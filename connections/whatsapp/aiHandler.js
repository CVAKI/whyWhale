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
// Runs directives visibly in the terminal and returns a summary for WA.
async function executeWork(directives, sender) {
  const R  = '\x1b[0m';
  const G  = '\x1b[38;5;35m';
  const CY = '\x1b[38;5;51m';
  const AM = '\x1b[38;5;226m';
  const DM = '\x1b[2m';
  const WH = '\x1b[38;5;255m\x1b[1m';
  const RF = '\x1b[38;5;203m';
  const TL = '\x1b[38;5;43m';

  const summary = [];

  // ── Write files ────────────────────────────────────────────────────────────
  for (const f of directives.files) {
    const abs = path.isAbsolute(f.path)
      ? f.path
      : path.join(process.cwd(), f.path);

    process.stdout.write(`  ${CY}📄 writing${R}  ${WH}${f.path}${R} `);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content, 'utf8');
      process.stdout.write(`${G}✔${R}\n`);
      summary.push(`📄 wrote \`${f.path}\``);
    } catch (e) {
      process.stdout.write(`${RF}✘ ${e.message}${R}\n`);
      summary.push(`✘ failed \`${f.path}\`: ${e.message}`);
    }
  }

  // ── Run commands ───────────────────────────────────────────────────────────
  for (const cmd of directives.runs) {
    process.stdout.write(`  ${AM}⚡ running${R}  ${WH}${cmd}${R}\n`);
    const { execSync } = require('child_process');
    try {
      const out = execSync(cmd, {
        encoding: 'utf8', timeout: 30_000,
        cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (out.trim()) {
        out.trim().split('\n').forEach(l =>
          process.stdout.write(`  ${DM}│${R}  ${l}\n`)
        );
      }
      summary.push(`⚡ ran \`${cmd}\``);
    } catch (e) {
      const errOut = (e.stderr || e.message || '').trim();
      if (errOut) process.stdout.write(`  ${RF}${errOut}${R}\n`);
      process.stdout.write(`  ${RF}exit ${e.status || 1}${R}\n`);
      summary.push(`✘ \`${cmd}\` failed (exit ${e.status || 1})`);
    }
  }

  // ── Save memory ────────────────────────────────────────────────────────────
  if (directives.memory.length > 0) {
    const { saveMemory } = require('../../lib/config');
    const mem = loadMemory();
    if (!mem.facts) mem.facts = {};
    for (const { key, value } of directives.memory) {
      mem.facts[key] = value;
      process.stdout.write(`  ${G}💾 memory${R}  ${TL}${key}${R} = ${WH}${value}${R}\n`);
      summary.push(`💾 remembered \`${key}\``);
    }
    try { saveMemory(mem); } catch (_) {}
    if (_ctx && _ctx.mem) Object.assign(_ctx.mem, mem);
  }

  console.log('');
  return summary;
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
    raw = ctxClone.lastReply ||
          chunks.join('').replace(/\x1b\[[0-9;]*m/g, '').trim();
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
  try {
    switch (provider) {
      case 'anthropic':   raw = await callAnthropic({ apiKey, model, systemPrompt, messages }); break;
      case 'openrouter':  raw = await callOpenRouter({ apiKey, model, systemPrompt, messages }); break;
      case 'groq':        raw = await callGroq({ apiKey, model, systemPrompt, messages }); break;
      case 'ollama':      raw = await callOllama({ model, systemPrompt, messages }); break;
      default:            raw = `⚠️ Unknown provider: ${provider}`;
    }
  } catch (err) {
    raw = `⚠️ Provider error: ${err.message}`;
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