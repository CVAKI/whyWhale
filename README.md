<p align="center">
  <img src="./banner.svg" alt="whyWhale — AI Terminal Assistant" width="840"/>
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Courier+New&size=15&duration=2800&pause=600&color=1EB4FF&center=true&vCenter=true&repeat=true&width=700&height=36&lines=AI+Terminal+%C2%B7+Self-Testing+Code+Engine;Persistent+Memory+%C2%B7+Skills+System;7-Phase+Neural+Pipeline+Architecture;Multi-Provider%3A+Claude+%C2%B7+Groq+%C2%B7+Ollama+%C2%B7+OpenRouter" alt="Typing SVG"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-4.0.0-1EB4FF?style=for-the-badge&labelColor=030a12" alt="version"/>
  <img src="https://img.shields.io/badge/Node.js-18+-3CDCC8?style=for-the-badge&logo=node.js&logoColor=white&labelColor=030a12" alt="node"/>
  <img src="https://img.shields.io/badge/license-MIT-B96EFF?style=for-the-badge&labelColor=030a12" alt="license"/>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-FFC83C?style=for-the-badge&labelColor=030a12" alt="platform"/>
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20Groq%20%7C%20Ollama-FF6B2B?style=for-the-badge&labelColor=030a12" alt="ai"/>
</p>

<br/>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=rect&color=0:030a12,100:041525&height=2&section=header" width="100%"/>
</p>

## ✨ What's New in v4

| Feature | Description |
|---|---|
| 🧠 **7-Phase AI Brain** | Tokenization → Context → Transformer → Thinking → Code Gen → Tool Use → Response |
| 🔬 **Self-Testing Loop** | Writes code → runs it → reads errors → auto-fixes (up to 3 rounds) |
| 💾 **Persistent Memory** | Remembers facts, projects, and session history across restarts |
| 📂 **Folder Scanner** | Auto-reads your project files into AI context on startup |
| 🎯 **Skills System** | Download and install prompt skill packs |
| 🖥️ **Shell Passthrough** | Run any terminal command with `!command` |
| 🎨 **Whale PS1 Prompt** | Parrot-OS style prompt — whale-branded |
| 🌈 **Syntax Highlighting** | 12+ languages with full token coloring |
| 🤖 **Multi-Provider** | Anthropic Claude, OpenRouter, Groq, Ollama |

<br/>

## 🚀 Installation

**Option 1 — Global install (recommended)**
```bash
git clone https://github.com/CVAKI/whyWhale.git
cd whyWhale
npm install -g .
whywhale
```

**Option 2 — Run directly**
```bash
node bin/whywhale.js
```

**Option 3 — Short alias**
```bash
ww
```

<br/>

## ⚙️ First-Time Setup

On first launch, whyWhale will prompt you to configure:

1. **AI Provider** — Anthropic / OpenRouter / Groq / Ollama
2. **Model** — e.g. `claude-sonnet-4-20250514`
3. **API Key** — saved to `~/.whywhale.json`

Or run setup manually:
```bash
whywhale --setup
```

<br/>

## 🎮 Commands Reference

### Chat & Modes

| Command | Action |
|---|---|
| `(type anything)` | Chat with the AI |
| `/mode code` | Switch to code mode `</>` |
| `/mode architect` | System design mode `⬡` |
| `/mode debug` | Debugging mode `⚡` |
| `/mode explain` | Teaching mode `❋` |
| `/mode review` | Code review mode `⊕` |
| `/mode plan` | Project planning mode `📋` |
| `/mode agent` | Autonomous agent mode `◈` |

### Shell Passthrough
```bash
!ls -la          # list files
!git status      # git commands
!python app.py   # run scripts
!npm install     # package management
```

### Memory System

| Command | Action |
|---|---|
| `/memory` | Show all stored memories |
| `/memory set key value` | Store a fact manually |
| `/memory clear` | Wipe all memories |

The AI also auto-saves with `@@MEMORY: key: value` blocks in its responses.

### Skills

| Command | Action |
|---|---|
| `/skill list` | Show available + installed skills |
| `/skill install react` | Install the React skill |
| `/skill show react` | Preview skill prompt |
| `/skill remove react` | Uninstall a skill |

**Built-in skill registry:**
`react` · `python` · `security` · `testing` · `api-design` · `docker` · `database` · `git` · `performance` · `typescript`

### File Commands

| Command | Action |
|---|---|
| `/ls [path]` | List files in directory |
| `/tree [depth]` | Directory tree (default depth 3) |
| `/read <path>` | Read file with syntax highlighting |
| `/analyse <path>` | Deep AI analysis of a file |
| `/write <path>` | AI-generate content for a file |
| `/scan` | Re-scan current directory into context |

### Session

| Command | Action |
|---|---|
| `/save [name]` | Save conversation to `~/.whywhale_sessions/` |
| `/load` | Restore a saved session |
| `/export` | Export chat as styled HTML |
| `/dashboard` | Open web dashboard at `http://localhost:7070` |
| `/history` | Show session history |
| `/stats` | Session statistics |
| `/exit` | Quit (saves session summary to memory) |

<br/>

## 🌊 Providers

<table>
<tr>
<td>

### 🔵 Anthropic (Claude)
```
Provider: anthropic
Model:    claude-sonnet-4-20250514
          claude-opus-4-20250514
          claude-haiku-4-5-20251001
API Key:  sk-ant-...
```
[Get key →](https://console.anthropic.com)

</td>
<td>

### 🟠 OpenRouter
```
Provider: openrouter
Model:    anthropic/claude-3.5-sonnet
          (any OpenRouter model)
API Key:  sk-or-...
```
[Get key →](https://openrouter.ai)

</td>
</tr>
<tr>
<td>

### 🔴 Groq
```
Provider: groq
Model:    llama-3.3-70b-versatile
API Key:  gsk_...
```
[Get key →](https://console.groq.com)

</td>
<td>

### 🟢 Ollama (Local)
```
Provider: ollama
Model:    llama3.2  (or any local model)
API Key:  (leave blank)
```
[Install →](https://ollama.com)

</td>
</tr>
</table>

<br/>

## 🧠 Architecture

whyWhale's AI pipeline mirrors real LLM architecture:

```
Your message
    ↓
Phase 1 — Tokenization        (intent parsing)
    ↓
Phase 2 — Context Assembly    (system + memory + skills + files + history)
    ↓
Phase 3 — Transformer         (API call)
    ↓
Phase 4 — Extended Thinking   (reasoning in system prompt)
    ↓
Phase 5 — Code Generation     (autoregressive decoding)
    ↓
Phase 6 — Self-Testing Loop   (run → error → fix × 3)
    ↓
Phase 7 — Response Assembly   (memory update + output)
    ↓
Streamed output to your terminal
```

<br/>

## 🎨 PS1 Prompt

```
┌[11:19:07]────[whyWhale]────[💻 code]────[#7]
└[~/projects]──►
```

| Field | Description |
|---|---|
| **Timestamp** | Current time |
| **Brand** | whyWhale (ocean blue) |
| **Mode** | Current AI mode with icon |
| **Counter** | Message count this session |
| **Directory** | Current working directory |

<br/>

## 💾 Data Files

| Path | Contents |
|---|---|
| `~/.whywhale.json` | Config (provider, model, API key, settings) |
| `~/.whywhale_memory.json` | Persistent memory (facts, projects, sessions) |
| `~/.whywhale_sessions/` | Per-session chat history |
| `~/.whywhale_skills/` | Installed skill JSON files |

<br/>

## 🤖 File Format (Agent Mode)

When creating or modifying files, the AI uses this exact format:

```
@@FILE: relative/path/filename.ext
```language
...complete file content...
```
@@END
```

<br/>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:030a12,50:1eb4ff,100:b96eff&height=100&section=footer" width="100%"/>
</p>

<p align="center">
  <sub>MIT License — developed by <strong>CVKI ♞</strong></sub>
</p>