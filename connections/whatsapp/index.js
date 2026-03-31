'use strict';

/**
 * whyWhale — WhatsApp Connection (Baileys)
 *
 * ALL FIXES (5 total):
 *
 *  Fix 1 — Singleton guard was blocking auto-reconnects (408/401/403).
 *           _isRunning was never reset before calling startWhatsApp() inside
 *           retry paths. Now it is.
 *
 *  Fix 2 — "Closing session: SessionEntry" log spam leaked to terminal.
 *           Baileys emits those via console.log (stdout), not stderr.
 *           Now stdout.write is also filtered for noisy signal-protocol lines.
 *
 *  Fix 3 — Code 440 (session-replaced) ended the session permanently.
 *           Now auto-retries once after 15 s so that if the conflicting
 *           standalone process has been killed by then, reconnect succeeds.
 *
 *  Fix 4 — Self-chat ("Message yourself") was silently ignored because
 *           every incoming self-message has key.fromMe = true.
 *           Now self-chat messages are allowed through; a _sentByBot Set
 *           tracks IDs of messages the bot itself sent so those are skipped,
 *           preventing reply loops.
 *
 *  Fix 5 — Farewell message was sent twice on /exit because
 *           sendFarewellMessage() was called from two places in main.
 *           A _farewellSent flag now makes it a one-shot operation.
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
const qrcode    = require('qrcode-terminal');

const { getAIResponse } = require('./aiHandler');
const { log, colors }   = require('./logger');

// ─── Config ───────────────────────────────────────────────────────────────────
const AUTH_DIR         = path.join(os.homedir(), '.whywhale', 'credentials', 'whatsapp');
const SESSION_ID       = 'session';
const CONNECTIONS_PATH = path.join(os.homedir(), '.whywhale_connections.json');
const MAX_RETRIES      = 3;
const RETRY_440_MS     = 15_000;

// ─── Fix 2: Stdout filter — suppress noisy Baileys signal-protocol dumps ──────
(function installStdoutFilter() {
  const NOISE = [
    'Closing session:',
    'Closing open session',
    'SessionEntry',
    'Bad MAC',
    'Failed to decrypt',
    'registrationId:',
    'currentRatchet:',
    'indexInfo:',
    '_chains:',
    'chainKey:',
    'chainType:',
    'messageKeys:',
    'ephemeralKeyPair:',
    'lastRemoteEphemeralKey:',
    'previousCounter:',
    'rootKey:',
    'baseKey:',
    'baseKeyType:',
    'remoteIdentityKey:',
  ];
  const _orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk, encodingOrCb, cb) {
    const s = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    if (NOISE.some(n => s.includes(n))) {
      if (typeof encodingOrCb === 'function') encodingOrCb();
      else if (typeof cb === 'function') cb();
      return true;
    }
    return _orig(chunk, encodingOrCb, cb);
  };
})();

// ─── Wipe local session ────────────────────────────────────────────────────────
function wipeSession() {
  const sessionPath = path.join(AUTH_DIR, SESSION_ID);
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log('  \x1b[38;5;226m⚠ Session wiped — will require fresh QR scan to reconnect.\x1b[0m');
    }
  } catch (e) {
    console.log('  \x1b[38;5;203m✘ Could not wipe session: ' + e.message + '\x1b[0m');
  }
}

// ─── Reset session (exported — called by /wa --reset) ────────────────────────
function resetSession() {
  wipeSession();
  _activeSock   = null;
  _startupSent  = false;
  _ownerJid     = null;
  _retryCount   = 0;
  _isRunning    = false;
  _farewellSent = false;
  _sentByBot.clear();

  try {
    if (fs.existsSync(CONNECTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
      if (data.whatsapp) {
        data.whatsapp.connected = false;
        fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
      }
    }
  } catch (_) {}
}

// ─── Load owner number ─────────────────────────────────────────────────────────
function loadOwnerNumber() {
  try {
    if (fs.existsSync(CONNECTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
      return (data.whatsapp?.ownerNumber || '').replace(/\D/g, '');
    }
  } catch (_) {}
  return '';
}

function toJid(number) {
  const clean = number.replace(/\D/g, '');
  if (!clean) return null;
  return clean + '@s.whatsapp.net';
}

// ─── Messages ─────────────────────────────────────────────────────────────────
const MSG_ONLINE  = '🐋 *whyWhale is swimming* 🌊\n\nI\'m online and ready!\nSend me any message or terminal command and I\'ll get it done.';
const MSG_OFFLINE = '🎣 *whyWhale is going to catch fish...* 🐟\n\nI\'m shutting down now. I\'ll message you again when I\'m back online!';

// ─── Module-level state ───────────────────────────────────────────────────────
let _activeSock   = null;
let _ownerJid     = null;
let _startupSent  = false;
let _retryCount   = 0;
let _isRunning    = false;
let _farewellSent = false;         // Fix 5: one-shot guard
const _sentByBot  = new Set();     // Fix 4: bot-sent message ID tracker

// ─── Fix 5: One-shot farewell ──────────────────────────────────────────────────
async function sendFarewellMessage() {
  if (!_activeSock || !_ownerJid || _farewellSent) return;
  _farewellSent = true;
  try {
    await _activeSock.sendMessage(_ownerJid, { text: MSG_OFFLINE });
    log.info('Farewell message sent to owner.');
  } catch (err) {
    log.error('Could not send farewell: ' + err.message);
  }
}

// ─── Disconnect notice ────────────────────────────────────────────────────────
function printDisconnectNotice(reason) {
  const Y  = '\x1b[38;5;226m';
  const G  = '\x1b[38;5;35m';
  const GR = '\x1b[38;5;245m';
  const R  = '\x1b[0m';
  console.log('');
  console.log('  ' + Y + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + R);
  console.log('  ' + Y + '⚠  WhatsApp disconnected' + (reason ? ' — ' + reason : '') + R);
  console.log('  ' + GR + '  To reconnect, type:' + R);
  console.log('  ' + G  + '    /wp' + R + GR + '          — re-link your account (shows QR)' + R);
  console.log('  ' + G  + '    /wa --reset' + R + GR + '  — wipe session and start fresh' + R);
  console.log('  ' + Y + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + R);
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function startWhatsApp(opts = {}) {
  if (_isRunning) {
    log.info('startWhatsApp called but session already active — skipping duplicate start.');
    if (typeof opts.onConnected === 'function' && _activeSock) opts.onConnected();
    return _activeSock;
  }
  _isRunning = true;

  const { onConnected, onDisconnected } = opts;
  const authPath = path.join(AUTH_DIR, SESSION_ID);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version }          = await fetchLatestBaileysVersion();

  log.info(`Using WA version ${version.join('.')}`);

  const ownerNumber = loadOwnerNumber();
  _ownerJid     = toJid(ownerNumber);
  _farewellSent = false;   // reset on each fresh connect

  if (!_ownerJid) {
    log.warn('No owner number set — replying to ALL messages. Run /wp to set your number.');
  } else {
    log.info(`Owner JID: ${_ownerJid}`);
  }

  const sock = makeWASocket({
    version,
    auth:    state,
    logger:  pino({ level: 'silent' }),
    browser: ['whyWhale', 'Chrome', '4.0.0'],
  });

  _activeSock  = sock;
  _startupSent = false;
  _sentByBot.clear();

  // Suppress Baileys stderr noise
  const _origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString();
    if (
      s.includes('Bad MAC') || s.includes('Failed to decrypt') ||
      s.includes('Closing open session') || s.includes('Closing session:') ||
      s.includes('SessionEntry')
    ) return true;
    return _origStderrWrite(chunk, ...args);
  };

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
      console.log(`  ${G}└──────────────────────────────────────────────┘${R}`);
      console.log('');
      qrcode.generate(qr, { small: true });
      console.log('');
    }

    if (connection === 'open') {
      _retryCount = 0;
      log.success('WhatsApp connected ✅  — relaying messages to the AI pipeline');
      if (typeof onConnected === 'function') onConnected();

      if (_ownerJid && !_startupSent) {
        _startupSent = true;
        try {
          await sleep(1500);
          const sent = await sock.sendMessage(_ownerJid, { text: MSG_ONLINE });
          if (sent?.key?.id) _sentByBot.add(sent.key.id);
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

      _activeSock  = null;
      _startupSent = false;

      // Case 1: Logged out from phone
      if (loggedOut) {
        wipeSession();
        _retryCount = 0;
        _isRunning  = false;
        printDisconnectNotice('you logged out from your phone');
        if (typeof onDisconnected === 'function') onDisconnected('loggedOut');
        return;
      }

      // Fix 3 — Case 2: Session replaced (440) — auto-retry after delay
      if (code === 440) {
        const Y  = '\x1b[38;5;226m';
        const GR = '\x1b[38;5;245m';
        const R  = '\x1b[0m';
        console.log('');
        console.log('  ' + Y + '⚠ WhatsApp: session replaced (code 440).' + R);
        console.log('  ' + GR + 'Another WhatsApp Web / standalone session took over.' + R);
        console.log('  ' + GR + 'Fix: phone → Linked Devices → remove extra sessions.' + R);
        console.log('  ' + GR + 'Auto-retrying in ' + (RETRY_440_MS / 1000) + 's …' + R);
        console.log('');
        _retryCount = 0;
        _isRunning  = false;   // Fix 1
        await sleep(RETRY_440_MS);
        if (!_isRunning) startWhatsApp(opts);
        return;
      }

      // Fix 1 — Case 3: Auth error
      if (code === 401 || code === 403) {
        log.warn(`Auth error (code ${code}) — wiping session, will show fresh QR.`);
        wipeSession();
        _retryCount = 0;
        _isRunning  = false;   // Fix 1: was missing
        await sleep(2000);
        startWhatsApp(opts);
        return;
      }

      // Fix 1 — Case 4: Network / timeout — retry up to MAX_RETRIES
      _retryCount++;
      if (_retryCount > MAX_RETRIES) {
        _retryCount = 0;
        _isRunning  = false;
        printDisconnectNotice(`connection failed after ${MAX_RETRIES} attempts (code ${code})`);
        if (typeof onDisconnected === 'function') onDisconnected('maxRetries');
        return;
      }
      const delay = 3000 * _retryCount;
      log.warn(`Connection closed (code ${code}). Reconnecting (${_retryCount}/${MAX_RETRIES}) in ${delay / 1000}s…`);
      _isRunning = false;      // Fix 1: was missing
      await sleep(delay);
      startWhatsApp(opts);
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const sender     = msg.key.remoteJid;
      const isSelfChat = !!(_ownerJid && sender === _ownerJid);

      // Fix 4: fromMe handling
      if (msg.key.fromMe) {
        if (_sentByBot.has(msg.key.id)) {
          // Bot's own reply — skip to prevent loop
          _sentByBot.delete(msg.key.id);
          continue;
        }
        // Non-self-chat: skip all other fromMe messages
        if (!isSelfChat) continue;
        // Self-chat: fall through — process as user input
      }

      const text = extractText(msg);
      if (!text) continue;

      // Owner gate
      if (_ownerJid && sender !== _ownerJid) {
        log.info(`Ignored message from non-owner: ${sender}`);
        continue;
      }

      log.incoming(sender, text);

      try {
        await sock.sendPresenceUpdate('composing', sender);
        const fullReply = await getAIResponse(text, sender);
        const reply     = buildWhatsAppReply(text, fullReply);
        await sock.sendPresenceUpdate('paused', sender);
        const sent = await sock.sendMessage(sender, { text: reply }, { quoted: msg });
        if (sent?.key?.id) _sentByBot.add(sent.key.id);
        log.outgoing(sender, reply);
      } catch (err) {
        log.error(`AI handler error: ${err.message}`);
        await sock.sendPresenceUpdate('paused', sender);
        const errSent = await sock.sendMessage(sender, {
          text: '⚠️ Something went wrong. Try again in a moment.',
        });
        if (errSent?.key?.id) _sentByBot.add(errSent.key.id);
      }
    }
  });

  return sock;
}

// ─── Build a WhatsApp-friendly reply ─────────────────────────────────────────
function buildWhatsAppReply(userInput, aiReply) {
  if (!aiReply) return '(no response)';

  let clean = aiReply.replace(/\x1b\[[0-9;]*m/g, '').trim();

  const wroteFiles = (clean.match(/@@FILE:/g)  || []).length;
  const ranCmds    = (clean.match(/@@RUN:/g)   || []).length;
  const savedMem   = (clean.match(/@@MEMORY:/g)|| []).length;

  clean = clean.replace(/@@(MEMORY|FILE|END|RUN)[^\n]*/g, '').trim();
  clean = clean.replace(/\n{3,}/g, '\n\n').trim();

  const parts = [];
  if (wroteFiles > 0) parts.push(`📄 ${wroteFiles} file${wroteFiles > 1 ? 's' : ''} written`);
  if (ranCmds   > 0) parts.push(`⚡ ${ranCmds} command${ranCmds   > 1 ? 's' : ''} run`);
  if (savedMem  > 0) parts.push(`💾 ${savedMem} memory update${savedMem > 1 ? 's' : ''}`);

  let header = '';
  if (parts.length > 0) header = '✅ *Done* — ' + parts.join(' · ') + '\n\n';

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

module.exports = { startWhatsApp, sendFarewellMessage, resetSession };