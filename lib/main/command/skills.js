'use strict';

const fs   = require('fs');
const path = require('path');

const { C, rf, kp, ab, sd, dg }                          = require('../../colors');
const { SKILL_REGISTRY, saveSkill, SKILLS_DIR }          = require('../../config');
const { formatMD }                                        = require('../../render');

// ─── /skill ───────────────────────────────────────────────────────────────────
async function handleSkill(text, ctx) {
  const args = text.slice(6).trim().split(/\s+/);
  const sub  = args[0];

  if (!sub || sub === 'list') {
    console.log('\n  ' + rf(C.bold + 'Skill Registry'));
    Object.entries(SKILL_REGISTRY).forEach(([k, s]) => {
      const inst = ctx.skills.find(sk => sk.name === s.name);
      console.log('  ' + rf(k.padEnd(14)) + sd(s.description.padEnd(50)) + (inst ? kp(' ✔ installed') : ''));
    });
    if (ctx.skills.length) {
      console.log('\n  ' + rf(C.bold + 'Installed Skills'));
      ctx.skills.forEach(s => console.log('  ' + kp('✔ ') + sd(s.name) + ab(' — ' + s.description)));
    }
    console.log('\n  ' + ab('Install with: ') + sd('/skill install react') + ab(' (or any name above)'));
  } else if (sub === 'install') {
    const sn  = args[1]?.toLowerCase();
    if (!sn) { console.log('\n  ' + dg('Usage: /skill install <n>')); ctx.prompt(); return true; }
    const reg = SKILL_REGISTRY[sn];
    if (!reg) { console.log('\n  ' + dg('Unknown. Available: ') + Object.keys(SKILL_REGISTRY).join(', ')); ctx.prompt(); return true; }
    if (ctx.skills.find(s => s.name === reg.name)) { console.log('\n  ' + kp('Already installed: ') + sd(reg.name)); ctx.prompt(); return true; }
    saveSkill(reg); ctx.skills.push(reg);
    console.log('\n  ' + kp('✔ Installed: ') + sd(reg.name) + ab(' — now active in all AI responses'));
  } else if (sub === 'remove') {
    const sn  = args[1];
    const idx = ctx.skills.findIndex(s => s.name.toLowerCase() === sn?.toLowerCase());
    if (idx < 0) { console.log('\n  ' + dg('Skill not found: ' + sn)); ctx.prompt(); return true; }
    try { fs.unlinkSync(path.join(SKILLS_DIR, ctx.skills[idx].name.toLowerCase().replace(/\s+/g, '_') + '.json')); } catch (_) {}
    ctx.skills.splice(idx, 1);
    console.log('\n  ' + kp('✔ Removed: ') + sd(sn));
  } else if (sub === 'show') {
    const sn = args[1];
    const sk = ctx.skills.find(s => s.name.toLowerCase() === sn?.toLowerCase()) || SKILL_REGISTRY[sn?.toLowerCase()];
    if (!sk) { console.log('\n  ' + dg('Skill not found.')); ctx.prompt(); return true; }
    console.log('\n  ' + rf(C.bold + sk.name));
    console.log('  ' + ab(sk.description));
    console.log('\n' + formatMD('```\n' + sk.prompt + '\n```'));
  }
  ctx.prompt(); return true;
}

module.exports = { handleSkill };
