'use strict';

/**
 * whyWhale — WhatsApp Connection (Baileys)
 *
 * Fixes:
 *  - Logout from phone → notify user, DON'T spam QR, ask them to /wp
 *  - 408 timeout      → max 3 retries, then stop and notify
 *  - resetSession()   → exported for /wa --reset command
 *  - onDisconnected() → callback so main can print prompt / notify user
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

// Max auto-reconnect attempts before giving up and asking the user to reconnect manually
const MAX_RETRIES = 3;

// ─── Wipe local session (called on Bad MAC / logout / reset) ─────────────────
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
  _activeSock  = null;
  _startupSent = false;
  _ownerJid    = null;
  _retryCount  = 0;
  _isRunning   = false;

  // Update connections file — mark as disconnected so banner reflects reality
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

// ─── Module-level state ───────────────────────────────────────────────────────
let _activeSock  = null;
let _ownerJid    = null;
let _startupSent = false;
let _retryCount  = 0;       // consecutive reconnect attempts
let _isRunning   = false;   // singleton guard — prevents double-connect (e.g. setup + autoStart)

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

// ─── Helper: print a clean "disconnected" notice ────────────────────────────
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
  // Singleton guard — if a session is already active or being established, skip.
  // This prevents autoStartConnections from spawning a second session when
  // setupWhatsApp already connected during the setup wizard.
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

  // Refresh owner JID on every connect (may change after /wa owner or /wp)
  const ownerNumber = loadOwnerNumber();
  _ownerJid = toJid(ownerNumber);

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

  // ── Persist credentials ───────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Suppress noisy libsignal decrypt logs to stderr ──────────────────────
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

  // ── Connection lifecycle ──────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ── Render QR code ────────────────────────────────────────────────────
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
      // Reset retry counter on successful connection
      _retryCount = 0;
      log.success('WhatsApp connected ✅  — relaying messages to the AI pipeline');

      // Always fire onConnected so callers (e.g. setup wizard) can proceed
      if (typeof onConnected === 'function') onConnected();

      // Only send startup message when an owner is registered
      if (_ownerJid && !_startupSent) {
        _startupSent = true;
        try {
          await sleep(1500);
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

      _activeSock  = null;
      _startupSent = false;

      // ── Case 1: User logged out from phone ─────────────────────────────
      if (loggedOut) {
        wipeSession();
        _retryCount = 0;
        _isRunning  = false;
        printDisconnectNotice('you logged out from your phone');
        if (typeof onDisconnected === 'function') onDisconnected('loggedOut');
        // DO NOT auto-restart — user must /wp or /wa --reset
        return;
      }

      // ── Case 2: Session replaced by another WA Web session ─────────────
      if (code === 440) {
        const Y  = '\x1b[38;5;226m';
        const G  = '\x1b[38;5;35m';
        const GR = '\x1b[38;5;245m';
        const R  = '\x1b[0m';
        console.log('');
        console.log('  ' + Y + '⚠ WhatsApp: session replaced (code 440).' + R);
        console.log('  ' + GR + 'Another WhatsApp Web session took over this account.' + R);
        console.log('  ' + GR + 'Fix: phone → Linked Devices → remove extra sessions.' + R);
        console.log('  ' + GR + 'Then run ' + R + G + '/wp' + R + GR + ' to reconnect.' + R);
        console.log('');
        _isRunning = false;
        if (typeof onDisconnected === 'function') onDisconnected('replaced');
        return;
      }

      // ── Case 3: Auth error — wipe and retry once ────────────────────────
      if (code === 401 || code === 403) {
        log.warn(`Auth error (code ${code}) — wiping session, will show fresh QR.`);
        wipeSession();
        _retryCount = 0;
        await sleep(2000);
        startWhatsApp(opts);
        return;
      }

      // ── Case 4: All other disconnects (408 timeout, network, etc.) ───────
      // Retry up to MAX_RETRIES, then stop and ask user to reconnect manually
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
      await sleep(delay);
      startWhatsApp(opts);
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

      // Owner gate: only the registered owner may interact
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
  if (parts.length > 0) {
    header = '✅ *Done* — ' + parts.join(' · ') + '\n\n';
  }

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