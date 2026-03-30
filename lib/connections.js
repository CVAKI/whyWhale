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
  const { dg, rf } = require('./colors');

  // ── WhatsApp green ANSI colours (used throughout this function) ────────────
  const G  = '\x1b[38;5;35m';   // #25D366 brand green
  const GD = '\x1b[38;5;30m';   // #128C7E dark teal-green
  const GL = '\x1b[38;5;157m';  // #DCF8C6 light mint
  const GM = '\x1b[38;5;42m';   // medium spring green
  const GR = '\x1b[38;5;245m';  // grey
  const WH = '\x1b[38;5;255m';  // white
  const B  = '\x1b[1m';
  const R  = '\x1b[0m';
  const DIV = G + '─'.repeat(50) + R;

  console.log('');
  console.log('  ' + G + B + '┌─────────────────────────────────────────────────┐' + R);
  console.log('  ' + G + B + '│' + R + '  ' + WH + B + '💬  WhatsApp Connection Setup' + R + '                  ' + G + B + '│' + R);
  console.log('  ' + G + B + '└─────────────────────────────────────────────────┘' + R);
  console.log('  ' + DIV);
  console.log('  ' + GL + 'Links your WhatsApp account — no API key needed.' + R);
  console.log('  ' + GR + 'Powered by whatsapp-web.js  ·  QR scan from your phone' + R);
  console.log('  ' + DIV);
  console.log('');

  // ── Check if packages are installed — auto-install if missing ────────────
  let Client, LocalAuth, qrcode;
  let missing = false;

  try { ({ Client, LocalAuth } = require('whatsapp-web.js')); } catch (_) { missing = true; }
  try { qrcode = require('qrcode-terminal'); }              catch (_) { missing = true; }

  if (missing) {
    console.log('  ' + '\x1b[38;5;226m' + '⚠ Required packages missing — installing automatically...' + R);
    console.log('  ' + GR + 'npm install whatsapp-web.js qrcode-terminal' + R + '\n');

    const installed = await new Promise((resolve) => {
      const { spawn } = require('child_process');
      // Determine install dir: prefer the whyWhale package root, fall back to cwd
      const installDir = (() => {
        try { return require('path').resolve(__dirname, '..', '..'); } catch (_) { return process.cwd(); }
      })();

      const isWin = process.platform === 'win32';
      const cmd   = isWin ? 'npm.cmd' : 'npm';
      const child = spawn(
        cmd,
        ['install', '--save', 'whatsapp-web.js', 'qrcode-terminal'],
        { cwd: installDir, stdio: 'inherit', shell: isWin }
      );

      child.on('close', code => {
        if (code === 0) {
          console.log('\n  ' + G + B + '✔ Packages installed!' + R);
          resolve(true);
        } else {
          console.log('\n  ' + '\x1b[38;5;203m' + '✘ npm install failed (exit ' + code + ').' + R);
          console.log('  ' + GR + 'Try manually: ' + R + G + 'npm install whatsapp-web.js qrcode-terminal' + R);
          resolve(false);
        }
      });

      child.on('error', err => {
        console.log('\n  ' + '\x1b[38;5;203m' + '✘ Could not run npm: ' + err.message + R);
        console.log('  ' + GR + 'Make sure Node.js / npm is in your PATH.' + R);
        resolve(false);
      });
    });

    if (!installed) return false;

    // Re-require after install
    try { ({ Client, LocalAuth } = require('whatsapp-web.js')); } catch (_) {
      console.log('  ' + '\x1b[38;5;203m' + '✘ Could not load whatsapp-web.js after install.' + R);
      console.log('  ' + GR + 'Try restarting whyWhale and running ' + R + G + '/wp' + R + GR + ' again.' + R);
      return false;
    }
    try { qrcode = require('qrcode-terminal'); } catch (_) {
      console.log('  ' + '\x1b[38;5;203m' + '✘ Could not load qrcode-terminal after install.' + R);
      return false;
    }

    console.log('  ' + GL + 'Starting WhatsApp setup...' + R + '\n');
  }

  // ── Check puppeteer / chromium ─────────────────────────────────────────────
  if (process.platform === 'linux') {
    const { execSync } = require('child_process');
    try { execSync('which chromium-browser || which google-chrome || which chromium', { stdio: 'pipe' }); }
    catch (_) {
      console.log('  ' + rf('⚠ No system Chromium found.'));
      console.log('  ' + GL + 'Install it: ' + R + G + 'sudo apt install chromium-browser' + R);
      console.log('  ' + GL + 'Or set:     ' + R + G + 'PUPPETEER_EXECUTABLE_PATH=/path/to/chrome' + R + '\n');
    }
  }

  console.log('  ' + GM + '⟳ Starting WhatsApp client...' + R);
  console.log('  ' + GR + '  QR code will appear below — scan it with your phone.' + R + '\n');
  console.log('  ' + DIV);

  return new Promise((resolve) => {
    let client;
    try {
      client = new Client({
        authStrategy: new LocalAuth({ clientId: 'whywhale' }),
        puppeteer:    { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      });
    } catch (err) {
      console.log('\n  ' + dg('✘ Could not create WhatsApp client: ') + err.message);
      console.log('  ' + GL + 'Make sure Chromium is available (see warning above).' + R);
      resolve(false);
      return;
    }

    // ── QR code event ────────────────────────────────────────────────────────
    client.on('qr', (qr) => {
      console.log('');
      qrcode.generate(qr, { small: true });
      console.log('');
      console.log('  ' + G + B + '► Scan the QR code above with WhatsApp on your phone.' + R);
      console.log('  ' + GD + '  WhatsApp app → ⋮ Menu → Linked Devices → Link a Device' + R);
      console.log('  ' + GR + '  Waiting for scan...' + R);
    });

    // ── Auth events ──────────────────────────────────────────────────────────
    client.on('authenticated', () => {
      console.log('\n  ' + G + B + '✔ Authenticated!' + R + GL + '  Finishing connection...' + R);
    });

    client.on('auth_failure', (msg) => {
      console.log('\n  ' + dg('✘ Authentication failed: ') + String(msg));
      console.log('  ' + GL + 'Try again with ' + R + G + '/wp' + R);
      resolve(false);
    });

    // ── Ready ────────────────────────────────────────────────────────────────
    client.on('ready', () => {
      console.log('');
      console.log('  ' + G + B + '┌─────────────────────────────────────────────────┐' + R);
      console.log('  ' + G + B + '│' + R + '  ' + G + B + '✅  WhatsApp Connected!' + R + '                        ' + G + B + '│' + R);
      console.log('  ' + G + B + '└─────────────────────────────────────────────────┘' + R);
      console.log('  ' + DIV);
      console.log('  ' + GL + '  Send a message: ' + R + G + '/wa <number> <message>' + R);
      console.log('  ' + GL + '  Example:        ' + R + G + '/wa 919876543210 Hello!' + R);
      console.log('  ' + GL + '  Disconnect:     ' + R + G + '/connection disconnect whatsapp' + R);
      console.log('  ' + DIV + '\n');

      const data = loadConnections();
      data.whatsapp = { connected: true, connectedAt: new Date().toISOString() };
      saveConnections(data);

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