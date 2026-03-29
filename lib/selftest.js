'use strict';
const fs   = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { wh, cr, kp, rf, ab, sd, dg, vt, tl, dm } = require('./colors');
const { CWD, parseFileBlocks, applyFileBlocks } = require('./filesystem');
const { callAI } = require('./providers');
const { spinner } = require('./render');
const { SESS_DIR, ensureDir } = require('./config');

// ─── Self-Testing System ──────────────────────────────────────────────────────
// Phase 6 of the 7-phase architecture.
// After writing code, whyWhale runs it and feeds errors back to the AI.
async function runFile(filePath) {
  return new Promise(res=>{
    const ext=path.extname(filePath).toLowerCase();
    let cmd;
    if (ext==='.js'||ext==='.mjs') cmd=`node "${filePath}"`;
    else if (ext==='.py') cmd=`python3 "${filePath}" 2>&1 || python "${filePath}" 2>&1`;
    else if (ext==='.sh') cmd=`bash "${filePath}"`;
    else if (ext==='.ts') cmd=`npx ts-node "${filePath}" 2>&1 || node "${filePath}"`;
    else { res({stdout:'',stderr:'Cannot auto-run '+ext+' files',code:1}); return; }
    exec(cmd,{timeout:15000,cwd:CWD(),shell:true},(err,stdout,stderr)=>{
      res({stdout:stdout||'',stderr:stderr||'',code:err?(err.code||1):0});
    });
  });
}

async function selfTestLoop(providerKey, apiKey, modelId, messages, appliedFiles, maxIter) {
  const runnable=appliedFiles.filter(f=>{
    if (!f.ok) return false;
    const ext=path.extname(f.path).toLowerCase();
    return ['.js','.mjs','.py','.sh','.ts'].includes(ext);
  });
  if (!runnable.length) return {tested:false};

  let iter=0;
  let lastResult=null;
  const MAX=maxIter||3;

  while (iter<MAX) {
    iter++;
    const testFile=runnable[0];
    console.log('\n  '+wh('⟳')+' '+ab('Self-test #'+iter+': ')+tl(testFile.path));
    const result=await runFile(testFile.full);
    lastResult=result;

    if (result.code===0) {
      const preview=(result.stdout||'').trim().slice(0,120);
      console.log('  '+kp('✔ Test PASSED')+ab(preview?' — '+preview:''));
      return {tested:true,passed:true,iterations:iter,output:result.stdout};
    }

    const errText=(result.stderr||result.stdout||'').trim();
    console.log('  '+dg('✘ Test FAILED')+'  exit '+result.code);
    errText.split('\n').slice(0,8).forEach(l=>console.log('  '+ab('  │ ')+dg(l)));

    if (iter>=MAX) break;

    console.log('\n  '+wh('⟳')+' '+ab('Asking AI to fix (attempt '+(iter+1)+')...'));
    const fixPrompt=`The code I wrote for ${testFile.path} failed when tested automatically.\n\nError output:\n\`\`\`\n${errText.slice(0,800)}\n\`\`\`\nExit code: ${result.code}\n\nThis is attempt ${iter} of ${MAX-1}. Please find the root cause and fix it. Output corrected file(s) using the @@FILE format. Think step by step.`;

    messages.push({role:'user',content:fixPrompt});
    const sp=spinner('AI self-correcting (phase 6: testing loop)...');
    try {
      const data=await callAI(providerKey,apiKey,modelId,messages);
      sp();
      const fixReply=data.choices[0].message.content;
      messages.push({role:'assistant',content:fixReply});
      const newBlocks=parseFileBlocks(fixReply);
      if (newBlocks.length) {
        const newResults=applyFileBlocks(newBlocks);
        newResults.forEach(r=>{
          if (r.ok) {
            console.log('  '+kp('  ✔ Fixed: ')+sd(r.path));
            const idx=runnable.findIndex(f=>f.path===r.path);
            if (idx>=0) runnable[idx]=r;
          }
        });
      }
    } catch(err) { sp(); console.log('  '+dg('Fix request failed: ')+err.message); break; }
  }

  return {tested:true,passed:false,iterations:iter,error:lastResult?.stderr||lastResult?.stdout};
}

// ─── Session ──────────────────────────────────────────────────────────────────
function saveSession(messages,name) {
  ensureDir(SESS_DIR);
  const fname=(name||'session_'+new Date().toISOString().slice(0,19).replace(/[:.]/g,'-'))+'.json';
  fs.writeFileSync(path.join(SESS_DIR,fname),JSON.stringify({saved:new Date().toISOString(),messages},null,2));
  return path.join(SESS_DIR,fname);
}
function listSessions() {
  ensureDir(SESS_DIR);
  try {
    return fs.readdirSync(SESS_DIR).filter(f=>f.endsWith('.json')).map(f=>{
      try { const d=JSON.parse(fs.readFileSync(path.join(SESS_DIR,f),'utf8')); return {name:f.replace('.json',''),saved:d.saved,messages:d.messages||[],count:(d.messages||[]).filter(m=>m.role==='user').length}; }
      catch(_){ return null; }
    }).filter(Boolean);
  } catch(_){ return []; }
}

// ─── Shell ────────────────────────────────────────────────────────────────────
function runShell(cmd) {
  return new Promise(res=>{
    exec(cmd,{timeout:30000,cwd:CWD(),shell:true},(err,stdout,stderr)=>{
      res({stdout:stdout||'',stderr:stderr||'',code:err?(err.code||1):0});
    });
  });
}
function copyClip(text) {
  try {
    if (process.platform==='win32') execSync('clip',{input:text,stdio:['pipe','ignore','ignore']});
    else if (process.platform==='darwin') execSync('pbcopy',{input:text,stdio:['pipe','ignore','ignore']});
    else execSync('xclip -selection clipboard 2>/dev/null||xsel --clipboard --input',{input:text,shell:true,stdio:['pipe','ignore','ignore']});
    return true;
  } catch(_){ return false; }
}

module.exports = {
  runFile, selfTestLoop,
  saveSession, listSessions,
  runShell, copyClip,
};
