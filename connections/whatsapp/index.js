'use strict';

/**
 * whyWhale — WhatsApp Connection
 * Powered by @whiskeysockets/baileys
 *
 * Features:
 *  - Only responds to the registered owner number
 *  - Sends "🐋 whyWhale is swimming 🌊" on connect
 *  - Sends "🎣 whyWhale is going to catch fish..." on disconnect/exit
 *  - Shows WhatsApp "typing…" animation while the AI thinks
 *  - Returns a brief summary of what was done after each command
 */

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const pino      = require('pino');

const { getAIResponse } = require('./aiHandler');
const { log, colors }   = require('./logger');

// ─── Config ───────────────────────────────────────────────────────────────────
const AUTH_DIR         = path.join(os.homedir(), '.whywhale', 'credentials', 'whatsapp');
const SESSION_ID       = 'session';
const CONNECTIONS_PATH = path.join(os.homedir(), '.whywhale_connections.json');

// ─── Load owner number from saved connections ─────────────────────────────────
function loadOwnerNumber() {
  try {
    if (fs.existsSync(CONNECTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
      return (data.whatsapp?.ownerNumber || '').replace(/\D/g, '');
    }
  } catch (_) {}
  return '';
}

// Build a Baileys-style JID from a plain phone number
function toJid(number) {
  const clean = number.replace(/\D/g, '');
  if (!clean) return null;
  return clean + '@s.whatsapp.net';
}

// ─── Startup / shutdown message text ─────────────────────────────────────────
const MSG_ONLINE  = '🐋 *whyWhale is swimming* 🌊\n\nI\'m online and ready!\nSend me any message or terminal command and I\'ll get it done.';
const MSG_OFFLINE = '🎣 *whyWhale is going to catch fish...* 🐟\n\nI\'m shutting down now. I\'ll message you again when I\'m back online!';

// ─── Module-level sock ref (so main can call farewell on exit) ────────────────
let _activeSock  = null;
let _ownerJid    = null;
let _startupSent = false;  // guard: send startup message only once per session

// ─── Send farewell message (exported — called by main on rl.close) ────────────
async function sendFarewellMessage() {
  if (!_activeSock || !_ownerJid) return;
  try {
    await _activeSock.sendMessage(_ownerJid, { text: MSG_OFFLINE });
    log.info('Farewell message sent to owner.');
  } catch (err) {
    log.error('Could not send farewell: ' + err.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function startWhatsApp(opts = {}) {
  const { headless = false } = opts;

  const authPath = path.join(AUTH_DIR, SESSION_ID);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version }          = await fetchLatestBaileysVersion();

  log.info(`Using WA version ${version.join('.')}`);

  // Refresh owner JID on every connect (may change after setup)
  const ownerNumber = loadOwnerNumber();
  _ownerJid = toJid(ownerNumber);

  if (!_ownerJid) {
    log.warn('No owner number found — replying to ALL messages. Set ownerNumber in ~/.whywhale_connections.json to restrict.');
  } else {
    log.info(`Owner JID: ${_ownerJid}`);
  }

  const sock = makeWASocket({
    version,
    auth:              state,
    printQRInTerminal: true,
    logger:            pino({ level: 'silent' }),
    browser:           ['whyWhale', 'Chrome', '4.0.0'],
  });

  _activeSock  = sock;
  _startupSent = false;

  // ── Persist credentials ───────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection lifecycle ──────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const G = colors.waGreen + colors.bold;
      const R = colors.reset;
      console.log(`\n  ${G}┌──────────────────────────────────────────────┐${R}`);
      console.log(`  ${G}│${R}  ${colors.waLight}📱  Scan QR with WhatsApp:${R}                  ${G}│${R}`);
      console.log(`  ${G}│${R}  ${colors.grey}Settings → Linked Devices → Link a Device${R}  ${G}│${R}`);
      console.log(`  ${G}└──────────────────────────────────────────────┘${R}\n`);
    }

    if (connection === 'open') {
      log.success('WhatsApp connected ✅  — relaying messages to the AI pipeline');

      // ── Send "swimming" startup message to owner ──────────────────────────
      if (_ownerJid && !_startupSent) {
        _startupSent = true;
        try {
          await sleep(1500);  // brief grace period for session to stabilise
          await sock.sendMessage(_ownerJid, { text: MSG_ONLINE });
          log.info('Startup message sent to owner.');
        } catch (err) {
          log.error('Could not send startup message: ' + err.message);
        }
      }
    }

    if (connection === 'close') {
      const code      = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode : null;
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        // Send farewell before giving up
        if (_ownerJid) {
          try { await sock.sendMessage(_ownerJid, { text: MSG_OFFLINE }); } catch (_) {}
        }
        log.warn('Session logged out. Delete ~/.whywhale/credentials/whatsapp and re-scan QR.');
        _activeSock = null;
      } else {
        log.warn(`Connection closed (code ${code}). Reconnecting…`);
        _activeSock  = null;
        _startupSent = false;
        await sleep(3000);
        startWhatsApp(opts);
      }
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      const text   = extractText(msg);

      if (!text) continue;

      // ── Owner gate: only the registered owner may interact ────────────────
      if (_ownerJid && sender !== _ownerJid) {
        log.info(`Ignored message from non-owner: ${sender}`);
        continue;
      }

      log.incoming(sender, text);

      try {
        // Show WhatsApp "typing…" animation while the AI thinks
        await sock.sendPresenceUpdate('composing', sender);

        const fullReply = await getAIResponse(text, sender);
        const reply     = buildWhatsAppReply(text, fullReply);

        await sock.sendPresenceUpdate('paused', sender);

        // Reply, quoted so the user sees which message triggered it
        await sock.sendMessage(sender, { text: reply }, { quoted: msg });
        log.outgoing(sender, reply);

      } catch (err) {
        log.error(`AI handler error: ${err.message}`);
        await sock.sendPresenceUpdate('paused', sender);
        await sock.sendMessage(sender, {
          text: '⚠️ Something went wrong. Try again in a moment.',
        });
      }
    }
  });

  return sock;
}

// ─── Build a WhatsApp-friendly reply ─────────────────────────────────────────
function buildWhatsAppReply(userInput, aiReply) {
  if (!aiReply) return '(no response)';

  // Strip ANSI escape sequences
  let clean = aiReply.replace(/\x1b\[[0-9;]*m/g, '').trim();

  // Count terminal-only action blocks before removing them
  const wroteFiles = (clean.match(/@@FILE:/g)  || []).length;
  const ranCmds    = (clean.match(/@@RUN:/g)   || []).length;
  const savedMem   = (clean.match(/@@MEMORY:/g)|| []).length;

  // Remove those blocks from the reply text
  clean = clean.replace(/@@(MEMORY|FILE|END|RUN)[^\n]*/g, '').trim();

  // Collapse 3+ blank lines to 2
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  // Build a "work done" banner if the AI performed actions
  const parts = [];
  if (wroteFiles > 0) parts.push(`📄 ${wroteFiles} file${wroteFiles > 1 ? 's' : ''} written`);
  if (ranCmds   > 0) parts.push(`⚡ ${ranCmds} command${ranCmds   > 1 ? 's' : ''} run`);
  if (savedMem  > 0) parts.push(`💾 ${savedMem} memory update${savedMem > 1 ? 's' : ''}`);

  let header = '';
  if (parts.length > 0) {
    header = '✅ *Done* — ' + parts.join(' · ') + '\n\n';
  }

  // Cap at ~1500 chars for comfortable mobile reading
  const MAX = 1500;
  if (clean.length > MAX) {
    clean = clean.slice(0, MAX) + '\n\n…_(trimmed — see terminal for full output)_';
  }

  return (header + clean).trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.buttonsResponseMessage?.selectedDisplayText ||
    msg.message?.listResponseMessage?.title ||
    ''
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Standalone entry ─────────────────────────────────────────────────────────
if (require.main === module) {
  startWhatsApp({ headless: !process.stdout.isTTY })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { startWhatsApp, sendFarewellMessage };