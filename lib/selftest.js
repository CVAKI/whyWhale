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
    console.log('\n  ' + rf('⚠') + ' ' + ab('Self-test skipped — all generated files are long-running servers'));
    console.log('  ' + ab('  Start manually: ') + sd('node ' + servers[0].path));
    return { tested:false, skipped:true, reason:'server' };
  }
  if (servers.length) {
    console.log('  ' + rf('⚠') + ' ' + ab('Skipping server file(s): ') + sd(servers.map(f=>f.path).join(', ')));
  }

  let iter = 0;
  let lastResult = null;
  const MAX   = maxIter || 3;
  const queue = [...testable];

  while (iter < MAX && queue.length) {
    iter++;
    const testFile = queue[0];
    const runner   = isJestFile(testFile.full) ? 'Jest' : 'node';
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

  return `The code I wrote for ${testFile.path} failed when tested automatically.

Error output:
\`\`\`
${errText.slice(0, 900)}
\`\`\`
Exit code: 1

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
function runShell(cmd) {
  return new Promise(res => {
    exec(cmd, {timeout:30000, cwd:CWD(), shell:true}, (err,stdout,stderr) => {
      res({stdout:stdout||'', stderr:stderr||'', code:err?(err.code||1):0});
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
  saveSession, listSessions,
  runShell, copyClip,
};