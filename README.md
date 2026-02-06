<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Aether OS

**A purpose-built operating system for AI agents.**

Real processes. Real filesystems. Real terminals. Beautiful UI.

[Getting Started](#getting-started) | [Architecture](#architecture) | [How It Works](#how-it-works) | [Roadmap](#roadmap)

</div>

---

Aether OS is a from-scratch operating system designed for AI agents to live and work in. Each agent runs as a real process with its own sandboxed filesystem, terminal session, and execution environment. Humans observe and interact with agents through a Mission Control interface inspired by macOS.

Unlike approaches that drop an AI into an existing Linux VM, Aether OS is built from the ground up with AI agents as first-class citizens. The kernel, process model, and UI are all designed around the agent lifecycle: think, act, observe.

## What It Does

- **Spawns AI agents as real OS processes** with PIDs, signals, and lifecycle management
- **Gives each agent a sandboxed environment** with its own home directory, shell, and filesystem
- **Runs agents through a think-act-observe loop** powered by Gemini (or heuristic fallback)
- **Displays each agent's virtual desktop** in a Mission Control grid, like monitoring multiple workstations
- **Provides real terminal sessions** with xterm.js rendering ANSI output from actual shell processes
- **Persists state to SQLite** so kernel state, agent logs, and file metadata survive restarts
- **Supports Docker container sandboxing** for real process isolation (falls back to child_process)
- **Enables agent-to-agent communication** through a kernel-managed IPC message queue

## Getting Started

**Prerequisites:** Node.js 22+, npm

```bash
# Clone and install
git clone https://github.com/bykadzu/Aether-agent-os.git
cd Aether-agent-os
npm install
cd server && npm install && cd ..
cd kernel && npm install && cd ..
cd runtime && npm install && cd ..
```

### Run in UI-only mode (mock agents, no backend needed)

```bash
npm run dev
```

Opens on `http://localhost:3000`. Agents run client-side with Gemini API calls. Set `GEMINI_API_KEY` in `.env.local` for real LLM reasoning, or leave it blank for heuristic demo mode.

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

### Optional: Docker sandboxing

If Docker is available on the host, agent processes will automatically run inside containers with mounted volumes and resource limits. If Docker isn't available, the kernel falls back to `child_process` with no configuration needed.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    React UI (Vite)                        │
│                                                          │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │   Mission    │  │  Agent   │  │  Virtual Desktop   │  │
│  │   Control    │  │   VM     │  │  (per agent)       │  │
│  │   (grid)     │  │  (full)  │  │                    │  │
│  └─────────────┘  └──────────┘  └────────────────────┘  │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │  KernelClient (WS)   │  │  useKernel() React hook  │  │
│  └──────────────────────┘  └──────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│                WebSocket + HTTP (port 3001)               │
├──────────────────────────────────────────────────────────┤
│                     Aether Kernel                        │
│                                                          │
│  ┌──────────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Process      │ │ Virtual  │ │ PTY Manager          │ │
│  │ Manager      │ │ FS       │ │ (real terminals)     │ │
│  │ (PIDs,       │ │ (/tmp/   │ │                      │ │
│  │  signals)    │ │  aether) │ │                      │ │
│  ├──────────────┤ ├──────────┤ ├──────────────────────┤ │
│  │ Container    │ │ State    │ │ Event Bus            │ │
│  │ Manager      │ │ Store    │ │ (typed pub/sub)      │ │
│  │ (Docker)     │ │ (SQLite) │ │                      │ │
│  └──────────────┘ └──────────┘ └──────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│                    Agent Runtime                         │
│                                                          │
│  ┌───────────────────┐  ┌────────────────────────────┐  │
│  │  Agent Loop        │  │  Tools                     │  │
│  │  (think-act-       │  │  read/write files, shell,  │  │
│  │   observe)         │  │  browse web, IPC, think,   │  │
│  │                    │  │  complete                   │  │
│  └───────────────────┘  └────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
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

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents from the agent's filesystem |
| `write_file` | Create or overwrite a file |
| `list_files` | List directory contents |
| `mkdir` | Create directories |
| `run_command` | Execute a shell command in the agent's terminal |
| `browse_web` | Fetch and extract text from a URL |
| `think` | Record reasoning (no side effects) |
| `list_agents` | Discover other running agents |
| `send_message` | Send a message to another agent |
| `check_messages` | Read messages from other agents |
| `complete` | Mark the task as done |

### Dual-Mode Architecture

The UI works in two modes with zero configuration:

- **Kernel mode**: When the kernel server is running on port 3001, the UI connects via WebSocket. Agents are real processes with real terminals and filesystems. A green "Kernel" indicator shows in the menu bar.
- **Mock mode**: When no kernel server is detected, the UI falls back to client-side agent simulation using the Gemini API directly. An orange "Mock" indicator shows in the menu bar.

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
- **Smart Bar** (Cmd+K): Spotlight-style search powered by Gemini
- **Desktop widgets**: Weather, calendar, music player
- **Context menu**: Right-click for quick actions
- **Built-in apps**: File Explorer, Terminal, Code Editor, Notes, Photos, Chat, Calculator, Browser, Settings

## Project Structure

```
.
├── App.tsx                      # Main app - dual-mode runtime, window management
├── types.ts                     # Frontend types (Agent, WindowState, RuntimeMode)
├── index.html                   # HTML shell with Tailwind CDN config
├── components/
│   ├── os/
│   │   ├── Window.tsx           # Draggable/resizable window container
│   │   ├── Dock.tsx             # Application launcher dock
│   │   ├── VirtualDesktop.tsx   # Agent desktop compositor
│   │   ├── XTerminal.tsx        # xterm.js React wrapper (Tokyo Night theme)
│   │   ├── DesktopWidgets.tsx   # Weather, calendar, music widgets
│   │   └── ContextMenu.tsx      # Right-click menu
│   └── apps/
│       ├── AgentDashboard.tsx   # Mission Control with metrics and filtering
│       ├── AgentVM.tsx          # Full agent view with terminal + logs tabs
│       ├── TerminalApp.tsx      # System terminal (real or mock)
│       ├── ChatApp.tsx          # Gemini chat interface
│       ├── FileExplorer.tsx     # File browser
│       ├── CodeEditorApp.tsx    # Code editor
│       └── ...                  # Notes, Photos, Calculator, Browser, etc.
├── services/
│   ├── kernelClient.ts          # WebSocket client with reconnection logic
│   ├── useKernel.ts             # React hook bridging kernel state to components
│   └── geminiService.ts         # Gemini API integration
├── kernel/
│   └── src/
│       ├── Kernel.ts            # Core kernel orchestrator
│       ├── ProcessManager.ts    # PID allocation, signals, lifecycle
│       ├── VirtualFS.ts         # Real filesystem at /tmp/aether
│       ├── PTYManager.ts        # Terminal sessions (shell or docker exec)
│       ├── ContainerManager.ts  # Docker container sandboxing
│       ├── StateStore.ts        # SQLite persistence
│       └── EventBus.ts          # Typed pub/sub IPC
├── runtime/
│   └── src/
│       ├── AgentLoop.ts         # Think-act-observe execution cycle
│       └── tools.ts             # Agent tool definitions (fs, shell, web, ipc)
├── server/
│   └── src/
│       └── index.ts             # HTTP + WebSocket server
└── shared/
    └── src/
        ├── protocol.ts          # Typed kernel protocol (commands + events)
        └── constants.ts         # System configuration
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS (CDN), glassmorphism design system |
| Icons | Lucide React |
| Terminal | xterm.js with FitAddon, Tokyo Night theme |
| Backend | Node.js 22, tsx |
| WebSocket | ws library |
| AI | Google Gemini API (@google/genai) |
| Database | better-sqlite3 |
| Containers | Docker (optional, auto-detected) |
| Font | Inter (Google Fonts) |

## Roadmap

- [ ] Full node-pty integration for proper SIGWINCH and terminal resizing
- [ ] VNC/noVNC for rendering real graphical applications inside agent desktops
- [ ] Multi-user authentication and per-user agent pools
- [ ] Agent plugin system for custom tool discovery
- [ ] GPU passthrough for agents running ML workloads
- [ ] Distributed kernel across multiple hosts
- [ ] Snapshot/restore for agent process state (like VM checkpoints)
- [ ] Shared filesystem mounts between cooperating agents

## License

MIT
