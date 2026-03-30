'use strict';

const readline = require('readline');
const path     = require('path');
const fs       = require('fs');

const { ab, cr, dg, kp, rf, wh }              = require('../colors');
const { loadConfig, loadMemory, loadSkills }   = require('../config');
const { PROVIDERS }                            = require('../providers');
const { renderPS1 }                            = require('../render');
const { CWD }                                  = require('../filesystem');
const { MODES }                                = require('../modes');

const { VERSION }                              = require('./constants');
const { runSetup }                             = require('./setup');
const { dispatchCommand }                      = require('./commands');
const { autoDetectModeAndSkills }              = require('./autoDetect');
const { handleAiMessage }                      = require('./aiHandler');

// ─── autoStartConnections ─────────────────────────────────────────────────────
// Called once after setup. If the user has previously connected WhatsApp
// (credentials exist on disk), silently start it in the background so it is
// live by the time they start chatting — no manual step needed.
async function autoStartConnections(ctx) {
  const { getConnectionStatus } = require('../connections');

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  const waStatus = getConnectionStatus('whatsapp');
  if (!waStatus?.connected) return;   // never set up — skip

  // Check credentials folder actually exists (session may have been wiped)
  const credPath = path.join(
    require('os').homedir(), '.whywhale', 'credentials', 'whatsapp', 'session'
  );
  if (!fs.existsSync(credPath)) {
    // Stale entry — clear it so the user is prompted to re-scan next time
    const { disconnectConnection } = require('../connections');
    disconnectConnection('whatsapp');
    return;
  }

  // Resolve path to the WhatsApp engine
  // Works whether whyWhale is run from its own root or globally installed
  const WA_INDEX = path.resolve(__dirname, '../../connections/whatsapp/index.js');
  if (!fs.existsSync(WA_INDEX)) {
    // connections/ folder not present — silently skip
    return;
  }

  let startWhatsApp, setContext;
  try {
    ({ startWhatsApp } = require(WA_INDEX));
    ({ setContext }    = require(path.join(path.dirname(WA_INDEX), 'aiHandler.js')));
  } catch (err) {
    // Package deps (baileys etc.) not installed yet — warn once and skip
    console.log(
      '  ' + rf('⚠ WhatsApp deps not installed.') +
      ab(' Run: ') + wh('cd connections/whatsapp && npm install')
    );
    return;
  }

  // Pass whyWhale ctx so WhatsApp messages go through the full AI pipeline
  setContext(ctx);

  console.log('  ' + kp('◈') + ' ' + ab('WhatsApp: ') + wh('connecting...'));

  startWhatsApp({ dmPolicy: 'pairing' })
    .catch(err => {
      console.log('  ' + rf('⚠ WhatsApp auto-start failed: ') + err.message);
    });
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ── Load saved config + memory ─────────────────────────────────────────────
  const cfg = loadConfig();
  const mem = loadMemory();

  // ── Build shared mutable context ────────────────────────────────────────────
  // All submodules read/write ctx so closures stay in sync across the session.
  const ctx = {
    // Persisted config
    providerKey:     cfg.provider || null,
    apiKey:          cfg.apiKey   || '',
    modelId:         cfg.model    || null,
    mode:            cfg.mode     || 'code',
    autoTest:        cfg.autoTest !== false,
    autoScan:        cfg.autoScan !== false,
    // Runtime state
    prov:            null,   // populated by setup
    modelMeta:       null,   // populated by setup
    availModels:     [],     // populated by setup
    messages:        [],
    mem,
    skills:          loadSkills(),
    totalTok:        0,
    lastReply:       '',
    mlBuf:           '',
    msgN:            0,
    t0:              Date.now(),
    folderCtx:       '',
    agentTaskActive: false,
    statusRef:       { mode: cfg.mode || 'code', model: cfg.model || '', msgCount: 0 },
    waClient:        null,   // populated by autoStartConnections if WhatsApp is live
    // I/O (set below)
    rl:              null,
    ask:             null,
    prompt:          null,
    // Version
    VERSION,
  };

  // ── Readline interface ─────────────────────────────────────────────────────
  ctx.rl     = readline.createInterface({ input: process.stdin, output: process.stdout });
  ctx.ask    = q => new Promise(res => ctx.rl.question(q, res));
  ctx.prompt = () => process.stdout.write(renderPS1(ctx.msgN, CWD(), ctx.mode, MODES));

  // ── Setup: provider → key → model → folder scan → welcome ─────────────────
  await runSetup(ctx);

  // Resolve prov reference now that providerKey is confirmed
  ctx.prov = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;

  // ── Auto-start any previously connected integrations ──────────────────────
  // Runs in the background — does NOT block the prompt or slow startup
  autoStartConnections(ctx);

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