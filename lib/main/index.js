'use strict';

const readline = require('readline');

const { ab, cr, dg }                               = require('../colors');
const { loadConfig, loadMemory, loadSkills }        = require('../config');
const { PROVIDERS }                                = require('../providers');
const { renderPS1 }                                = require('../render');
const { CWD }                                      = require('../filesystem');
const { MODES }                                    = require('../modes');

const { VERSION }                                  = require('./constants');
const { runSetup }                                 = require('./setup');
const { dispatchCommand }                          = require('./commands');
const { autoDetectModeAndSkills }                  = require('./autoDetect');
const { handleAiMessage }                          = require('./aiHandler');

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ── Load saved config + memory ─────────────────────────────────────────────
  const cfg = loadConfig();
  const mem = loadMemory();

  // ── Build shared mutable context ────────────────────────────────────────────
  // All submodules read/write ctx so closures stay in sync across the session.
  const ctx = {
    // Persisted config
    providerKey:    cfg.provider || null,
    apiKey:         cfg.apiKey   || '',
    modelId:        cfg.model    || null,
    mode:           cfg.mode     || 'code',
    autoTest:       cfg.autoTest !== false,
    autoScan:       cfg.autoScan !== false,
    // Runtime state
    prov:           null,   // populated by setup
    modelMeta:      null,   // populated by setup
    availModels:    [],     // populated by setup
    messages:       [],
    mem,
    skills:         loadSkills(),
    totalTok:       0,
    lastReply:      '',
    mlBuf:          '',
    msgN:           0,
    t0:             Date.now(),
    folderCtx:      '',
    agentTaskActive: false,
    statusRef:      { mode: cfg.mode || 'code', model: cfg.model || '', msgCount: 0 },
    // I/O (set below)
    rl:   null,
    ask:  null,
    prompt: null,
    // Version
    VERSION,
  };

  // ── Readline interface ────────────────────────────────────────────────────
  ctx.rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  ctx.ask = q => new Promise(res => ctx.rl.question(q, res));
  ctx.prompt = () => process.stdout.write(renderPS1(ctx.msgN, CWD(), ctx.mode, MODES));

  // ── Setup: provider → key → model → folder scan → welcome ─────────────────
  await runSetup(ctx);

  // Resolve prov reference now that providerKey is confirmed
  ctx.prov = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;

  ctx.prompt();

  // ── Input queue ────────────────────────────────────────────────────────────
  // Queue ensures pasted multi-line input is processed one line at a time,
  // preventing async handler race conditions (the "3000/scan" class of bug).
  const _inputQueue = [];
  let   _inputBusy  = false;

  async function _processQueue() {
    if (_inputBusy) return;
    while (_inputQueue.length) {
      _inputBusy = true;
      const raw  = _inputQueue.shift();
      try {
        await _handleLine(raw);
      } catch (e) {
        console.log('\n  ' + dg('✘ Input error: ') + e.message);
      } finally {
        _inputBusy = false;
      }
    }
  }

  ctx.rl.on('line', raw => { _inputQueue.push(raw); _processQueue(); });

  // ── _handleLine ────────────────────────────────────────────────────────────
  async function _handleLine(raw) {
    let text = raw.trim();

    // Multi-line buffer: lines ending with \ are accumulated
    if (text.endsWith('\\')) { ctx.mlBuf += text.slice(0, -1) + '\n'; process.stdout.write(ab('... ')); return; }
    if (ctx.mlBuf)           { text = ctx.mlBuf + text; ctx.mlBuf = ''; }
    if (!text)               { ctx.prompt(); return; }

    // ── Try slash commands / shell passthrough ─────────────────────────────
    const handled = await dispatchCommand(text, ctx);
    if (handled) return;

    // ── Auto mode + skill detection ────────────────────────────────────────
    autoDetectModeAndSkills(text, ctx);

    // ── Default: send to AI ────────────────────────────────────────────────
    await handleAiMessage(text, ctx);
    ctx.prompt();
  }

  ctx.rl.on('close', () => { console.log(''); process.exit(0); });
}

module.exports = { main, VERSION };