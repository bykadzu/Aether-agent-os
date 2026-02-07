<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Aether OS

**A purpose-built operating system for AI agents.**

Real processes. Real filesystems. Real terminals. Beautiful UI.

[![CI](https://github.com/bykadzu/Aether-agent-os/actions/workflows/ci.yml/badge.svg)](https://github.com/bykadzu/Aether-agent-os/actions/workflows/ci.yml)

[Getting Started](#getting-started) | [Architecture](#architecture) | [How It Works](#how-it-works) | [Roadmap](#roadmap)

</div>

---

Aether OS is a from-scratch operating system designed for AI agents to live and work in. Each agent runs as a real process with its own sandboxed filesystem, terminal session, and execution environment. Agents remember across sessions, plan hierarchically, reflect on their work, collaborate with each other, and see through vision-capable LLMs. Humans observe and interact through a Mission Control interface inspired by macOS.

Unlike approaches that drop an AI into an existing Linux VM, Aether OS is built from the ground up with AI agents as first-class citizens. The kernel (15 subsystems), agent runtime (28+ tools, 4 LLM providers), and UI (20+ apps) are all designed around the agent lifecycle: think, act, observe, remember, plan, reflect.

## What It Does

- **Spawns AI agents as real OS processes** with PIDs, signals, and lifecycle management
- **Gives each agent a sandboxed environment** with its own home directory, shell, and filesystem
- **Runs agents through a think-act-observe loop** powered by multiple LLM providers (Gemini, OpenAI, Anthropic, Ollama) with automatic fallback
- **Deploys from pre-built agent templates** (Researcher, Coder, Reviewer, Analyst, SysAdmin, Writer, Tester) with curated tool sets and goals
- **Displays each agent's virtual desktop** in a Mission Control grid, like monitoring multiple workstations
- **Streams graphical desktops via VNC/noVNC** for agents running browsers, IDEs, or other GUI apps inside containers
- **Provides real terminal sessions** with xterm.js rendering ANSI output from actual shell processes
- **Persists state to SQLite** so kernel state, agent logs, and file metadata survive restarts
- **Supports Docker container sandboxing** for real process isolation (falls back to child_process)
- **Passes through NVIDIA GPUs** to containerized agents running ML workloads via `nvidia-container-toolkit`
- **Authenticates users** with JWT-based login, registration, and per-user agent isolation
- **Scales across hosts** with hub-and-spoke clustering for distributed kernel execution
- **Snapshots and restores agents** like VM checkpoints — capturing process state, filesystem, and logs
- **Extends agents with plugins** discovered automatically from each agent's home directory
- **Enables agent-to-agent communication** through a kernel-managed IPC message queue

## Getting Started

**Prerequisites:** Node.js 22+, npm

### Quick setup

```bash
git clone https://github.com/bykadzu/Aether-agent-os.git
cd Aether-agent-os
./scripts/setup.sh
```

The setup script verifies prerequisites (Node.js, npm, Docker, NVIDIA GPU), installs all workspace dependencies, and creates a `.env` from `.env.example` if one doesn't exist. Edit `.env` to add your LLM API keys:

```bash
# .env — at least one provider is needed for real LLM reasoning
GEMINI_API_KEY=           # Google Gemini (default provider)
OPENAI_API_KEY=           # OpenAI (gpt-4o, gpt-4o-mini, gpt-3.5-turbo)
ANTHROPIC_API_KEY=        # Anthropic (claude-sonnet-4-5, claude-haiku-4-5)
OLLAMA_HOST=http://localhost:11434   # Local Ollama (no key required)
```

See `.env.example` for the full list of configuration options (auth, clustering, filesystem root, etc.).

### Run in UI-only mode (mock agents, no backend needed)

```bash
npm run dev
```

Opens on `http://localhost:3000`. Agents run client-side with LLM API calls. Leave all API keys blank for heuristic demo mode.

### Run with the full kernel (real processes, real filesystem)

```bash
# Terminal 1: Start the kernel server
npm run dev:kernel

# Terminal 2: Start the UI
npm run dev
```

Or both at once:

```bash
npm run dev:full
```

The kernel server runs on port 3001. The UI auto-detects it via WebSocket and switches from mock mode to kernel mode. You'll see a green "Kernel" indicator in the menu bar when connected.

Default admin credentials: `admin` / `aether` (change after first login).

### Optional: Docker sandboxing

If Docker is available on the host, agent processes will automatically run inside containers with mounted volumes and resource limits. If Docker isn't available, the kernel falls back to `child_process` with no configuration needed.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                       React UI (Vite)                          │
│                                                                │
│  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Mission     │ │  Agent   │ │  Agent   │ │  Virtual     │  │
│  │  Control     │ │   VM     │ │ Timeline │ │  Desktop     │  │
│  │  (grid)      │ │  (full)  │ │          │ │  + VNCViewer │  │
│  └─────────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│                                                                │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────────┐  │
│  │ KernelClient │ │ useKernel()  │ │ ErrorBoundary         │  │
│  │ (WebSocket)  │ │ React hook   │ │ LoginScreen           │  │
│  └──────────────┘ └──────────────┘ └───────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                  WebSocket + HTTP (port 3001)                  │
├────────────────────────────────────────────────────────────────┤
│                        Aether Kernel                           │
│                                                                │
│  ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Process      │ │ Virtual  │ │ PTY      │ │ Container   │  │
│  │ Manager      │ │ FS       │ │ Manager  │ │ Manager     │  │
│  │ (PIDs,       │ │ (/tmp/   │ │ (real    │ │ (Docker +   │  │
│  │  signals)    │ │  aether) │ │  terms)  │ │  GPU)       │  │
│  ├──────────────┤ ├──────────┤ ├──────────┤ ├─────────────┤  │
│  │ VNC Manager  │ │ Snapshot │ │ Auth     │ │ Cluster     │  │
│  │ (noVNC       │ │ Manager  │ │ Manager  │ │ Manager     │  │
│  │  proxy)      │ │ (ckpts)  │ │ (JWT)    │ │ (hub/spoke) │  │
│  ├──────────────┤ ├──────────┤ ├──────────┤ ├─────────────┤  │
│  │ Plugin       │ │ State    │ │ Event    │ │ Browser     │  │
│  │ Manager      │ │ Store    │ │ Bus      │ │ Manager     │  │
│  │              │ │ (SQLite) │ │ (pub/sub)│ │ (Playwright)│  │
│  ├──────────────┤ ├──────────┤ └──────────┘ └─────────────┘  │
│  │ Memory       │ │ Cron     │                               │  │
│  │ Manager      │ │ Manager  │                               │  │
│  │ (FTS5,       │ │ (sched,  │                               │  │
│  │  4-layer)    │ │  events) │                               │  │
│  └──────────────┘ └──────────┘                               │  │
├────────────────────────────────────────────────────────────────┤
│                       Agent Runtime                            │
│                                                                │
│  ┌───────────────┐ ┌──────────────┐ ┌──────────────────────┐  │
│  │ Agent Loop    │ │  Tools (28+) │ │  LLM Providers       │  │
│  │ (think-act-   │ │  fs, shell,  │ │  Gemini · OpenAI     │  │
│  │  observe,     │ │  web, memory,│ │  Anthropic · Ollama  │  │
│  │  memory-aware)│ │  plan, collab│ │  (+ vision support)  │  │
│  ├───────────────┤ ├──────────────┤ └──────────────────────┘  │
│  │ Templates     │ │ Intelligence │                           │  │
│  │ (8 presets)   │ │ reflection,  │                           │  │
│  └───────────────┘ │ planner,     │                           │  │
│                    │ collaboration│                           │  │
│                    └──────────────┘                           │  │
└────────────────────────────────────────────────────────────────┘
```

### Layer Breakdown

| Layer | Directory | Purpose |
|-------|-----------|---------|
| **Shared** | `shared/` | Typed protocol between UI and kernel. Every WebSocket message is a discriminated union. |
| **Kernel** | `kernel/` | The OS core. Manages processes, filesystem, terminals, containers, persistence. |
| **Runtime** | `runtime/` | Agent execution. Think-act-observe loop with tool use and LLM integration. |
| **Server** | `server/` | HTTP + WebSocket transport. Bridges the kernel to the UI. |
| **UI** | Root (`App.tsx`, `components/`, `services/`) | React frontend. Window manager, desktop environment, Mission Control. |

## How It Works

### Process Model

Each agent is a real process managed by the kernel:

```
spawn → created → running ←→ sleeping → zombie → dead
                    ↕
                  stopped
```

Agent phases layer on top of process states for more granular tracking:

```
booting → thinking → executing → observing → thinking → ... → completed
                        ↕
                     waiting (human approval)
```

### Agent Lifecycle

1. **Deploy** an agent from Mission Control with a role and goal
2. The kernel **spawns a process**, creates a home directory, opens a terminal session
3. The runtime starts a **think-act-observe loop**:
   - **Think**: Ask the LLM what to do next
   - **Act**: Execute a tool (write file, run command, browse web, message another agent)
   - **Observe**: Read the result, feed it back into the next think step
4. The UI **streams events in real-time**: thoughts, actions, terminal output, file changes
5. The agent **completes** when it achieves its goal (or hits the step limit)

### Agent Tools

Tools are invoked by whichever LLM provider is active (Gemini, OpenAI, Anthropic, or Ollama). The provider translates each tool into its native function-calling format automatically.

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents from the agent's filesystem |
| `write_file` | Create or overwrite a file |
| `list_files` | List directory contents |
| `mkdir` | Create directories |
| `run_command` | Execute a shell command in the agent's terminal |
| `browse_web` | Browse with real Chromium (Playwright) or HTTP fetch fallback |
| `screenshot_page` | Take a screenshot of the current browser page |
| `click_element` | Click an element in the browser |
| `type_text` | Type text into the browser |
| `think` | Record reasoning (no side effects) |
| `remember` | Store a memory for future sessions |
| `recall` | Search past memories by query |
| `forget` | Remove a specific memory |
| `create_plan` | Break a goal into a hierarchical task tree |
| `update_plan` | Update a plan node's status |
| `get_plan` | Retrieve the current plan |
| `get_feedback` | Query past user feedback |
| `request_review` | Ask another agent to review work |
| `respond_to_review` | Send review feedback |
| `delegate_task` | Delegate a task to another agent |
| `share_knowledge` | Share knowledge with another agent |
| `analyze_image` | Analyze an image using vision-capable LLM |
| `list_agents` | Discover other running agents |
| `send_message` | Send a message to another agent |
| `check_messages` | Read messages from other agents |
| `create_shared_workspace` | Create a shared directory for collaboration |
| `mount_workspace` | Mount an existing shared directory |
| `list_workspaces` | List available shared workspaces |
| `complete` | Mark the task as done |

Agent templates further curate which tools each role has access to (e.g., a Reviewer only gets `read_file`, `list_files`, and `think`).

### Agent Plugin System

Agents can be extended with custom tools via the plugin system. Plugins are discovered automatically from each agent's home directory.

**Plugin structure:**
```
~/.config/plugins/
  my-plugin/
    manifest.json    # Plugin metadata and tool definitions
    handler.js       # Tool implementation (default export)
```

**manifest.json format:**
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "tools": [{
    "name": "tool_name",
    "description": "Description for the LLM",
    "parameters": {
      "param1": { "type": "string", "description": "...", "required": true }
    },
    "handler": "handler.js",
    "requiresApproval": false
  }]
}
```

**handler.js format:**
```js
export default async function(params, context) {
  // params: tool arguments from the agent
  // context: { pid, cwd, kernel }
  return "result string";
}
```

**API endpoints:**
- `GET /api/plugins/:pid` — list loaded plugins for an agent
- `POST /api/plugins/:pid/install` — install a plugin (body: `{ manifest, handlers }`)

A sample plugin is included at `kernel/src/plugins/sample-weather/` as a template.

### Dual-Mode Architecture

The UI works in two modes with zero configuration:

- **Kernel mode**: When the kernel server is running on port 3001, the UI connects via WebSocket. Agents are real processes with real terminals and filesystems. A green "Kernel" indicator shows in the menu bar.
- **Mock mode**: When no kernel server is detected, the UI falls back to client-side agent simulation using LLM API calls directly. An orange "Mock" indicator shows in the menu bar.

## UI Features

### Mission Control (Agent Center)

The dashboard shows all agents in a grid of live virtual desktop previews. Each preview is a miniature rendering of the agent's workspace showing their terminal, files, and browser activity.

- **Metrics bar**: Total agents, active/idle/completed/failed counts, kernel uptime, memory usage
- **Filtering**: Show all, active only, completed, or failed agents
- **View modes**: Grid (desktop previews) or compact list
- **Detach**: Open any agent's desktop in a separate browser window

### Agent VM

Click into any agent to see their full virtual desktop with:

- **Live terminal** (xterm.js) showing real shell output with ANSI colors
- **Agent logs** with color-coded entries (purple: thoughts, blue: actions, cyan: observations)
- **Floating control bar**: Status, PID, GitHub sync toggle, emergency stop
- **Approval modal**: When an agent needs permission, a dialog appears over the desktop

### Virtual Desktop

Each agent's desktop is a self-contained view showing:

- **Terminal window**: Real TTY output when connected to kernel, log fallback otherwise
- **File manager**: Real directory listing from the agent's home dir via kernel API
- **Code editor**: Most recently created file's content
- **Browser**: URL and content summary when agent is browsing
- **Activity monitor**: PID, phase, step count, progress bar
- **Dock**: Icons highlight and pulse based on the agent's current activity

### Desktop Environment

The host OS itself is a full desktop environment:

- **Window manager**: Draggable, resizable windows with macOS-style traffic lights
- **Dock**: App launcher with hover animations and open-app indicators
- **Smart Bar** (Cmd+K): Spotlight-style search powered by LLM
- **Desktop widgets**: Weather, calendar, music player
- **Context menu**: Right-click for quick actions
- **Built-in apps**: File Explorer, Terminal, Code Editor, Notes, Photos, Chat, Calculator, Browser, Settings

## Project Structure

```
.
├── App.tsx                      # Main app — dual-mode runtime, window management
├── types.ts                     # Frontend types (Agent, WindowState, RuntimeMode)
├── index.html                   # HTML shell with Tailwind CDN config
├── vite.config.ts               # Vite build configuration
├── vitest.config.ts             # Test runner configuration (Vitest + v8 coverage)
├── .env.example                 # Environment variable template (LLM keys, auth, cluster)
├── scripts/
│   └── setup.sh                 # Automated install & prereq checker
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions — lint + test on push/PR
├── components/
│   ├── os/
│   │   ├── Window.tsx           # Draggable/resizable window container
│   │   ├── Dock.tsx             # Application launcher dock
│   │   ├── VirtualDesktop.tsx   # Agent desktop compositor
│   │   ├── XTerminal.tsx        # xterm.js React wrapper (Tokyo Night theme)
│   │   ├── VNCViewer.tsx        # noVNC RFB client for graphical agent desktops
│   │   ├── ErrorBoundary.tsx    # React error boundary with recovery UI
│   │   ├── DesktopWidgets.tsx   # Weather, calendar, music widgets
│   │   ├── ContextMenu.tsx      # Right-click menu
│   │   ├── LoginScreen.tsx      # Full-screen authentication UI
│   │   └── UserMenu.tsx         # User dropdown menu in menu bar
│   └── apps/
│       ├── AgentDashboard.tsx   # Mission Control with metrics and filtering
│       ├── AgentVM.tsx          # Full agent view with terminal + logs tabs
│       ├── AgentTimeline.tsx    # Vertical timeline of agent think/act/observe steps
│       ├── TerminalApp.tsx      # System terminal (real or mock)
│       ├── ChatApp.tsx          # LLM chat interface
│       ├── FileExplorer.tsx     # File browser
│       ├── CodeEditorApp.tsx    # Code editor
│       └── ...                  # Notes, Photos, Calculator, Browser, Settings, etc.
├── services/
│   ├── kernelClient.ts          # WebSocket client with reconnection logic
│   ├── useKernel.ts             # React hook bridging kernel state to components
│   └── geminiService.ts         # Gemini API integration (UI-side mock mode)
├── kernel/
│   └── src/
│       ├── Kernel.ts            # Core kernel orchestrator (15 subsystems)
│       ├── ProcessManager.ts    # PID allocation, signals, lifecycle
│       ├── VirtualFS.ts         # Real filesystem at /tmp/aether
│       ├── PTYManager.ts        # Terminal sessions (node-pty or docker exec)
│       ├── ContainerManager.ts  # Docker container sandboxing + GPU passthrough
│       ├── VNCManager.ts        # WebSocket-to-TCP proxy for noVNC streams
│       ├── BrowserManager.ts    # Playwright browser session management
│       ├── MemoryManager.ts     # 4-layer agent memory with FTS5 + profiles
│       ├── CronManager.ts       # Cron scheduling + event triggers
│       ├── SnapshotManager.ts   # VM-checkpoint-style agent snapshots
│       ├── AuthManager.ts       # User auth, JWT tokens, password hashing
│       ├── ClusterManager.ts    # Hub-and-spoke distributed kernel
│       ├── PluginManager.ts     # Agent plugin loading and management
│       ├── plugins/             # Sample plugins
│       │   └── sample-weather/  # Template plugin with weather tool
│       ├── StateStore.ts        # SQLite persistence (processes, users, metrics, memories, plans, feedback, profiles)
│       ├── EventBus.ts          # Typed pub/sub IPC
│       └── __tests__/           # Kernel unit tests (Vitest)
├── runtime/
│   └── src/
│       ├── AgentLoop.ts         # Think-act-observe cycle (memory-aware)
│       ├── tools.ts             # 28+ agent tools (fs, shell, web, memory, plan, collab, vision)
│       ├── templates.ts         # Pre-built agent templates (8 presets)
│       ├── reflection.ts        # Post-task self-reflection engine
│       ├── planner.ts           # Goal decomposition & hierarchical planning
│       ├── collaboration.ts     # Structured multi-agent protocols
│       ├── llm/                 # Multi-LLM provider abstraction
│       │   ├── LLMProvider.ts   # Base provider interface (+ vision)
│       │   ├── GeminiProvider.ts
│       │   ├── OpenAIProvider.ts
│       │   ├── AnthropicProvider.ts
│       │   ├── OllamaProvider.ts
│       │   └── index.ts         # Provider registry + fallback chain
│       └── __tests__/           # Runtime unit tests
├── server/
│   └── src/
│       ├── index.ts             # HTTP + WebSocket server
│       └── __tests__/           # Integration tests
└── shared/
    └── src/
        ├── protocol.ts          # Typed kernel protocol (commands + events)
        ├── constants.ts         # System configuration
        └── __tests__/           # Protocol tests
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS (CDN), glassmorphism design system |
| Icons | Lucide React |
| Terminal | xterm.js with FitAddon, Tokyo Night theme |
| VNC | noVNC (`@novnc/novnc`) RFB client |
| Backend | Node.js 22, tsx |
| WebSocket | ws library |
| AI | Multi-provider — Google Gemini (`@google/genai`), OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`), Ollama (local HTTP) |
| Database | better-sqlite3 |
| Containers | Docker (optional, auto-detected) |
| GPU | NVIDIA via `nvidia-container-toolkit` (optional) |
| Testing | Vitest, v8 coverage |
| CI | GitHub Actions (lint + test on push/PR) |
| Font | Inter (Google Fonts) |

## Roadmap

### Shipped

**v0.1 — Kernel Foundation:**
- [x] Full node-pty integration for proper SIGWINCH and terminal resizing
- [x] VNC/noVNC for rendering real graphical applications inside agent desktops
- [x] Multi-user authentication and per-user agent pools
- [x] Agent plugin system for custom tool discovery
- [x] GPU passthrough for agents running ML workloads
- [x] Distributed kernel foundation (hub-and-spoke clustering)
- [x] Snapshot/restore for agent process state (like VM checkpoints)
- [x] Shared filesystem mounts between cooperating agents
- [x] Agent history timeline in Mission Control
- [x] Multi-LLM provider abstraction (Gemini, OpenAI, Anthropic, Ollama)
- [x] Pre-built agent templates with curated tool sets
- [x] CI pipeline (GitHub Actions — lint + Vitest)
- [x] Automated setup script (`scripts/setup.sh`)

**v0.2 — Real Apps:**
- [x] Playwright-based browser (replaces iframe approach)
- [x] Monaco code editor with multi-tab, file tree, language detection
- [x] System monitor with real-time CPU/memory/disk/network charts
- [x] Music player with Web Audio visualizer and TTS
- [x] PDF viewer with AI summarization
- [x] Spreadsheet with formula engine (SUM, AVERAGE, COUNT, etc.)
- [x] Drawing canvas with 8 tools, undo/redo, export
- [x] Markdown writer with live preview and AI assist
- [x] Notification center with bell icon and history
- [x] Keyboard shortcut system (40+ shortcuts, Cmd+/ overlay)
- [x] Multi-desktop workspaces with Ctrl+Left/Right switching
- [x] Dark/light/system theme toggle with CSS custom properties

**v0.3 — Agent Intelligence:**
- [x] Cross-session agent memory (4-layer: episodic, semantic, procedural, social) with FTS5 search
- [x] Cron scheduling and event-triggered agent spawning
- [x] Self-reflection system with quality ratings and lessons learned
- [x] Goal decomposition and hierarchical planning
- [x] User feedback system (thumbs up/down per action)
- [x] Agent profiles with auto-tracked performance stats
- [x] Structured collaboration protocols (review, delegate, broadcast, share)
- [x] Vision capability across all 4 LLM providers
- [x] Memory Inspector app with search, filters, and agent profiles
- [x] Plan Viewer and Feedback UI in Agent VM
- [x] Automation Manager in Settings for cron jobs and triggers

### Up Next (v0.4 — Ecosystem)

- [ ] App Store framework (manifest, sandbox, permissions, SDK)
- [ ] Plugin Marketplace with searchable catalog
- [ ] External integrations (GitHub, Slack, Discord — bidirectional)
- [ ] REST API & SDKs (TypeScript, Python, CLI)
- [ ] Agent template marketplace with ratings
- [ ] Webhook & event system (inbound/outbound)
- [ ] Lightweight skill format (simpler than full React apps)

## Snapshots (Agent Checkpoints)

Agents can be snapshotted and restored, similar to VM checkpoints. A snapshot captures the agent's full state: process info, home directory, logs, and IPC queue.

**How it works:**
- Snapshots pause the agent (SIGSTOP), capture state + tarball the home directory, then resume (SIGCONT)
- Stored at `/tmp/aether/var/snapshots/` as JSON metadata + `.tar.gz` filesystem archive
- Restoring creates a new process with a new PID, extracts the saved filesystem, and carries over configuration

**API (HTTP):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/snapshots` | List all snapshots |
| `GET` | `/api/snapshots/:pid` | List snapshots for a specific agent |
| `POST` | `/api/snapshots/:pid` | Create a snapshot (body: `{ description? }`) |
| `POST` | `/api/snapshots/:id/restore` | Restore from a snapshot (returns `{ newPid }`) |
| `DELETE` | `/api/snapshots/:id` | Delete a snapshot |

**WebSocket commands:** `snapshot.create`, `snapshot.list`, `snapshot.restore`, `snapshot.delete`

## Shared Filesystem Mounts

Cooperating agents can share directories. Shared mounts live at `/tmp/aether/shared/` and are symlinked into each agent's home directory.

**How it works:**
- An agent creates a shared workspace (e.g., `project-data`)
- Other agents mount it into their home at `~/shared/project-data`
- Uses `fs.symlink()` for simplicity; path traversal checks resolve symlinks to ensure safety

**Agent tools:**
| Tool | Description |
|------|-------------|
| `create_shared_workspace` | Create a new shared directory |
| `mount_workspace` | Mount an existing shared dir into `~/shared/{name}` |
| `list_workspaces` | Show all shared workspaces and which agents have them mounted |

**API (HTTP):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shared` | List all shared mounts |
| `POST` | `/api/shared` | Create a shared mount (body: `{ name, ownerPid }`) |
| `POST` | `/api/shared/mount` | Mount for an agent (body: `{ pid, name, mountPoint? }`) |
| `POST` | `/api/shared/unmount` | Unmount from an agent (body: `{ pid, name }`) |

**WebSocket commands:** `fs.createShared`, `fs.mountShared`, `fs.unmountShared`, `fs.listShared`

## Agent History Timeline

Mission Control now includes a full history timeline for agent decisions, accessible from two places:

- **AgentVM sidebar**: A "Timeline" tab alongside "Agent Logs" and "Terminal" shows a chronological vertical timeline of all agent thoughts, actions, and observations with color-coded phase icons
- **Mission Control dashboard**: A "History" button reveals an archive of all past (completed/failed) agent runs. Clicking any past agent opens its full timeline

The timeline loads historical data from `GET /api/history/logs/:pid` and subscribes to live events for real-time updates.

## Graphical Desktops (VNC/noVNC)

Agents can run graphical applications (browsers, IDEs, file managers) inside their Docker containers. The graphical output is streamed to the browser via VNC.

**How it works:**
- Graphical agents run Xvfb (virtual framebuffer) on display `:99` and x11vnc inside their container
- The kernel's VNCManager creates a WebSocket-to-TCP proxy for each graphical agent
- The UI renders the remote desktop using the noVNC RFB client in the VNCViewer component
- When VNC is active, the VNC stream replaces the simulated windows in the agent's virtual desktop

**Requirements:**
- Docker must be available on the host
- The container image must include `Xvfb`, `x11vnc`, and basic X11 utilities
- Use `aether-desktop:latest` or provide a custom image with `sandbox.image`
- Install noVNC in the frontend: `npm install @novnc/novnc`

**Building the graphical container image:**
```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    xvfb x11vnc x11-utils xterm \
    && rm -rf /var/lib/apt/lists/*
```
```bash
docker build -t aether-desktop:latest .
```

**Spawning a graphical agent (WebSocket):**
```json
{
  "type": "process.spawn",
  "id": "msg_1",
  "config": {
    "role": "Designer",
    "goal": "Create UI mockups",
    "sandbox": {
      "type": "container",
      "graphical": true,
      "networkAccess": true
    }
  }
}
```

**Running graphical commands:**
```json
{ "type": "vnc.exec", "id": "msg_2", "pid": 1, "command": "xterm &" }
```

**API (HTTP):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vnc/:pid` | Get VNC proxy info (wsPort, display) for an agent |

**WebSocket commands:** `vnc.info`, `vnc.exec`
**WebSocket events:** `vnc.started`, `vnc.stopped`

## GPU Support

Agents running ML workloads can access NVIDIA GPUs inside their Docker containers via `nvidia-container-toolkit`.

**Requirements:**
- NVIDIA GPU(s) on the host
- [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) installed
- `nvidia-smi` accessible from the host

**How it works:**
- On kernel boot, ContainerManager runs `nvidia-smi` to detect available GPUs
- When spawning an agent with `sandbox.gpu.enabled = true`, the `--gpus` flag is passed to `docker run`
- GPU allocations are tracked per-process to prevent over-allocation
- GPU stats (utilization, temperature, power) are available via REST API

**Spawning a GPU-enabled agent (WebSocket):**
```json
{
  "type": "process.spawn",
  "id": "msg_1",
  "config": {
    "role": "Coder",
    "goal": "Train a neural network",
    "sandbox": {
      "type": "container",
      "gpu": { "enabled": true },
      "networkAccess": true,
      "image": "nvidia/cuda:12.0-base"
    }
  }
}
```

**GPU allocation options:**
- `gpu.enabled: true` — use all available GPUs (`--gpus all`)
- `gpu.count: 2` — use N GPUs (`--gpus 2`)
- `gpu.deviceIds: ["0", "1"]` — use specific GPU devices (`--gpus "device=0,1"`)

**API (HTTP):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gpu` | List GPUs, allocations, and availability |
| `GET` | `/api/gpu/stats` | Real-time GPU utilization, temperature, power |

**WebSocket commands:** `gpu.list`, `gpu.stats`
**WebSocket events:** `gpu.allocated`, `gpu.released`

**UI integration:**
- Mission Control metrics bar shows GPU count when GPUs are detected
- Deploy Agent modal shows a "GPU Enabled" toggle when GPUs are available
- Activity monitor widget shows GPU allocation per agent
- A "Graphical Desktop" toggle enables VNC for the new agent

## Authentication

Aether OS includes a multi-user authentication system. Multiple users can log in and manage their own isolated agent pools.

### Default Admin Account

On first boot (when no users exist), the kernel automatically creates a default admin account:

- **Username:** `admin`
- **Password:** `aether`

Credentials are logged to the console at startup. **Change this password after first login.**

### Login & Registration

The UI displays a full-screen login page before the desktop loads. Users can:

- **Log in** with username/password
- **Register** a new account (if registration is open)

Registration can be disabled by setting `AETHER_REGISTRATION_OPEN=false`.

### Token System

Authentication uses HMAC-SHA256 signed JWTs (implemented with Node.js `crypto`, no external dependencies):

- Tokens expire after 24 hours
- Tokens are stored in `localStorage` on the client
- The signing secret comes from `AETHER_SECRET` env var, or is randomly generated at boot
- WebSocket connections include the token as a query parameter
- HTTP requests use `Authorization: Bearer <token>` header or `aether_token` cookie

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/login` | No | Login with `{ username, password }`, returns `{ token, user }` |
| `POST` | `/api/auth/register` | No | Register with `{ username, password, displayName? }` |
| `GET` | `/health` | No | Health check |
| All others | `*` | Yes | Require valid Bearer token |

### Per-User Isolation

- Each user's spawned agents are tagged with `ownerUid`
- Process listing filters by the requesting user (admins see all)
- Signal sending verifies process ownership
- Per-user directories exist at `/tmp/aether/users/{userId}/`

## Clustering

Aether OS supports distributing the kernel across multiple hosts using a hub-and-spoke model.

### Architecture

- **Hub**: The primary kernel that the UI connects to. Accepts node registrations and routes commands.
- **Node**: A secondary kernel that registers with the hub and executes commands locally.
- **Standalone**: Default mode. No clustering, single host.

### Configuration

| Env Variable | Values | Description |
|-------------|--------|-------------|
| `AETHER_CLUSTER_ROLE` | `hub`, `node`, `standalone` | Cluster role (default: `standalone`) |
| `AETHER_HUB_URL` | `ws://host:port` | Hub WebSocket URL (required for nodes) |
| `AETHER_NODE_HOST` | hostname/IP | This node's hostname for the hub to track |
| `AETHER_NODE_CAPACITY` | number | Max processes on this node (default: 16) |

### Hub Mode

```bash
AETHER_CLUSTER_ROLE=hub npm run dev:kernel
```

The hub:
- Accepts node registrations on the `/cluster` WebSocket path
- Monitors node health via heartbeats (every 10s, offline after 35s)
- Routes `process.spawn` to the least-loaded node when local capacity is full
- Proxies commands for remote processes to the appropriate node
- Broadcasts cluster events (nodeJoined, nodeLeft, nodeOffline) to the UI

### Node Mode

```bash
AETHER_CLUSTER_ROLE=node AETHER_HUB_URL=ws://hub-host:3001 npm run dev:kernel
```

The node:
- Registers with the hub on boot
- Sends heartbeat every 10s with load, capacity, and resource info
- Receives and executes commands forwarded from the hub
- Reports events back to the hub for UI broadcast

### UI Integration

When clustering is active:
- **Menu bar**: Shows "Hub · N nodes" or "Node · Connected to hub" badge
- **Agent Dashboard**: Displays cluster capacity and per-node breakdown in the metrics bar

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cluster` | Returns `ClusterInfo` (role, nodes, capacity, load) |

**WebSocket commands:** `cluster.status`, `cluster.nodes`, `cluster.drain`

## License

MIT
