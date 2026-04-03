'use strict';

const { C, cr, kp, ab, sd, dg, vt, dm }                = require('../../colors');
const { saveMemory, updateMemory, sanitizeMemory }       = require('../../config');

// ─── /memory ──────────────────────────────────────────────────────────────────
async function handleMemory(text, ctx) {
  const arg = text.slice(7).trim();
  if (!arg || arg === 'show') {
    if (!ctx.mem.facts.length) console.log('\n  ' + ab('No memory stored yet. The AI saves facts with @@MEMORY: key: value'));
    else {
      console.log('\n  ' + vt(C.bold + 'Persistent Memory') + ab(' (' + ctx.mem.facts.length + ' facts)'));
      ctx.mem.facts.forEach(f => console.log('  ' + vt(f.key.padEnd(22)) + ab('→ ') + sd(f.value)));
    }
    if (ctx.mem.sessionSummaries?.length) {
      console.log('\n  ' + ab('Past sessions: ' + ctx.mem.sessionSummaries.length));
      ctx.mem.sessionSummaries.slice(-3).forEach(s => console.log('  ' + ab('  ' + s.date.slice(0, 10) + ' · ') + dm(s.summary?.slice(0, 80) || '')));
    }
  } else if (arg === 'clean') {
    const before = ctx.mem.facts.length;
    sanitizeMemory(ctx.mem); saveMemory(ctx.mem);
    const removed = before - ctx.mem.facts.length;
    console.log('\n  ' + kp('✔ Memory cleaned — ') + sd(removed + ' garbage fact' + (removed !== 1 ? 's' : '') + ' removed') + ab(', ' + ctx.mem.facts.length + ' clean facts remain'));
  } else if (arg === 'clear') {
    ctx.mem.facts = []; ctx.mem.sessionSummaries = []; saveMemory(ctx.mem);
    console.log('\n  ' + kp('✔ Memory cleared.'));
  } else if (arg.startsWith('set ')) {
    const parts = arg.slice(4).trim().split(/\s+/);
    const key   = parts[0].replace(/:$/, '');
    const val   = parts.slice(1).join(' ').split(/\r?\n/)[0].trim();
    if (key && val) {
      updateMemory(ctx.mem, [{ key, value: val }]); saveMemory(ctx.mem);
      console.log('\n  ' + kp('✔ Memory saved: ') + sd(key + ' → ' + val));
    } else {
      console.log('\n  ' + dg('Usage: /memory set <key> <value>'));
    }
  }
  ctx.prompt(); return true;
}

module.exports = { handleMemory };
