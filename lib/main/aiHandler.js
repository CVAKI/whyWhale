'use strict';

/**
 * lib/main/aiHandler.js
 *
 * Terminal AI message handler for the main whyWhale REPL.
 *
 * FIX: This file previously only exported `getAIResponse` / `setContext`
 * (a misplaced copy of the WA aiHandler). It was MISSING the `handleAiMessage`
 * export that lib/main/index.js imports at startup:
 *
 *   const { handleAiMessage } = require('./aiHandler');   // got undefined
 *   await handleAiMessage(text, ctx);                     // ← "not a function"
 *
 * This file now exports handleAiMessage(text, ctx) with the correct
 * argument order matching how index.js calls it.
 */

const path = require('path');
const fs   = require('fs');

const { loadConfig, loadMemory, saveMemory } = require('../config');
const { formatMD, spinner }                  = require('../render');
const { ab, cr, dg, kp, rf, wh, tl, sd }   = require('../colors');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runShell(cmd) {
  const { execSync } = require('child_process');
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
  const fileRe  = /@@FILE:([^\n]+)\n([\s\S]*?)@@END/g;
  const runRe   = /@@RUN:([^\n]+)/g;
  const memRe   = /@@MEMORY:([^=\n]+)=([^\n]+)/g;
  let m;
  while ((m = fileRe.exec(text)) !== null)
    results.files.push({ path: m[1].trim(), content: m[2] });
  while ((m = runRe.exec(text)) !== null)
    results.runs.push(m[1].trim());
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
      fs.writeFileSync(abs, f.content, 'utf8');
      lines.push('  ' + ab('📄 wrote ') + tl(f.path));
    } catch (e) {
      lines.push('  ' + rf('✘ write failed: ') + f.path + ' — ' + e.message);
    }
  }

  for (const cmd of directives.runs) {
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

  return [
    'You are whyWhale, an elite AI coding assistant running inside a terminal.',
    'You can write files, run commands, and remember facts using these directives:',
    '  @@FILE:<relative/path>',
    '  <file content here>',
    '  @@END',
    '  @@RUN:<shell command>',
    '  @@MEMORY:<key>=<value>',
    'Use directives only when the user explicitly asks to create files, run commands,',
    'or save information. For questions and conversation, reply normally.',
    '',
    `Current mode: ${ctx.mode || 'code'}`,
    `Working directory: ${process.cwd()}`,
    ctx.folderCtx  ? `\nProject context:\n${ctx.folderCtx}` : '',
    skillLines     ? `\nLoaded skills:\n${skillLines}` : '',
    memLines       ? `\nMemory:\n${memLines}` : '',
  ].filter(Boolean).join('\n');
}

// ─── Provider call ────────────────────────────────────────────────────────────

async function callProvider(ctx, messages) {
  const cfg     = loadConfig();
  const provKey = ctx.providerKey || cfg.provider || 'anthropic';
  const model   = ctx.modelId     || cfg.model    || 'claude-opus-4-20250514';
  const apiKey  = ctx.apiKey      || cfg.apiKey   || '';

  if (provKey === 'anthropic') {
    if (!apiKey) throw new Error('No API key configured. Run `whywhale --setup`.');
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

  // Generic OpenAI-compat (openrouter, groq, etc.)
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
}

// ─── handleAiMessage (main export) ───────────────────────────────────────────
//
// Signature: handleAiMessage(text, ctx)
// Called by lib/main/index.js as: await handleAiMessage(text, ctx)

async function handleAiMessage(text, ctx) {
  if (!ctx || !ctx.prov) {
    console.log('\n  ' + rf('✘ Provider not ready. Run `whywhale --setup`.'));
    return;
  }

  if (!Array.isArray(ctx.messages)) ctx.messages = [];

  const systemPrompt = buildSystemPrompt(ctx);
  ctx.messages.push({ role: 'user', content: text });
  if (ctx.messages.length > 80) ctx.messages.splice(0, ctx.messages.length - 80);

  ctx.msgN = (ctx.msgN || 0) + 1;
  if (ctx.statusRef) ctx.statusRef.msgCount = ctx.msgN;

  const stopSpinner = spinner('whyWhale · thinking');

  let reply = '';
  try {
    reply = await callProvider(ctx, [
      { role: 'system', content: systemPrompt },
      ...ctx.messages,
    ]);
  } catch (err) {
    stopSpinner();
    console.log('\n  ' + rf('✘ AI error: ') + err.message);
    ctx.messages.pop();
    return;
  }

  stopSpinner();

  ctx.messages.push({ role: 'assistant', content: reply });
  ctx.lastReply = reply;

  const directives = parseDirectives(reply);
  const hasWork    = directives.files.length > 0 ||
                     directives.runs.length  > 0 ||
                     directives.memory.length > 0;

  // Clean display text — strip directive blocks
  const display = reply
    .replace(/@@FILE:[^\n]+\n[\s\S]*?@@END/g, '')
    .replace(/@@RUN:[^\n]+/g, '')
    .replace(/@@MEMORY:[^\n]+/g, '')
    .trim();

  if (display) console.log('\n' + formatMD(display));

  if (hasWork) {
    console.log('');
    const summary = await executeDirectives(directives, ctx);
    if (summary) console.log(summary);
  }

  console.log('');
}

module.exports = { handleAiMessage };