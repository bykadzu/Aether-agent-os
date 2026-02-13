# What Is Aether OS?

## The One-Liner

Aether OS is a desktop operating system built from scratch — not for humans, but for AI agents. You watch and interact with them through a sleek, macOS-inspired interface in your browser.

## The Bigger Picture

Think of it like this: today, when you want an AI to do something, you open ChatGPT, type a prompt, and read its response. That's a conversation. Aether OS turns that into a **workspace**.

Instead of chatting with an AI, you **deploy** one. It gets its own desktop, its own file system, its own terminal — like giving an employee a laptop. Then you watch it work in real time. It thinks, it acts, it reads the results, and it decides what to do next. If it needs to do something sensitive (like deleting a file or running a command), it asks you for permission first.

You can deploy multiple agents at once. A Researcher can browse the web and take notes. A Coder can write and test code. An Analyst can crunch data. They each get their own isolated sandbox, but they can also talk to each other and share files when needed.

## What Does It Look Like?

When you open Aether OS in your browser, you see something that looks a lot like macOS:

- **Menu bar** at the top with the time, battery/wifi indicators, and user menu
- **Desktop** with widgets showing weather, system activity, and a clock
- **Dock** at the bottom for launching apps
- **Windows** that you can drag, resize, minimize, and maximize

The key apps are:

| App | What It Does |
|-----|-------------|
| **Mission Control** | Dashboard showing all your deployed agents in a grid. See what each one is doing at a glance. |
| **Agent VM** | Full view of a single agent — its terminal, thought log, plan viewer, feedback buttons, and an approval modal when it needs permission. |
| **Memory Inspector** | Browse agent memories across 4 layers (episodic, semantic, procedural, social). Search, filter, view agent profiles and stats. |
| **Terminal** | A real terminal connected to the host system or an agent's sandbox. |
| **Chat** | An LLM-powered chat interface for quick questions (Gemini, OpenAI, Anthropic, or Ollama). |
| **Code Editor** | Monaco-based editor with multi-tab support, file tree, and language auto-detection. |
| **Browser** | Full browser with Chromium backend (Playwright) or iframe fallback, tab management. |
| **System Monitor** | Real-time CPU/memory/disk/network charts with per-agent resource breakdown. |
| **Smart Bar** | Hit Cmd+K for a Spotlight-style search powered by LLM. |
| Sheets, Canvas, Writer, Music, Documents, Notes, Calculator, Photos, Video, Settings | Full-featured productivity apps. |

## How Agents Work

Every agent follows a **think-act-observe** loop:

```
1. THINK  →  The AI reads the current situation and decides what to do
2. ACT    →  It uses a tool (write a file, run a command, browse the web, etc.)
3. OBSERVE →  It reads the result of that action
4. REPEAT  →  Back to step 1, until the goal is complete
```

Agents have access to 28+ real tools:

- **File operations** — read, write, create, delete, move, copy files
- **Shell commands** — run anything in their terminal
- **Web browsing** — browse pages with real Chromium, take screenshots, click elements
- **Memory** — remember things across sessions, recall past experiences, forget outdated info
- **Planning** — break goals into hierarchical task trees, track progress
- **Collaboration** — request reviews, delegate tasks, share knowledge with other agents
- **Vision** — analyze images and screenshots via multi-modal LLMs
- **Messaging** — send messages to other agents
- **Shared workspaces** — create folders that multiple agents can access
- **Plugins** — custom tools you can add yourself

## What Makes It an "OS"?

Aether OS isn't a chatbot with a fancy UI. It implements real operating system concepts:

| OS Concept | How Aether Does It |
|-----------|-------------------|
| **Processes** | Each agent is a process with a real PID, lifecycle states, and signal handling (pause, resume, kill). |
| **Filesystem** | A real virtual filesystem on disk with per-agent home directories, file permissions, and shared mounts. |
| **Terminal** | Real pseudo-terminal (PTY) sessions — not simulated. Full ANSI support, window resizing, the works. |
| **IPC** | Agents can send typed messages to each other through message queues. |
| **Containers** | Optional Docker sandboxing with CPU/memory limits and GPU passthrough. |
| **Persistence** | SQLite database stores process history, logs, metrics, and file metadata across restarts. |
| **Multi-User** | Authentication system with JWT tokens. Each user gets their own agent pool and directory space. |
| **Clustering** | Hub-and-spoke distributed mode — spread agents across multiple machines. |
| **Self-Knowledge** | Agents can read a comprehensive CODEBASE.md document to understand the architecture, subsystems, tools, and filesystem layout of the system they run inside. |

## Who Is This For?

- **Developers** who want to experiment with autonomous AI agents in a safe, observable environment
- **Researchers** exploring multi-agent systems and agent-computer interaction
- **Teams** who want to deploy AI workers that can collaborate on tasks
- **Anyone curious** about what it looks like when AI agents get a real operating system instead of just a chat box

## How Do I Run It?

**Quick start (UI only, agents run client-side):**
```bash
npm install
npm run dev
# Open http://localhost:3000
```

**Full mode (real kernel with sandboxing, persistence, terminals):**
```bash
# Terminal 1
npm run dev:kernel

# Terminal 2
npm run dev
```

**Both at once:**
```bash
npm run dev:full
```

You'll need a `GEMINI_API_KEY` environment variable set for the AI reasoning to work.

## The Tech Stack (If You're Curious)

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, xterm.js |
| Backend | Node.js, TypeScript, WebSocket |
| Database | SQLite (via better-sqlite3) |
| Terminals | node-pty (real pseudo-terminals) |
| Containers | Docker (optional, auto-detected) |
| AI | Multi-provider — Google Gemini, OpenAI, Anthropic, Ollama (local) — with vision support |
| Graphics | Xvfb + x11vnc + WebSocket-to-TCP proxy (ws library) for graphical agent desktops |
| Browser Engine | Playwright (Chromium) for real web browsing |
