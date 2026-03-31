'use strict';

/**
 * logger.js
 *
 * WhatsApp-green themed logger for the WhatsApp connection module.
 * Incoming / outgoing messages render as PS1-style prompt blocks
 * that visually integrate with the whyWhale terminal UI:
 *
 *   ┌[HH:MM:SS]════[whyWhale]════[WA ←]════[#N]
 *   ┟══[whatsapp]::[sender  preview text...]
 *   └[folder]──►
 *
 * Palette mirrors WhatsApp's own brand greens:
 *   waGreen   #25D366  — primary brand green  (ansi 38;5;35m)
 *   waDark    #128C7E  — dark teal-green       (ansi 38;5;30m)
 *   waLight   #DCF8C6  — light bubble green    (ansi 38;5;157m)
 *   waMid     #34B7F1  — info blue
 */

const path = require('path');

const colors = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  // ── WhatsApp greens ───────────────────────────────────────────────────────
  waGreen:  '\x1b[38;5;35m',
  waDark:   '\x1b[38;5;30m',
  waLight:  '\x1b[38;5;157m',
  waMid:    '\x1b[38;5;42m',
  // ── PS1 chrome ────────────────────────────────────────────────────────────
  cyan:     '\x1b[38;5;51m',
  blue:     '\x1b[38;5;75m',
  // ── Status ────────────────────────────────────────────────────────────────
  yellow:   '\x1b[38;5;226m',
  red:      '\x1b[38;5;203m',
  grey:     '\x1b[38;5;245m',
  white:    '\x1b[38;5;255m',
};

// ── Counters ──────────────────────────────────────────────────────────────────
let _inCount  = 0;
let _outCount = 0;

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function cwd() {
  return path.basename(process.cwd());
}

// ── Shared prefix badges ──────────────────────────────────────────────────────
const WA  = colors.bold + colors.waGreen + '[WA]'   + colors.reset;

// ─── PS1 block builder ────────────────────────────────────────────────────────
// Produces a 3-line PS1-style block for incoming / outgoing WA messages.
//
//   ┌[HH:MM:SS]════[whyWhale]════[WA ←]════[#N]
//   ┟══[whatsapp]::[num  preview]
//   └[folder]──►
//
function ps1Block({ direction, color, num, preview, count }) {
  const C  = colors.cyan;
  const DM = colors.dim;
  const BLD = colors.bold;
  const R  = colors.reset;
  const DIR = color + BLD + direction + R;
  const SEP = DM + '════' + R;

  const line1 = `${C}┌[${ts()}]${SEP}${C}[${R}${BLD}whyWhale${R}${C}]${SEP}${C}[${DIR}${C}]${SEP}${C}[#${count}]${R}`;
  const line2 = `${C}┟══${R}${DM}[whatsapp]${R}::${color}[${R}${colors.grey}${num}${R}  ${colors.waLight}${preview}${R}${color}]${R}`;
  const line3 = `${C}└[${cwd()}] ${R}`;

  return `${line1}\n${line2}\n${line3}`;
}

// ─── Logger ───────────────────────────────────────────────────────────────────
const log = {
  info(msg) {
    console.log(`${ts()} ${WA} ${colors.waLight}${msg}${colors.reset}`);
  },
  success(msg) {
    console.log(`${ts()} ${WA} ${colors.waGreen}${colors.bold}${msg}${colors.reset}`);
  },
  warn(msg) {
    console.warn(`${ts()} ${WA} ${colors.yellow}${msg}${colors.reset}`);
  },
  error(msg) {
    console.error(`${ts()} ${WA} ${colors.red}${msg}${colors.reset}`);
  },

  incoming(sender, text) {
    const num     = sender.replace('@s.whatsapp.net', '').replace('@g.us', ' (group)');
    const preview = text.length > 65 ? text.slice(0, 65) + '…' : text;
    _inCount++;
    console.log('\n' + ps1Block({
      direction: 'WA ←',
      color:     colors.waGreen,
      num,
      preview,
      count:     _inCount,
    }));
  },

  outgoing(sender, text) {
    const num     = sender.replace('@s.whatsapp.net', '').replace('@g.us', ' (group)');
    const preview = text.length > 65 ? text.slice(0, 65) + '…' : text;
    _outCount++;
    console.log('\n' + ps1Block({
      direction: 'WA →',
      color:     colors.waMid,
      num,
      preview,
      count:     _outCount,
    }));
  },
};

module.exports = { log, colors };