'use strict';

/**
 * whyWhale — WhatsApp Connection
 * Powered by @whiskeysockets/baileys
 *
 * Usage:
 *   node connections/whatsapp/index.js
 *
 * Or import and call startWhatsApp() from your own entry point.
 */

const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom }    = require('@hapi/boom');
const path        = require('path');
const pino        = require('pino');

const { getAIResponse }  = require('./aiHandler');
const { dmGuard }        = require('./dmPolicy');
const { log, colors }    = require('./logger');

// ─── Config ──────────────────────────────────────────────────────────────────
const AUTH_DIR   = path.join(require('os').homedir(), '.whywhale', 'credentials', 'whatsapp');
const SESSION_ID = 'session';

// ─── Main ─────────────────────────────────────────────────────────────────────
async function startWhatsApp(opts = {}) {
  const {
    dmPolicy   = 'pairing',   // 'pairing' | 'allowlist' | 'open'
    allowFrom  = ['*'],       // array of allowed JIDs / '*' for all
    headless   = false,       // set true for servers — renders QR as ASCII
  } = opts;

  const authPath = path.join(AUTH_DIR, SESSION_ID);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version }          = await fetchLatestBaileysVersion();

  log.info(`Using WA version ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth:              state,
    printQRInTerminal: true,           // always print — works both headed & headless
    logger:            pino({ level: 'silent' }), // suppress Baileys internal noise
    browser:           ['whyWhale', 'Chrome', '4.0.0'],
  });

  // ── Persist credentials ─────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection lifecycle ────────────────────────────────────────────────────
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
      log.success('WhatsApp connected ✅  — messages will be relayed to the AI pipeline');
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : null;

      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        log.warn('Session logged out. Delete ~/.whywhale/credentials/whatsapp and re-scan QR.');
      } else {
        log.warn(`Connection closed (code ${code}). Reconnecting…`);
        // Back-off then reconnect
        await sleep(3000);
        startWhatsApp(opts);
      }
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip outbound / empty
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      const text   = extractText(msg);

      if (!text) continue;

      // ── DM policy gate ───────────────────────────────────────────────────
      const allowed = await dmGuard({ sender, text, policy: dmPolicy, allowFrom, sock });
      if (!allowed) continue;

      log.incoming(sender, text);

      try {
        // Show "typing…" indicator
        await sock.sendPresenceUpdate('composing', sender);

        // Call AI
        const reply = await getAIResponse(text);

        await sock.sendPresenceUpdate('paused', sender);

        // Send reply
        await sock.sendMessage(sender, { text: reply }, { quoted: msg });
        log.outgoing(sender, reply);
      } catch (err) {
        log.error(`AI handler error: ${err.message}`);
        await sock.sendMessage(sender, { text: '⚠️ Something went wrong. Try again in a moment.' });
      }
    }
  });

  return sock;
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
  // Read simple env overrides for headless / policy
  const policy    = process.env.WA_DM_POLICY  || 'open';
  const allowFrom = process.env.WA_ALLOW_FROM
    ? process.env.WA_ALLOW_FROM.split(',').map(s => s.trim())
    : ['*'];

  startWhatsApp({ dmPolicy: policy, allowFrom, headless: !process.stdout.isTTY })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { startWhatsApp };