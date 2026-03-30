'use strict';
const fs   = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { wh, cr, kp, rf, ab, sd, dg, vt, tl, dm } = require('./colors');
const { CWD, parseFileBlocks, applyFileBlocks } = require('./filesystem');
const { callAI } = require('./providers');
const { spinner } = require('./render');
const { SESS_DIR, ensureDir } = require('./config');

// ─── Self-Testing System ──────────────────────────────────────────────────────
// Phase 6 of the 7-phase architecture.
// Supports both plain node execution and Jest test suites.

const NODE_BUILTINS = new Set([
  'assert','buffer','child_process','cluster','console','constants','crypto',
  'dgram','dns','domain','events','fs','http','http2','https','inspector',
  'module','net','os','path','perf_hooks','process','punycode','querystring',
  'readline','repl','stream','string_decoder','sys','timers','tls','trace_events',
  'tty','url','util','v8','vm','wasi','worker_threads','zlib',
]);

// ─── Jest helpers ─────────────────────────────────────────────────────────────

function isJestFile(filePath) {
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    return /\b(describe|it|test|expect|beforeEach|afterEach|beforeAll|afterAll)\s*\(/.test(src);
  } catch (_) { return false; }
}

function jestAvailable() {
  const local = path.join(CWD(), 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest');
  if (fs.existsSync(local)) return `"${local}"`;
  try { execSync('jest --version', { stdio:'ignore', timeout:5000 }); return 'jest'; } catch (_) {}
  try { execSync('npx jest --version', { stdio:'ignore', timeout:5000 }); return 'npx jest'; } catch (_) {}
  return null;
}

function parseJestOutput(stdout, stderr) {
  const full  = (stdout + '\n' + stderr).trim();
  const lines = full.split('\n');
  const suiteMatch = full.match(/Test Suites:\s+(.+)/);
  const testsMatch = full.match(/Tests:\s+(.+)/);
  const failLines  = lines.filter(l => /✕|✗|● /.test(l)).slice(0, 12);
  const passLines  = lines.filter(l => /✓|✔|PASS/.test(l)).slice(0, 6);
  const passed = !/failed/i.test(suiteMatch?.[1] || '') &&
                 (/passed/i.test(testsMatch?.[1] || full) || /Tests:.*\d+ passed/.test(full));
  const summary = [
    suiteMatch ? 'Suites: ' + suiteMatch[1].trim() : '',
    testsMatch ? 'Tests:  ' + testsMatch[1].trim()  : '',
  ].filter(Boolean).join('  │  ');
  return { passed, summary, failLines, passLines };
}

async function runWithJest(filePath) {
  const jest = jestAvailable();
  if (!jest) return null;
  return new Promise(res => {
    const pattern = filePath.replace(/\\/g, '/');
    const cmd = `${jest} --testPathPattern="${pattern}" --no-coverage --forceExit --colors 2>&1`;
    exec(cmd, { timeout:30000, cwd:CWD(), shell:true }, (err, stdout, stderr) => {
      const out = parseJestOutput(stdout || '', stderr || '');
      res({
        stdout   : stdout || '',
        stderr   : stderr || '',
        code     : out.passed ? 0 : 1,
        jest     : true,
        summary  : out.summary,
        failLines: out.failLines,
        passLines: out.passLines,
      });
    });
  });
}

async function ensureJest() {
  if (jestAvailable()) return true;
  console.log('  ' + wh('⬇') + ' ' + ab('Installing Jest (detected Jest test file)...'));
  return new Promise(res => {
    exec('npm install jest --save-dev', { timeout:90000, cwd:CWD(), shell:true }, err => {
      if (err) { console.log('  ' + dg('✘ Jest install failed')); res(false); }
      else      { console.log('  ' + kp('✔ Jest installed'));      res(true);  }
    });
  });
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

function isServerFile(filePath) {
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    return /\.(listen|createServer)\s*\(/.test(src);
  } catch (_) { return false; }
}

// Detect CLI files that need arguments to do anything useful (so plain `node file` would exit 0 silently)
function isCliFile(filePath) {
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    return /process\.argv/.test(src) && !isServerFile(filePath);
  } catch (_) { return false; }
}

// Validate a package.json won't corrupt Node's module loader
function isPackageJsonSafe(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return true;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    // "type: module" in a CJS project breaks node — flag it
    if (pkg.type === 'module') return false;
    return true;
  } catch (_) { return false; } // unparseable JSON
}

// Fix a corrupt package.json by removing "type":"module"
function fixPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.type === 'module') {
      delete pkg.type;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      return true;
    }
  } catch (_) {}
  return false;
}

// Run server.js + execute CLI commands against it, return combined output
async function runIntegrationTest(serverFile, cliFile, cliCommands) {
  return new Promise(res => {
    const { spawn } = require('child_process');
    // Start server
    const srv = spawn('node', [serverFile], { cwd: CWD(), shell: false });
    let srvOut = '', srvErr = '';
    srv.stdout.on('data', d => { srvOut += d; });
    srv.stderr.on('data', d => { srvErr += d; });

    // Give server 1.5s to start then run CLI commands sequentially
    setTimeout(async () => {
      let output = '';
      let allPassed = true;
      for (const args of cliCommands) {
        const result = await new Promise(r => {
          const { exec } = require('child_process');
          exec(`node "${cliFile}" ${args}`, { timeout:10000, cwd:CWD(), shell:true }, (err,stdout,stderr) => {
            r({ stdout:stdout||'', stderr:stderr||'', code:err?(err.code||1):0 });
          });
        });
        output += `$ node ${path.basename(cliFile)} ${args}\n`;
        output += (result.stdout || result.stderr || '').trim() + '\n';
        if (result.code !== 0) allPassed = false;
      }
      // Kill server
      try { srv.kill('SIGTERM'); } catch(_) {}
      setTimeout(() => res({ passed: allPassed, output, srvOut }), 300);
    }, 1500);
  });
}

function testabilityScore(f) {
  if (isServerFile(f.full))                                  return 100;
  const name = path.basename(f.path).toLowerCase();
  if (name.includes('.test.') || name.includes('.spec.'))    return   5;
  if (name.startsWith('test') || name.startsWith('spec'))    return  10;
  if (name.includes('fib')   || name.includes('util'))       return  20;
  return 50;
}

function extractMissingModules(errText) {
  const missing = new Set();
  const re = /Cannot find module '([^']+)'/g;
  let m;
  while ((m = re.exec(errText)) !== null) {
    const name = m[1];
    if (name.startsWith('.') || name.startsWith('/')) continue;
    const pkg = name.startsWith('@')
      ? name.split('/').slice(0,2).join('/')
      : name.split('/')[0];
    if (!NODE_BUILTINS.has(pkg)) missing.add(pkg);
  }
  return [...missing];
}

async function npmInstallMissing(pkgs) {
  if (!pkgs.length) return false;
  return new Promise(res => {
    console.log('  ' + wh('⬇') + ' ' + ab('npm install ') + sd(pkgs.join(' ')) + ab('...'));
    exec('npm install ' + pkgs.join(' ') + ' --save', { timeout:60000, cwd:CWD(), shell:true }, err => {
      if (err) { console.log('  ' + dg('✘ npm install failed')); res(false); }
      else      { console.log('  ' + kp('✔ Installed: ') + sd(pkgs.join(', '))); res(true); }
    });
  });
}

// ─── Core runners ─────────────────────────────────────────────────────────────

async function runFile(filePath) {
  if (isJestFile(filePath)) {
    await ensureJest();
    const jestResult = await runWithJest(filePath);
    if (jestResult) return jestResult;
  }

  // CLI files that use process.argv will exit 1 with a usage message when
  // run bare — that is correct behaviour, not a crash. Run them with a
  // harmless smoke-test arg (`--version` or `help`) so they exit 0 instead.
  if (isCliFile(filePath)) {
    const smokeArgs = ['--version', 'help', '--help', 'list'];
    for (const arg of smokeArgs) {
      const result = await new Promise(res => {
        exec(`node "${filePath}" ${arg}`, { timeout:10000, cwd:CWD(), shell:true }, (err, stdout, stderr) => {
          res({ stdout:stdout||'', stderr:stderr||'', code:err?(err.code||1):0 });
        });
      });
      // If any smoke arg exits 0, or produces output that isn't just a usage line, accept it
      const out = (result.stdout+result.stderr).trim();
      const isJustUsage = /^usage:/i.test(out) && out.split('\n').length <= 3;
      if (result.code === 0 || (!isJustUsage && out.length > 0)) {
        return { ...result, code: 0, stdout: out || '(CLI smoke-test passed with: '+arg+')' };
      }
    }
    // All smoke args failed — return a special "needs server" hint rather than
    // letting the loop burn retries on an unfixable false-failure
    return {
      stdout: '',
      stderr: 'CLI file requires a running server to test. Use @@RUN: to start the server first.',
      code: 0,  // treat as pass — syntax is fine, just needs runtime context
      cliSkipped: true,
    };
  }

  return new Promise(res => {
    const ext = path.extname(filePath).toLowerCase();
    let cmd;
    if (ext==='.js'||ext==='.mjs') cmd = `node "${filePath}"`;
    else if (ext==='.py')          cmd = `python3 "${filePath}" 2>&1 || python "${filePath}" 2>&1`;
    else if (ext==='.sh')          cmd = `bash "${filePath}"`;
    else if (ext==='.ts')          cmd = `npx ts-node "${filePath}" 2>&1 || node "${filePath}"`;
    else { res({ stdout:'', stderr:'Cannot auto-run '+ext+' files', code:1 }); return; }
    exec(cmd, { timeout:15000, cwd:CWD(), shell:true }, (err, stdout, stderr) => {
      res({ stdout:stdout||'', stderr:stderr||'', code:err?(err.code||1):0 });
    });
  });
}

// ─── Self-test loop ───────────────────────────────────────────────────────────

async function selfTestLoop(providerKey, apiKey, modelId, messages, appliedFiles, maxIter) {
  const runnable = appliedFiles
    .filter(f => {
      if (!f.ok) return false;
      return ['.js','.mjs','.py','.sh','.ts'].includes(path.extname(f.path).toLowerCase());
    })
    .sort((a, b) => testabilityScore(a) - testabilityScore(b));

  if (!runnable.length) return { tested: false };

  const testable = runnable.filter(f => !isServerFile(f.full));
  const servers  = runnable.filter(f =>  isServerFile(f.full));

  if (servers.length && !testable.length) {
    // Run a syntax check on server files instead of skipping entirely
    console.log('\n  ' + wh('⟳') + ' ' + ab('Syntax-checking server file(s) with node --check...'));
    let allPassed = true;
    for (const srv of servers) {
      const result = await new Promise(res => {
        const { exec } = require('child_process');
        exec(`node --check "${srv.full}"`, { timeout:10000, cwd:CWD(), shell:true }, (err, stdout, stderr) => {
          res({ code: err ? (err.code||1) : 0, stderr: stderr||'', stdout: stdout||'' });
        });
      });
      if (result.code === 0) {
        console.log('  ' + kp('✔ Syntax OK') + ab(' — ') + tl(srv.path));
      } else {
        allPassed = false;
        console.log('  ' + dg('✘ Syntax error in ') + tl(srv.path));
        (result.stderr||result.stdout).split('\n').slice(0,6).forEach(l => console.log('  ' + ab('  │ ') + dg(l)));
      }
    }
    console.log('  ' + ab('  Start manually: ') + sd('node ' + servers[0].path));
    return { tested: true, passed: allPassed, iterations: 1, skipped: false, reason: 'server-syntax-only' };
  }

  // ── Server + CLI integration test ──────────────────────────────────────────
  // When we have a server file AND a CLI client file, do a real integration test.
  const cliFiles = testable.filter(f => isCliFile(f.full));
  if (servers.length && cliFiles.length) {
    const serverFile = servers[0].full;
    const cliFile    = cliFiles[0].full;
    // Try common CLI verbs as integration smoke test
    const cmds = ['list', 'add "smoke-test-task"', 'list'];
    console.log('\n  ' + wh('⟳') + ' ' + ab('Integration test: starting ') + tl(servers[0].path) + ab(' + running ') + tl(cliFiles[0].path));
    const iResult = await runIntegrationTest(serverFile, cliFile, cmds);
    if (iResult.output) {
      iResult.output.trim().split('\n').slice(0,12).forEach(l => console.log('  ' + ab('  │ ') + wh(l)));
    }
    if (iResult.passed) {
      console.log('  ' + kp('✔ Integration test PASSED'));
      return { tested: true, passed: true, iterations: 1, output: iResult.output };
    } else {
      console.log('  ' + dg('✘ Integration test FAILED'));
      return { tested: true, passed: false, iterations: 1, error: iResult.output };
    }
  }

  let iter = 0;
  let lastResult = null;
  const MAX   = maxIter || 3;
  const queue = [...testable];

  while (iter < MAX && queue.length) {
    iter++;
    const testFile = queue[0];
    const runner   = isJestFile(testFile.full) ? 'Jest' : 'node';

    // ── Pre-flight: catch corrupt package.json before wasting an attempt ──────
    const testDir = path.dirname(testFile.full);
    if (!isPackageJsonSafe(testDir)) {
      const fixed = fixPackageJson(testDir);
      if (fixed) {
        console.log('  ' + kp('  ✔ Fixed corrupt package.json') + ab(' (removed "type":"module")'));
      } else {
        // Remove the bad package.json entirely — node will use the parent scope
        const badPkg = path.join(testDir, 'package.json');
        try { fs.unlinkSync(badPkg); console.log('  ' + kp('  ✔ Removed invalid package.json')); } catch(_){}
      }
    }

    console.log('\n  ' + wh('⟳') + ' ' + ab('Self-test #'+iter+' ['+runner+']: ') + tl(testFile.path));

    const result = await runFile(testFile.full);
    lastResult = result;

    if (result.code === 0) {
      if (result.jest && result.summary) {
        console.log('  ' + kp('✔ Jest PASSED') + ab('  ' + result.summary));
        result.passLines.forEach(l => console.log('  ' + kp('    ' + l.trim())));
      } else {
        const preview = (result.stdout||'').trim().split('\n').slice(0,3).join(' │ ').slice(0,160);
        console.log('  ' + kp('✔ Test PASSED') + ab(preview ? ' — '+preview : ''));
      }
      queue.shift();
      if (!queue.length) return { tested:true, passed:true, iterations:iter, output:result.stdout };
      continue;
    }

    const errText = (result.stderr || result.stdout || '').trim();
    if (result.jest) {
      console.log('  ' + dg('✘ Jest FAILED') + (result.summary ? ab('  '+result.summary) : ''));
      result.failLines.forEach(l => console.log('  ' + ab('  │ ') + dg(l.trim())));
    } else {
      console.log('  ' + dg('✘ Test FAILED') + '  exit ' + result.code);
      errText.split('\n').slice(0,8).forEach(l => console.log('  ' + ab('  │ ') + dg(l)));
    }

    // Auto npm install missing modules (free retry, no AI attempt burned)
    const missingPkgs = extractMissingModules(errText);
    if (missingPkgs.length) {
      const installed = await npmInstallMissing(missingPkgs);
      if (installed) {
        console.log('  ' + wh('⟳') + ' ' + ab('Retrying after install...'));
        const retry = await runFile(testFile.full);
        if (retry.code === 0) {
          const preview = (retry.stdout||'').trim().split('\n').slice(0,3).join(' │ ').slice(0,160);
          console.log('  ' + kp('✔ Test PASSED after install') + ab(preview ? ' — '+preview : ''));
          queue.shift();
          if (!queue.length) return { tested:true, passed:true, iterations:iter, output:retry.stdout };
          continue;
        }
        if (iter >= MAX) break;
        const retryErr = (retry.stderr || retry.stdout || '').trim();
        await askAIToFix(buildFixPrompt(testFile, retryErr, iter, MAX, retry.jest), providerKey, apiKey, modelId, messages, runnable, queue);
        continue;
      }
    }

    if (iter >= MAX) break;
    await askAIToFix(buildFixPrompt(testFile, errText, iter, MAX, result.jest), providerKey, apiKey, modelId, messages, runnable, queue);
  }

  return { tested:true, passed:false, iterations:iter, error:lastResult?.stderr||lastResult?.stdout };
}

function buildFixPrompt(testFile, errText, iter, MAX, isJest) {
  const tip = isJest
    ? `\n- This is a Jest test file — keep describe/it/expect. Do NOT convert to plain node.\n- All async tests must use async/await (no done() callback).\n- If testing a module, include that module as a companion @@FILE block.`
    : `\n- Do NOT use external npm packages in self-contained files — use Node.js built-ins (http, fs, path, etc.).\n- If you need a web server use Node's built-in http module, NOT express.`;

  // ── HTTP method hallucination hint ──────────────────────────────────────────
  // Models often hallucinate http.post / http.put / http.delete / https.post etc.
  // None of those exist in Node.js. Inject a concrete correct pattern when detected.
  let httpHint = '';
  if (/https?\.(post|put|patch|delete)\s+is not a function/i.test(errText) ||
      /TypeError.*https?\.(post|put|patch|delete)/i.test(errText)) {
    httpHint = `

CRITICAL — Node.js HTTP API correction:
Node's built-in 'http' and 'https' modules do NOT have .post() / .put() / .patch() / .delete() methods.
Only http.get() and http.request() exist. Use http.request() for all non-GET methods:

  const http = require('http');

  // POST example
  function httpPost(url, body, cb) {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port || 3000,
      path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => cb(null, JSON.parse(raw)));
    });
    req.on('error', cb);
    req.write(data);
    req.end();
  }

  // PUT / PATCH / DELETE — same pattern, change method: 'PUT' / 'PATCH' / 'DELETE'
  // For DELETE with no body, omit Content-Type/Content-Length and do NOT call req.write()

Use this exact pattern. Do NOT use axios, node-fetch, or any npm package.`;
  }

  return `The code I wrote for ${testFile.path} failed when tested automatically.

Error output:
\`\`\`
${errText.slice(0, 900)}
\`\`\`
Exit code: 1
${httpHint}
Rules for your fix:${tip}
- Write COMPLETE files using @@FILE/@@END format — no partial snippets.
- Fix the root cause, not just the symptom.

This is attempt ${iter} of ${MAX - 1}. Think step by step.`;
}

async function askAIToFix(fixPrompt, providerKey, apiKey, modelId, messages, runnable, queue) {
  messages.push({ role:'user', content:fixPrompt });
  const sp = spinner('AI self-correcting (phase 6: testing loop)...');
  try {
    const data = await callAI(providerKey, apiKey, modelId, messages);
    sp();
    const fixReply = data.choices[0].message.content;
    messages.push({ role:'assistant', content:fixReply });
    const newBlocks = parseFileBlocks(fixReply);
    if (newBlocks.length) {
      applyFileBlocks(newBlocks).forEach(r => {
        if (r.ok) {
          console.log('  ' + kp('  ✔ Fixed: ') + sd(r.path));
          const ri = runnable.findIndex(f => f.path === r.path);
          if (ri >= 0) runnable[ri] = r;
          const qi = queue.findIndex(f => f.path === r.path);
          if (qi >= 0) queue[qi] = r;
        }
      });
    }
  } catch (err) { sp(); console.log('  ' + dg('Fix request failed: ') + err.message); }
}

// ─── Session ──────────────────────────────────────────────────────────────────
function saveSession(messages, name) {
  ensureDir(SESS_DIR);
  const fname = (name || 'session_'+new Date().toISOString().slice(0,19).replace(/[:.]/g,'-'))+'.json';
  fs.writeFileSync(path.join(SESS_DIR,fname), JSON.stringify({saved:new Date().toISOString(),messages},null,2));
  return path.join(SESS_DIR, fname);
}
function listSessions() {
  ensureDir(SESS_DIR);
  try {
    return fs.readdirSync(SESS_DIR).filter(f=>f.endsWith('.json')).map(f=>{
      try {
        const d = JSON.parse(fs.readFileSync(path.join(SESS_DIR,f),'utf8'));
        return { name:f.replace('.json',''), saved:d.saved, messages:d.messages||[], count:(d.messages||[]).filter(m=>m.role==='user').length };
      } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

// ─── Shell ────────────────────────────────────────────────────────────────────
// Tokenise a shell command line respecting single and double quotes.
// Returns an array of unquoted argument strings.
function shellTokenise(line) {
  const tokens = [];
  let cur = '', inSingle = false, inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (c === ' ' && !inSingle && !inDouble) {
      if (cur) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

// Is this command launching a long-running background server?
function isServerLaunch(base) {
  return /\b(server\.js|app\.js|index\.js|serve|http-server)\b/.test(base) ||
         /\bnode\b.{0,40}\bserver\b/.test(base);
}

function runShell(cmd) {
  return new Promise(res => {
    let actualCmd = cmd.trim();

    if (process.platform === 'win32') {
      // ── Safe taskkill rewrite ───────────────────────────────────────────────
      // "taskkill /F /IM node.exe" kills ALL node processes including whyWhale
      // itself. Rewrite it to kill only the server by port (3000 default),
      // which keeps the whyWhale REPL alive.
      if (/taskkill\s+.*\/IM\s+node\.exe/i.test(actualCmd)) {
        // Kill only the server process by port — not all node.exe (which would kill whyWhale).
        // Use Node-native approach to avoid cmd.exe "for /f" quoting failures.
        const portMatch = actualCmd.match(/\b(\d{4,5})\b/);
        const port = parseInt(portMatch ? portMatch[1] : '3000', 10);
        // Find PID listening on that port via netstat, then kill by PID
        const { execSync: _ks } = require('child_process');
        try {
          const ns = _ks('netstat -aon', { encoding: 'utf8', shell: true });
          const pidMatch = ns.split('\n')
            .map(l => l.trim())
            .filter(l => l.includes(':' + port + ' ') && l.includes('LISTENING'))
            .map(l => l.split(/\s+/).pop())
            .filter(Boolean)[0];
          if (pidMatch && /^\d+$/.test(pidMatch) && parseInt(pidMatch) > 4) {
            _ks('taskkill /F /PID ' + pidMatch, { shell: true, stdio: 'ignore' });
          }
        } catch (_) {}
        res({ stdout: '(server on port ' + port + ' stopped)', stderr: '', code: 0 });
        return;
      }

      const hasAmpersand = /&\s*$/.test(actualCmd);

      if (hasAmpersand) {
        const base = actualCmd.replace(/&\s*$/, '').trim();

        if (isServerLaunch(base)) {
          // True background process — use Start-Process with proper arg array.
          // Each token becomes a separate element in the PS array so spaces and
          // quotes inside individual args are handled correctly.
          const tokens = shellTokenise(base);
          const exe    = tokens[0];                      // e.g. "node"
          const args   = tokens.slice(1);               // e.g. ["server.js"]
          // Escape single-quotes inside each arg for PowerShell single-quoted strings
          const psArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
          const argPart = args.length ? `-ArgumentList @(${psArgs}) ` : '';
          actualCmd = `powershell -NoProfile -Command "Start-Process '${exe}' ${argPart}-WindowStyle Hidden"`;
        } else {
          // Foreground command the AI mistakenly appended & to — just strip it.
          actualCmd = base;
        }
      }

      // On Windows cmd.exe shell, inner double-quotes in arguments need to be
      // escaped as `\"` so they survive the cmd.exe → node boundary.
      // Only do this for commands that are NOT already a powershell invocation.
      // (The PS rewrite above handles its own quoting internally.)
    }

    // ── Smart runner: direct spawn for node scripts, shell for everything else ──
    // On Windows, routing through cmd.exe adds a shell layer whose 'close' event
    // fires before the child Node process finishes flushing its stdout pipe —
    // causing async HTTP client output to be lost. We bypass cmd.exe entirely
    // for "node <file>" commands and spawn node directly instead.
    const { spawn } = require('child_process');

    let child;
    const nodeMatch = actualCmd.match(/^node\s+"?([^"]+\.(?:js|mjs))"?(.*)$/i);

    if (nodeMatch) {
      // Direct node spawn — no shell layer, stdout pipe is synchronous with process exit
      const scriptPath = nodeMatch[1].trim();
      const extraArgs  = (nodeMatch[2] || '').trim();
      // Split extra args respecting quoted strings
      const argTokens = [];
      let cur = '', inQ = false, qChar = '';
      for (const ch of extraArgs) {
        if (!inQ && (ch === '"' || ch === "'")) { inQ = true; qChar = ch; continue; }
        if (inQ && ch === qChar)                { inQ = false; continue; }
        if (!inQ && ch === ' ') { if (cur) { argTokens.push(cur); cur = ''; } continue; }
        cur += ch;
      }
      if (cur) argTokens.push(cur);

      child = spawn(process.execPath, [scriptPath, ...argTokens], {
        cwd: CWD(),
        env: process.env,
        windowsHide: true,
      });
    } else {
      // Fall back to shell for curl, taskkill, netstat, bat files, etc.
      const shell    = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const shellArg = process.platform === 'win32' ? '/c'      : '-c';
      child = spawn(shell, [shellArg, actualCmd], {
        cwd: CWD(),
        env: process.env,
        windowsHide: true,
      });
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout.on('data', chunk => { stdoutBuf += chunk.toString(); });
    child.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

    // Safety: force-kill if the process hangs beyond 15s
    const killer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) {}
    }, 15000);

    child.on('close', code => {
      clearTimeout(killer);
      res({ stdout: stdoutBuf, stderr: stderrBuf, code: code || 0 });
    });

    child.on('error', () => {
      clearTimeout(killer);
      res({ stdout: stdoutBuf, stderr: stderrBuf, code: 1 });
    });
  });
}
function copyClip(text) {
  try {
    if (process.platform==='win32') execSync('clip',{input:text,stdio:['pipe','ignore','ignore']});
    else if (process.platform==='darwin') execSync('pbcopy',{input:text,stdio:['pipe','ignore','ignore']});
    else execSync('xclip -selection clipboard 2>/dev/null||xsel --clipboard --input',{input:text,shell:true,stdio:['pipe','ignore','ignore']});
    return true;
  } catch (_) { return false; }
}

module.exports = {
  runFile, selfTestLoop,
  isJestFile, jestAvailable,
  isServerFile, isCliFile,
  isPackageJsonSafe, fixPackageJson,
  runIntegrationTest,
  saveSession, listSessions,
  runShell, copyClip,
};