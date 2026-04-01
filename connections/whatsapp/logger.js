'use strict';

/**
 * connections/whatsapp/logger.js
 *
 * WhatsApp themed terminal display with two visual modes:
 *
 * ── IDLE MODE (WA connected but quiet) ───────────────────────────────────────
 * Normal PS1 prompt identical to the main terminal:
 *   ┌[HH:MM:SS]────[whyWhale]────[</> code]────[0]
 *   └[cwd]──►
 *
 * ── SECTION MODE (WA conversation active) ────────────────────────────────────
 * Double-line (═) border opens when a message arrives:
 *   ┌[HH:MM:SS]════[whyWhale]════════[section :N]
 *   ┟══[whatsapp :[WA ←]:[1 ]::[919562689836  hello]]
 *   ┟══[whatsapp :[WA →]:[2]::[919562689836  hi! how can I help?]]
 *   ...more lines as conversation continues...
 *   └[whatsapp]-[process]::[section @END-> going to terminal for work]
 *   OR
 *   └[whatsapp]-[process]::[section @OnGoing->chatting]
 *   OR
 *   └[whatsapp]-[process]::[section @END->to sending]
 *
 * After the section footer, terminal returns to normal idle PS1.
 * A new section header prints with the next incremented section number
 * when conversation resumes after work is done.
 *
 * Section lifecycle:
 *   openSection()   → print ┌═══ header, reset line counter
 *   logLine()       → print ┟══ message line, increment counter
 *   closeSection()  → print └ footer with status tag, increment section number
 */

const path = require('path');
const os   = require('os');

// ── Color palette (WhatsApp brand greens + PS1 chrome) ────────────────────────
const colors = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  italic:   '\x1b[3m',

  // WhatsApp greens
  waGreen:  '\x1b[38;5;35m',   // #25D366 primary brand green
  waDark:   '\x1b[38;5;30m',   // #128C7E dark teal
  waLight:  '\x1b[38;5;157m',  // #DCF8C6 light bubble green
  waMid:    '\x1b[38;5;42m',   // outgoing blue-green

  // PS1 chrome (matches main terminal render.js)
  cyan:     '\x1b[38;5;51m',
  blue:     '\x1b[38;5;75m',
  teal:     '\x1b[38;5;43m',
  coral:    '\x1b[38;5;203m',
  amber:    '\x1b[38;5;226m',
  red:      '\x1b[38;5;203m',
  grey:     '\x1b[38;5;245m',
  white:    '\x1b[38;5;255m',
  dimBlue:  '\x1b[38;5;61m',
};

const C = colors;
const R = colors.reset;
const B = colors.bold;

// ── Utilities ──────────────────────────────────────────────────────────────────
function ts() {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()]
    .map(v => String(v).padStart(2, '0')).join(':');
}

function cwd() {
  const home = os.homedir();
  const p    = process.cwd();
  return path.basename(p.startsWith(home) ? '~' + p.slice(home.length) : p) || p;
}

// ── Section state ──────────────────────────────────────────────────────────────
let _sectionNum  = 1;    // increments after each closeSection()
let _lineCount   = 0;    // resets on openSection()
let _sectionOpen = false;

// ── Section renderer ───────────────────────────────────────────────────────────

/**
 * Print the ┌═══ section header.
 * Called automatically when the first message of a new section arrives.
 */
function openSection() {
  _lineCount   = 0;
  _sectionOpen = true;

  const num = _sectionNum;
  const G   = C.waGreen + B;
  const CY  = C.cyan;
  const GR  = C.grey;

  // ┌[HH:MM:SS]════[whyWhale]════════[section :N]
  const line = [
    CY + '┌',
    C.waGreen + '[' + R + C.amber + ts() + R + C.waGreen + ']' + R,
    C.waGreen + '════' + R,
    C.waGreen + '[' + R + B + C.white + 'whyWhale' + R + C.waGreen + ']' + R,
    C.waGreen + '════════' + R,
    C.waGreen + '[' + R + C.waLight + B + 'section :' + num + R + C.waGreen + ']' + R,
  ].join('');

  console.log('\n' + line);
}

/**
 * Print a ┟══ conversation line.
 * @param {'in'|'out'} direction
 * @param {string} sender   — raw JID, will be cleaned
 * @param {string} text     — message content
 */
function logLine(direction, sender, text) {
  if (!_sectionOpen) openSection();

  _lineCount++;
  const num    = String(_lineCount).padStart(2, ' ');
  const arrow  = direction === 'in' ? 'WA ←' : 'WA →';
  const color  = direction === 'in' ? C.waGreen : C.waMid;
  const clean  = sender.replace('@s.whatsapp.net', '').replace('@g.us', '');
  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;

  // ┟══[whatsapp :[WA ←]:[N ]::[NUMBER  message]]
  const line = [
    C.waGreen + '┟══' + R,
    C.grey    + '[whatsapp :' + R,
    color + B + '[' + arrow + ']' + R,
    C.grey    + ':[' + R,
    C.cyan    + num + R,
    C.grey    + ']::[' + R,
    C.amber   + clean + R,
    '  ',
    C.waLight + preview + R,
    C.grey    + ']' + R,
  ].join('');

  console.log(line);
}

/**
 * Print the └ section footer and increment section number.
 *
 * @param {'work'|'chat'|'send'|'end'} status
 *   'work'  → @END-> going to terminal for work
 *   'send'  → @END->to sending
 *   'chat'  → @OnGoing->chatting
 *   'end'   → @END (generic)
 */
function closeSection(status = 'chat') {
  if (!_sectionOpen) return;
  _sectionOpen = false;

  const tags = {
    work: `section @END-> going to terminal for work`,
    send: `section @END->to sending`,
    chat: `section @OnGoing->chatting`,
    end:  `section @END`,
  };

  const tag       = tags[status] || tags.chat;
  const tagColor  = (status === 'chat') ? C.waMid : C.amber;

  // └[whatsapp]-[process]::[section @...]
  const line = [
    C.waGreen + '└' + R,
    C.grey    + '[whatsapp]' + R,
    C.grey    + '-[process]' + R,
    C.grey    + '::' + R,
    C.grey    + '[' + R,
    tagColor  + B + tag + R,
    C.grey    + ']' + R,
  ].join('');

  console.log(line);

  // Increment section number for next conversation burst
  _sectionNum++;
}

// ── Idle PS1 (mirrors main render.js renderPS1 style) ─────────────────────────
/**
 * Print the normal idle prompt — called after section closes and when WA
 * is connected but no conversation is active.
 *
 * @param {number} msgCount
 * @param {string} mode
 */
function printIdlePrompt(msgCount = 0, mode = 'code') {
  const modeLabel = '</> ' + mode;
  const AB = C.cyan;
  const l1 = [
    AB + '┌',
    AB + '[' + R + C.coral + ts() + R + AB + ']' + R,
    AB + '────' + R,
    AB + '[' + R + B + C.white + 'whyWhale' + R + AB + ']' + R,
    AB + '────' + R,
    AB + '[' + R + C.coral + modeLabel + R + AB + ']' + R,
    AB + '────' + R,
    AB + '[' + R + C.teal  + String(msgCount) + R + AB + ']' + R,
  ].join('');

  const l2 = AB + '└' + '[' + R + C.teal + cwd() + R + AB + ']' + R +
             AB + '──' + R + C.coral + '►' + R + ' ';

  process.stdout.write('\n' + l1 + '\n' + l2);
}

// ── Generic log methods ────────────────────────────────────────────────────────
const WA_BADGE = C.bold + C.waGreen + '[WA]' + R;

const log = {
  info(msg) {
    console.log(`${ts()} ${WA_BADGE} ${C.waLight}${msg}${R}`);
  },
  success(msg) {
    console.log(`${ts()} ${WA_BADGE} ${C.waGreen}${B}${msg}${R}`);
  },
  warn(msg) {
    console.warn(`${ts()} ${WA_BADGE} ${C.amber}${msg}${R}`);
  },
  error(msg) {
    console.error(`${ts()} ${WA_BADGE} ${C.red}${msg}${R}`);
  },

  /**
   * Log an incoming WA message — opens a section if none is active.
   */
  incoming(sender, text) {
    logLine('in', sender, text);
  },

  /**
   * Log an outgoing WA reply.
   */
  outgoing(sender, text) {
    logLine('out', sender, text);
  },

  /**
   * Close the current section with a status tag and optionally reprint
   * the idle prompt.
   *
   * @param {'work'|'chat'|'send'|'end'} status
   * @param {boolean} printPrompt  — if true, print idle PS1 afterwards
   * @param {number}  msgCount
   * @param {string}  mode
   */
  closeSection(status = 'chat', printPrompt = false, msgCount = 0, mode = 'code') {
    closeSection(status);
    if (printPrompt) printIdlePrompt(msgCount, mode);
  },

  /**
   * Manually open a new section (rarely needed — incoming() auto-opens).
   */
  openSection,

  /**
   * Print idle prompt directly (called e.g. after terminal work finishes).
   */
  printIdlePrompt,

  /** Whether a section is currently open */
  get sectionOpen() { return _sectionOpen; },

  /** Current section number */
  get sectionNum() { return _sectionNum; },
};

module.exports = { log, colors };