# 🐋 whyWhale v4.0

> An AI-powered terminal assistant with a real brain — self-testing code engine, persistent memory, downloadable skills, shell passthrough, and a whale-branded PS1 prompt.

---

## ✨ What's New in v4

| Feature | Description |
|---|---|
| 🧠 7-Phase AI Brain | Follows real LLM architecture: Tokenization → Context → Transformer → Thinking → Code Gen → Tool Use → Response |
| 🔬 Self-Testing Loop | Writes code → runs it → reads errors → auto-fixes (up to 3 rounds) |
| 💾 Persistent Memory | Remembers facts, projects, and session history across restarts |
| 📂 Folder Scanner | Auto-reads your project files into AI context on startup |
| 🎯 Skills System | Download and install prompt skill packs |
| 🖥️ Shell Passthrough | Run any terminal command with `!command` |
| 🎨 Whale PS1 Prompt | Parrot-OS style prompt — whale-branded |
| 🌈 Syntax Highlighting | 12+ languages with full token coloring |
| 🤖 Multi-Provider | Anthropic Claude, OpenRouter, Groq, Ollama |

---

## 🚀 Installation

### Option 1 — Global install (recommended)
```bash
cd whyWhale_v4
npm install -g .
whywhale
```

### Option 2 — Run directly
```bash
node bin/whywhale.js
```

### Option 3 — Short alias `ww`
After global install:
```bash
ww
```

---

## ⚙️ First-Time Setup

On first launch, whyWhale will ask you to configure:
1. **AI Provider** — Anthropic / OpenRouter / Groq / Ollama
2. **Model** — e.g. `claude-sonnet-4-20250514`
3. **API Key** — saved to `~/.whywhale.json`

Or run setup manually:
```bash
whywhale --setup
```

---

## 🎮 Commands Reference

### Chat & Modes
| Command | Action |
|---|---|
| (type anything) | Chat with the AI |
| `/mode code` | Switch to code mode (💻) |
| `/mode architect` | System design mode (⬡) |
| `/mode debug` | Debugging mode (🔍) |
| `/mode explain` | Teaching mode (📖) |
| `/mode review` | Code review mode (👁) |
| `/mode plan` | Project planning mode (📋) |

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

### Folder Scanning
| Command | Action |
|---|---|
| `/scan` | Re-scan current directory into context |
| `/autoscan` | Toggle auto-scan on startup |

### Self-Testing
| Command | Action |
|---|---|
| `/autotest` | Toggle auto-test after code generation |

When enabled, whyWhale runs generated `.js`, `.py`, `.sh`, `.ts` files automatically and feeds errors back to the AI for self-correction (max 3 rounds).

### General
| Command | Action |
|---|---|
| `/help` | Show all commands |
| `/clear` | Clear screen |
| `/config` | Show current config |
| `/setup` | Reconfigure provider/model/key |
| `/history` | Show session history |
| `/exit` | Quit (saves session summary to memory) |
| `whywhale --memory` | Dump memory JSON from CLI |
| `whywhale --version` | Show version |

---

## 🐋 PS1 Prompt

```
┌[11:19:07]────[whyWhale]────[💻 code]────[#7]
└[~/projects]──►
```

- **Timestamp** — current time
- **Brand** — whyWhale (ocean blue)
- **Mode** — current AI mode with icon
- **Counter** — message count this session
- **Directory** — current working directory

---

## 🧠 Architecture

whyWhale's AI pipeline mirrors real LLM architecture:

```
Your message
    ↓
Phase 1 — Tokenization (intent parsing)
    ↓
Phase 2 — Context Window Assembly
         (system prompt + memory + skills + scanned files + history)
    ↓
Phase 3 — Transformer Processing (API call)
    ↓
Phase 4 — Extended Thinking (reasoning in system prompt)
    ↓
Phase 5 — Code Generation (autoregressive decoding)
    ↓
Phase 6 — Self-Testing Loop (run → error → fix × 3)
    ↓
Phase 7 — Response Assembly + Memory Update
    ↓
Streamed output to your terminal
```

---

## 💾 Data Files

| Path | Contents |
|---|---|
| `~/.whywhale.json` | Config (provider, model, API key, settings) |
| `~/.whywhale_memory.json` | Persistent memory (facts, projects, sessions) |
| `~/.whywhale_sessions/` | Per-session chat history |
| `~/.whywhale_skills/` | Installed skill JSON files |

---

## 🌊 Providers

### Anthropic (Claude)
```
Provider: anthropic
Model:    claude-sonnet-4-20250514
          claude-opus-4-20250514
          claude-haiku-4-5-20251001
API Key:  sk-ant-...
```
Get your key: https://console.anthropic.com

### OpenRouter
```
Provider: openrouter
Model:    anthropic/claude-3.5-sonnet  (or any OpenRouter model)
API Key:  sk-or-...
```

### Groq
```
Provider: groq
Model:    llama-3.3-70b-versatile
API Key:  gsk_...
```

### Ollama (Local)
```
Provider: ollama
Model:    llama3.2  (or any local model)
API Key:  (leave blank)
```

---

## 📝 License

MIT — developed by CVKI
