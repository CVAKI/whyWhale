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
 *
 * FIX: The original integratedResponse() directly swapped _ctx.messages with
 * the WhatsApp history array. This corrupted the main terminal session and
 * caused "Cannot read properties of undefined (reading 'push')" because the
 * 7-phase pipeline internally accesses sub-arrays on ctx that don't exist on
 * the swapped history array.
 *
 * Fix: Use a shallow context clone ({ ..._ctx, messages: history }) so that
 * _ctx is never mutated. If the integrated path still fails for any reason,
 * it automatically falls back to the standalone provider call.
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
// FIXED: Uses a shallow clone of _ctx instead of mutating _ctx.messages directly.
// This prevents the 7-phase pipeline from corrupting the main terminal session
// and avoids "Cannot read properties of undefined (reading 'push')" errors.
async function integratedResponse(userMessage, sender) {
  try {
    const { handleAiMessage } = require('../../lib/main/aiHandler');

    // Push the incoming message into this sender's history first
    pushHistory(sender, 'user', userMessage);

    // Build a shallow context clone with this sender's message history.
    // We never touch _ctx.messages — the main terminal session is untouched.
    const ctxClone = {
      ..._ctx,
      messages:  getHistory(sender),
      lastReply: undefined,
    };

    // Capture streamed output instead of printing to terminal
    const chunks    = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

    let reply = '';
    try {
      await handleAiMessage(ctxClone, userMessage);
      reply = ctxClone.lastReply
        || chunks.join('').replace(/\x1b\[[0-9;]*m/g, '').trim();
    } finally {
      process.stdout.write = origWrite;
    }

    // Sync the updated messages array back into the per-sender history
    if (Array.isArray(ctxClone.messages) && ctxClone.messages.length > 0) {
      // Keep only the last MAX_HISTORY entries
      const trimmed = ctxClone.messages.slice(-MAX_HISTORY);
      histories.set(sender, trimmed);
    } else {
      // Fallback: manually record the assistant reply
      pushHistory(sender, 'assistant', reply);
    }

    return reply || '(no response)';

  } catch (err) {
    // If the integrated path fails for any reason, fall back to standalone.
    // This ensures the user always gets a reply even if ctx is in a bad state.
    const warnFn = (typeof _ctx?.log?.warn === 'function')
      ? _ctx.log.warn.bind(_ctx.log)
      : console.warn;
    warnFn(`[WA] Integrated path error (${err.message}) — falling back to standalone`);
    return standaloneResponse(userMessage, sender);
  }
}

// ─── Standalone: direct provider call ─────────────────────────────────────────
async function standaloneResponse(userMessage, sender) {
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

  let reply = '';

  try {
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
  } catch (err) {
    reply = `⚠️ Provider error: ${err.message}`;
  }

  pushHistory(sender, 'assistant', reply);
  return reply || '(no response)';
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
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system:     systemPrompt,
      messages,
    }),
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
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGroq({ apiKey, model, systemPrompt, messages }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
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