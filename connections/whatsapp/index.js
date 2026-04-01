'use strict';

/**
 * whyWhale — WhatsApp Connection (Baileys)
 *
 * FIXES & CHANGES in this version:
 *
 *  Fix 1 — Singleton guard reset for auto-reconnects (408/401/403).
 *  Fix 2 — Stdout filter suppresses noisy Baileys signal-protocol dumps.
 *  Fix 3 — Code 440 (session-replaced) auto-retries once after 15s.
 *  Fix 4 — Self-chat allowed through; _sentByBot set prevents reply loops.
 *  Fix 5 — Farewell message one-shot guard (_farewellSent flag).
 *
 *  NEW — Section theme display:
 *    · When WA is connected but idle, terminal shows normal PS1.
 *    · When a message arrives, the logger opens a ┌═══ section block.
 *    · Each message/reply is rendered as ┟══ lines inside the section.
 *    · When the AI decides to do work (file ops, shell commands),
 *      the section closes with @END-> going to terminal for work,
 *      and the terminal returns to its normal PS1 while work runs.
 *    · When the AI sends a file, section closes with @END->to sending.
 *    · If no work is triggered (pure chat), section closes @OnGoing->chatting.
 *    · A new section with an incremented number opens on the next message.
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

const { getAIResponse, executeWork } = require('./aiHandler');
const { log, colors }                = require('./logger');

// ─── Config ───────────────────────────────────────────────────────────────────
const AUTH_DIR         = path.join(os.homedir(), '.whywhale', 'credentials', 'whatsapp');
const SESSION_ID       = 'session';
const CONNECTIONS_PATH = path.join(os.homedir(), '.whywhale_connections.json');
const MAX_RETRIES      = 3;
const RETRY_440_MS     = 15_000;

// ─── Fix 2: Stdout filter ─────────────────────────────────────────────────────
(function installStdoutFilter() {
  const NOISE = [
    'Closing session:', 'Closing open session', 'SessionEntry',
    'Bad MAC', 'Failed to decrypt', 'registrationId:', 'currentRatchet:',
    'indexInfo:', '_chains:', 'chainKey:', 'chainType:', 'messageKeys:',
    'ephemeralKeyPair:', 'lastRemoteEphemeralKey:', 'previousCounter:',
    'rootKey:', 'baseKey:', 'baseKeyType:', 'remoteIdentityKey:',
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

// ─── Session management ───────────────────────────────────────────────────────
function wipeSession() {
  const sessionPath = path.join(AUTH_DIR, SESSION_ID);
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log('  \x1b[38;5;226m⚠ Session wiped — will require fresh QR scan.\x1b[0m');
    }
  } catch (e) {
    console.log('  \x1b[38;5;203m✘ Could not wipe session: ' + e.message + '\x1b[0m');
  }
}

function resetSession() {
  wipeSession();
  _activeSock = null; _startupSent = false; _ownerJid = null;
  _retryCount = 0; _isRunning = false; _farewellSent = false;
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
  return clean ? clean + '@s.whatsapp.net' : null;
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
let _farewellSent = false;
const _sentByBot  = new Set();

// ─── Farewell ─────────────────────────────────────────────────────────────────
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
  console.log('  ' + G  + '    /wp'          + R + GR + '          — re-link your account (shows QR)' + R);
  console.log('  ' + G  + '    /wa --reset'  + R + GR + '  — wipe session and start fresh' + R);
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
  _farewellSent = false;

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

      if (loggedOut) {
        wipeSession(); _retryCount = 0; _isRunning = false;
        printDisconnectNotice('you logged out from your phone');
        if (typeof onDisconnected === 'function') onDisconnected('loggedOut');
        return;
      }

      if (code === 440) {
        const Y = '\x1b[38;5;226m', GR = '\x1b[38;5;245m', R = '\x1b[0m';
        console.log('');
        console.log('  ' + Y + '⚠ WhatsApp: session replaced (code 440).' + R);
        console.log('  ' + GR + 'Another WhatsApp Web / standalone session took over.' + R);
        console.log('  ' + GR + 'Auto-retrying in ' + (RETRY_440_MS / 1000) + 's …' + R);
        console.log('');
        _retryCount = 0; _isRunning = false;
        await sleep(RETRY_440_MS);
        if (!_isRunning) startWhatsApp(opts);
        return;
      }

      if (code === 401 || code === 403) {
        log.warn(`Auth error (code ${code}) — wiping session, will show fresh QR.`);
        wipeSession(); _retryCount = 0; _isRunning = false;
        await sleep(2000);
        startWhatsApp(opts);
        return;
      }

      _retryCount++;
      if (_retryCount > MAX_RETRIES) {
        _retryCount = 0; _isRunning = false;
        printDisconnectNotice(`connection failed after ${MAX_RETRIES} attempts (code ${code})`);
        if (typeof onDisconnected === 'function') onDisconnected('maxRetries');
        return;
      }
      const delay = 3000 * _retryCount;
      log.warn(`Connection closed (code ${code}). Reconnecting (${_retryCount}/${MAX_RETRIES}) in ${delay / 1000}s…`);
      _isRunning = false;
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

      if (msg.key.fromMe) {
        if (_sentByBot.has(msg.key.id)) {
          _sentByBot.delete(msg.key.id);
          continue;
        }
        if (!isSelfChat) continue;
      }

      const text = extractText(msg);
      if (!text) continue;

      if (_ownerJid && sender !== _ownerJid) {
        log.info(`Ignored message from non-owner: ${sender}`);
        continue;
      }

      // ── PHASE 1: Log incoming, get AI plan (stdout suppressed) ────────
      log.incoming(sender, text);

      try {
        await sock.sendPresenceUpdate('composing', sender);

        // AI plans the response — returns reply text + parsed directives
        const { reply, directives, workType } = await getAIResponse(text, sender);

        // ── Log outgoing reply inside the section ───────────────────────
        log.outgoing(sender, reply);

        // ── Close section with the right status tag ─────────────────────
        log.closeSection(workType);

        // ── Send the reply to WhatsApp now ──────────────────────────────
        await sock.sendPresenceUpdate('paused', sender);
        const sent = await sock.sendMessage(sender, { text: reply }, { quoted: msg });
        if (sent?.key?.id) _sentByBot.add(sent.key.id);

        // ── PHASE 2: Execute work visibly in the terminal ───────────────
        // Only runs when AI produced @@FILE / @@RUN / @@MEMORY directives.
        // stdout is fully restored here so the user sees the work live.
        if (workType === 'work' || workType === 'send') {
          const summary = await executeWork(directives, sender);

          // ── Open a new section to report results back via WA ──────────
          if (summary.length > 0) {
            const doneText = '✅ Done!\n\n' + summary.join('\n');
            log.openSection();
            log.outgoing(sender, doneText);
            log.closeSection('chat');

            const doneSent = await sock.sendMessage(sender, { text: doneText });
            if (doneSent?.key?.id) _sentByBot.add(doneSent.key.id);
          }
        }

      } catch (err) {
        log.error(`AI handler error: ${err.message}`);
        if (log.sectionOpen) log.closeSection('end');
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Standalone entry ─────────────────────────────────────────────────────────
if (require.main === module) {
  startWhatsApp({ headless: !process.stdout.isTTY })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { startWhatsApp, sendFarewellMessage, resetSession };