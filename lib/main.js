'use strict';
const readline = require('readline');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm } = require('./colors');
const { loadConfig, saveConfig, loadMemory, saveMemory, parseMemoryBlocks, updateMemory, buildMemoryContext, SKILL_REGISTRY, loadSkills, saveSkill, buildSkillsContext, HOME_DIR, CONFIG_PATH, SKILLS_DIR } = require('./config');
const { PROVIDERS, ollamaAvailable, ollamaModels, ollamaPull, fetchLiveModels, callAI } = require('./providers');
const { formatMD, renderPS1, printBanner, spinner } = require('./render');
const { CWD, safePath, ensureDirForFile, writeFileSafe, readFileSafe, treeDir, lsDir, formatSize, parseFileBlocks, applyFileBlocks, printFileResults, scanFolder, buildFolderContext } = require('./filesystem');
const { runFile, selfTestLoop, saveSession, listSessions, runShell, copyClip } = require('./selftest');
const { MODES } = require('./modes');
const { startDashboard } = require('./dashboard');

// Strip @@FILE:...@@END blocks from AI reply before markdown rendering.
// The actual file content is already handled by parseFileBlocks/applyFileBlocks
// and printed separately via printFileResults — rendering it again through
// formatMD causes the code to spill out unstyled when the AI wraps @@FILE:
// inside a code fence (which closes immediately, leaving raw code outside).
function stripFileBlocks(text) {
  return text
    // Remove fenced @@FILE blocks: ```lang\n@@FILE: ...\n``` (AI sometimes wraps the tag)
    .replace(/```[^\n]*\n@@FILE:[^\n]*\n```\n?/g, '')
    // Remove full @@FILE:...@@END blocks (with or without inner fences)
    .replace(/@@FILE:[^\n]*\n(?:```[^\n]*\n)?[\s\S]*?(?:```\n)?@@END\n?/g, '')
    .trim();
}

const VERSION = '4.0.0';

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cfg=loadConfig();
  const mem=loadMemory();
  let skills=loadSkills();

  printBanner(VERSION);

  let providerKey=cfg.provider||null;
  let apiKey     =cfg.apiKey||'';
  let modelId    =cfg.model||null;
  let mode       =cfg.mode||'code';
  let autoTest   =cfg.autoTest!==false;
  let autoScan   =cfg.autoScan!==false;
  let folderCtx  ='';

  const rl =readline.createInterface({input:process.stdin,output:process.stdout});
  const ask=q=>new Promise(res=>rl.question(q,res));
  const statusRef={mode,model:modelId||'',msgCount:0};

  // ── Provider selection ──────────────────────────────────────────────────────
  if (!providerKey) {
    console.log('  '+ab('Select a provider:'));
    console.log('');
    console.log('  '+wh('[1]')+'  '+sd('Anthropic (Claude)')+'  '+ab('claude-sonnet-4, opus-4 — most capable'));
    console.log('  '+cr('[2]')+'  '+sd('OpenRouter         ')+'  '+kp('FREE models available'));
    console.log('  '+rf('[3]')+'  '+sd('Groq               ')+'  '+kp('FREE ultra-fast inference'));
    const olOk=await ollamaAvailable();
    if (olOk) console.log('  '+kp('[4]')+'  '+sd('Ollama (Local)     ')+'  '+kp('● detected — no key needed'));
    else console.log('  '+ab('[4]')+'  '+ab('Ollama (Local)     ')+'  '+ab('not detected (ollama.com)'));
    console.log('');
    const ch=await ask(cr('  ❯ ')+ab('Select [1/2/3/4]: '));
    if      (ch.trim()==='4') { if (!olOk){console.log('\n  '+dg('Ollama not running: ollama serve'));rl.close();process.exit(1);} providerKey='ollama'; }
    else if (ch.trim()==='3') providerKey='groq';
    else if (ch.trim()==='2') providerKey='openrouter';
    else                       providerKey='anthropic';
    console.log('');
  }

  const prov=PROVIDERS[providerKey]||PROVIDERS.openrouter;
  console.log('  '+ab('Provider › ')+prov.colorFn(prov.name));

  // ── API Key ─────────────────────────────────────────────────────────────────
  if (providerKey!=='ollama'&&!apiKey) {
    console.log('');
    console.log('  '+ab('Get your key → ')+tl(prov.keyUrl));
    const ki=await ask(cr('  ❯ ')+ab('Enter API key: '));
    apiKey=ki.trim();
  }

  // ── Model selection ─────────────────────────────────────────────────────────
  const OLLAMA_DOWNLOADABLE=[
    {id:'llama3.2',        label:'Llama 3.2 3B       ',  size:'2.0 GB', desc:'Fast & lightweight'},
    {id:'llama3.1',        label:'Llama 3.1 8B       ',  size:'4.7 GB', desc:'Great all-rounder'},
    {id:'llama3.1:70b',    label:'Llama 3.1 70B      ',  size:'40 GB',  desc:'Most powerful Llama'},
    {id:'mistral',         label:'Mistral 7B         ',  size:'4.1 GB', desc:'Fast & capable'},
    {id:'gemma3:4b',       label:'Gemma 3 4B         ',  size:'3.3 GB', desc:'Google — very capable'},
    {id:'gemma3:12b',      label:'Gemma 3 12B        ',  size:'8.1 GB', desc:'Google — powerful'},
    {id:'qwen2.5-coder:7b',label:'Qwen 2.5 Coder 7B  ',  size:'4.7 GB', desc:'Best for coding'},
    {id:'deepseek-r1:7b',  label:'DeepSeek R1 7B     ',  size:'4.7 GB', desc:'Excellent reasoning'},
    {id:'phi4',            label:'Phi-4 14B          ',  size:'9.1 GB', desc:'Microsoft — small but smart'},
    {id:'codellama',       label:'Code Llama 7B      ',  size:'3.8 GB', desc:'Meta — code focused'},
  ];

  let availModels;
  if (providerKey==='ollama') {
    availModels=await ollamaModels();
    if (!availModels.length) {
      console.log('\n  '+rf('⚠ No Ollama models installed.')+ab(' Choose one to download:'));
      console.log('');
      OLLAMA_DOWNLOADABLE.forEach((m,i)=>{
        console.log('  '+wh('['+(i+1)+']')+' '+sd(m.label)+rf(m.size.padStart(8))+'  '+ab(m.desc));
      });
      console.log('');
      const mc=await ask(cr('  ❯ ')+ab('Pick a model to download [1-'+OLLAMA_DOWNLOADABLE.length+']: '));
      const idx=parseInt(mc.trim())-1;
      const chosen=OLLAMA_DOWNLOADABLE[isNaN(idx)||idx<0||idx>=OLLAMA_DOWNLOADABLE.length?0:idx];
      console.log('\n  '+wh('Downloading ')+sd(chosen.id)+ab('  ('+chosen.size+') — this may take a few minutes...'));
      console.log('  '+ab('Connecting to Ollama API...\n'));
      try {
        await ollamaPull(chosen.id);
        console.log('\n  '+kp('✔ Download complete! Model ready: ')+wh(chosen.id));
      } catch(pullErr) {
        console.log('\n  '+dg('✘ Download failed: ')+pullErr.message);
        console.log('  '+ab('Try manually in a terminal: ')+sd('ollama pull '+chosen.id));
        rl.close(); process.exit(1);
      }
      availModels=await ollamaModels();
      if (!availModels.length){
        console.log('\n  '+dg('Still no models found. Try manually: ')+sd('ollama pull '+chosen.id));
        rl.close(); process.exit(1);
      }
    }
  } else {
    const sp=spinner('Fetching available models...');
    const liveModels=await fetchLiveModels(providerKey, apiKey);
    sp();
    if (liveModels && liveModels.length) {
      availModels=liveModels;
      console.log('  '+kp('✔')+' '+ab('Fetched ')+wh(String(liveModels.length))+ab(' live models from ')+prov.colorFn(prov.name));
    } else {
      availModels=prov.models||[];
      if (availModels.length) console.log('  '+rf('⚠')+' '+ab('Could not fetch live models — using built-in list'));
    }
  }

  // ── Model selection + connection test loop ──────────────────────────────────
  let modelMeta;
  let connected = false;
  if (modelId && !availModels.find(m=>m.id===modelId)) modelId = null;

  while (!connected) {
    if (!modelId) {
      console.log('');
      availModels.forEach((m,i)=>{
        const sz=m.size?'  '+ab((m.size/1e9).toFixed(1)+'GB'):'';
        console.log('  '+ab('['+(i+1)+']')+' '+sd(m.label||m.id)+(m.free?' '+kp('FREE'):'')+sz);
      });
      console.log('');
      const mc=await ask(cr('  ❯ ')+ab('Select model [1-'+availModels.length+']: '));
      const idx=parseInt(mc.trim())-1;
      modelId=availModels[isNaN(idx)||idx<0||idx>=availModels.length?0:idx].id;
    }
    modelMeta=availModels.find(m=>m.id===modelId)||availModels[0];
    console.log('  '+ab('Model    › ')+wh(modelMeta.label||modelMeta.id));

    saveConfig({provider:providerKey,apiKey,model:modelId,mode,autoTest,autoScan});

    console.log('');
    const stopTest=spinner('Testing connection...');
    try {
      await callAI(providerKey,apiKey,modelId,[{role:'user',content:'hi'}]);
      stopTest();
      console.log('  '+kp('✔ Connected!')+ab(' whyWhale v'+VERSION+' is ready.'));
      connected = true;
    } catch(err) {
      stopTest();
      console.log('  '+dg('✘ ')+err.message);
      console.log('  '+ab('This model may require terms acceptance or may not support chat.'));
      availModels = availModels.filter(m=>m.id!==modelId);
      modelId = null;
      if (!availModels.length) {
        console.log('  '+dg('No more models to try. Check your API key or run: ')+sd('whywhale --reset'));
        rl.close(); process.exit(1);
      }
      console.log('  '+rf('↩ Pick a different model:'));
    }
  }

  // ── Folder scan ─────────────────────────────────────────────────────────────
  if (autoScan) {
    const sp=spinner('Scanning project directory...');
    const files=scanFolder(CWD(),8);
    sp();
    if (files.length) {
      folderCtx=buildFolderContext(files,CWD());
      console.log('  '+tl('◈')+' '+ab('Scanned: ')+sd(files.length+' project files')+ab(' in ')+tl(path.basename(CWD())));
    }
  }

  // ── Memory / Skills report ──────────────────────────────────────────────────
  if (mem.facts.length||mem.sessionSummaries?.length) {
    console.log('  '+vt('◈')+' '+ab('Memory: ')+sd(mem.facts.length+' facts')+ab(', ')+sd((mem.sessionSummaries?.length||0)+' past sessions'));
  }
  if (skills.length) {
    console.log('  '+rf('◈')+' '+ab('Skills: ')+sd(skills.map(s=>s.name).join(', ')));
  }
  console.log('  '+ab('◈')+' '+ab('Auto-Test: ')+(autoTest?kp('ON'):ab('OFF'))+ab('  Auto-Scan: ')+(autoScan?kp('ON'):ab('OFF')));

  // ── State ───────────────────────────────────────────────────────────────────
  let messages  =[];
  let totalTok  =0;
  let lastReply ='';
  let mlBuf     ='';
  let msgN      =0;
  const t0      =Date.now();

  // NOTE: memCtx and skillsCtx are intentionally computed INSIDE buildSystemPrompt
  // so that newly saved memory facts and freshly installed skills are reflected in
  // every subsequent API call without needing a restart.
  function buildSystemPrompt() {
    const base=MODES[mode]?.prompt||MODES.code.prompt;
    const parts=[base];
    const currentMemCtx   =buildMemoryContext(mem,CWD());
    const currentSkillsCtx=buildSkillsContext(skills);
    if (currentMemCtx)   parts.push('\n---\n'+currentMemCtx);
    if (folderCtx)       parts.push('\n---\n'+folderCtx);
    if (currentSkillsCtx)parts.push('\n---\n'+currentSkillsCtx);
    return parts.join('\n');
  }

  const allMs=()=>[{role:'system',content:buildSystemPrompt()},...messages];
  const modeS=()=>{ const m=MODES[mode]; return m.colorFn(m.icon+' '+m.name); };

  // ── Welcome ─────────────────────────────────────────────────────────────────
  console.log('');
  const DW=Math.min((process.stdout.columns||80)-2,72);
  console.log('  '+ab('─'.repeat(DW)));
  console.log('  '+ab('Mode: ')+modeS()+'  '+ab('│  cwd: ')+tl(CWD()));
  console.log('  '+ab('Type ')+sd('/help')+ab(' · ')+sd('!cmd')+ab(' runs shell · ')+sd('/skill install <n>')+ab(' for skills · ')+sd('/memory')+ab(' to view memory'));
  console.log('');

  const prompt=()=>process.stdout.write(renderPS1(msgN,CWD(),mode,MODES));
  prompt();

  // ── Input Loop ──────────────────────────────────────────────────────────────
  // Queue ensures pasted multi-line input is processed one line at a time,
  // preventing async handler race conditions (the "3000/scan" class of bug).
  const _inputQueue = [];
  let _inputBusy = false;
  async function _processQueue() {
    if (_inputBusy) return;
    while (_inputQueue.length) {
      _inputBusy = true;
      const raw = _inputQueue.shift();
      try {
        await _handleLine(raw);
      } catch(e) {
        console.log('\n  '+dg('✘ Input error: ')+e.message);
      } finally {
        _inputBusy = false;
      }
    }
  }
  rl.on('line', raw => { _inputQueue.push(raw); _processQueue(); });
  async function _handleLine(raw) {
    let text=raw.trim();

    // Multi-line
    if (text.endsWith('\\')){  mlBuf+=text.slice(0,-1)+'\n'; process.stdout.write(ab('... ')); return; }
    if (mlBuf){ text=mlBuf+text; mlBuf=''; }
    if (!text){ prompt(); return; }

    // ── !shell passthrough ──────────────────────────────────────────────────
    if (text.startsWith('!')) {
      const cmd=text.slice(1).trim();
      if (!cmd){ prompt(); return; }
      // Fix 5: detect Unix-only commands on Windows and give a helpful message
      if (process.platform==='win32') {
        const UNIX_ONLY=[
          { pat:/^\s*ps\s+(aux|aux\b|-ef|-e)/, hint:'Use: tasklist' },
          { pat:/^\s*kill\s+%\d+/,             hint:'Use: taskkill /F /IM node.exe  (or Stop-Process in PowerShell)' },
          { pat:/^\s*(pkill|killall)\s/,        hint:'Use: taskkill /F /IM <processname>.exe' },
          { pat:/^\s*which\s/,                  hint:'Use: where <command>' },
          { pat:/^\s*grep\s/,                   hint:'Use: findstr "<pattern>" <file>  (or pipe to findstr)' },
          { pat:/^\s*cat\s/,                    hint:'Use: type <file>' },
        ];
        const match=UNIX_ONLY.find(r=>r.pat.test(cmd));
        if (match) {
          console.log('\n  '+rf('⚠ Windows: ')+ab('"'+cmd.trim().split(/\s/)[0]+'" is a Unix command and won\'t work here.'));
          console.log('  '+ab('  Hint → ')+sd(match.hint));
          prompt(); return;
        }
      }
      console.log('\n  '+ab('$ ')+sd(cmd));
      const res=await runShell(cmd);
      const TW2=Math.min((process.stdout.columns||80)-4,100);
      console.log('  '+ab('╭─ output '+'─'.repeat(TW2-10)));
      const lines=[...res.stdout.split('\n'),...(res.stderr?res.stderr.split('\n').map(l=>dg(l)):[])]
        .filter(l=>l!==undefined);
      if (!res.stdout&&!res.stderr) lines.push(dm('(no output)'));
      lines.filter(Boolean).forEach(l=>console.log('  '+ab('│ ')+l));
      console.log('  '+ab('╰─ exit ')+(res.code===0?kp(String(res.code)):dg(String(res.code))));
      prompt(); return;
    }

    // ── /exit ────────────────────────────────────────────────────────────────
    if (['/exit','/quit','/q'].includes(text)) {
      const up=Math.round((Date.now()-t0)/1000);
      if (messages.length>2) {
        const summary=messages.filter(m=>m.role==='user').slice(-5).map(m=>m.content.slice(0,100)).join(' | ');
        mem.sessionSummaries=[...(mem.sessionSummaries||[]).slice(-9),{date:new Date().toISOString(),summary,msgCount:msgN}];
        saveMemory(mem);
      }
      console.log('\n  '+cr('🐋 Goodbye!')+ab('  '+msgN+' msgs · '+totalTok.toLocaleString()+' tokens · '+Math.floor(up/60)+'m '+(up%60)+'s'));
      console.log(''); rl.close(); process.exit(0);
    }

    // ── /help ────────────────────────────────────────────────────────────────
    if (text==='/help') {
      console.log('');
      console.log('  '+cr(C.bold+'whyWhale v'+VERSION)+C.reset+'  '+ab(prov.name+' · '+(modelMeta.label||modelMeta.id)));
      const sections={
        'CHAT & MODES': [
          ['/help','This help'],
          ['/clear','Clear conversation history'],
          ['/mode [name]','Switch AI mode: '+Object.keys(MODES).join(' · ')],
          ['/model [n]','Show or switch model'],
          ['/provider','Switch AI provider'],
          ['/stats','Session statistics'],
          ['/tokens','Show token usage'],
          ['/system','Show current system prompt'],
          ['/copy','Copy last AI reply to clipboard'],
          ['!<command>','Run any shell command (e.g. !ls, !git status, !npm install)'],
        ],
        'FILES & PROJECT': [
          ['/ls [path]','List files in directory'],
          ['/tree [depth]','Directory tree (default depth 3)'],
          ['/read <path>','Read file and show with syntax highlighting'],
          ['/analyse <path>','Deep AI analysis of a file'],
          ['/write <path>','AI-generate content for a file'],
          ['/create <path>','Create empty file'],
          ['/delete <path>','Delete file (asks confirmation)'],
          ['/rename <a> <b>','Rename or move a file'],
          ['/scan','Re-scan current directory into AI context'],
          ['/run <cmd>','Run a shell command and show output'],
        ],
        'MEMORY': [
          ['/memory','Show all persistent memory facts'],
          ['/memory set <key> <val>','Set a memory fact manually'],
          ['/memory clear','Clear all memory'],
        ],
        'SKILLS': [
          ['/skill list','Show available & installed skills'],
          ['/skill install <n>','Install a skill (react, python, security, testing, api-design, docker, database, git, performance, typescript)'],
          ['/skill remove <n>','Remove an installed skill'],
          ['/skill show <n>','Show skill prompt details'],
        ],
        'SESSION': [
          ['/save [name]','Save conversation to ~/.whywhale_sessions/'],
          ['/load','Restore a saved session'],
          ['/export','Export chat as Markdown file'],
          ['/autotest','Toggle auto self-testing (currently: '+(autoTest?'ON':'OFF')+')'],
          ['/autoscan','Toggle auto folder scan (currently: '+(autoScan?'ON':'OFF')+')'],
          ['/dashboard','Open web dashboard at http://localhost:7070'],
          ['/reset','Wipe all config'],
          ['/exit','Quit'],
        ],
      };
      Object.entries(sections).forEach(([sec,cmds])=>{
        console.log('\n  '+tl(sec));
        cmds.forEach(([c,d])=>console.log('  '+cr(c.padEnd(24))+ab(d)));
      });
      console.log('');
      console.log('  '+ab('Tip: End any line with \\\\ for multi-line input'));
      console.log('  '+ab('Tip: In ')+vt('agent')+ab(' mode, AI creates and fixes files automatically'));
      console.log('  '+ab('Tip: ')+sd('@@MEMORY: key: value')+ab(' in AI responses saves info between sessions'));
      prompt(); return;
    }

    // ── /clear ───────────────────────────────────────────────────────────────
    if (text==='/clear') {
      messages=[]; msgN=0; totalTok=0;
      console.clear(); printBanner(VERSION);
      console.log('  '+kp('✔ Cleared')+ab('  Mode: ')+modeS()+ab('  cwd: ')+tl(CWD()));
      prompt(); return;
    }

    // ── /stats ───────────────────────────────────────────────────────────────
    if (text==='/stats') {
      const up=Math.round((Date.now()-t0)/1000);
      console.log('\n  '+cr(C.bold+'Session Statistics'));
      [
        ['Provider',   prov.name],
        ['Model',      modelMeta.label||modelMeta.id],
        ['Mode',       MODES[mode].name],
        ['Working Dir',CWD()],
        ['Messages',   String(msgN)],
        ['Tokens Used',totalTok.toLocaleString()],
        ['Memory Facts',String(mem.facts.length)],
        ['Past Sessions',String(mem.sessionSummaries?.length||0)],
        ['Skills',     skills.length?skills.map(s=>s.name).join(', '):'none'],
        ['Auto-Test',  autoTest?'ON':'OFF'],
        ['Auto-Scan',  autoScan?'ON':'OFF'],
        ['Uptime',     Math.floor(up/60)+'m '+(up%60)+'s'],
      ].forEach(([k,v])=>console.log('  '+ab(k.padEnd(14)+' › ')+sd(v)));
      prompt(); return;
    }

    if (text==='/tokens') { console.log('\n  '+ab('Tokens: ')+cr(totalTok.toLocaleString())+ab('  Msgs: ')+sd(String(msgN))); prompt(); return; }
    if (text==='/system') { console.log('\n  '+ab('System prompt ('+mode+'):')+'  '); buildSystemPrompt().split('\n').forEach(l=>console.log('  '+dm(l))); prompt(); return; }
    if (text==='/copy')   { if (!lastReply){console.log('\n  '+dg('No response yet.'));} else console.log('\n  '+(copyClip(lastReply)?kp('✔ Copied!'):dg('✘ Clipboard unavailable.'))); prompt(); return; }
    if (text==='/reset')  { if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH); console.log('\n  '+kp('✔ Config wiped. Restart to reconfigure.')); rl.close(); process.exit(0); }
    if (text==='/autotest')  { autoTest=!autoTest; saveConfig({provider:providerKey,apiKey,model:modelId,mode,autoTest,autoScan}); console.log('\n  '+ab('Auto-Test: ')+(autoTest?kp('ON'):ab('OFF'))); prompt(); return; }
    if (text==='/autoscan')  { autoScan=!autoScan; saveConfig({provider:providerKey,apiKey,model:modelId,mode,autoTest,autoScan}); console.log('\n  '+ab('Auto-Scan: ')+(autoScan?kp('ON'):ab('OFF'))); prompt(); return; }

    // ── /scan ────────────────────────────────────────────────────────────────
    if (text==='/scan') {
      const sp=spinner('Scanning directory...');
      const files=scanFolder(CWD(),8);
      sp(); folderCtx=buildFolderContext(files,CWD());
      console.log('\n  '+tl('✔ Scanned: ')+sd(files.length+' files'));
      files.forEach(f=>console.log('  '+ab('  → ')+sd(f.path)+ab(' ('+formatSize(f.size)+')')));
      prompt(); return;
    }

    // ── /mode ────────────────────────────────────────────────────────────────
    if (text.startsWith('/mode')) {
      // Strip any invisible Unicode chars Windows terminals inject into pasted text
      const arg=text.split(/\s+/)[1]?.toLowerCase().replace(/[^a-z]/g,'');
      const validModes=Object.keys(MODES);
      if (!arg) {
        console.log('');
        Object.entries(MODES).forEach(([k,v])=>console.log('  '+v.colorFn(v.icon+' '+v.name.padEnd(12))+ab('/mode '+k)+(k===mode?cr(' ◀ current'):'')));
      } else if (validModes.includes(arg)) {
        mode=arg; saveConfig({provider:providerKey,apiKey,model:modelId,mode,autoTest,autoScan});
        console.log('\n  '+kp('✔ Mode → ')+MODES[arg].colorFn(MODES[arg].icon+' '+MODES[arg].name));
        if (arg==='agent') console.log('  '+vt('Agent mode: ')+ab('AI will autonomously create and fix files'));
      } else { console.log('\n  '+dg('Unknown mode. Options: ')+validModes.join(' · ')); }
      prompt(); return;
    }

    // ── /model ───────────────────────────────────────────────────────────────
    if (text.startsWith('/model')) {
      const arg=text.split(/\s+/)[1];
      if (!arg) {
        console.log('\n  '+ab('Current: ')+wh(modelMeta.label||modelMeta.id));
        availModels.forEach((m,i)=>console.log('  '+ab('['+(i+1)+']')+' '+sd(m.label||m.id)+(m.free?' '+kp('FREE'):'')+(m.id===modelId?cr(' ◀'):'')));
        console.log('\n  '+ab('Type /model <n> to switch.'));
      } else {
        const idx=parseInt(arg)-1, sel=availModels[idx];
        if (!sel) console.log('\n  '+dg('Invalid.'));
        else { modelId=sel.id; saveConfig({provider:providerKey,apiKey,model:modelId,mode,autoTest,autoScan}); console.log('\n  '+kp('✔ Model → ')+wh(sel.label||sel.id)); }
      }
      prompt(); return;
    }

    // ── /provider ────────────────────────────────────────────────────────────
    if (text==='/provider') {
      console.log('\n  '+wh('[1]')+' Anthropic (Claude)'+(providerKey==='anthropic'?cr(' ◀'):''));
      console.log('  '+cr('[2]')+' OpenRouter'+(providerKey==='openrouter'?cr(' ◀'):''));
      console.log('  '+rf('[3]')+' Groq'+(providerKey==='groq'?rf(' ◀'):''));
      const olOk=await ollamaAvailable();
      console.log('  '+kp('[4]')+' Ollama'+(providerKey==='ollama'?kp(' ◀'):'')+' '+(olOk?kp('● running'):ab('○ not running')));
      const ch=await ask(cr('\n  ❯ ')+ab('Switch [1-4] or Enter to cancel: '));
      const pk={1:'anthropic',2:'openrouter',3:'groq',4:'ollama'}[ch.trim()];
      if (pk) {
        if (pk==='ollama'&&!olOk){console.log('\n  '+dg('Ollama not running: ollama serve')); prompt(); return;}
        providerKey=pk; modelId=null;
        saveConfig({provider:providerKey,apiKey,model:'',mode,autoTest,autoScan});
        console.log('\n  '+kp('✔ Switched. Restart whywhale to apply.'));
      }
      prompt(); return;
    }

    // ── /memory ──────────────────────────────────────────────────────────────
    if (text.startsWith('/memory')) {
      const arg=text.slice(7).trim();
      if (!arg||arg==='show') {
        if (!mem.facts.length) console.log('\n  '+ab('No memory stored yet. The AI saves facts with @@MEMORY: key: value'));
        else {
          console.log('\n  '+vt(C.bold+'Persistent Memory')+ab(' ('+mem.facts.length+' facts)'));
          mem.facts.forEach(f=>console.log('  '+vt(f.key.padEnd(22))+ab('→ ')+sd(f.value)));
        }
        if (mem.sessionSummaries?.length) {
          console.log('\n  '+ab('Past sessions: '+mem.sessionSummaries.length));
          mem.sessionSummaries.slice(-3).forEach(s=>console.log('  '+ab('  '+s.date.slice(0,10)+' · ')+dm(s.summary?.slice(0,80)||'')));
        }
      } else if (arg==='clear') {
        mem.facts=[]; mem.sessionSummaries=[]; saveMemory(mem);
        console.log('\n  '+kp('✔ Memory cleared.'));
      } else if (arg.startsWith('set ')) {
        // Split on whitespace — first token is the key, rest is the value.
        // Take only the first line of the value in case pasted input leaked in.
        const parts=arg.slice(4).trim().split(/\s+/);
        const key=parts[0].replace(/:$/, '');
        const val=parts.slice(1).join(' ').split(/\r?\n/)[0].trim();
        if (key&&val) {
          updateMemory(mem,[{key,value:val}]); saveMemory(mem);
          console.log('\n  '+kp('✔ Memory saved: ')+sd(key+' → '+val));
        } else {
          console.log('\n  '+dg('Usage: /memory set <key> <value>'));
        }
      }
      prompt(); return;
    }

    // ── /skill ───────────────────────────────────────────────────────────────
    if (text.startsWith('/skill')) {
      const args=text.slice(6).trim().split(/\s+/);
      const sub=args[0];
      if (!sub||sub==='list') {
        console.log('\n  '+rf(C.bold+'Skill Registry'));
        Object.entries(SKILL_REGISTRY).forEach(([k,s])=>{
          const inst=skills.find(sk=>sk.name===s.name);
          console.log('  '+rf(k.padEnd(14))+sd(s.description.padEnd(50))+(inst?kp(' ✔ installed'):''));
        });
        if (skills.length) {
          console.log('\n  '+rf(C.bold+'Installed Skills'));
          skills.forEach(s=>console.log('  '+kp('✔ ')+sd(s.name)+ab(' — '+s.description)));
        }
        console.log('\n  '+ab('Install with: ')+sd('/skill install react')+ab(' (or any name above)'));
      } else if (sub==='install') {
        const sn=args[1]?.toLowerCase();
        if (!sn){console.log('\n  '+dg('Usage: /skill install <n>')); prompt(); return;}
        const reg=SKILL_REGISTRY[sn];
        if (!reg){console.log('\n  '+dg('Unknown. Available: ')+Object.keys(SKILL_REGISTRY).join(', ')); prompt(); return;}
        if (skills.find(s=>s.name===reg.name)){console.log('\n  '+kp('Already installed: ')+sd(reg.name)); prompt(); return;}
        saveSkill(reg); skills.push(reg);
        console.log('\n  '+kp('✔ Installed: ')+sd(reg.name)+ab(' — now active in all AI responses'));
      } else if (sub==='remove') {
        const sn=args[1];
        const idx=skills.findIndex(s=>s.name.toLowerCase()===sn?.toLowerCase());
        if (idx<0){console.log('\n  '+dg('Skill not found: '+sn)); prompt(); return;}
        try { fs.unlinkSync(path.join(SKILLS_DIR,skills[idx].name.toLowerCase().replace(/\s+/g,'_')+'.json')); } catch(_){}
        skills.splice(idx,1);
        console.log('\n  '+kp('✔ Removed: ')+sd(sn));
      } else if (sub==='show') {
        const sn=args[1];
        const sk=skills.find(s=>s.name.toLowerCase()===sn?.toLowerCase())||SKILL_REGISTRY[sn?.toLowerCase()];
        if (!sk){console.log('\n  '+dg('Skill not found.')); prompt(); return;}
        console.log('\n  '+rf(C.bold+sk.name));
        console.log('  '+ab(sk.description));
        console.log('\n'+formatMD('```\n'+sk.prompt+'\n```'));
      }
      prompt(); return;
    }

    // ── /save / /load / /export ──────────────────────────────────────────────
    if (text.startsWith('/save')) {
      console.log('\n  '+kp('✔ Saved → ')+ab(saveSession(messages,text.split(/\s+/)[1]||null)));
      prompt(); return;
    }
    if (text==='/load') {
      const sessions=listSessions();
      if (!sessions.length){console.log('\n  '+ab('No saved sessions.')); prompt(); return;}
      sessions.forEach((s,i)=>console.log('  '+ab('['+(i+1)+']')+' '+sd(s.name)+'  '+ab(new Date(s.saved).toLocaleString()+' · '+s.count+' msgs')));
      const ch=await ask(cr('\n  ❯ ')+ab('Load [n] or Enter to cancel: '));
      const idx=parseInt(ch.trim())-1;
      if (!isNaN(idx)&&sessions[idx]){messages=sessions[idx].messages;msgN=messages.filter(m=>m.role==='user').length;console.log('\n  '+kp('✔ Loaded: ')+sd(sessions[idx].name)+ab(' ('+msgN+' msgs)'));}
      prompt(); return;
    }
    if (text==='/export') {
      const exportMsgs = messages.filter(m => m.role !== 'system');
      const timestamp  = new Date().toLocaleString();
      const modelLabel = modelMeta?.label || modelMeta?.id || '—';

      const bubblesHtml = exportMsgs.map(m => {
        const isUser    = m.role === 'user';
        const rowClass  = isUser ? 'bubble-row user' : 'bubble-row';
        const bubClass  = isUser ? 'bubble bubble-user' : 'bubble bubble-ai';
        const nameClass = isUser ? 'name-user' : 'name-ai';
        const name      = isUser ? 'You' : '🐋 whyWhale';
        const avatarCls = isUser ? 'avatar avatar-user' : 'avatar avatar-ai';
        // Escape for embedding in a JS template-literal data attribute
        const escaped   = m.content
          .replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
        return `\n  <div class="${rowClass}">\n    <div class="${avatarCls}">${isUser?'U':'🐋'}</div>\n    <div class="${bubClass}">\n      <div class="bubble-name ${nameClass}">${name}</div>\n      <div class="bubble-md" data-raw="\`${escaped}\`"></div>\n    </div>\n  </div>`;
      }).join('\n');

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🐋 whyWhale Export</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"><\\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\\/script>
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
.bubble-md h1,.bubble-md h2,.bubble-md h3{color:var(--white);margin:10px 0 6px}
.bubble-md h1{font-size:16px;border-bottom:1px solid var(--border);padding-bottom:4px}
.bubble-md p{margin-bottom:8px}.bubble-md p:last-child{margin-bottom:0}
.bubble-md ul,.bubble-md ol{padding-left:20px;margin-bottom:8px}
.bubble-md code{background:#0d1117;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-family:monospace;font-size:12px;color:var(--coral)}
.bubble-md pre{background:#0d1117;border:1px solid var(--border);border-radius:8px;overflow-x:auto;margin:8px 0}
.bubble-md pre code{background:none;border:none;padding:12px 14px;display:block;font-size:12px;line-height:1.55;color:var(--text)}
.bubble-md blockquote{border-left:3px solid var(--whale);padding-left:12px;color:var(--muted);margin:6px 0}
.bubble-md strong{color:var(--white)}.bubble-md em{color:var(--reef)}
.bubble-md a{color:var(--teal)}.bubble-md hr{border:none;border-top:1px solid var(--border);margin:10px 0}
.bubble-md table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}
.bubble-md th{background:#0d1117;color:var(--whale);padding:6px 10px;border:1px solid var(--border);text-align:left}
.bubble-md td{padding:5px 10px;border:1px solid var(--border)}
@media(max-width:600px){.bubble{max-width:90%}}
<\\/style>
<\\/head>
<body>
<div class="header">
  <span style="font-size:20px">🐋<\\/span>
  <h1>whyWhale Chat Export<\\/h1>
  <div class="meta">${timestamp} &nbsp;·&nbsp; ${modelLabel} &nbsp;·&nbsp; ${exportMsgs.length} messages<\\/div>
<\\/div>
<div class="chat-wrap">
${bubblesHtml}
<\\/div>
<script>
marked.setOptions({breaks:true,gfm:true,highlight:(c,l)=>{if(l&&hljs.getLanguage(l)){try{return hljs.highlight(c,{language:l}).value;}catch(_){}}return hljs.highlightAuto(c).value;}});
document.querySelectorAll('.bubble-md[data-raw]').forEach(el=>{
  const raw=eval(el.getAttribute('data-raw'));
  el.innerHTML=marked.parse(raw);
  el.querySelectorAll('pre code:not(.hljs)').forEach(b=>hljs.highlightElement(b));
  el.removeAttribute('data-raw');
});
<\\/script>
<\\/body>
<\\/html>`;

      const fp = path.join(HOME_DIR, 'whywhale_export_' + Date.now() + '.html');
      fs.writeFileSync(fp, html, 'utf8');
      console.log('\n  '+kp('✔ Exported → ')+ab(fp));
      console.log('  '+tl('  Open in any browser to view the styled bubble chat'));
      prompt(); return;
    }

    // ── FILE COMMANDS ─────────────────────────────────────────────────────────
    if (text.startsWith('/ls')) {
      const arg=text.slice(3).trim()||'.';
      try {
        const entries=lsDir(arg);
        const relBase=path.resolve(CWD(),arg);
        console.log('\n  '+tl(path.relative(CWD(),relBase)||'.')+'  '+ab('('+entries.length+' items)'));
        console.log('');
        entries.forEach(e=>{
          const col=e.isDir?wh:sd;
          console.log('  '+(e.isDir?wh('▸ '):ab('  '))+col(e.name+(e.isDir?'/':''))+(e.size!=null?ab('  '+formatSize(e.size)):''));
        });
      } catch(err){console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/tree')) {
      const depth=parseInt(text.split(/\s+/)[1])||3;
      console.log('\n  '+tl(CWD()));
      console.log(treeDir(CWD(),'  ',0,depth));
      prompt(); return;
    }
    if (text.startsWith('/read ')) {
      const fp=text.slice(6).trim().replace(/^["']|["']$/g,'');
      // Try the given path, then src/<path>, then lib/<path> before giving up
      const rdCandidates=[fp, path.join('src',fp), path.join('lib',fp)];
      let rdResolved=null;
      for (const c of rdCandidates) { try { readFileSafe(c); rdResolved=c; break; } catch(_){} }
      if (!rdResolved) {
        console.log('\n  '+dg('✘ File not found: ')+sd(fp));
        console.log('  '+ab('  Hint: use /ls to browse files'));
        prompt(); return;
      }
      try {
        const file=readFileSafe(rdResolved);
        console.log('\n  '+kp('✔ ')+sd(file.name)+ab(' ('+formatSize(file.size)+' · '+file.content.split('\n').length+' lines)'));
        console.log(formatMD('```'+file.ext+'\n'+file.content.slice(0,3000)+(file.content.length>3000?'\n... (truncated)':'')+'\n```'));
      } catch(err){console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/create ')) {
      const fp=text.slice(8).trim().replace(/^["']|["']$/g,'');
      try {
        const full=safePath(fp); ensureDirForFile(full);
        if (fs.existsSync(full)) console.log('\n  '+rf('Already exists: ')+sd(fp)+ab(' — use /analyse or ask AI to modify it'));
        else { fs.writeFileSync(full,'','utf8'); console.log('\n  '+kp('✔ Created: ')+sd(fp)); }
      } catch(err){console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/delete ')) {
      const fp=text.slice(8).trim().replace(/^["']|["']$/g,'');
      try {
        const full=safePath(fp);
        if (!fs.existsSync(full)){console.log('\n  '+dg('Not found: '+fp)); prompt(); return;}
        const conf=await ask('\n  '+dg('Delete ')+sd(fp)+dg('? (yes/no): '));
        if (conf.trim().toLowerCase()==='yes'){fs.rmSync(full,{recursive:true}); console.log('  '+kp('✔ Deleted: ')+ab(fp));}
        else console.log('  '+ab('Cancelled.'));
      } catch(err){console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/rename ')) {
      const parts=text.slice(8).trim().split(/\s+/);
      if (parts.length<2){console.log('\n  '+dg('Usage: /rename <old> <new>')); prompt(); return;}
      try {
        const from=safePath(parts[0]),to=safePath(parts[1]);
        if (!fs.existsSync(from)){console.log('\n  '+dg('Not found: '+parts[0])); prompt(); return;}
        ensureDirForFile(to); fs.renameSync(from,to);
        console.log('\n  '+kp('✔ Renamed: ')+sd(parts[0])+ab(' → ')+sd(parts[1]));
      } catch(err){console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/analyse ')||text.startsWith('/analyze ')) {
      const fp=text.replace(/^\/analy[sz]e\s+/,'').trim().replace(/^["']|["']$/g,'');
      // Try the given path, then src/<path>, then lib/<path> before giving up
      let resolvedFp = fp;
      const candidates = [fp, path.join('src', fp), path.join('lib', fp)];
      let fileFound = false;
      for (const candidate of candidates) {
        try {
          readFileSafe(candidate); // test-read — throws if missing
          resolvedFp = candidate;
          fileFound = true;
          break;
        } catch(_) {}
      }
      if (!fileFound) {
        console.log('\n  '+dg('✘ File not found: ')+sd(fp));
        console.log('  '+ab('  Hint: use the full path, e.g. ')+sd('src/'+fp)+ab(' or /ls to browse'));
        prompt(); return;
      }
      try {
        const file=readFileSafe(resolvedFp);
        const kb=(file.size/1024).toFixed(1);
        console.log('\n  '+kp('Analysing: ')+sd(file.name)+ab(' ('+kb+'KB)'));
        const userMsg=`Analyse this file in detail:\n\nFile: ${resolvedFp} | Extension: .${file.ext} | Size: ${kb}KB | Lines: ${file.content.split('\n').length}\n\n\`\`\`${file.ext}\n${file.content}\n\`\`\`\n\nProvide: purpose, architecture, quality assessment (1-10), issues found, and improvement suggestions.`;
        messages.push({role:'user',content:userMsg}); msgN++;
        console.log('');
        const sp=spinner('Analysing '+file.name+'...');
        const t1=Date.now();
        const data=await callAI(providerKey,apiKey,modelId,allMs());
        sp();
        const reply=data.choices[0].message.content;
        messages.push({role:'assistant',content:reply}); lastReply=reply;
        if (data.usage) totalTok+=data.usage.total_tokens||0;
        const blocks=parseFileBlocks(reply);
        if (blocks.length) {
          console.log('\n  '+vt('AI wants to modify '+blocks.length+' file(s):'));
          blocks.forEach(bk=>console.log('  '+ab('  → ')+sd(bk.relPath)));
          const conf=await ask(cr('\n  ❯ ')+ab('Apply files? [Y/n]: '));
          const ans2=conf.trim().toLowerCase();
          if (ans2===''||ans2==='y'||ans2==='yes') printFileResults(applyFileBlocks(blocks));
          else console.log('  '+ab('Skipped.'));
        }
        const memBlocks=parseMemoryBlocks(reply);
        if (memBlocks.length){updateMemory(mem,memBlocks);saveMemory(mem);}
        console.log('\n  '+wh('🐋 whyWhale')+'  '+ab(((Date.now()-t1)/1000).toFixed(1)+'s · '+totalTok.toLocaleString()+' tokens'));
        console.log('');
        console.log(formatMD(stripFileBlocks(reply)));
      } catch(err){console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/write ')) {
      const fp=text.slice(7).trim().replace(/^["']|["']$/g,'');
      const what=await ask(cr('  ❯ ')+ab('Describe what to write into '+fp+': '));
      messages.push({role:'user',content:'Write complete content for `'+fp+'`.\n'+what+'\nOutput using @@FILE/@@END format.'}); msgN++;
      console.log('');
      const sp=spinner('Generating '+fp+'...');
      const t1=Date.now();
      try {
        const data=await callAI(providerKey,apiKey,modelId,allMs());
        sp();
        const reply=data.choices[0].message.content;
        messages.push({role:'assistant',content:reply}); lastReply=reply;
        if (data.usage) totalTok+=data.usage.total_tokens||0;
        const blocks=parseFileBlocks(reply);
        let applied=[];
        if (blocks.length) {
          applied=applyFileBlocks(blocks);
          printFileResults(applied);
          if (autoTest) {
            const tr=await selfTestLoop(providerKey,apiKey,modelId,messages,applied,3);
            if (tr.tested) console.log('\n  '+(tr.passed?kp('✔ Self-Test PASSED'):dg('✘ Self-Test FAILED after '+tr.iterations+' attempts')));
          }
        }
        console.log('\n  '+wh('🐋 whyWhale')+'  '+ab(((Date.now()-t1)/1000).toFixed(1)+'s · '+totalTok.toLocaleString()+' tokens'));
        console.log(''); console.log(formatMD(stripFileBlocks(reply)));
      } catch(err){sp();console.log('\n  '+dg('✘ '+err.message));}
      prompt(); return;
    }
    if (text.startsWith('/run')) {
      const cmd=text.slice(4).trim();
      if (!cmd){console.log('\n  '+dg('Usage: /run <command>  or  !<command>'));}
      else {
        const res=await runShell(cmd);
        const TW2=Math.min((process.stdout.columns||80)-4,100);
        console.log('\n  '+ab('╭─ ')+sd(cmd)+ab(' '+'─'.repeat(Math.max(0,TW2-cmd.length-4))));
        [...res.stdout.split('\n'),...(res.stderr?res.stderr.split('\n').map(l=>dg(l)):[])].filter(Boolean).forEach(l=>console.log('  '+ab('│ ')+l));
        if (!res.stdout&&!res.stderr) console.log('  '+ab('│ ')+dm('(no output)'));
        console.log('  '+ab('╰─ exit ')+(res.code===0?kp(String(res.code)):dg(String(res.code))));
      }
      prompt(); return;
    }

    // ── /dashboard ───────────────────────────────────────────────────────────
    if (text.startsWith('/dashboard')) {
      const portArg=parseInt(text.split(/\s+/)[1])||7070;
      statusRef.mode=mode; statusRef.model=modelId||''; statusRef.msgCount=msgN;
      startDashboard(portArg, null, mem, messages, statusRef, VERSION);
      prompt(); return;
    }

    // ── AUTO MODE + SKILL DETECTION ──────────────────────────────────────────
    // Analyse the user's message before sending to AI.
    // If it clearly signals a different mode or missing skills, switch/install
    // automatically and announce what changed.
    {
      const t = text.toLowerCase();

      // ── Mode detection rules ────────────────────────────────────────────────
      // Each entry: { patterns, mode, reason }
      // First match wins. Only switches if current mode differs.
      const MODE_RULES = [
        {
          mode: 'agent',
          reason: 'autonomous file creation detected',
          patterns: [
            /\b(build|create|generate|scaffold|write|make|implement|set up)\b.{0,60}\b(full|complete|entire|whole|all)\b/,
            /\b(build|create|generate)\b.{0,80}\b(app|application|project|api|server|cli|tool|system)\b/,
            /\b(multi.?file|multiple files|several files)\b/,
            /@@file:/i,
            /\bauto(matically)?\s+(fix|create|write|build)\b/,
          ],
        },
        {
          mode: 'debug',
          reason: 'debugging intent detected',
          patterns: [
            /\b(fix|debug|broken|error|crash|failing|not working|doesn'?t work|bug|issue|problem|exception|traceback|stack ?trace)\b/,
            /\bwhy (is|does|won'?t|can'?t|isn'?t)\b.{0,60}\b(work|run|start|connect|return|fail)\b/,
            /\bgetting (an? )?(error|exception|crash|warning)\b/,
          ],
        },
        {
          mode: 'review',
          reason: 'code review intent detected',
          patterns: [
            /\b(review|audit|check|critique|evaluate|rate|assess|feedback on)\b.{0,60}\b(code|file|function|class|module|script|server\.js|client\.js)\b/,
            /\bhow (good|clean|solid|well.?written) is\b/,
            /\brate (it|this|my code)\b/,
          ],
        },
        {
          mode: 'architect',
          reason: 'system design intent detected',
          patterns: [
            /\b(design|architect|plan|structure|diagram|scalab|system design)\b.{0,80}\b(api|service|system|architecture|database|infra|backend|microservice)\b/,
            /\bhow (should|would|do) (i|we|you) (structure|design|scale|organise|organize)\b/,
            /\b(draw|sketch|map out|lay out).{0,40}\b(architecture|system|flow|diagram)\b/,
          ],
        },
        {
          mode: 'explain',
          reason: 'explanation intent detected',
          patterns: [
            /\b(explain|teach|help me understand|what is|what are|how does|how do|walk me through|eli5|break.?down)\b/,
            /\b(for a (junior|beginner|newbie)|like (i'?m|i am) (5|new|a beginner))\b/,
            /\bwhat.{0,20}(mean|difference between|better than)\b/,
          ],
        },
        {
          mode: 'code',
          reason: 'coding task detected',
          patterns: [
            /\b(write|add|implement|code|function|endpoint|route|method|class|module|script)\b/,
            /\b(refactor|optimise|optimize|improve|update|modify|change|edit)\b.{0,40}\b(code|function|file|class|module)\b/,
          ],
        },
      ];

      let detectedMode = null;
      let modeReason   = '';
      for (const rule of MODE_RULES) {
        if (rule.mode === mode) continue; // already in this mode
        if (rule.patterns.some(p => p.test(t))) {
          detectedMode = rule.mode;
          modeReason   = rule.reason;
          break;
        }
      }

      // ── Skill detection rules ───────────────────────────────────────────────
      // Each entry: { skillKey, patterns }
      const SKILL_RULES = [
        { key:'react',        patterns:[/\breact\b/, /\bjsx\b/, /\bhooks?\b/, /\busestate\b/, /\buseeffect\b/, /\bcomponent\b/] },
        { key:'typescript',   patterns:[/\btypescript\b/, /\b\.tsx?\b/, /\btype.?hints?\b/, /\binterface\b.*\btype\b/] },
        { key:'testing',      patterns:[/\b(test|tests|testing|spec|jest|mocha|vitest|unit test|integration test|e2e)\b/] },
        { key:'security',     patterns:[/\b(security|auth|jwt|oauth|xss|sql.?inject|csrf|sanitize|encrypt|hash|bcrypt)\b/] },
        { key:'docker',       patterns:[/\b(docker|container|dockerfile|compose|k8s|kubernetes|image|pod)\b/] },
        { key:'database',     patterns:[/\b(database|postgres|mysql|mongodb|sqlite|sequelize|prisma|orm|schema|migration|sql)\b/] },
        { key:'api-design',   patterns:[/\b(rest|api|endpoint|openapi|swagger|graphql|grpc|rate.?limit|versioning)\b/] },
        { key:'python',       patterns:[/\bpython\b/, /\bpip\b/, /\bdjango\b/, /\bflask\b/, /\bfastapi\b/, /\b\.py\b/] },
        { key:'performance',  patterns:[/\b(perf|performance|optim|speed|slow|latency|cache|memo|profil|bundle.?size)\b/] },
        { key:'git',          patterns:[/\b(git|commit|branch|merge|pr|pull.?request|ci\/cd|pipeline|workflow)\b/] },
      ];

      const skillsToInstall = [];
      for (const rule of SKILL_RULES) {
        // Only suggest if not already installed
        if (skills.find(s => s.name.toLowerCase() === (SKILL_REGISTRY[rule.key]?.name||'').toLowerCase())) continue;
        if (rule.patterns.some(p => p.test(t))) {
          const reg = SKILL_REGISTRY[rule.key];
          if (reg) skillsToInstall.push({ key: rule.key, reg });
        }
      }

      // ── Apply detected changes and announce them ────────────────────────────
      const changes = [];

      if (detectedMode) {
        mode = detectedMode;
        saveConfig({provider:providerKey,apiKey,model:modelId,mode,autoTest,autoScan});
        statusRef.mode = mode;
        changes.push(MODES[mode].colorFn('⟳ Auto-switched to '+MODES[mode].icon+' '+MODES[mode].name)+ab(' ('+modeReason+')'));
      }

      for (const { key, reg } of skillsToInstall) {
        saveSkill(reg);
        skills.push(reg);
        changes.push(rf('⟳ Auto-installed skill: ')+sd(reg.name)+ab(' — '+reg.description));
      }

      if (changes.length) {
        console.log('');
        changes.forEach(c => console.log('  '+c));
      }
    }

    // ── DEFAULT: Send message to AI ──────────────────────────────────────────
    messages.push({role:'user',content:text}); msgN++;
    statusRef.msgCount=msgN; statusRef.mode=mode; statusRef.model=modelId||'';
    console.log('');
    const mc2=MODES[mode];
    const sp2=spinner(mc2.name+' · [thinking]');
    const t1=Date.now();
    try {
      const data=await callAI(providerKey,apiKey,modelId,allMs());
      sp2();
      const reply=data.choices[0].message.content;
      messages.push({role:'assistant',content:reply}); lastReply=reply;
      if (data.usage) totalTok+=data.usage.total_tokens||0;
      const elapsed=((Date.now()-t1)/1000).toFixed(1);

      // Save memory blocks
      const memBlocks=parseMemoryBlocks(reply);
      if (memBlocks.length){
        updateMemory(mem,memBlocks); saveMemory(mem);
        console.log('  '+vt('◈ Memory: ')+sd(memBlocks.map(m=>m.key).join(', '))+ab(' saved'));
      }

      // Handle file blocks
      const blocks=parseFileBlocks(reply);
      if (!blocks.length && reply.includes('@@FILE:') && reply.includes('@@END')) {
        console.log('  '+rf('⚠ ')+ab('AI output @@FILE blocks but they could not be parsed. Check format.'));
      }
      let appliedFiles=[];
      if (blocks.length) {
        if (mode==='agent') {
          appliedFiles=applyFileBlocks(blocks);
        } else {
          console.log('\n  '+vt('AI wants to create/modify '+blocks.length+' file(s):'));
          blocks.forEach(bk=>console.log('  '+ab('  → ')+sd(bk.relPath)));
          const conf=await ask(cr('\n  ❯ ')+ab('Apply files? [Y/n]: '));
          const ans=conf.trim().toLowerCase();
          if (ans===''||ans==='y'||ans==='yes') appliedFiles=applyFileBlocks(blocks);
          else console.log('  '+ab('Skipped.'));
        }
      }

      // Self-test loop
      let testResult=null;
      if (appliedFiles.length&&autoTest) {
        testResult=await selfTestLoop(providerKey,apiKey,modelId,messages,appliedFiles,3);
      }

      console.log('  '+wh('🐋 whyWhale')+'  '+mc2.colorFn(mc2.icon)+'  '+ab('────── '+elapsed+'s · '+totalTok.toLocaleString()+' tokens · #'+msgN));
      console.log('');
      console.log(formatMD(stripFileBlocks(reply)));

      if (appliedFiles.length) printFileResults(appliedFiles);

      if (testResult?.tested) {
        console.log('');
        if (testResult.passed) {
          console.log('  '+kp('✔ AI Self-Test PASSED')+ab(' — code verified by running it')+(testResult.iterations>1?ab(' ('+testResult.iterations+' fix attempts)'):''));
        } else {
          console.log('  '+dg('✘ AI Self-Test FAILED')+ab(' after '+testResult.iterations+' attempts — manual review recommended'));
        }
      }
      console.log('');
    } catch(err) {
      sp2();
      console.log('\n  '+dg('✘ Error: ')+err.message);
      messages.pop(); msgN--;
    }
    prompt();
  } // end _handleLine

  rl.on('close',()=>{ console.log(''); process.exit(0); });
}

module.exports = { main, VERSION };