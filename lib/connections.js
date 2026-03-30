'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONNECTIONS_PATH = path.join(os.homedir(), '.whywhale_connections.json');

// ─── Connection Registry ──────────────────────────────────────────────────────
// Add new integrations here. Each entry describes the service and how to set it up.
const CONNECTION_REGISTRY = {
  whatsapp: {
    id:          'whatsapp',
    name:        'WhatsApp',
    icon:        '💬',
    color:       'kp',   // green — matches brand
    description: 'Send & receive WhatsApp messages from the terminal',
    packages:    ['whatsapp-web.js', 'qrcode-terminal'],
  },
  telegram: {
    id:          'telegram',
    name:        'Telegram',
    icon:        '✈️',
    color:       'ab',   // blue
    description: 'Send & receive Telegram messages (coming soon)',
    packages:    [],
    comingSoon:  true,
  },
  discord: {
    id:          'discord',
    name:        'Discord',
    icon:        '🎮',
    color:       'vt',   // violet
    description: 'Monitor Discord channels (coming soon)',
    packages:    [],
    comingSoon:  true,
  },
};

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadConnections() {
  try {
    if (fs.existsSync(CONNECTIONS_PATH))
      return JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
  } catch (_) {}
  return {};
}

function saveConnections(data) {
  try { fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
}

function getConnectionStatus(id) {
  return loadConnections()[id] || null;
}

function disconnectConnection(id) {
  const data = loadConnections();
  delete data[id];
  saveConnections(data);
}

// ─── WhatsApp setup ───────────────────────────────────────────────────────────
async function setupWhatsApp(ctx) {
  const { kp, ab, sd, dg, wh, rf, tl, cr } = require('./colors');

  console.log('\n  ' + wh('💬 WhatsApp Connection Setup'));
  console.log('  ' + ab('─'.repeat(48)));
  console.log('  ' + ab('Uses ') + sd('whatsapp-web.js') + ab(' to link your WhatsApp account.'));
  console.log('  ' + ab('You will scan a QR code with your phone — no API key needed.\n'));

  // ── Check if packages are installed ───────────────────────────────────────
  let Client, LocalAuth, qrcode;
  let missing = false;

  try { ({ Client, LocalAuth } = require('whatsapp-web.js')); } catch (_) { missing = true; }
  try { qrcode = require('qrcode-terminal'); }              catch (_) { missing = true; }

  if (missing) {
    console.log('  ' + rf('⚠ Required packages are not installed.'));
    console.log('  ' + ab('Install them by running:\n'));
    console.log('    ' + sd('npm install whatsapp-web.js qrcode-terminal') + '\n');
    console.log('  ' + ab('Then run ') + sd('/connection') + ab(' again to complete setup.'));
    return false;
  }

  // ── Check puppeteer / chromium ─────────────────────────────────────────────
  // whatsapp-web.js uses puppeteer under the hood. On some Linux systems
  // the bundled Chromium is missing. Warn early if that looks likely.
  if (process.platform === 'linux') {
    const { execSync } = require('child_process');
    try { execSync('which chromium-browser || which google-chrome || which chromium', { stdio: 'pipe' }); }
    catch (_) {
      console.log('  ' + rf('⚠ No system Chromium found.'));
      console.log('  ' + ab('Install it with: ') + sd('sudo apt install chromium-browser'));
      console.log('  ' + ab('Or set the env var: ') + sd('PUPPETEER_EXECUTABLE_PATH=/path/to/chrome\n'));
    }
  }

  console.log('  ' + ab('Starting WhatsApp client — QR code will appear shortly...\n'));
  console.log('  ' + ab('─'.repeat(48)));

  return new Promise((resolve) => {
    let client;
    try {
      client = new Client({
        authStrategy:   new LocalAuth({ clientId: 'whywhale' }),
        puppeteer:      { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      });
    } catch (err) {
      console.log('\n  ' + dg('✘ Could not create WhatsApp client: ') + err.message);
      console.log('  ' + ab('Make sure Chromium is available (see warning above).'));
      resolve(false);
      return;
    }

    // ── QR code event ────────────────────────────────────────────────────────
    client.on('qr', (qr) => {
      console.log('');
      qrcode.generate(qr, { small: true });
      console.log('\n  ' + kp('► Scan the QR code above with WhatsApp on your phone.'));
      console.log('  ' + ab('  WhatsApp app → ⋮ Menu → Linked Devices → Link a Device'));
      console.log('  ' + ab('  Waiting for scan...'));
    });

    // ── Auth events ──────────────────────────────────────────────────────────
    client.on('authenticated', () => {
      console.log('\n  ' + kp('✔ Authenticated!') + ab(' Finishing connection...'));
    });

    client.on('auth_failure', (msg) => {
      console.log('\n  ' + dg('✘ Authentication failed: ') + String(msg));
      console.log('  ' + ab('Try again with ') + sd('/connection'));
      resolve(false);
    });

    // ── Ready ────────────────────────────────────────────────────────────────
    client.on('ready', () => {
      console.log('  ' + kp('✔ WhatsApp connected!'));
      console.log('  ' + ab('  You can now send messages inside whyWhale.'));
      console.log('  ' + ab('  Type ') + sd('/wa <number> <message>') + ab(' to send a message.'));
      console.log('  ' + ab('  Example: ') + sd('/wa 919876543210 Hello!') + '\n');

      // Persist connection state
      const data = loadConnections();
      data.whatsapp = {
        connected:   true,
        connectedAt: new Date().toISOString(),
      };
      saveConnections(data);

      // Attach the live client to ctx so the /wa command can use it
      if (ctx) ctx.waClient = client;

      resolve(true);
    });

    client.on('disconnected', (reason) => {
      console.log('\n  ' + rf('⚠ WhatsApp disconnected: ') + reason);
      const data = loadConnections();
      if (data.whatsapp) { data.whatsapp.connected = false; saveConnections(data); }
    });

    client.initialize().catch((err) => {
      console.log('\n  ' + dg('✘ Failed to start WhatsApp client: ') + err.message);
      resolve(false);
    });
  });
}

// ─── setupConnection ──────────────────────────────────────────────────────────
// Entry point called by /connection command and first-run setup.
async function setupConnection(id, ctx) {
  const reg = CONNECTION_REGISTRY[id];
  if (!reg) return false;
  if (reg.comingSoon) {
    const { ab, dg } = require('./colors');
    console.log('\n  ' + dg(reg.icon + ' ' + reg.name + ' is coming soon!') + ab(' Stay tuned.'));
    return false;
  }
  if (id === 'whatsapp') return setupWhatsApp(ctx);
  return false;
}

module.exports = {
  CONNECTION_REGISTRY,
  loadConnections,
  saveConnections,
  getConnectionStatus,
  disconnectConnection,
  setupConnection,
};