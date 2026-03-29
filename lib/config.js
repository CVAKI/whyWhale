'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────
const HOME_DIR    = os.homedir();
const CONFIG_PATH = path.join(HOME_DIR, '.whywhale.json');
const MEMORY_PATH = path.join(HOME_DIR, '.whywhale_memory.json');
const SESS_DIR    = path.join(HOME_DIR, '.whywhale_sessions');
const SKILLS_DIR  = path.join(HOME_DIR, '.whywhale_skills');

function ensureDir(d) { try { if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); } catch(_){} }

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch(_){}
  return {};
}
function saveConfig(cfg) { try { fs.writeFileSync(CONFIG_PATH,JSON.stringify(cfg,null,2)); } catch(_){} }

// ─── Memory System ────────────────────────────────────────────────────────────
// Persistent brain — remembers facts, project context, and past sessions.
// The AI can update memory using @@MEMORY: key: value blocks in its responses.
function loadMemory() {
  try { if (fs.existsSync(MEMORY_PATH)) return JSON.parse(fs.readFileSync(MEMORY_PATH,'utf8')); } catch(_){}
  return { facts:[], projects:{}, sessionSummaries:[], created:new Date().toISOString(), lastUpdated:null };
}
function saveMemory(mem) {
  try { mem.lastUpdated=new Date().toISOString(); fs.writeFileSync(MEMORY_PATH,JSON.stringify(mem,null,2)); } catch(_){}
}
function parseMemoryBlocks(text) {
  const blocks=[], re=/@@MEMORY:\s*([^\n:]+):\s*([^\n]+)/g; let m;
  while ((m=re.exec(text))!==null) blocks.push({key:m[1].trim(),value:m[2].trim()});
  return blocks;
}
function updateMemory(mem, blocks) {
  blocks.forEach(mb => {
    const i=mem.facts.findIndex(f=>f.key===mb.key);
    if (i>=0) mem.facts[i].value=mb.value;
    else mem.facts.push({key:mb.key,value:mb.value,added:new Date().toISOString()});
  });
}
function buildMemoryContext(mem, cwd) {
  const parts=[];
  if (mem.facts.length) {
    parts.push('## Persistent Memory (from previous sessions)');
    mem.facts.slice(-25).forEach(f=>parts.push(`- ${f.key}: ${f.value}`));
  }
  const projKey=cwd.replace(/[^a-zA-Z0-9]/g,'_');
  if (mem.projects[projKey]?.summary) {
    parts.push('## Project Memory (this directory)');
    parts.push(mem.projects[projKey].summary);
  }
  if (mem.sessionSummaries?.length) {
    const last=mem.sessionSummaries[mem.sessionSummaries.length-1];
    parts.push('## Last Session');
    parts.push(last.summary);
  }
  return parts.join('\n');
}

// ─── Skills System ────────────────────────────────────────────────────────────
const SKILL_REGISTRY = {
  react:       { name:'React',        description:'Modern React with hooks, TypeScript, patterns',        prompt:'When writing React: use functional components with hooks (useState,useEffect,useCallback,useMemo), TypeScript interfaces, error boundaries, proper keys. No class components unless asked.' },
  python:      { name:'Python',       description:'Idiomatic Python with type hints and best practices',  prompt:'When writing Python: use type hints, f-strings, dataclasses, pathlib, context managers. PEP 8 compliance. Use list comprehensions appropriately. Write docstrings for all functions.' },
  security:    { name:'Security',     description:'Security-first code review and hardening',             prompt:'When reviewing/writing code: check for XSS, SQL injection, CSRF, auth flaws, sensitive data exposure, hardcoded secrets, input validation, OWASP Top 10. Always suggest fixes.' },
  testing:     { name:'Testing',      description:'Comprehensive test writing (unit, integration, e2e)',  prompt:'When writing tests: cover happy path, edge cases, error cases. Use descriptive names. AAA pattern (Arrange,Act,Assert). Mock external deps. Aim for meaningful coverage, not 100%.' },
  'api-design':{ name:'API Design',   description:'REST/GraphQL API design and OpenAPI specs',           prompt:'When designing APIs: proper HTTP methods and status codes, versioning strategy, pagination, rate limiting, auth patterns, clear error messages, consistent naming. Generate OpenAPI specs when useful.' },
  docker:      { name:'Docker',       description:'Containerization and Compose best practices',          prompt:'When writing Docker: multi-stage builds, minimal base images (alpine/distroless), non-root users, health checks, .dockerignore, env var handling, proper volume mounts.' },
  database:    { name:'Database',     description:'Schema design, queries, and optimization',             prompt:'When working with databases: proper indexing strategy, normalized schemas, efficient queries (avoid N+1), migrations, connection pooling, transactions, explain plan analysis.' },
  git:         { name:'Git',          description:'Git workflows, conventional commits, CI/CD',           prompt:'When working with git: conventional commits (feat/fix/docs/chore), branching strategy, meaningful PRs, proper .gitignore, conflict resolution, semantic versioning.' },
  performance: { name:'Performance',  description:'Code and app performance optimization',                prompt:'When optimizing performance: profile before optimizing, Big-O analysis, memoization, lazy loading, caching strategies, bundle size analysis, database query optimization, rendering performance.' },
  typescript:  { name:'TypeScript',   description:'Advanced TypeScript types and patterns',               prompt:'When writing TypeScript: prefer strict mode, use utility types (Partial,Required,Pick,Omit,Record), discriminated unions, generics, avoid any. Leverage the type system fully.' },
};

function loadSkills() {
  ensureDir(SKILLS_DIR);
  try {
    return fs.readdirSync(SKILLS_DIR).filter(f=>f.endsWith('.json')).map(f=>{
      try { return JSON.parse(fs.readFileSync(path.join(SKILLS_DIR,f),'utf8')); } catch(_){ return null; }
    }).filter(Boolean);
  } catch(_){ return []; }
}
function saveSkill(skill) {
  ensureDir(SKILLS_DIR);
  fs.writeFileSync(path.join(SKILLS_DIR,skill.name.toLowerCase().replace(/\s+/g,'_')+'.json'),JSON.stringify(skill,null,2));
}
function buildSkillsContext(skills) {
  if (!skills.length) return '';
  return '## Installed Skills (apply these to all relevant code)\n'+skills.map(s=>`- **${s.name}**: ${s.prompt}`).join('\n');
}

module.exports = {
  HOME_DIR, CONFIG_PATH, MEMORY_PATH, SESS_DIR, SKILLS_DIR,
  ensureDir, loadConfig, saveConfig,
  loadMemory, saveMemory, parseMemoryBlocks, updateMemory, buildMemoryContext,
  SKILL_REGISTRY, loadSkills, saveSkill, buildSkillsContext,
};
