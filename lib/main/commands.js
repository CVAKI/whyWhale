'use strict';

const fs   = require('fs');
const path = require('path');

const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, dm }                         = require('../colors');
const { saveConfig, saveMemory, updateMemory, sanitizeMemory,
        SKILL_REGISTRY, saveSkill, HOME_DIR, SKILLS_DIR }                    = require('../config');
const { PROVIDERS, ollamaAvailable, ollamaInstall, ollamaStart }              = require('../providers');
const { formatMD, printBanner, spinner }                                      = require('../render');
const { CWD, safePath, ensureDirForFile, readFileSafe, treeDir, lsDir,
        formatSize, parseFileBlocks, parseMemoryBlocks, applyFileBlocks,
        printFileResults, scanFolder, buildFolderContext }                    = require('../filesystem');
const { selfTestLoop, saveSession, listSessions, runShell, copyClip }         = require('../selftest');
const { MODES }                                                               = require('../modes');
const { startDashboard }                                                      = require('../dashboard');
const { callAI }                                                              = require('../providers');
const { stripFileBlocks, buildSystemPrompt }                                  = require('./utils');
const { VERSION }                                                             = require('./constants');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const modeS = (ctx) => { const m = MODES[ctx.mode]; return m.colorFn(m.icon + ' ' + m.name); };

// ─── !shell passthrough ───────────────────────────────────────────────────────
async function handleShell(text, ctx) {
  const cmd = text.slice(1).trim();
  if (!cmd) { ctx.prompt(); return true; }

  // ── Guard: block running the WA standalone runner while whyWhale is active ──
  // Running `node connections/whatsapp/index.js` as a child process creates a
  // second Baileys session that immediately kicks out the one whyWhale is using
  // (WhatsApp code 440 — session replaced). Always use /wp inside whyWhale.
  if (/connections[/\\]whatsapp[/\\]index\.js/.test(cmd)) {
    console.log('\n  ' + rf('⚠ Blocked: ') + ab('Cannot run the WhatsApp standalone runner while whyWhale is active.'));
    console.log('  ' + ab('  Running a second Baileys session would kick out the current one (code 440).'));
    console.log('  ' + ab('  Use ') + sd('/wp') + ab(' to manage the WhatsApp connection from here.'));
    ctx.prompt(); return true;
  }

  if (process.platform === 'win32') {
    const UNIX_ONLY = [
      { pat: /^\s*ps\s+(aux|aux\b|-ef|-e)/,   hint: 'Use: tasklist' },
      { pat: /^\s*kill\s+%\d+/,               hint: 'Use: taskkill /F /IM node.exe  (or Stop-Process in PowerShell)' },
      { pat: /^\s*(pkill|killall)\s/,          hint: 'Use: taskkill /F /IM <processname>.exe' },
      { pat: /^\s*which\s/,                    hint: 'Use: where <command>' },
      { pat: /^\s*grep\s/,                     hint: 'Use: findstr "<pattern>" <file>  (or pipe to findstr)' },
      // cat → type: auto-rewrite instead of blocking
      // Also convert forward-slashes to backslashes — Windows `type` requires them
      { pat: /^\s*cat\s/,  fix: c => c.replace(/^\s*cat\s+/, 'type ').replace(/\//g, '\\') },
    ];
    const match = UNIX_ONLY.find(r => r.pat.test(cmd));
    if (match) {
      if (match.fix) {
        // Auto-rewrite the command silently
        const rewritten = match.fix(cmd);
        console.log('  ' + rf('⟳ Windows: ') + ab('rewrote to: ') + sd(rewritten));
        // Fall through with rewritten command
        const res2  = await runShell(rewritten);
        const TW2b  = Math.min((process.stdout.columns || 80) - 4, 100);
        console.log('  ' + ab('╭─ output ' + '─'.repeat(TW2b - 10)));
        const lines2 = [...res2.stdout.split('\n'), ...(res2.stderr ? res2.stderr.split('\n').map(l => dg(l)) : [])]
          .filter(l => l !== undefined);
        if (!res2.stdout && !res2.stderr) lines2.push(dm('(no output)'));
        lines2.filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
        console.log('  ' + ab('╰─ exit ') + (res2.code === 0 ? kp(String(res2.code)) : dg(String(res2.code))));
        ctx.prompt(); return true;
      }
      console.log('\n  ' + rf('⚠ Windows: ') + ab('"' + cmd.trim().split(/\s/)[0] + '" is a Unix command and won\'t work here.'));
      console.log('  ' + ab('  Hint → ') + sd(match.hint));
      ctx.prompt(); return true;
    }
  }

  let cmdToRun = cmd;
  if (process.platform === 'win32' && /&\s*$/.test(cmdToRun)) {
    cmdToRun = 'start /B ' + cmdToRun.replace(/&\s*$/, '').trim();
    console.log('  ' + rf('⟳ Windows: ') + ab('rewrote to: ') + sd(cmdToRun));
  }

  // Auto-background long-running node processes on Windows.
  // Patterns: `node file.js`, `set X=Y && node file.js`
  // Without this, the terminal hangs forever waiting for a server that never exits.
  if (process.platform === 'win32' && !cmdToRun.startsWith('start /B')) {
    const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
    if (nodeServerPat.test(cmdToRun.trim())) {
      // Split on && so we can wrap just the node part with start /B
      const parts  = cmdToRun.split('&&').map(s => s.trim());
      const last   = parts[parts.length - 1];
      parts[parts.length - 1] = 'start /B ' + last;
      cmdToRun = parts.join(' && ');
      console.log('  ' + rf('⟳ Windows: ') + ab('auto-backgrounded: ') + sd(cmdToRun));
    }
  }

  console.log('\n  ' + ab('$ ') + sd(cmdToRun));
  const res  = await runShell(cmdToRun);
  const TW2  = Math.min((process.stdout.columns || 80) - 4, 100);
  console.log('  ' + ab('╭─ output ' + '─'.repeat(TW2 - 10)));
  const lines = [...res.stdout.split('\n'), ...(res.stderr ? res.stderr.split('\n').map(l => dg(l)) : [])]
    .filter(l => l !== undefined);
  if (!res.stdout && !res.stderr) lines.push(dm('(no output)'));
  lines.filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
  console.log('  ' + ab('╰─ exit ') + (res.code === 0 ? kp(String(res.code)) : dg(String(res.code))));
  ctx.prompt(); return true;
}

// ─── /exit ────────────────────────────────────────────────────────────────────
async function handleExit(text, ctx) {
  const up = Math.round((Date.now() - ctx.t0) / 1000);

  // Save session summary to persistent memory
  if (ctx.messages.length > 2) {
    const summary = ctx.messages.filter(m => m.role === 'user').slice(-5).map(m => m.content.slice(0, 100)).join(' | ');
    ctx.mem.sessionSummaries = [...(ctx.mem.sessionSummaries || []).slice(-9), { date: new Date().toISOString(), summary, msgCount: ctx.msgN }];
    saveMemory(ctx.mem);
  }

  // Send WA farewell message before anything else (awaited so it actually sends)
  if (ctx._waSendFarewell) {
    try {
      await ctx._waSendFarewell();
    } catch (_) {}
  }

  // Print the goodbye whale banner
  ctx._exitBannerPrinted = true;  // flag so rl.on('close') doesn't print a second banner
  console.log('\n  ' + cr('🐋 Goodbye!') + ab('  ' + ctx.msgN + ' msgs · ' + ctx.totalTok.toLocaleString() + ' tokens · ' + Math.floor(up / 60) + 'm ' + (up % 60) + 's'));
  console.log('');

  // Close readline — this fires the 'close' event which calls process.exit(0)
  ctx.rl.close();
}

// ─── /help ────────────────────────────────────────────────────────────────────
async function handleHelp(ctx) {
  console.log('');
  console.log('  ' + cr(C.bold + 'whyWhale v' + VERSION) + C.reset + '  ' + ab(ctx.prov.name + ' · ' + (ctx.modelMeta.label || ctx.modelMeta.id)));
  const sections = {
    'CHAT & MODES': [
      ['/help',           'This help'],
      ['/clear',          'Clear conversation history'],
      ['/mode [name]',    'Switch AI mode: ' + Object.keys(MODES).join(' · ')],
      ['/model [n]',      'Show or switch model'],
      ['/provider',       'Switch AI provider'],
      ['/stats',          'Session statistics'],
      ['/tokens',         'Show token usage'],
      ['/system',         'Show current system prompt'],
      ['/copy',           'Copy last AI reply to clipboard'],
      ['!<command>',      'Run any shell command (e.g. !ls, !git status, !npm install)'],
    ],
    'FILES & PROJECT': [
      ['/ls [path]',      'List files in directory'],
      ['/tree [depth]',   'Directory tree (default depth 3)'],
      ['/read <path>',    'Read file and show with syntax highlighting'],
      ['/analyse <path>', 'Deep AI analysis of a file'],
      ['/write <path>',   'AI-generate content for a file'],
      ['/create <path>',  'Create empty file'],
      ['/delete <path>',  'Delete file (asks confirmation)'],
      ['/rename <a> <b>', 'Rename or move a file'],
      ['/scan',           'Re-scan current directory into AI context'],
      ['/run <cmd>',      'Run a shell command and show output'],
    ],
    'MEMORY': [
      ['/memory',               'Show all persistent memory facts'],
      ['/memory set <key> <val>', 'Set a memory fact manually'],
      ['/memory clear',         'Clear all memory'],
    ],
    'SKILLS': [
      ['/skill list',        'Show available & installed skills'],
      ['/skill install <n>', 'Install a skill (react, python, security, testing, api-design, docker, database, git, performance, typescript)'],
      ['/skill remove <n>',  'Remove an installed skill'],
      ['/skill show <n>',    'Show skill prompt details'],
    ],
    'CONNECTIONS': [
      ['/connection',              'Show & set up messaging connections (WhatsApp, etc.)'],
      ['/connection whatsapp',     'Set up WhatsApp integration'],
      ['/wp',                      'Shortcut — open WhatsApp setup directly'],
      ['/connection disconnect <n>','Disconnect a service'],
      ['/wa <number> <message>',   'Send a WhatsApp message (e.g. /wa 919876543210 Hello!)'],
      ['/wa status',               'Show WhatsApp connection status'],
      ['/wa history',              'Show messages sent this session'],
      ['/wa owner <number>',       'Change the owner number whyWhale responds to'],
      ['/wa --reset',              'Wipe WhatsApp session & credentials — forces fresh QR scan'],
    ],
    'SESSION': [
      ['/save [name]',  'Save conversation to ~/.whywhale_sessions/'],
      ['/load',         'Restore a saved session'],
      ['/export',       'Export chat as HTML file'],
      ['/autotest',     'Toggle auto self-testing (currently: ' + (ctx.autoTest ? 'ON' : 'OFF') + ')'],
      ['/autoscan',     'Toggle auto folder scan (currently: ' + (ctx.autoScan ? 'ON' : 'OFF') + ')'],
      ['/dashboard',    'Open web dashboard at http://localhost:7070'],
      ['/reset',        'Wipe all config'],
      ['/exit',         'Quit (sends WA farewell if connected)'],
    ],
  };
  Object.entries(sections).forEach(([sec, cmds]) => {
    console.log('\n  ' + tl(sec));
    cmds.forEach(([c, d]) => console.log('  ' + cr(c.padEnd(28)) + ab(d)));
  });
  console.log('');
  console.log('  ' + ab('Tip: End any line with \\\\ for multi-line input'));
  console.log('  ' + ab('Tip: In ') + vt('agent') + ab(' mode, AI creates and fixes files automatically'));
  console.log('  ' + ab('Tip: ') + sd('@@MEMORY: key: value') + ab(' in AI responses saves info between sessions'));
  ctx.prompt(); return true;
}

// ─── /clear ───────────────────────────────────────────────────────────────────
async function handleClear(ctx) {
  ctx.messages = []; ctx.msgN = 0; ctx.totalTok = 0;
  console.clear(); printBanner(VERSION);
  console.log('  ' + kp('✔ Cleared') + ab('  Mode: ') + modeS(ctx) + ab('  cwd: ') + tl(CWD()));
  ctx.prompt(); return true;
}

// ─── /stats ───────────────────────────────────────────────────────────────────
async function handleStats(ctx) {
  const up = Math.round((Date.now() - ctx.t0) / 1000);
  console.log('\n  ' + cr(C.bold + 'Session Statistics'));
  [
    ['Provider',     ctx.prov.name],
    ['Model',        ctx.modelMeta.label || ctx.modelMeta.id],
    ['Mode',         MODES[ctx.mode].name],
    ['Working Dir',  CWD()],
    ['Messages',     String(ctx.msgN)],
    ['Tokens Used',  ctx.totalTok.toLocaleString()],
    ['Memory Facts', String(ctx.mem.facts.length)],
    ['Past Sessions',String(ctx.mem.sessionSummaries?.length || 0)],
    ['Skills',       ctx.skills.length ? ctx.skills.map(s => s.name).join(', ') : 'none'],
    ['Auto-Test',    ctx.autoTest ? 'ON' : 'OFF'],
    ['Auto-Scan',    ctx.autoScan ? 'ON' : 'OFF'],
    ['Uptime',       Math.floor(up / 60) + 'm ' + (up % 60) + 's'],
  ].forEach(([k, v]) => console.log('  ' + ab(k.padEnd(14) + ' › ') + sd(v)));
  ctx.prompt(); return true;
}

// ─── /scan ────────────────────────────────────────────────────────────────────
async function handleScan(ctx) {
  const sp    = spinner('Scanning directory...');
  const files = scanFolder(CWD(), 8);
  sp(); ctx.folderCtx = buildFolderContext(files, CWD());
  console.log('\n  ' + tl('✔ Scanned: ') + sd(files.length + ' files'));
  files.forEach(f => console.log('  ' + ab('  → ') + sd(f.path) + ab(' (' + formatSize(f.size) + ')')));
  ctx.prompt(); return true;
}

// ─── /mode ────────────────────────────────────────────────────────────────────
async function handleMode(text, ctx) {
  const arg        = text.split(/\s+/)[1]?.toLowerCase().replace(/[^a-z]/g, '');
  const validModes = Object.keys(MODES);
  if (!arg) {
    console.log('');
    Object.entries(MODES).forEach(([k, v]) =>
      console.log('  ' + v.colorFn(v.icon + ' ' + v.name.padEnd(12)) + ab('/mode ' + k) + (k === ctx.mode ? cr(' ◀ current') : '')));
  } else if (validModes.includes(arg)) {
    ctx.mode = arg;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    console.log('\n  ' + kp('✔ Mode → ') + MODES[arg].colorFn(MODES[arg].icon + ' ' + MODES[arg].name));
    if (arg === 'agent') console.log('  ' + vt('Agent mode: ') + ab('AI will autonomously create and fix files'));
  } else {
    console.log('\n  ' + dg('Unknown mode. Options: ') + validModes.join(' · '));
  }
  ctx.prompt(); return true;
}

// ─── /model ───────────────────────────────────────────────────────────────────
async function handleModel(text, ctx) {
  const arg = text.split(/\s+/)[1];
  if (!arg) {
    console.log('\n  ' + ab('Current: ') + wh(ctx.modelMeta.label || ctx.modelMeta.id));
    ctx.availModels.forEach((m, i) =>
      console.log('  ' + ab('[' + (i + 1) + ']') + ' ' + sd(m.label || m.id) + (m.free ? ' ' + kp('FREE') : '') + (m.id === ctx.modelId ? cr(' ◀') : '')));
    console.log('\n  ' + ab('Type /model <n> to switch.'));
  } else {
    const idx = parseInt(arg) - 1, sel = ctx.availModels[idx];
    if (!sel) console.log('\n  ' + dg('Invalid.'));
    else {
      ctx.modelId = sel.id;
      saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
      console.log('\n  ' + kp('✔ Model → ') + wh(sel.label || sel.id));
    }
  }
  ctx.prompt(); return true;
}

// ─── /provider ────────────────────────────────────────────────────────────────
async function handleProvider(ctx) {
  console.log('\n  ' + wh('[1]') + ' Anthropic (Claude)' + (ctx.providerKey === 'anthropic' ? cr(' ◀') : ''));
  console.log('  ' + cr('[2]') + ' OpenRouter'         + (ctx.providerKey === 'openrouter' ? cr(' ◀') : ''));
  console.log('  ' + rf('[3]') + ' Groq'               + (ctx.providerKey === 'groq'       ? rf(' ◀') : ''));
  const olOk = await ollamaAvailable();
  console.log('  ' + kp('[4]') + ' Ollama' + (ctx.providerKey === 'ollama' ? kp(' ◀') : '') + ' ' + (olOk ? kp('● running') : rf('○ not running — will auto-install if selected')));
  const ch = await ctx.ask(cr('\n  ❯ ') + ab('Switch [1-4] or Enter to cancel: '));
  const pk = { 1: 'anthropic', 2: 'openrouter', 3: 'groq', 4: 'ollama' }[ch.trim()];
  if (pk) {
    if (pk === 'ollama' && !olOk) {
      console.log('\n  ' + ab('Ollama not found — installing automatically...\n'));
      try {
        await ollamaInstall();
        console.log('\n  ' + kp('✔ Ollama installed!') + ab(' Starting server...'));
        const started = await ollamaStart();
        if (!started) {
          console.log('  ' + rf('⚠ Server did not respond — run: ') + sd('ollama serve'));
          ctx.prompt(); return true;
        }
        console.log('  ' + kp('✔ Ollama server is running!'));
      } catch (e) {
        console.log('  ' + dg('✘ Install failed: ') + e.message);
        console.log('  ' + ab('Install manually → ') + tl('https://ollama.com'));
        ctx.prompt(); return true;
      }
    }
    ctx.providerKey = pk; ctx.modelId = null;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: '', mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    console.log('\n  ' + kp('✔ Switched. Restart whywhale to apply.'));
  }
  ctx.prompt(); return true;
}

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

// ─── /save ────────────────────────────────────────────────────────────────────
async function handleSave(text, ctx) {
  console.log('\n  ' + kp('✔ Saved → ') + ab(saveSession(ctx.messages, text.split(/\s+/)[1] || null)));
  ctx.prompt(); return true;
}

// ─── /load ────────────────────────────────────────────────────────────────────
async function handleLoad(ctx) {
  const sessions = listSessions();
  if (!sessions.length) { console.log('\n  ' + ab('No saved sessions.')); ctx.prompt(); return true; }
  sessions.forEach((s, i) => console.log('  ' + ab('[' + (i + 1) + ']') + ' ' + sd(s.name) + '  ' + ab(new Date(s.saved).toLocaleString() + ' · ' + s.count + ' msgs')));
  const ch  = await ctx.ask(cr('\n  ❯ ') + ab('Load [n] or Enter to cancel: '));
  const idx = parseInt(ch.trim()) - 1;
  if (!isNaN(idx) && sessions[idx]) {
    ctx.messages = sessions[idx].messages;
    ctx.msgN     = ctx.messages.filter(m => m.role === 'user').length;
    console.log('\n  ' + kp('✔ Loaded: ') + sd(sessions[idx].name) + ab(' (' + ctx.msgN + ' msgs)'));
  }
  ctx.prompt(); return true;
}

// ─── /export ──────────────────────────────────────────────────────────────────
async function handleExport(ctx) {
  const exportMsgs = ctx.messages.filter(m => m.role !== 'system');
  const timestamp  = new Date().toLocaleString();
  const modelLabel = ctx.modelMeta?.label || ctx.modelMeta?.id || '—';

  const bubblesHtml = exportMsgs.map(m => {
    const isUser    = m.role === 'user';
    const rowClass  = isUser ? 'bubble-row user' : 'bubble-row';
    const bubClass  = isUser ? 'bubble bubble-user' : 'bubble bubble-ai';
    const nameClass = isUser ? 'name-user' : 'name-ai';
    const name      = isUser ? 'You' : '🐋 whyWhale';
    const avatarCls = isUser ? 'avatar avatar-user' : 'avatar avatar-ai';
    const escaped   = m.content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return `\n  <div class="${rowClass}">\n    <div class="${avatarCls}">${isUser ? 'U' : '🐋'}</div>\n    <div class="${bubClass}">\n      <div class="bubble-name ${nameClass}">${name}</div>\n      <div class="bubble-md" data-raw="\`${escaped}\`"></div>\n    </div>\n  </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🐋 whyWhale Export</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<style>
:root{--bg:#0a0f14;--surface:#111820;--card:#161e28;--border:#1e2d3d;--whale:#1eb4ff;--coral:#ff6b2b;--kelp:#3fc85a;--reef:#ffc83c;--violet:#b96eff;--teal:#3cdcc8;--text:#c9d1d9;--muted:#586069;--white:#e6edf3}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;padding-bottom:48px}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.header h1{font-size:17px;font-weight:700;color:var(--whale)}
.header .meta{margin-left:auto;font-size:11px;color:var(--muted)}
.chat-wrap{max-width:820px;margin:0 auto;padding:28px 20px;display:flex;flex-direction:column;gap:20px}
.bubble-row{display:flex;align-items:flex-end;gap:10px}
.bubble-row.user{flex-direction:row-reverse}
.avatar{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}
.avatar-user{background:#0d2233;border:1px solid var(--whale);color:var(--whale)}
.avatar-ai{background:#1a1228;border:1px solid var(--violet);color:var(--violet)}
.bubble{max-width:74%;padding:13px 17px;border-radius:16px;font-size:13.5px;line-height:1.65;word-break:break-word}
.bubble-user{background:#0d2233;border:1px solid #1e3a52;border-bottom-right-radius:4px}
.bubble-ai{background:#1a1228;border:1px solid #2d1e42;border-bottom-left-radius:4px}
.bubble-name{font-weight:700;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px}
.name-user{color:var(--whale)}.name-ai{color:var(--violet)}
<\/style>
<\/head>
<body>
<div class="header">
  <span style="font-size:20px">🐋<\/span>
  <h1>whyWhale Chat Export<\/h1>
  <div class="meta">${timestamp} &nbsp;·&nbsp; ${modelLabel} &nbsp;·&nbsp; ${exportMsgs.length} messages<\/div>
<\/div>
<div class="chat-wrap">
${bubblesHtml}
<\/div>
<\/body>
<\/html>`;

  const fp = path.join(HOME_DIR, 'whywhale_export_' + Date.now() + '.html');
  fs.writeFileSync(fp, html, 'utf8');
  console.log('\n  ' + kp('✔ Exported → ') + ab(fp));
  console.log('  ' + tl('  Open in any browser to view the styled bubble chat'));
  ctx.prompt(); return true;
}

// ─── /ls ──────────────────────────────────────────────────────────────────────
async function handleLs(text, ctx) {
  const arg = text.slice(3).trim() || '.';
  try {
    const entries  = lsDir(arg);
    const relBase  = path.resolve(CWD(), arg);
    console.log('\n  ' + tl(path.relative(CWD(), relBase) || '.') + '  ' + ab('(' + entries.length + ' items)'));
    console.log('');
    entries.forEach(e => {
      const col = e.isDir ? wh : sd;
      console.log('  ' + (e.isDir ? wh('▸ ') : ab('  ')) + col(e.name + (e.isDir ? '/' : '')) + (e.size != null ? ab('  ' + formatSize(e.size)) : ''));
    });
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /tree ────────────────────────────────────────────────────────────────────
async function handleTree(text, ctx) {
  const depth = parseInt(text.split(/\s+/)[1]) || 3;
  console.log('\n  ' + tl(CWD()));
  console.log(treeDir(CWD(), '  ', 0, depth));
  ctx.prompt(); return true;
}

// ─── /read ────────────────────────────────────────────────────────────────────
async function handleRead(text, ctx) {
  const fp         = text.slice(6).trim().replace(/^["']|["']$/g, '');
  const candidates = [fp, path.join('src', fp), path.join('lib', fp)];
  let rdResolved   = null;
  for (const c of candidates) { try { readFileSafe(c); rdResolved = c; break; } catch (_) {} }
  if (!rdResolved) {
    console.log('\n  ' + dg('✘ File not found: ') + sd(fp));
    console.log('  ' + ab('  Hint: use /ls to browse files'));
    ctx.prompt(); return true;
  }
  try {
    const file = readFileSafe(rdResolved);
    console.log('\n  ' + kp('✔ ') + sd(file.name) + ab(' (' + formatSize(file.size) + ' · ' + file.content.split('\n').length + ' lines)'));
    console.log(formatMD('```' + file.ext + '\n' + file.content.slice(0, 3000) + (file.content.length > 3000 ? '\n... (truncated)' : '') + '\n```'));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /create ──────────────────────────────────────────────────────────────────
async function handleCreate(text, ctx) {
  const fp = text.slice(8).trim().replace(/^["']|["']$/g, '');
  try {
    const full = safePath(fp); ensureDirForFile(full);
    if (fs.existsSync(full)) console.log('\n  ' + rf('Already exists: ') + sd(fp) + ab(' — use /analyse or ask AI to modify it'));
    else { fs.writeFileSync(full, '', 'utf8'); console.log('\n  ' + kp('✔ Created: ') + sd(fp)); }
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /delete ──────────────────────────────────────────────────────────────────
async function handleDelete(text, ctx) {
  const fp = text.slice(8).trim().replace(/^["']|["']$/g, '');
  try {
    const full = safePath(fp);
    if (!fs.existsSync(full)) { console.log('\n  ' + dg('Not found: ' + fp)); ctx.prompt(); return true; }
    const conf = await ctx.ask('\n  ' + dg('Delete ') + sd(fp) + dg('? (yes/no): '));
    if (conf.trim().toLowerCase() === 'yes') { fs.rmSync(full, { recursive: true }); console.log('  ' + kp('✔ Deleted: ') + ab(fp)); }
    else console.log('  ' + ab('Cancelled.'));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /rename ──────────────────────────────────────────────────────────────────
async function handleRename(text, ctx) {
  const parts = text.slice(8).trim().split(/\s+/);
  if (parts.length < 2) { console.log('\n  ' + dg('Usage: /rename <old> <new>')); ctx.prompt(); return true; }
  try {
    const from = safePath(parts[0]), to = safePath(parts[1]);
    if (!fs.existsSync(from)) { console.log('\n  ' + dg('Not found: ' + parts[0])); ctx.prompt(); return true; }
    ensureDirForFile(to); fs.renameSync(from, to);
    console.log('\n  ' + kp('✔ Renamed: ') + sd(parts[0]) + ab(' → ') + sd(parts[1]));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /analyse ─────────────────────────────────────────────────────────────────
async function handleAnalyse(text, ctx) {
  if (ctx.mode !== 'review') {
    ctx.mode = 'review';
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    ctx.statusRef.mode = ctx.mode;
    console.log('\n  ' + MODES['review'].colorFn('⟳ Auto-switched to ' + MODES['review'].icon + ' ' + MODES['review'].name) + ab(' (code review intent detected)'));
  }

  const fp         = text.replace(/^\/analy[sz]e\s+/, '').trim().replace(/^["']|["']$/g, '');
  const candidates = [fp, path.join('src', fp), path.join('lib', fp)];
  let resolvedFp   = fp, fileFound = false;
  for (const candidate of candidates) {
    try { readFileSafe(candidate); resolvedFp = candidate; fileFound = true; break; } catch (_) {}
  }
  if (!fileFound) {
    console.log('\n  ' + dg('✘ File not found: ') + sd(fp));
    console.log('  ' + ab('  Hint: use the full path, e.g. ') + sd('src/' + fp) + ab(' or /ls to browse'));
    ctx.prompt(); return true;
  }

  try {
    const file   = readFileSafe(resolvedFp);
    const kb     = (file.size / 1024).toFixed(1);
    console.log('\n  ' + kp('Analysing: ') + sd(file.name) + ab(' (' + kb + 'KB)'));
    const userMsg = `Analyse this file in detail:\n\nFile: ${resolvedFp} | Extension: .${file.ext} | Size: ${kb}KB | Lines: ${file.content.split('\n').length}\n\n\`\`\`${file.ext}\n${file.content}\n\`\`\`\n\nProvide: purpose, architecture, quality assessment (1-10), issues found, and improvement suggestions.`;
    ctx.messages.push({ role: 'user', content: userMsg }); ctx.msgN++;
    console.log('');
    const sp   = spinner('Analysing ' + file.name + '...');
    const t1   = Date.now();
    const allMs = [{ role: 'system', content: buildSystemPrompt(ctx) }, ...ctx.messages];
    const data  = await callAI(ctx.providerKey, ctx.apiKey, ctx.modelId, allMs);
    sp();
    const reply = data.choices[0].message.content;
    ctx.messages.push({ role: 'assistant', content: reply }); ctx.lastReply = reply;
    if (data.usage) ctx.totalTok += data.usage.total_tokens || 0;
    const blocks = parseFileBlocks(reply);
    if (blocks.length) {
      console.log('\n  ' + vt('AI wants to modify ' + blocks.length + ' file(s):'));
      blocks.forEach(bk => console.log('  ' + ab('  → ') + sd(bk.relPath)));
      const conf = await ctx.ask(cr('\n  ❯ ') + ab('Apply files? [Y/n]: '));
      const ans2 = conf.trim().toLowerCase();
      if (ans2 === '' || ans2 === 'y' || ans2 === 'yes') printFileResults(applyFileBlocks(blocks));
      else console.log('  ' + ab('Skipped.'));
    }
    const memBlocks = parseMemoryBlocks(reply);
    if (memBlocks.length) { updateMemory(ctx.mem, memBlocks); saveMemory(ctx.mem); }
    console.log('\n  ' + wh('🐋 whyWhale') + '  ' + ab(((Date.now() - t1) / 1000).toFixed(1) + 's · ' + ctx.totalTok.toLocaleString() + ' tokens'));
    console.log('');
    console.log(formatMD(stripFileBlocks(reply)));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /write ───────────────────────────────────────────────────────────────────
async function handleWrite(text, ctx) {
  const fp   = text.slice(7).trim().replace(/^["']|["']$/g, '');
  const what = await ctx.ask(cr('  ❯ ') + ab('Describe what to write into ' + fp + ': '));
  ctx.messages.push({ role: 'user', content: 'Write complete content for `' + fp + '`.\n' + what + '\nOutput using @@FILE/@@END format.' }); ctx.msgN++;
  console.log('');
  const sp    = spinner('Generating ' + fp + '...');
  const t1    = Date.now();
  try {
    const allMs = [{ role: 'system', content: buildSystemPrompt(ctx) }, ...ctx.messages];
    const data  = await callAI(ctx.providerKey, ctx.apiKey, ctx.modelId, allMs);
    sp();
    const reply  = data.choices[0].message.content;
    ctx.messages.push({ role: 'assistant', content: reply }); ctx.lastReply = reply;
    if (data.usage) ctx.totalTok += data.usage.total_tokens || 0;
    const blocks  = parseFileBlocks(reply);
    let applied   = [];
    if (blocks.length) {
      applied = applyFileBlocks(blocks);
      printFileResults(applied);
      if (ctx.autoTest) {
        const tr = await selfTestLoop(ctx.providerKey, ctx.apiKey, ctx.modelId, ctx.messages, applied, 3);
        if (tr.tested) console.log('\n  ' + (tr.passed ? kp('✔ Self-Test PASSED') : dg('✘ Self-Test FAILED after ' + tr.iterations + ' attempts')));
      }
    }
    console.log('\n  ' + wh('🐋 whyWhale') + '  ' + ab(((Date.now() - t1) / 1000).toFixed(1) + 's · ' + ctx.totalTok.toLocaleString() + ' tokens'));
    console.log(''); console.log(formatMD(stripFileBlocks(reply)));
  } catch (err) { sp(); console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /run ─────────────────────────────────────────────────────────────────────
async function handleRun(text, ctx) {
  const cmd = text.slice(4).trim();
  if (!cmd) { console.log('\n  ' + dg('Usage: /run <command>  or  !<command>')); }
  else {
    const res  = await runShell(cmd);
    const TW2  = Math.min((process.stdout.columns || 80) - 4, 100);
    console.log('\n  ' + ab('╭─ ') + sd(cmd) + ab(' ' + '─'.repeat(Math.max(0, TW2 - cmd.length - 4))));
    [...res.stdout.split('\n'), ...(res.stderr ? res.stderr.split('\n').map(l => dg(l)) : [])].filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
    if (!res.stdout && !res.stderr) console.log('  ' + ab('│ ') + dm('(no output)'));
    console.log('  ' + ab('╰─ exit ') + (res.code === 0 ? kp(String(res.code)) : dg(String(res.code))));
  }
  ctx.prompt(); return true;
}

// ─── /dashboard ───────────────────────────────────────────────────────────────
async function handleDashboard(text, ctx) {
  const portArg = parseInt(text.split(/\s+/)[1]) || 7070;
  ctx.statusRef.mode = ctx.mode; ctx.statusRef.model = ctx.modelId || ''; ctx.statusRef.msgCount = ctx.msgN;
  startDashboard(portArg, null, ctx.mem, ctx.messages, ctx.statusRef, VERSION);
  ctx.prompt(); return true;
}

// ─── dispatchCommand ──────────────────────────────────────────────────────────
async function dispatchCommand(text, ctx) {
  if (text.startsWith('!')) return handleShell(text, ctx);

  if (['/exit', '/quit', '/q'].includes(text)) return handleExit(text, ctx);
  if (text === '/help')                          return handleHelp(ctx);
  if (text === '/clear')                         return handleClear(ctx);
  if (text === '/stats')                         return handleStats(ctx);

  if (text === '/tokens') {
    console.log('\n  ' + ab('Tokens: ') + cr(ctx.totalTok.toLocaleString()) + ab('  Msgs: ') + sd(String(ctx.msgN)));
    ctx.prompt(); return true;
  }
  if (text === '/system') {
    console.log('\n  ' + ab('System prompt (' + ctx.mode + '):') + '  ');
    buildSystemPrompt(ctx).split('\n').forEach(l => console.log('  ' + dm(l)));
    ctx.prompt(); return true;
  }
  if (text === '/copy') {
    if (!ctx.lastReply) console.log('\n  ' + dg('No response yet.'));
    else console.log('\n  ' + (copyClip(ctx.lastReply) ? kp('✔ Copied!') : dg('✘ Clipboard unavailable.')));
    ctx.prompt(); return true;
  }
  if (text === '/reset') {
    const { CONFIG_PATH } = require('../config');
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    console.log('\n  ' + kp('✔ Config wiped. Restart to reconfigure.'));
    ctx.rl.close(); process.exit(0);
  }
  if (text === '/autotest') {
    ctx.autoTest = !ctx.autoTest;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    console.log('\n  ' + ab('Auto-Test: ') + (ctx.autoTest ? kp('ON') : ab('OFF')));
    ctx.prompt(); return true;
  }
  if (text === '/autoscan') {
    ctx.autoScan = !ctx.autoScan;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    console.log('\n  ' + ab('Auto-Scan: ') + (ctx.autoScan ? kp('ON') : ab('OFF')));
    ctx.prompt(); return true;
  }

  if (text === '/scan')                                             return handleScan(ctx);
  if (text.startsWith('/mode'))                                     return handleMode(text, ctx);
  if (text.startsWith('/model'))                                    return handleModel(text, ctx);
  if (text === '/provider')                                         return handleProvider(ctx);
  if (text.startsWith('/memory'))                                   return handleMemory(text, ctx);
  if (text.startsWith('/skill'))                                    return handleSkill(text, ctx);
  if (text.startsWith('/save'))                                     return handleSave(text, ctx);
  if (text === '/load')                                             return handleLoad(ctx);
  if (text === '/export')                                           return handleExport(ctx);
  if (text.startsWith('/ls'))                                       return handleLs(text, ctx);
  if (text.startsWith('/tree'))                                     return handleTree(text, ctx);
  if (text.startsWith('/read '))                                    return handleRead(text, ctx);
  if (text.startsWith('/create '))                                  return handleCreate(text, ctx);
  if (text.startsWith('/delete '))                                  return handleDelete(text, ctx);
  if (text.startsWith('/rename '))                                  return handleRename(text, ctx);
  if (text.startsWith('/analyse ') || text.startsWith('/analyze ')) return handleAnalyse(text, ctx);
  if (text.startsWith('/write '))                                   return handleWrite(text, ctx);
  if (text.startsWith('/run'))                                      return handleRun(text, ctx);
  if (text.startsWith('/connection'))                               return handleConnection(text, ctx);
  if (text === '/wp' || text.startsWith('/wp '))                    return handleConnection('/connection whatsapp' + text.slice(3), ctx);
  if (text === '/wa' || text.startsWith('/wa '))                    return handleWa(text, ctx);
  if (text.startsWith('/dashboard'))                                return handleDashboard(text, ctx);

  return false;
}


// ─── /connection ──────────────────────────────────────────────────────────────
async function handleConnection(text, ctx) {
  const { CONNECTION_REGISTRY, getConnectionStatus,
          disconnectConnection, setupConnection } = require('../connections');
  const args = text.slice(11).trim().split(/\s+/);
  const sub  = args[0]?.toLowerCase();

  if (!sub || sub === 'list') {
    console.log('\n  ' + tl(C.bold + '⚡ Connections') + C.reset);
    console.log('  ' + ab('─'.repeat(52)));
    Object.values(CONNECTION_REGISTRY).forEach((conn, i) => {
      const status = getConnectionStatus(conn.id);
      const badge  = conn.comingSoon ? ab('  (coming soon)')
                   : status?.connected ? kp(' ● connected')
                   : rf(' ○ not connected');
      console.log('  ' + ab('[' + (i + 1) + ']') + '  ' + conn.icon + '  ' + wh(conn.name.padEnd(14)) + ab(conn.description) + badge);
    });
    console.log('\n  ' + ab('─'.repeat(52)));
    console.log('  ' + ab('Type ') + sd('/connection <n>') + ab(' to set up.'));
    console.log('  ' + ab('e.g. ') + sd('/connection whatsapp'));
    console.log('  ' + ab('Or pick a number: '));
    const ids  = Object.keys(CONNECTION_REGISTRY);
    const ch   = await ctx.ask(cr('\n  ❯ ') + ab('Select [1-' + ids.length + '] or Enter to cancel: '));
    const idx  = parseInt(ch.trim()) - 1;
    if (!isNaN(idx) && ids[idx]) {
      await setupConnection(ids[idx], ctx);
    }
    ctx.prompt(); return true;
  }

  if (sub === 'disconnect') {
    const target = args[1]?.toLowerCase();
    if (!target || !CONNECTION_REGISTRY[target]) {
      console.log('\n  ' + dg('Usage: /connection disconnect <n>'));
      ctx.prompt(); return true;
    }
    disconnectConnection(target);
    console.log('\n  ' + kp('✔ Disconnected: ') + sd(CONNECTION_REGISTRY[target].name));
    ctx.prompt(); return true;
  }

  if (CONNECTION_REGISTRY[sub]) {
    await setupConnection(sub, ctx);
    ctx.prompt(); return true;
  }

  console.log('\n  ' + dg('Unknown connection: ') + sd(sub));
  console.log('  ' + ab('Available: ') + Object.keys(CONNECTION_REGISTRY).join(', '));
  ctx.prompt(); return true;
}

// ─── /wa ──────────────────────────────────────────────────────────────────────
// Usage:  /wa <number> <message>
//         /wa status
//         /wa history
//         /wa owner <number>        ← change the owner number
//         /wa --reset               ← wipe session and credentials
async function handleWa(text, ctx) {
  const G  = '\x1b[38;5;35m';   // brand green
  const GD = '\x1b[38;5;30m';   // dark teal-green
  const GL = '\x1b[38;5;157m';  // light mint
  const GR = '\x1b[38;5;245m';  // grey
  const Y  = '\x1b[38;5;226m';
  const B  = '\x1b[1m';
  const R  = '\x1b[0m';
  const DIV = G + '─'.repeat(50) + R;

  const args = text.slice(3).trim();

  // ── /wa (no args) / /wa help ─────────────────────────────────────────────
  if (!args || args === 'help') {
    console.log('\n  ' + G + B + '💬 WhatsApp — /wa commands' + R);
    console.log('  ' + DIV);
    console.log('  ' + GL + '/wa <number> <message>' + R + GR + '  — send a message' + R);
    console.log('  ' + GL + '/wa status             ' + R + GR + '  — show connection status' + R);
    console.log('  ' + GL + '/wa history            ' + R + GR + '  — show recent messages (this session)' + R);
    console.log('  ' + GL + '/wa owner <number>     ' + R + GR + '  — change the owner number whyWhale responds to' + R);
    console.log('  ' + GL + '/wa --reset            ' + R + GR + '  — wipe session & credentials, forces fresh QR' + R);
    console.log('  ' + GL + '/wp                    ' + R + GR + '  — open WhatsApp setup / re-link' + R);
    console.log('  ' + DIV);
    console.log('  ' + GR + 'Example: ' + R + G + '/wa 919876543210 Hey, this is whyWhale!' + R);
    console.log('  ' + GR + 'Number format: country code + number, no spaces or + sign.' + R);
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa --reset ──────────────────────────────────────────────────────────
  if (args === '--reset') {
    const WA_INDEX = require('path').resolve(__dirname, '../../connections/whatsapp/index.js');
    const G2 = '\x1b[38;5;35m';
    const R2 = '\x1b[0m';

    // Confirm
    const conf = await ctx.ask('\n  ' + Y + '⚠ This will wipe your WhatsApp session and credentials.' + R + '\n  ' + GR + 'You will need to scan a QR code again to reconnect.' + R + '\n  ' + GR + 'Continue? [y/N]: ' + R);
    if (conf.trim().toLowerCase() !== 'y' && conf.trim().toLowerCase() !== 'yes') {
      console.log('  ' + ab('Cancelled.'));
      ctx.prompt(); return true;
    }

    // Call resetSession from the WA module if available
    try {
      const waModule = require(WA_INDEX);
      if (typeof waModule.resetSession === 'function') {
        waModule.resetSession();
      }
    } catch (_) {
      // Module not loaded — manually wipe the session folder
      const os   = require('os');
      const path = require('path');
      const sessionPath = path.join(os.homedir(), '.whywhale', 'credentials', 'whatsapp', 'session');
      try {
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
      } catch (_2) {}

      // Update connections file
      const connPath = path.join(os.homedir(), '.whywhale_connections.json');
      try {
        if (fs.existsSync(connPath)) {
          const data = JSON.parse(fs.readFileSync(connPath, 'utf8'));
          if (data.whatsapp) { data.whatsapp.connected = false; fs.writeFileSync(connPath, JSON.stringify(data, null, 2), 'utf8'); }
        }
      } catch (_2) {}
    }

    ctx.waClient        = null;
    ctx._waSendFarewell = null;
    console.log('\n  ' + G2 + '✔ WhatsApp session wiped.' + R2);
    console.log('  ' + GR + 'Run ' + R + G2 + '/wp' + R2 + GR + ' to reconnect and scan a fresh QR.' + R);
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa owner <number> ───────────────────────────────────────────────────
  if (args.startsWith('owner')) {
    const rest = args.slice(5).trim().replace(/\D/g, '');
    if (!rest) {
      // Show current owner
      const os       = require('os');
      const connPath = require('path').join(os.homedir(), '.whywhale_connections.json');
      let current    = 'not set';
      try {
        const data = JSON.parse(fs.readFileSync(connPath, 'utf8'));
        if (data.whatsapp?.ownerNumber) current = '+' + data.whatsapp.ownerNumber;
      } catch (_) {}
      console.log('\n  ' + G + B + '📱 WhatsApp owner number: ' + R + GL + current + R);
      console.log('  ' + GR + 'Usage: ' + R + G + '/wa owner 919876543210' + R + GR + ' (country code + number, no +)' + R);
      console.log('');
      ctx.prompt(); return true;
    }

    // Update owner number in connections file
    const os       = require('os');
    const connPath = require('path').join(os.homedir(), '.whywhale_connections.json');
    try {
      let data = {};
      if (fs.existsSync(connPath)) data = JSON.parse(fs.readFileSync(connPath, 'utf8'));
      if (!data.whatsapp) data.whatsapp = { connected: false };
      data.whatsapp.ownerNumber = rest;
      fs.writeFileSync(connPath, JSON.stringify(data, null, 2), 'utf8');
      console.log('\n  ' + G + B + '✔ Owner number updated: ' + R + GL + '+' + rest + R);
      console.log('  ' + GR + 'Restart whyWhale (or run /wp) for the change to take effect.' + R);
    } catch (err) {
      console.log('\n  ' + '\x1b[38;5;203m' + '✘ Could not update owner number: ' + R + err.message);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa status ────────────────────────────────────────────────────────────
  if (args === 'status') {
    const { getConnectionStatus } = require('../connections');
    const status = getConnectionStatus('whatsapp');
    console.log('');
    if (ctx.waClient || ctx._waSendFarewell) {
      const owner = status?.ownerNumber ? GR + '  (owner: +' + status.ownerNumber + ')' + R : '';
      console.log('  ' + G + B + '● WhatsApp: connected' + R + GL + '  (active this session)' + R + owner);
    } else if (status?.connected) {
      console.log('  ' + GD + '● WhatsApp: saved' + R + GR + '  (credentials on disk — restart to auto-connect)' + R);
    } else {
      console.log('  ' + '\x1b[38;5;203m' + '○ WhatsApp: not connected' + R);
      console.log('  ' + GR + 'Run ' + R + G + '/wp' + R + GR + ' to set up, or ' + R + G + '/wa --reset' + R + GR + ' to start fresh.' + R);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa history ───────────────────────────────────────────────────────────
  if (args === 'history') {
    const hist = ctx._waHistory || [];
    console.log('');
    if (!hist.length) {
      console.log('  ' + GR + 'No messages sent this session.' + R);
    } else {
      console.log('  ' + G + B + '💬 WhatsApp message history (this session)' + R);
      console.log('  ' + DIV);
      hist.forEach(h => {
        const dir = h.dir === 'out' ? G + '→' + R : GD + '←' + R;
        console.log('  ' + GR + h.time + R + ' ' + dir + ' ' + GR + h.to + R + '  ' + GL + h.text + R);
      });
      console.log('  ' + DIV);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── Sending a message (/wa <number> <message> or wizard) ─────────────────
  if (!ctx.waClient) {
    const { getConnectionStatus } = require('../connections');
    const status = getConnectionStatus('whatsapp');
    console.log('');
    if (status?.connected) {
      console.log('  ' + Y + '⚠ WhatsApp client is not active this session.' + R);
      console.log('  ' + GR + 'Restart whyWhale to auto-reconnect, or run ' + R + G + '/wp' + R + GR + ' to re-link.' + R);
    } else {
      console.log('  ' + '\x1b[38;5;203m' + '✘ WhatsApp is not connected.' + R);
      console.log('  ' + GR + 'Run ' + R + G + '/wp' + R + GR + ' to set up, or ' + R + G + '/wa --reset' + R + GR + ' to start fresh.' + R);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // Interactive wizard (no number provided)
  if (!args.match(/^\d/)) {
    console.log('\n  ' + G + B + '💬 Send a WhatsApp message' + R);
    console.log('  ' + DIV);

    const ccRaw  = await ctx.ask('  ' + G + '❯ Country code ' + GR + '(digits only, e.g. 91 for India, 1 for USA): ' + R);
    const cc     = ccRaw.trim().replace(/\D/g, '');
    if (!cc) { console.log('  ' + '\x1b[38;5;203m' + '✘ Cancelled.' + R + '\n'); ctx.prompt(); return true; }

    const numRaw = await ctx.ask('  ' + G + '❯ Phone number ' + GR + '(without country code or spaces): ' + R);
    const num    = numRaw.trim().replace(/\D/g, '');
    if (!num) { console.log('  ' + '\x1b[38;5;203m' + '✘ Cancelled.' + R + '\n'); ctx.prompt(); return true; }

    const msgRaw = await ctx.ask('  ' + G + '❯ Message: ' + R);
    const msg    = msgRaw.trim();
    if (!msg) { console.log('  ' + '\x1b[38;5;203m' + '✘ Cancelled.' + R + '\n'); ctx.prompt(); return true; }

    const fullNumber = cc + num;
    const jidW       = fullNumber + '@c.us';
    console.log('\n  ' + G + '⟳ Sending to +' + cc + ' ' + num + '...' + R);
    try {
      await ctx.waClient.sendMessage(jidW, msg);
      if (!ctx._waHistory) ctx._waHistory = [];
      ctx._waHistory.push({ dir: 'out', to: fullNumber, text: msg, time: new Date().toTimeString().slice(0, 8) });
      console.log('  ' + G + B + '✔ Sent!' + R + GL + '  → +' + cc + ' ' + num + R);
    } catch (err) {
      console.log('  ' + '\x1b[38;5;203m' + '✘ Failed to send: ' + R + err.message);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // /wa <number> <message> shorthand
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) {
    console.log('\n  ' + '\x1b[38;5;203m' + '✘ No message provided.' + R);
    console.log('  ' + GR + 'Usage: ' + R + G + '/wa <number> <message>' + R + '\n');
    ctx.prompt(); return true;
  }

  const number  = args.slice(0, spaceIdx).trim().replace(/\D/g, '');
  const message = args.slice(spaceIdx + 1).trim();

  if (!number || !message) {
    console.log('\n  ' + '\x1b[38;5;203m' + '✘ Invalid format.' + R + GR + '  Usage: /wa <number> <message>' + R + '\n');
    ctx.prompt(); return true;
  }

  const jid = number + '@c.us';
  console.log('');
  console.log('  ' + G + '⟳ Sending...' + R);

  try {
    await ctx.waClient.sendMessage(jid, message);
    if (!ctx._waHistory) ctx._waHistory = [];
    ctx._waHistory.push({ dir: 'out', to: number, text: message, time: new Date().toTimeString().slice(0, 8) });
    console.log('  ' + G + B + '✔ Sent!' + R + GL + '  → ' + number + R);
    console.log('  ' + GR + '"' + (message.length > 60 ? message.slice(0, 60) + '…' : message) + '"' + R);
  } catch (err) {
    console.log('  ' + '\x1b[38;5;203m' + '✘ Failed to send: ' + R + err.message);
    console.log('  ' + GR + 'Check the number format — no +, no spaces, with country code.' + R);
  }

  console.log('');
  ctx.prompt(); return true;
}

module.exports = { dispatchCommand };