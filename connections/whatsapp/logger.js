'use strict';

/**
 * logger.js
 *
 * Minimal styled logger for the WhatsApp connection module.
 * Uses the same ocean-blue / teal palette as whyWhale's render.js.
 */

const colors = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[38;5;39m',
  teal:    '\x1b[38;5;44m',
  green:   '\x1b[38;5;83m',
  yellow:  '\x1b[38;5;226m',
  red:     '\x1b[38;5;203m',
  grey:    '\x1b[38;5;245m',
  whale:   '\x1b[38;5;33m',
};

function ts() {
  return colors.grey + new Date().toTimeString().slice(0, 8) + colors.reset;
}

const log = {
  info(msg) {
    console.log(`${ts()} ${colors.cyan}[WA]${colors.reset} ${msg}`);
  },
  success(msg) {
    console.log(`${ts()} ${colors.green}[WA]${colors.reset} ${msg}`);
  },
  warn(msg) {
    console.warn(`${ts()} ${colors.yellow}[WA]${colors.reset} ${msg}`);
  },
  error(msg) {
    console.error(`${ts()} ${colors.red}[WA]${colors.reset} ${msg}`);
  },
  incoming(sender, text) {
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    console.log(`${ts()} ${colors.teal}[WA ←]${colors.reset} ${colors.grey}${sender}${colors.reset}  ${preview}`);
  },
  outgoing(sender, text) {
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    console.log(`${ts()} ${colors.whale}[WA →]${colors.reset} ${colors.grey}${sender}${colors.reset}  ${preview}`);
  },
};

module.exports = { log, colors };
