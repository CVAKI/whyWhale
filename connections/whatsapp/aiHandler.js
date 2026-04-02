'use strict';

/**
 * connections/whatsapp/aiHandler.js
 *
 * Bridges WhatsApp messages → whyWhale AI pipeline (or direct provider).
 *
 * TWO-PHASE DESIGN for work tasks:
 *
 *   Phase 1 — PLAN (stdout suppressed):
 *     AI receives the message and produces a reply that may contain
 *     @@FILE / @@RUN / @@MEMORY directives. stdout is suppressed so
 *     the terminal pipeline spinner doesn't bleed into the WA session.
 *     Returns: { reply, directives, rawReply }
 *
 *   Phase 2 — EXECUTE (stdout open, visible in terminal):
 *     Called by index.js AFTER the section closes and the idle PS1 prints.
 *     Runs the directives with full terminal output so the user can watch
 *     the work happening live, exactly like typing the command themselves.
 *     Returns: summary string for the follow-up WA reply.
 *
 * This produces the flow from the design:
 *   ┟══ [WA ←] user message
 *   ┟══ [WA →] "ok wait for me, I'll be back after processing"
 *   └[whatsapp]-[process]::[section @END-> going to terminal for work]
 *   ┌[time]────[whyWhale]────[mode]────[#]
 *   └[cwd]──►  creating index.php...        ← live terminal output
 *              writing style.css...
 *   ┌[time]════[whyWhale]════════[section :2]
 *   ┟══ [WA →] "Done! Here's what I built..."
 */

const path = require('path');
const fs   = require('fs');
const { loadConfig, loadMemory } = require('../../lib/config');

// ─── Shared context ───────────────────────────────────────────────────────────
let _ctx = null;
function setContext(ctx) { _ctx = ctx; }

// ─── Per-sender rolling history ───────────────────────────────────────────────
const histories   = new Map();
const MAX_HISTORY = 20;

function getHistory(sender) {
  if (!histories.has(sender)) histories.set(sender, []);
  return histories.get(sender);
}
function pushHistory(sender, role, content) {
  const h = getHistory(sender);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

// ─── Directive parser ─────────────────────────────────────────────────────────
function parseDirectives(text) {
  const result = { files: [], runs: [], memory: [] };
  const fileRe  = /@@FILE:([^\n]+)\n([\s\S]*?)@@END/g;
  const runRe   = /@@RUN:([^\n]+)/g;
  const memRe   = /@@MEMORY:([^=\n]+)=([^\n]+)/g;
  let m;
  while ((m = fileRe.exec(text)) !== null)
    result.files.push({ path: m[1].trim(), content: m[2] });
  while ((m = runRe.exec(text)) !== null)
    result.runs.push(m[1].trim());
  while ((m = memRe.exec(text)) !== null)
    result.memory.push({ key: m[1].trim(), value: m[2].trim() });
  return result;
}

function hasWork(directives) {
  return directives.files.length > 0 ||
         directives.runs.length  > 0 ||
         directives.memory.length > 0;
}

function detectWorkType(directives, rawReply) {
  const hasSend = /@@SEND:/i.test(rawReply) ||
    /\bsend\b.*\b(file|zip|attachment)\b/i.test(rawReply) ||
    /\b(zip|compress|archive)\b/i.test(rawReply);
  if (hasSend)                              return 'send';
  if (hasWork(directives))                  return 'work';
  return 'chat';
}

// ─── PHASE 1: getAIResponse ───────────────────────────────────────────────────
// Called by index.js to get the AI reply.
// stdout is suppressed so terminal pipeline output doesn't bleed.
// Returns { reply, directives, workType, rawReply }
async function getAIResponse(userMessage, sender = 'unknown') {
  let rawReply = '';

  if (_ctx && _ctx.prov) {
    rawReply = await integratedCall(userMessage, sender);
  } else {
    rawReply = await standaloneCall(userMessage, sender);
  }

  const directives = parseDirectives(rawReply);
  const workType   = detectWorkType(directives, rawReply);

  // Clean reply for WA (strip directive blocks)
  let reply = rawReply
    .replace(/@@FILE:[^\n]+\n[\s\S]*?@@END/g, '')
    .replace(/@@RUN:[^\n]+/g, '')
    .replace(/@@MEMORY:[^\n]+/g, '')
    .trim();

  // Annotate reply with what's about to happen
  if (workType === 'work') {
    const parts = [];
    if (directives.files.length) parts.push(`📄 ${directives.files.length} file(s)`);
    if (directives.runs.length)  parts.push(`⚡ ${directives.runs.length} command(s)`);
    reply = (reply ? reply + '\n\n' : '') +
      `⏳ Working on it — ${parts.join(', ')}. I'll report back when done.`;
  } else if (workType === 'send') {
    reply = (reply ? reply + '\n\n' : '') + '📦 Preparing files, just a moment...';
  }

  return { reply, directives, workType, rawReply };
}

// ─── PHASE 2: executeWork ─────────────────────────────────────────────────────
// Called by index.js AFTER the section closes, with stdout fully restored.
// Wraps all output in a WA-style section box so readline prompt doesn't bleed in.
async function executeWork(directives, sender) {
  const { log, colors: C } = require('./logger');
  const B  = C.bold;
  const R  = C.reset;

  const summary      = [];
  const createdFiles = [];

  // ── Open WA work section box ───────────────────────────────────────────────
  const ts = () => { const n = new Date(); return [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':'); };
  process.stdout.write('\n' + [
    C.waGreen+'┌'+R,
    C.waGreen+'['+R+C.amber+ts()+R+C.waGreen+']'+R,
    C.waGreen+'════'+R,
    C.waGreen+'['+R+B+C.white+'whyWhale'+R+C.waGreen+']'+R,
    C.waGreen+'════════'+R,
    C.waGreen+'['+R+C.waLight+B+'⚙ executing work'+R+C.waGreen+']'+R,
  ].join('') + '\n');

  function wline(icon, label, text, ok) {
    const col = ok === false ? C.red : ok === true ? C.waGreen : C.waLight;
    const preview = (text||'').length > 70 ? (text||'').slice(0,70)+'…' : (text||'');
    process.stdout.write([
      C.waGreen+'┟══ '+R,
      C.amber+icon+' '+R,
      C.grey+label+'  '+R,
      col+preview+R,
    ].join('') + '\n');
  }

  // ── Write files ────────────────────────────────────────────────────────────
  for (const f of directives.files) {
    const abs = path.isAbsolute(f.path) ? f.path : path.join(process.cwd(), f.path);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // Strip markdown code fences if model wrapped content
      let fc = f.content;
      fc = fc.replace(/^```[\w]*\r?\n/, '').replace(/\r?\n```[\s]*$/, '');
      fs.writeFileSync(abs, fc, 'utf8');
      wline('📄', 'wrote', f.path, true);
      summary.push('📄 wrote `' + f.path + '`');
      createdFiles.push(abs);
    } catch (e) {
      wline('✘', 'failed', f.path + ' — ' + e.message, false);
      summary.push('✘ failed `' + f.path + '`: ' + e.message);
    }
  }

  // ── Run commands ───────────────────────────────────────────────────────────
  for (let cmd of directives.runs) {
    const myPid = process.pid;
    if (process.platform === 'win32' && /taskkill\b.*\/IM\s+node\.exe/i.test(cmd)) {
      cmd = `powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${myPid} } | Stop-Process -Force"`;
    } else if (process.platform !== 'win32' && /\b(killall|pkill)\s+(-\w+\s+)*node\b/i.test(cmd)) {
      cmd = `pkill -f "node server\\.js" 2>/dev/null; pkill -f "node client\\.js" 2>/dev/null; true`;
    }
    wline('⚡', 'run  ', cmd, null);
    const { execSync } = require('child_process');
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 30_000, cwd: process.cwd(), stdio: ['pipe','pipe','pipe'] });
      if (out.trim()) {
        out.trim().split('\n').slice(0,8).forEach(l =>
          process.stdout.write(C.waGreen+'┟    '+R+C.grey+'│  '+R+C.waLight+l+R+'\n')
        );
      }
      summary.push('⚡ ran `' + cmd + '`');
    } catch (e) {
      const errOut = (e.stderr || e.message || '').trim().split('\n')[0];
      if (errOut) wline('✘', 'error', errOut, false);
      process.stdout.write(C.waGreen+'┟    '+R+C.red+'exit '+((e.status||1))+R+'\n');
      summary.push('✘ `' + cmd + '` failed (exit ' + (e.status||1) + ')');
    }
  }

  // ── Save memory ────────────────────────────────────────────────────────────
  if (directives.memory.length > 0) {
    const { saveMemory } = require('../../lib/config');
    const mem = loadMemory();
    if (!mem.facts) mem.facts = {};
    for (const { key, value } of directives.memory) {
      mem.facts[key] = value;
      wline('💾', 'memory', key + ' = ' + value, true);
      summary.push('💾 remembered `' + key + '`');
    }
    try { saveMemory(mem); } catch (_) {}
    if (_ctx && _ctx.mem) Object.assign(_ctx.mem, mem);
  }

  // ── Close section box ──────────────────────────────────────────────────────
  const ok = summary.every(s => !s.startsWith('✘'));
  process.stdout.write([
    C.waGreen+'└'+R,
    C.grey+'[whatsapp]'+R,
    C.grey+'-[work]'+R,
    C.grey+'::'+R,
    C.grey+'['+R,
    (ok ? C.waGreen : C.red)+B+(ok ? 'work done ✅' : 'work done ⚠')+R,
    C.grey+']'+R,
  ].join('') + '\n');

  return { summary, createdFiles };
}

// ─── Integrated call (stdout suppressed) ─────────────────────────────────────
async function integratedCall(userMessage, sender) {
  let handleAiMessage;
  try {
    const mod = require('../../lib/main/aiHandler');
    handleAiMessage = mod.handleAiMessage;
    if (typeof handleAiMessage !== 'function') handleAiMessage = null;
  } catch (_) { handleAiMessage = null; }

  if (!handleAiMessage) return standaloneCall(userMessage, sender);

  const ctxClone = {
    ..._ctx,
    messages:  getHistory(sender),
    lastReply: '',
  };

  // Suppress all terminal output during AI call
  const origWrite = process.stdout.write.bind(process.stdout);
  const chunks    = [];
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  let raw = '';
  try {
    await handleAiMessage(userMessage, ctxClone);
    raw = ctxClone.lastReply || ''; // chunks NOT used — spinner frames would bleed
  } catch (err) {
    process.stdout.write = origWrite;
    return standaloneCall(userMessage, sender);
  } finally {
    process.stdout.write = origWrite;
  }

  // Sync history
  if (Array.isArray(ctxClone.messages) && ctxClone.messages.length > 0) {
    histories.set(sender, ctxClone.messages.slice(-MAX_HISTORY));
  } else {
    pushHistory(sender, 'user',      userMessage);
    pushHistory(sender, 'assistant', raw);
  }

  return raw || '(no response)';
}

// ─── Standalone call ──────────────────────────────────────────────────────────
async function standaloneCall(userMessage, sender) {
  const cfg = loadConfig();
  const mem = loadMemory();

  const provider = process.env.WA_PROVIDER || cfg.provider || 'anthropic';
  const model    = process.env.WA_MODEL    || cfg.model    || 'claude-sonnet-4-20250514';
  const apiKey   = process.env.WA_API_KEY  || cfg.apiKey   || '';

  if (!apiKey && provider !== 'ollama') {
    return '⚠️ No API key configured. Run `whywhale --setup` or set WA_API_KEY.';
  }

  pushHistory(sender, 'user', userMessage);
  const systemPrompt = buildSystemPrompt(mem);
  const messages     = getHistory(sender);

  let raw = '';
  // Retry up to 3 times with 2s backoff (handles Ollama cold-start / fetch failed)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, 2000));
      switch (provider) {
        case 'anthropic':   raw = await callAnthropic({ apiKey, model, systemPrompt, messages }); break;
        case 'openrouter':  raw = await callOpenRouter({ apiKey, model, systemPrompt, messages }); break;
        case 'groq':        raw = await callGroq({ apiKey, model, systemPrompt, messages }); break;
        case 'ollama':      raw = await callOllama({ model, systemPrompt, messages }); break;
        default:            raw = `⚠️ Unknown provider: ${provider}`;
      }
      break; // success — exit retry loop
    } catch (err) {
      if (attempt === 3) raw = `⚠️ Provider error (after 3 attempts): ${err.message}`;
    }
  }

  pushHistory(sender, 'assistant', raw);
  return raw || '(no response)';
}

// ─── Provider implementations ─────────────────────────────────────────────────
async function callAnthropic({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return (await res.json()).content?.[0]?.text || '';
}
async function callOpenRouter({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}
async function callGroq({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}
async function callOllama({ model, systemPrompt, messages }) {
  const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const res  = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message?.content || '';
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(mem) {
  const memLines = Object.entries(mem?.facts || {})
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return [
    'You are whyWhale, an intelligent AI assistant connected via WhatsApp.',
    'Be concise and clear — WhatsApp messages should be readable on mobile.',
    'Use plain text. Avoid markdown headers or heavy formatting.',
    'For code snippets, use plain triple-backticks only.',
    'When asked to create files or run commands, use these directives:',
    '  @@FILE:<relative/path>',
    '  <file content here>',
    '  @@END',
    '  @@RUN:<shell command>',
    '  @@MEMORY:<key>=<value>',
    memLines ? `\nMemory:\n${memLines}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { getAIResponse, executeWork, setContext };