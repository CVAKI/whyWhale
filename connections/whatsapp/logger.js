'use strict';

/**
 * logger.js
 *
 * WhatsApp-green themed logger for the WhatsApp connection module.
 * Palette mirrors WhatsApp's own brand greens.
 *
 *   waGreen   #25D366  — primary brand green  (ansi 35;5;35m)
 *   waDark    #128C7E  — dark teal-green       (ansi 38;5;30m)
 *   waLight   #DCF8C6  — light bubble green    (ansi 38;5;157m)
 *   waMid     #34B7F1  — info blue (kept for variety)
 */

const colors = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  // ── WhatsApp greens ───────────────────────────────────────────────────────
  waGreen:  '\x1b[38;5;35m',   // #25D366 — brand green
  waDark:   '\x1b[38;5;30m',   // #128C7E — dark teal-green
  waLight:  '\x1b[38;5;157m',  // #DCF8C6 — light mint green
  waMid:    '\x1b[38;5;42m',   // medium spring green
  // ── Status colours ────────────────────────────────────────────────────────
  yellow:   '\x1b[38;5;226m',
  red:      '\x1b[38;5;203m',
  grey:     '\x1b[38;5;245m',
  white:    '\x1b[38;5;255m',
};

function ts() {
  return colors.grey + new Date().toTimeString().slice(0, 8) + colors.reset;
}

// ── Prefix badge ──────────────────────────────────────────────────────────────
const WA  = colors.bold + colors.waGreen  + '[WA]'   + colors.reset;
const WAI = colors.bold + colors.waDark   + '[WA ←]' + colors.reset;  // incoming
const WAO = colors.bold + colors.waMid    + '[WA →]' + colors.reset;  // outgoing

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
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    console.log(`${ts()} ${WAI} ${colors.grey}${sender}${colors.reset}  ${colors.waLight}${preview}${colors.reset}`);
  },
  outgoing(sender, text) {
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    console.log(`${ts()} ${WAO} ${colors.grey}${sender}${colors.reset}  ${colors.waMid}${preview}${colors.reset}`);
  },
};

module.exports = { log, colors };