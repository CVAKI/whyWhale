'use strict';

/**
 * aiHandler.js
 *
 * Bridges incoming WhatsApp messages → whyWhale AI pipeline (or direct API).
 *
 * Two modes:
 *   1. INTEGRATED  — If a whyWhale `ctx` object is injected via setContext(),
 *                    messages are processed through the full 7-phase pipeline
 *                    (memory, skills, mode, self-test loop, etc.).
 *
 *   2. STANDALONE  — Falls back to a direct Claude / provider API call using
 *                    env vars, so the WhatsApp connection works independently.
 */

const { loadConfig, loadMemory } = require('../../lib/config');

// ─── Shared context (set by caller if running inside whyWhale) ────────────────
let _ctx = null;

function setContext(ctx) {
  _ctx = ctx;
}

// ─── Conversation history per-sender (simple rolling window) ─────────────────
const histories = new Map();
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

// ─── Main entry ───────────────────────────────────────────────────────────────
async function getAIResponse(userMessage, sender = 'unknown') {
  if (_ctx && _ctx.prov) {
    return integratedResponse(userMessage, sender);
  }
  return standaloneResponse(userMessage, sender);
}

// ─── Integrated: uses full whyWhale ctx ───────────────────────────────────────
async function integratedResponse(userMessage, sender) {
  // Safely resolve handleAiMessage — export name may differ across versions
  let handleAiMessage;
  try {
    const mod = require('../../lib/main/aiHandler');
    handleAiMessage = mod.handleAiMessage || mod.default || mod;
    if (typeof handleAiMessage !== 'function') handleAiMessage = null;
  } catch (_) {
    handleAiMessage = null;
  }

  // If the integrated handler isn't available, fall back to standalone
  if (!handleAiMessage) {
    return standaloneResponse(userMessage, sender);
  }

  // Temporarily swap ctx messages with this sender's history
  const original = _ctx.messages;
  _ctx.messages = getHistory(sender);

  let reply = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  try {
    await handleAiMessage(_ctx, userMessage);
    reply = _ctx.lastReply || chunks.join('').replace(/\x1b\[[0-9;]*m/g, '').trim();
  } catch (err) {
    // If pipeline throws, fall through to standalone
    process.stdout.write = origWrite;
    return standaloneResponse(userMessage, sender);
  } finally {
    process.stdout.write = origWrite;
    _ctx.messages = original;
  }

  pushHistory(sender, 'user',      userMessage);
  pushHistory(sender, 'assistant', reply);

  return reply || '(no response)';
}

// ─── Standalone: direct provider call ─────────────────────────────────────────
async function standaloneResponse(userMessage, sender) {
  const cfg = loadConfig();
  const mem = loadMemory();

  const provider = process.env.WA_PROVIDER || cfg.provider  || 'anthropic';
  const model    = process.env.WA_MODEL    || cfg.model     || 'claude-sonnet-4-20250514';
  const apiKey   = process.env.WA_API_KEY  || cfg.apiKey    || '';

  if (!apiKey && provider !== 'ollama') {
    return '⚠️ No API key configured. Run `whywhale --setup` or set WA_API_KEY.';
  }

  pushHistory(sender, 'user', userMessage);

  const systemPrompt = buildSystemPrompt(mem);
  const messages     = getHistory(sender);

  let reply = '';

  switch (provider) {
    case 'anthropic':
      reply = await callAnthropic({ apiKey, model, systemPrompt, messages });
      break;
    case 'openrouter':
      reply = await callOpenRouter({ apiKey, model, systemPrompt, messages });
      break;
    case 'groq':
      reply = await callGroq({ apiKey, model, systemPrompt, messages });
      break;
    case 'ollama':
      reply = await callOllama({ model, systemPrompt, messages });
      break;
    default:
      reply = `⚠️ Unknown provider: ${provider}`;
  }

  pushHistory(sender, 'assistant', reply);
  return reply;
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function callAnthropic({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callOpenRouter({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });

  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGroq({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });

  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama({ model, systemPrompt, messages }) {
  const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const res  = await fetch(`${base}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content || '';
}

// ─── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(mem) {
  const memLines = Object.entries(mem?.facts || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  return [
    'You are whyWhale, an intelligent AI assistant connected via WhatsApp.',
    'Be concise and clear — WhatsApp messages should be readable on mobile.',
    'Use plain text. Avoid markdown headers or heavy formatting.',
    'For code snippets, use plain triple-backticks only.',
    memLines ? `\nMemory:\n${memLines}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { getAIResponse, setContext };