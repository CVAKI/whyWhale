'use strict';

const net = require('net');

const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, dm }          = require('../colors');
const { saveMemory, parseMemoryBlocks, updateMemory }           = require('../config');
const { callAI }                                                = require('../providers');
const { formatMD, spinner }                                     = require('../render');
const { parseFileBlocks, parseRunBlocks, applyFileBlocks,
        printFileResults }                                      = require('../filesystem');
const { selfTestLoop, runShell }                                = require('../selftest');
const { stripFileBlocks, buildSystemPrompt }                    = require('./utils');

// ─── Port probe ───────────────────────────────────────────────────────────────
// Probe BOTH IPv4 and IPv6 loopback — Express may bind on either.
function probePort(port) {
  const tryHost = (host) => new Promise(r => {
    const s = net.createConnection({ host, port });
    s.on('connect', () => { s.destroy(); r(true); });
    s.on('error',   () => { s.destroy(); r(false); });
    setTimeout(() => { try { s.destroy(); } catch (_) {} r(false); }, 500);
  });
  return Promise.resolve().then(() => tryHost('127.0.0.1')).then(ok => ok || tryHost('::1'));
}

// Only auto-start if command is a client command (not taskkill/netstat/curl etc.)
function isClientCmd(cmd) {
  return /^node\s+/i.test(cmd.trim()) && !/\b(server\.js|app\.js)\b/i.test(cmd);
}

// ─── ensureServer ─────────────────────────────────────────────────────────────
// Auto-start server.js / app.js if port 3000 is not already open.
async function ensureServer(ctx) {
  const fs    = require('fs');
  const path  = require('path');
  const { CWD } = require('../filesystem');

  if (await probePort(3000)) return false; // already running

  const candidates = [
    path.join(CWD(), 'server.js'),
    path.join(CWD(), 'src', 'server.js'),
    path.join(CWD(), 'app.js'),
  ];
  const serverFile = candidates.find(f => fs.existsSync(f));
  if (!serverFile) return false;

  const rel = path.relative(CWD(), serverFile);
  console.log('  ' + wh('⟳') + ' ' + ab('Auto-starting server: ') + tl(rel));
  await runShell('node "' + serverFile + '" &');

  // Poll up to 5s for port to open (25 × 200ms), check both hosts
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await probePort(3000)) {
      console.log('  ' + kp('✔ Server ready on port 3000'));
      return true;
    }
  }
  console.log('  ' + dg('⚠ Server did not bind within 5s — proceeding anyway'));
  return true;
}

// ─── executeRunBlocks ─────────────────────────────────────────────────────────
// Execute @@RUN: commands from an AI reply and feed real output back into history.
async function executeRunBlocks(runCmds, ctx) {
  console.log('\n  ' + wh('⟳') + ' ' + ab('Running @@RUN commands (live)...'));
  const runOutputLines = [];
  let serverStarted = false;
  let serverEnsured = false;

  for (let cmd of runCmds) {
    // ── Sanity-check: reject non-shell tokens ──────────────────────────────
    // Models sometimes emit bare JS function names instead of shell commands.
    const firstToken = cmd.trim().split(/\s+/)[0];
    const looksLikeShell =
      /^[a-z]:[\\//]/i.test(firstToken) ||
      /^[\.~\/\\]/.test(firstToken) ||
      /\.(js|py|sh|cmd|bat|exe|ps1)$/i.test(firstToken) ||
      /^(node|npm|npx|python|pip|git|curl|powershell|cmd|taskkill|netstat|timeout|sleep|start|echo|cd|mkdir|rmdir|copy|move|del|type|for|set)$/i.test(firstToken);

    if (!looksLikeShell) {
      console.log('  ' + dg('  ├─ (skipped — not a shell command: ' + firstToken + ')'));
      runOutputLines.push('$ ' + cmd + '\n(skipped — not a shell command)');
      continue;
    }

    // ── Strip trailing & from non-server foreground commands ───────────────
    // AI often appends & to client commands — on Windows this swallows stdout.
    const isServerLaunchCmd = /\b(server\.js|app\.js|index\.js)\b/i.test(cmd);
    if (/&\s*$/.test(cmd) && !isServerLaunchCmd) {
      cmd = cmd.replace(/\s*&\s*$/, '').trim();
    }

    console.log('  ' + sd('$ ') + tl(cmd));

    // Small sleep commands — handle inline without spawning
    const sleepMatch = cmd.match(/^(sleep|timeout)\s+(\d+(\.\d+)?)/i) ||
                       cmd.match(/setTimeout.*?(\d+)\s*\}/);
    if (sleepMatch) {
      const ms = parseFloat(sleepMatch[2] || sleepMatch[1]) * (cmd.toLowerCase().startsWith('sleep') ? 1000 : 1);
      await new Promise(r => setTimeout(r, Math.min(ms, 5000)));
      runOutputLines.push('$ ' + cmd + '\n(waited ' + Math.round(ms / 1000) + 's)');
      continue;
    }

    // Explicitly-backgrounded server start
    const isServerCmd = /\b(server\.js|app\.js)\b/.test(cmd) && /&\s*$/.test(cmd);
    if (isServerCmd && !serverStarted) {
      await runShell(cmd);
      await new Promise(r => setTimeout(r, 1800));
      serverStarted = true;
      serverEnsured = true;
      runOutputLines.push('$ ' + cmd + '\n(server started, waited 1.8s)');
      continue;
    }

    // Before running a client node command, auto-start the server if needed.
    if (!serverEnsured && !isServerCmd && isClientCmd(cmd)) {
      const alreadyUp = await probePort(3000);
      if (alreadyUp) {
        serverStarted = true;
      } else {
        const autoStarted = await ensureServer(ctx);
        if (autoStarted) serverStarted = true;
      }
      serverEnsured = true;
    }

    let res = await runShell(cmd);
    let out = (res.stdout + res.stderr).trim();

    // If ECONNREFUSED, server died between turns — restart and retry
    if (out.includes('ECONNREFUSED')) {
      console.log('  ' + dg('  ├─ (ECONNREFUSED — restarting server and retrying...)'));
      await ensureServer(ctx);
      serverStarted = true;
      serverEnsured = true;
      let ready = false;
      for (let _i = 0; _i < 15; _i++) {
        await new Promise(r => setTimeout(r, 300));
        if (await probePort(3000)) { ready = true; break; }
      }
      if (ready) {
        res = await runShell(cmd);
        out = (res.stdout + res.stderr).trim();
      }
    }

    // No output and exit 0 — retry for any node client command
    if (!out && res.code === 0 && isClientCmd(cmd)) {
      for (let _r = 0; _r < 2 && !out; _r++) {
        await new Promise(r => setTimeout(r, 800));
        res = await runShell(cmd);
        out = (res.stdout + res.stderr).trim();
      }
    }

    if (out) {
      out.split('\n').slice(0, 20).forEach(l => console.log('  ' + ab('  ├─ ') + wh(l)));
      runOutputLines.push('$ ' + cmd + '\n' + out);
    } else if (res.code !== 0) {
      console.log('  ' + dg('  ├─ (exit ' + res.code + ' — no output)'));
      runOutputLines.push('$ ' + cmd + '\n(exit ' + res.code + ')');
    } else {
      console.log('  ' + dg('  ├─ (no output)'));
      runOutputLines.push('$ ' + cmd + '\n(no output)');
    }
  }

  // Feed real output back into message history so AI can see actual results
  if (runOutputLines.length) {
    ctx.messages.push({ role: 'user',      content: '@@RUN results:\n```\n' + runOutputLines.join('\n') + '\n```' });
    ctx.messages.push({ role: 'assistant', content: 'Run output received.' });
  }
}

// ─── handleAiMessage ──────────────────────────────────────────────────────────
// Send the user message to the AI, handle file/memory/run blocks, self-test.
async function handleAiMessage(text, ctx) {
  ctx.messages.push({ role: 'user', content: text }); ctx.msgN++;
  ctx.statusRef.msgCount = ctx.msgN;
  ctx.statusRef.mode     = ctx.mode;
  ctx.statusRef.model    = ctx.modelId || '';

  console.log('');
  const mc2 = require('../modes').MODES[ctx.mode];
  const sp2 = spinner(mc2.name + ' · thinking...');
  const t1  = Date.now();

  try {
    const allMs = [{ role: 'system', content: buildSystemPrompt(ctx) }, ...ctx.messages];
    const data  = await callAI(ctx.providerKey, ctx.apiKey, ctx.modelId, allMs);
    sp2();
    const reply = data.choices[0].message.content;
    ctx.messages.push({ role: 'assistant', content: reply });
    ctx.lastReply = reply;
    if (data.usage) ctx.totalTok += data.usage.total_tokens || 0;
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);

    // ── Memory blocks ──────────────────────────────────────────────────────
    const memBlocks = parseMemoryBlocks(reply);
    const newMemBlocks = memBlocks.filter(mb => {
      const existing = ctx.mem.facts.find(f => f.key === mb.key);
      return !existing || existing.value !== mb.value;
    });
    if (newMemBlocks.length) {
      updateMemory(ctx.mem, newMemBlocks); saveMemory(ctx.mem);
      console.log('  ' + vt('◈ Memory: ') + sd(newMemBlocks.map(m => m.key).join(', ')) + ab(' saved'));
    }

    // ── File blocks ────────────────────────────────────────────────────────
    const blocks = parseFileBlocks(reply);
    if (!blocks.length && reply.includes('@@FILE:') && reply.includes('@@END')) {
      console.log('  ' + rf('⚠ ') + ab('AI output @@FILE blocks but they could not be parsed. Check format.'));
    }
    let appliedFiles = [];
    if (blocks.length) {
      if (ctx.mode === 'agent') {
        appliedFiles = applyFileBlocks(blocks);
        ctx.agentTaskActive = true; // stay in agent mode for follow-up turns
      } else {
        console.log('\n  ' + vt('AI wants to create/modify ' + blocks.length + ' file(s):'));
        blocks.forEach(bk => console.log('  ' + ab('  → ') + sd(bk.relPath)));
        console.log('  ' + rf('  ⚠  You are in ') + mc2.colorFn(mc2.icon + ' ' + mc2.name) + rf(' mode — file writes are OFF by default. Use /mode agent to auto-apply.'));
        const conf = await ctx.ask(cr('\n  ❯ ') + ab('Apply files anyway? [y/N]: '));
        const ans  = conf.trim().toLowerCase();
        if (ans === 'y' || ans === 'yes') appliedFiles = applyFileBlocks(blocks);
        else console.log('  ' + ab('Skipped — no files changed.'));
      }
    } else {
      // No files written this turn — clear agent stickiness only if no @@RUN commands either
      if (!parseRunBlocks(reply).length) ctx.agentTaskActive = false;
    }

    // ── @@RUN blocks ───────────────────────────────────────────────────────
    const runCmds = parseRunBlocks(reply);
    if (runCmds.length) await executeRunBlocks(runCmds, ctx);

    // ── Self-test loop ─────────────────────────────────────────────────────
    let testResult = null;
    if (appliedFiles.length && ctx.autoTest) {
      testResult = await selfTestLoop(ctx.providerKey, ctx.apiKey, ctx.modelId, ctx.messages, appliedFiles, 3);
    }

    // ── Print reply ────────────────────────────────────────────────────────
    console.log('  ' + wh('🐋 whyWhale') + '  ' + mc2.colorFn(mc2.icon) + '  ' + ab('────── ' + elapsed + 's · ' + ctx.totalTok.toLocaleString() + ' tokens · #' + ctx.msgN));
    console.log('');
    console.log(formatMD(stripFileBlocks(reply)));

    if (appliedFiles.length) printFileResults(appliedFiles);

    if (testResult?.tested) {
      console.log('');
      if (testResult.passed) {
        console.log('  ' + kp('✔ AI Self-Test PASSED') + ab(' — code verified by running it') + (testResult.iterations > 1 ? ab(' (' + testResult.iterations + ' fix attempts)') : ''));
      } else {
        console.log('  ' + dg('✘ AI Self-Test FAILED') + ab(' after ' + testResult.iterations + ' attempts — manual review recommended'));
      }
    }
    console.log('');
  } catch (err) {
    sp2();
    console.log('\n  ' + dg('✘ Error: ') + err.message);
    ctx.messages.pop(); ctx.msgN--;
  }
}

module.exports = { handleAiMessage };