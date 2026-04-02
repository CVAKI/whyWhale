'use strict';

/**
 * lib/main/aiHandler.js
 *
 * Terminal AI message handler for the main whyWhale REPL.
 *
 * FIXES in this version:
 *   1. spinner() now receives ctx.mode so it displays:
 *      [⠸]──[ whyWhale ]──[◈ agent]──thinking::[5:048]
 *   2. lastReply is the ONLY source of reply — chunks fallback removed entirely.
 *      Spinner output was leaking into chunks[] and being returned as the reply.
 *   3. Ollama fetch retry: up to 3 attempts with 2s backoff before failing.
 */

const path = require('path');
const fs   = require('fs');

const { loadConfig, loadMemory, saveMemory } = require('../config');
const { formatMD, spinner, createPhaseTracker } = require('../render');
const { ab, cr, dg, kp, rf, wh, tl, sd }       = require('../colors');
const { selfTestLoop }                           = require('../selftest');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// safeCmd — rewrites dangerous "kill all node.exe" commands so they spare
// the running whyWhale process (and its parent shell) by excluding our own PID.
function safeCmd(cmd) {
  const myPid = process.pid;

  if (process.platform === 'win32') {
    // taskkill /F /IM node.exe  →  PowerShell kill excluding our PID
    if (/taskkill\b.*\/IM\s+node\.exe/i.test(cmd)) {
      return (
        `powershell -NoProfile -Command ` +
        `"Get-Process node -ErrorAction SilentlyContinue ` +
        `| Where-Object { $_.Id -ne ${myPid} } ` +
        `| Stop-Process -Force"`
      );
    }
  } else {
    // killall node / pkill node  →  kill only node server.js, spare us
    if (/\b(killall|pkill)\s+(-\w+\s+)*node\b/i.test(cmd)) {
      return `pkill -f "node server\\.js" 2>/dev/null; pkill -f "node client\\.js" 2>/dev/null; true`;
    }
  }
  return cmd;
}

function runShell(cmd) {
  const { execSync } = require('child_process');
  cmd = safeCmd(cmd);
  try {
    const out = execSync(cmd, {
      encoding: 'utf8', timeout: 30_000,
      cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: out, stderr: '', code: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || e.message, code: e.status || 1 };
  }
}

function parseDirectives(text) {
  const results = { files: [], runs: [], memory: [] };

  // @@FILE: path\n...content...\n@@END
  // Tolerates Windows \r\n, spaces after colon, and blank lines before content
  const fileRe = /@@FILE:\s*([^\r\n]+)\r?\n([\s\S]*?)@@END/g;
  const runRe  = /@@RUN:\s*([^\r\n]+)/g;
  const memRe  = /@@MEMORY:\s*([^=\r\n]+)=([^\r\n]+)/g;

  let m;
  while ((m = fileRe.exec(text)) !== null)
    results.files.push({ path: m[1].trim(), content: m[2] });

  // Deduplicate @@RUN: lines (model sometimes repeats them)
  const seenRuns = new Set();
  while ((m = runRe.exec(text)) !== null) {
    const cmd = m[1].trim();
    if (!seenRuns.has(cmd)) { seenRuns.add(cmd); results.runs.push(cmd); }
  }

  while ((m = memRe.exec(text)) !== null)
    results.memory.push({ key: m[1].trim(), value: m[2].trim() });

  return results;
}

async function executeDirectives(directives, ctx) {
  const lines = [];

  for (const f of directives.files) {
    try {
      const abs = path.isAbsolute(f.path)
        ? f.path
        : path.join(process.cwd(), f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // Strip markdown code fences if model wrapped content in them
      let fileContent = f.content;
      fileContent = fileContent.replace(/^```[\w]*\r?\n/, '').replace(/\r?\n```[\s]*$/, '');
      fs.writeFileSync(abs, fileContent, 'utf8');
      lines.push('  ' + ab('📄 wrote ') + tl(f.path));
    } catch (e) {
      lines.push('  ' + rf('✘ write failed: ') + f.path + ' — ' + e.message);
    }
  }

  for (let cmd of directives.runs) {
    // Windows safety: convert Unix background operator & → start /B
    if (process.platform === 'win32') {
      if (/&\s*$/.test(cmd)) {
        cmd = 'start /B ' + cmd.replace(/&\s*$/, '').trim();
      } else {
        // Auto-background bare `node server.js` style commands so they don't hang
        const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
        if (nodeServerPat.test(cmd.trim())) {
          const parts = cmd.split('&&').map(s => s.trim());
          parts[parts.length - 1] = 'start /B ' + parts[parts.length - 1];
          cmd = parts.join(' && ');
        }
      }
    }

    lines.push('  ' + ab('⚡ ') + wh('$ ' + cmd));
    const r = runShell(cmd);
    if (r.stdout.trim())
      lines.push(r.stdout.trim().split('\n').map(l => '    ' + l).join('\n'));
    if (r.stderr.trim())
      lines.push('  ' + rf(r.stderr.trim().split('\n').map(l => '    ' + l).join('\n')));
    if (r.code !== 0)
      lines.push('  ' + rf('  exit ' + r.code));
  }

  if (directives.memory.length > 0) {
    const mem = loadMemory();
    if (!mem.facts) mem.facts = {};
    for (const { key, value } of directives.memory) {
      mem.facts[key] = value;
      lines.push('  ' + ab('💾 memory: ') + sd(key) + ' = ' + tl(value));
    }
    try { saveMemory(mem); } catch (_) {}
    if (ctx && ctx.mem) Object.assign(ctx.mem, mem);
  }

  return lines.join('\n');
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx) {
  const mem = ctx.mem || loadMemory();

  const memLines = Object.entries(mem?.facts || {})
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const skillLines = (ctx.skills || [])
    .map(s => `- ${s.name}: ${s.description || ''}`).join('\n');

  const isAgent = (ctx.mode || 'code') === 'agent';
  const platform = process.platform;
  const bgCmd = platform === 'win32' ? 'start /B node server.js' : 'node server.js &';

  const directiveBlock = [
    '╔══════════════════════════════════════════════════════════╗',
    '║  FILE CREATION — YOU MUST USE THIS FORMAT EXACTLY       ║',
    '╚══════════════════════════════════════════════════════════╝',
    '',
    'To write a file — START YOUR RESPONSE with this (no prose before it):',
    '@@FILE: relative/path/filename.js',
    '// full file content — no truncation, no placeholders, no "// rest of file"',
    '@@END',
    '',
    'To run a shell command after writing files:',
    '@@RUN: node client.js list',
    '',
    'To save a memory fact:',
    '@@MEMORY: key=value',
    '',
    'ABSOLUTE RULES — VIOLATION = BROKEN OUTPUT:',
    '1. @@FILE: / @@END is the ONLY way to write files. NEVER use markdown code blocks for files.',
    '2. Every @@FILE: block MUST contain COMPLETE file content. No "..." or "// TODO" or truncation.',
    '3. @@FILE: path must be relative (e.g. client.js  NOT /absolute/path/client.js).',
    '4. After writing files, add @@RUN: lines if execution is needed.',
    `5. To start a background server on this platform (${platform}): @@RUN: ${bgCmd}`,
    `6. To stop the server on this platform — Windows: @@RUN: powershell -Command "Get-Process node | Where-Object { $_.Id -ne ${process.pid} } | Stop-Process -Force"   Linux/Mac: @@RUN: pkill -f "node server.js"`,
    '7. NEVER use "taskkill /F /IM node.exe" or "killall node" — those kill ALL node processes including whyWhale itself.',
    '8. You MAY chain multiple @@FILE: and @@RUN: blocks in one reply.',
    '9. If a file is large, write it in full — do NOT skip lines.',
    '10. NEVER output a markdown ```code block``` when creating a file. Use @@FILE: instead.',
  ].join('\n');

  const agentExtra = isAgent ? [
    '',
    '╔══════════════════════════════════════════════════════════╗',
    '║  AGENT MODE — AUTONOMOUS EXECUTION                      ║',
    '╚══════════════════════════════════════════════════════════╝',
    'You are in AGENT mode. Rules:',
    '  • Write ALL requested files immediately using @@FILE:/@@END — NOT markdown blocks.',
    '  • Begin your response with the first @@FILE: block. No preamble.',
    '  • Execute ALL requested shell commands using @@RUN:',
    '  • Complete the ENTIRE task autonomously. Do not ask clarifying questions.',
    '  • After all @@FILE: and @@RUN: blocks, write a 2-line plain-text summary.',
  ].join('\n') : '';

  return [
    'You are whyWhale, an elite AI coding assistant running inside a terminal.',
    directiveBlock,
    agentExtra,
    '',
    `Current mode: ${ctx.mode || 'code'}`,
    `Working directory: ${process.cwd()}`,
    `Platform: ${platform}`,
    ctx.folderCtx  ? `\nProject context:\n${ctx.folderCtx}` : '',
    skillLines     ? `\nLoaded skills:\n${skillLines}` : '',
    memLines       ? `\nMemory:\n${memLines}` : '',
  ].filter(Boolean).join('\n');
}

// ─── Provider call with retry ─────────────────────────────────────────────────

async function callProvider(ctx, messages, retries = 3) {
  const cfg     = loadConfig();
  const provKey = ctx.providerKey || cfg.provider || 'anthropic';
  const model   = ctx.modelId     || cfg.model    || 'claude-opus-4-20250514';
  const apiKey  = ctx.apiKey      || cfg.apiKey   || '';

  let lastErr;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        // Wait 2s between retries
        await new Promise(r => setTimeout(r, 2000));
        process.stdout.write('\r  ' + ab('⟳ retrying... (attempt ' + attempt + '/' + retries + ')') + '   ');
      }

      if (provKey === 'anthropic') {
        if (!apiKey) throw new Error('No API key. Run `whywhale --setup`.');
        const sysMsg   = messages.find(m => m.role === 'system');
        const chatMsgs = messages.filter(m => m.role !== 'system');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model, max_tokens: 4096,
            system:   sysMsg?.content || '',
            messages: chatMsgs,
            stream:   false,
          }),
        });
        if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
        const data = await res.json();
        if (ctx) ctx.totalTok = (ctx.totalTok || 0) +
          (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
        return data.content?.[0]?.text || '';
      }

      if (provKey === 'ollama') {
        const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const res  = await fetch(`${base}/api/chat`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ model, messages, stream: false }),
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.message?.content || '';
      }

      // OpenRouter / Groq
      const URLS = {
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
      };
      const url = URLS[provKey];
      if (!url) throw new Error(`Unknown provider: ${provKey}`);
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ model, messages }),
      });
      if (!res.ok) throw new Error(`${provKey} ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (ctx) ctx.totalTok = (ctx.totalTok || 0) + (data.usage?.total_tokens || 0);
      return data.choices?.[0]?.message?.content || '';

    } catch (err) {
      lastErr = err;
      if (attempt < retries) continue;
    }
  }

  throw lastErr;
}

// ─── handleAiMessage ──────────────────────────────────────────────────────────
//
// Called by lib/main/index.js as: await handleAiMessage(text, ctx)

async function handleAiMessage(text, ctx) {
  if (!ctx || !ctx.prov) {
    console.log('\n  ' + rf('✘ Provider not ready. Run `whywhale --setup`.'));
    return;
  }

  if (!Array.isArray(ctx.messages)) ctx.messages = [];

  const tracker = createPhaseTracker(7);
  const tw      = Math.min((process.stdout.columns || 80) - 4, 100);
  console.log('\n  ' + ab('─'.repeat(tw)));

  // ── Phase 1: Tokenization ────────────────────────────────────────────────
  tracker.start(1, 'Tokenizing intent');
  if (ctx.mode) tracker.note(1, 'mode: ' + ctx.mode);
  tracker.done(1);

  // ── Phase 2: Context assembly ─────────────────────────────────────────────
  tracker.start(2, 'Assembling context');
  const mem       = ctx.mem || loadMemory();
  const factCount = Object.keys(mem?.facts || {}).length;
  const skillCount= (ctx.skills || []).length;
  tracker.note(2, [
    factCount  ? factCount  + ' memory facts' : null,
    skillCount ? skillCount + ' skills'       : null,
    ctx.folderCtx ? 'folder context loaded'  : null,
  ].filter(Boolean).join(' · ') || 'no extra context');

  const systemPrompt = buildSystemPrompt(ctx);
  ctx.messages.push({ role: 'user', content: text });
  if (ctx.messages.length > 80) ctx.messages.splice(0, ctx.messages.length - 80);
  ctx.msgN = (ctx.msgN || 0) + 1;
  if (ctx.statusRef) ctx.statusRef.msgCount = ctx.msgN;
  tracker.done(2);

  // ── Phase 3: Provider call ────────────────────────────────────────────────
  const cfg     = loadConfig();
  const provKey = ctx.providerKey || cfg.provider || 'anthropic';
  const modelId = ctx.modelId     || cfg.model    || '';
  tracker.start(3, 'Calling ' + provKey);
  tracker.note(3, (provKey === 'ollama' ? 'local · ' : '') + (modelId || 'default model'));

  // ── Activity labels per mode — what the model is likely doing at each second ─
  const ACTIVITY = {
    agent: [
      [0,  'reading your request'],
      [3,  'understanding the task'],
      [8,  'planning file structure'],
      [15, 'writing code'],
      [30, 'building full implementation'],
      [60, 'generating output'],
      [90, 'finalizing files'],
    ],
    code: [
      [0,  'reading your question'],
      [4,  'thinking through solution'],
      [12, 'writing the code'],
      [30, 'reviewing the logic'],
      [60, 'finalizing response'],
    ],
    debug: [
      [0,  'reading the error'],
      [3,  'tracing the issue'],
      [8,  'identifying root cause'],
      [18, 'building the fix'],
      [40, 'verifying solution'],
    ],
    architect: [
      [0,  'reading the requirements'],
      [4,  'designing the system'],
      [12, 'planning architecture'],
      [25, 'detailing components'],
      [50, 'writing diagrams'],
    ],
    review: [
      [0,  'reading the code'],
      [4,  'analysing quality'],
      [10, 'checking edge cases'],
      [20, 'writing feedback'],
    ],
    explain: [
      [0,  'reading the topic'],
      [4,  'building explanation'],
      [12, 'adding examples'],
      [25, 'simplifying language'],
    ],
    plan: [
      [0,  'reading the goal'],
      [4,  'breaking down tasks'],
      [12, 'ordering priorities'],
      [25, 'writing the plan'],
    ],
  };

  function getActivityLabel(mode, elapsedSec) {
    const steps = ACTIVITY[mode] || ACTIVITY.code;
    let label = steps[0][1];
    for (const [sec, lbl] of steps) {
      if (elapsedSec >= sec) label = lbl; else break;
    }
    return label;
  }

  let reply = '';
  const t0  = Date.now();

  // ── Live spinner — label updates every 80ms based on elapsed time ────────
  const spin = spinner(getActivityLabel(ctx.mode || 'code', 0), ctx.mode);

  // Separate interval to update the label as time progresses
  const labelIv = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    spin.update(getActivityLabel(ctx.mode || 'code', sec));
  }, 500);

  try {
    reply = await callProvider(ctx, [
      { role: 'system', content: systemPrompt },
      ...ctx.messages,
    ]);
  } catch (err) {
    clearInterval(labelIv);
    spin.stop();
    tracker.fail(3, err.message);
    ctx.messages.pop();
    return;
  }
  clearInterval(labelIv);
  spin.stop();
  const elapsed3 = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  tracker.done(3, elapsed3);

  // ── Phase 4: Thinking / parsing ────────────────────────────────────────────
  tracker.start(4, 'Parsing AI response');
  ctx.messages.push({ role: 'assistant', content: reply });
  ctx.lastReply = reply;
  tracker.done(4);

  // ── Phase 5: Code generation / directive extraction ───────────────────────
  tracker.start(5, 'Extracting files & commands');
  let directives = parseDirectives(reply);

  // ── Markdown fallback — local models that ignore @@FILE: ─────────────────
  // Three patterns, tried in order, to catch how different models reference files.
  if (directives.files.length === 0) {

    // Pattern 1: filename in text IMMEDIATELY BEFORE the code block
    // Catches: "Save as `client.js`", "### client.js", "Create client.js then..."
    const beforeBlockRe = /(?:###?\s*|`{1,3}|[Ss]ave (?:it )?as\s+|[Cc]reate\s+|[Ff]ile(?:name)?[:\s]+)([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})[`\s]*\n*```(?:[a-z]*)\n([\s\S]*?)```/gi;
    let bm;
    while ((bm = beforeBlockRe.exec(reply)) !== null) {
      const fpath = bm[1].trim().replace(/\\/g, '/');
      if (!fpath.includes(' ') && fpath.length < 120)
        directives.files.push({ path: fpath, content: bm[2] });
    }

    // Pattern 2: filename as first-line comment INSIDE the code block
    // Catches: ```js\n// client.js\n...``` or ```\n# server.py\n...```
    if (directives.files.length === 0) {
      const codeBlockRe = /```(?:[a-z]*)\n([\s\S]*?)```/g;
      let cm;
      while ((cm = codeBlockRe.exec(reply)) !== null) {
        const blockContent = cm[1];
        const firstLine = blockContent.match(/^(?:\/\/|#|<!--)\s*([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})\s*(?:-->)?\r?\n/);
        if (firstLine) {
          const fpath = firstLine[1].trim().replace(/\\/g, '/');
          if (!fpath.includes(' ') && fpath.length < 80) {
            const contentWithoutComment = blockContent.slice(firstLine[0].length);
            directives.files.push({ path: fpath, content: contentWithoutComment });
          }
        }
      }
    }

    // Pattern 3: filename anywhere in the ~400 chars before each code block
    // Catches prose like "The following client.js handles..." then code block
    if (directives.files.length === 0) {
      const splitParts = reply.split(/(```[a-z]*\n[\s\S]*?```)/g);
      for (let pi = 1; pi < splitParts.length; pi += 2) {
        const block      = splitParts[pi];
        const beforeText = splitParts[pi - 1] || '';
        const contentM   = block.match(/```[a-z]*\n([\s\S]*?)```/);
        if (!contentM) continue;
        const blockContent = contentM[1];
        const nameM =
          beforeText.slice(-400).match(/`([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})`[^`\n]{0,60}$/) ||
          beforeText.slice(-300).match(/\b([a-zA-Z0-9_.\/\\-]+\.(?:js|ts|py|php|rb|go|rs|java|cpp|c|html|css|json|yaml|yml|sh|cmd|bat|ps1|md|txt))\b[^.\n]{0,80}$/i);
        if (nameM) {
          const fpath = nameM[1].replace(/\\/g, '/');
          if (!directives.files.some(f => f.path === fpath))
            directives.files.push({ path: fpath, content: blockContent });
        }
      }
    }

    if (directives.files.length > 0)
      tracker.note(5, '⟳ auto-extracted ' + directives.files.length + ' file(s) from markdown (model ignored @@FILE: format)');
  }

  const hasWork = directives.files.length > 0 ||
                  directives.runs.length  > 0 ||
                  directives.memory.length > 0;
  tracker.done(5, hasWork
    ? directives.files.length + ' file(s)  ·  ' + directives.runs.length + ' command(s)'
    : 'chat response — no files');

  // ── Phase 6: Self-test loop ───────────────────────────────────────────────
  if (hasWork) {
    tracker.start(6, 'Executing & self-testing');

    const appliedFiles = [];

    // Write files
    for (const f of directives.files) {
      try {
        const abs = path.isAbsolute(f.path)
          ? f.path
          : path.join(process.cwd(), f.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.content, 'utf8');
        const lineCount = f.content.split('\n').length;
        tracker.sub(6, 'file', f.path + ' · ' + lineCount + ' lines');
        appliedFiles.push({ path: f.path, full: abs, ok: true });
      } catch (e) {
        tracker.sub(6, 'fail', 'write failed: ' + f.path + ' — ' + e.message);
      }
    }

    // Run shell commands
    for (let cmd of directives.runs) {
      if (process.platform === 'win32') {
        if (/&\s*$/.test(cmd)) {
          cmd = 'start /B ' + cmd.replace(/&\s*$/, '').trim();
        } else {
          const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
          if (nodeServerPat.test(cmd.trim())) {
            const parts = cmd.split('&&').map(s => s.trim());
            parts[parts.length - 1] = 'start /B ' + parts[parts.length - 1];
            cmd = parts.join(' && ');
          }
        }
      }
      tracker.sub(6, 'run', cmd);
      const r = runShell(cmd);
      if (r.stdout.trim()) tracker.sub(6, 'info', r.stdout.trim().split('\n')[0].slice(0, 80));
      if (r.code !== 0 && r.stderr.trim()) tracker.sub(6, 'fail', r.stderr.trim().split('\n')[0].slice(0, 80));
    }

    // Save memory
    if (directives.memory.length > 0) {
      const m = loadMemory();
      if (!m.facts) m.facts = {};
      for (const { key, value } of directives.memory) {
        m.facts[key] = value;
        tracker.sub(6, 'info', '💾 memory: ' + key + ' = ' + value);
      }
      try { saveMemory(m); } catch (_) {}
      if (ctx && ctx.mem) Object.assign(ctx.mem, m);
    }

    // Live self-test
    if (ctx.autoTest !== false && appliedFiles.length > 0) {
      tracker.sub(6, 'wait', 'running live self-test on created files…');

      // Spinner while self-test runs
      const testSpin = spinner('running tests', ctx.mode);
      let testAttempt = 0;
      const testLabelIv = setInterval(() => {
        const labels = ['running tests', 'checking output', 'verifying logic', 'reading errors', 'applying fix'];
        testSpin.update(labels[testAttempt % labels.length]);
        testAttempt++;
      }, 2000);

      try {
        const tr = await selfTestLoop(
          ctx.providerKey || cfg.provider,
          ctx.apiKey      || cfg.apiKey,
          ctx.modelId     || cfg.model,
          ctx.messages,
          appliedFiles,
          3
        );
        clearInterval(testLabelIv);
        testSpin.stop();
        if (tr.tested) {
          if (tr.passed) {
            const preview = tr.output ? tr.output.trim().split('\n')[0].slice(0, 70) : '';
            tracker.sub(6, 'pass', 'self-test PASSED' + (preview ? ' — ' + preview : ''));
          } else {
            tracker.sub(6, 'fail', 'self-test FAILED after ' + tr.iterations + ' attempt(s)');
            if (tr.error) {
              tr.error.split('\n').slice(0, 3).forEach(l => tracker.sub(6, 'info', l.slice(0, 80)));
            }
          }
        } else {
          tracker.sub(6, 'info', 'no testable files found');
        }
      } catch (testErr) {
        clearInterval(testLabelIv);
        testSpin.stop();
        tracker.sub(6, 'fail', 'test error: ' + testErr.message.slice(0, 80));
      }
    }

    tracker.done(6);
  } else {
    tracker.start(6, 'Self-test loop');
    tracker.note(6, 'skipped — chat response, no files created');
    tracker.done(6);
  }

  // ── Phase 7: Response assembly ────────────────────────────────────────────
  tracker.start(7, 'Assembling response');
  const display = reply
    .replace(/@@FILE:\s*[^\r\n]+\r?\n[\s\S]*?@@END/g, '')
    .replace(/@@RUN:\s*[^\r\n]+/g, '')
    .replace(/@@MEMORY:\s*[^\r\n]+/g, '')
    .trim();
  tracker.done(7);

  // ── Summary ───────────────────────────────────────────────────────────────
  tracker.finish({
    provider: provKey === 'ollama' ? 'Ollama (local)' : provKey,
    model:    modelId || undefined,
    tokens:   ctx.totalTok || undefined,
    elapsed:  elapsed3,
  });

  if (display) console.log(formatMD(display));
  console.log('');

  // ── WA Notification — send terminal work summary to owner ─────────────────
  if (hasWork && (directives.files.length + directives.runs.length > 0)) {
    try {
      const waPath = require('path').resolve(__dirname, '../../connections/whatsapp/index.js');
      if (require('fs').existsSync(waPath)) {
        const { sendToOwner } = require(waPath);
        if (typeof sendToOwner === 'function') {
          const lines = [
            '🐋 *Terminal work done*',
            '',
            ...directives.files.map(f => '📄 `' + f.path + '`'),
            ...directives.runs.map(r  => '⚡ `' + r + '`'),
            ...directives.memory.map(m => '💾 ' + m.key + ' = ' + m.value),
            '',
            '✅ All phases complete',
          ].filter(l => l !== undefined);
          sendToOwner(lines.join('\n')).catch(() => {});
        }
      }
    } catch (_) {}
  }
}

module.exports = { handleAiMessage };