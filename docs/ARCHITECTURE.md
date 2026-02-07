# Aether OS Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (port 3000)                          │
│                                                                     │
│   ┌───────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│   │Mission Control │  │  Agent VM    │  │  Desktop Apps          │  │
│   │ (agent grid)   │  │ (term+logs)  │  │  (files, chat, code…) │  │
│   └───────┬───────┘  └──────┬───────┘  └────────────┬───────────┘  │
│           │                 │                        │              │
│   ┌───────┴─────────────────┴────────────────────────┴───────────┐  │
│   │                    kernelClient.ts                            │  │
│   │          WebSocket + HTTP bridge to kernel                   │  │
│   └──────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ WebSocket (JSON)
                               │ port 3001
┌──────────────────────────────┼──────────────────────────────────────┐
│                        SERVER / TRANSPORT                            │
│                                                                     │
│   HTTP endpoints: /health, /api/auth/*, /api/processes, /api/gpu   │
│   WebSocket: /kernel (UI ↔ kernel), /cluster (node ↔ hub)         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                          KERNEL                                     │
│                                                                     │
│   ┌────────────────┐  ┌────────────┐  ┌──────────────────────┐     │
│   │ ProcessManager │  │ VirtualFS  │  │    PTYManager        │     │
│   │ PIDs, signals, │  │ /tmp/aether│  │  node-pty terminals  │     │
│   │ lifecycle      │  │ per-agent  │  │  or docker exec      │     │
│   └────────────────┘  └────────────┘  └──────────────────────┘     │
│                                                                     │
│   ┌────────────────┐  ┌────────────┐  ┌──────────────────────┐     │
│   │ContainerManager│  │ StateStore │  │     EventBus         │     │
│   │ Docker + GPU   │  │  SQLite    │  │  typed pub/sub       │     │
│   └────────────────┘  └────────────┘  └──────────────────────┘     │
│                                                                     │
│   ┌────────────────┐  ┌────────────┐  ┌──────────────────────┐     │
│   │ PluginManager  │  │ AuthManager│  │  ClusterManager      │     │
│   │ custom tools   │  │ JWT + users│  │  hub-and-spoke       │     │
│   └────────────────┘  └────────────┘  └──────────────────────┘     │
│                                                                     │
│   ┌────────────────┐  ┌────────────┐  ┌──────────────────────┐     │
│   │  VNCManager    │  │ SnapshotMgr│  │  BrowserManager      │     │
│   │ Xvfb + x11vnc │  │ pause/save │  │  Playwright          │     │
│   └────────────────┘  └────────────┘  └──────────────────────┘     │
│                                                                     │
│   ┌────────────────┐  ┌────────────┐                               │
│   │ MemoryManager  │  │ CronManager│                               │
│   │ FTS5 + 4-layer │  │ scheduling │                               │
│   └────────────────┘  └────────────┘                               │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                       AGENT RUNTIME                                 │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │                    AgentLoop                            │       │
│   │                                                         │       │
│   │   ┌─────────┐    ┌─────────┐    ┌───────────┐          │       │
│   │   │  THINK  │───→│   ACT   │───→│  OBSERVE  │──┐       │       │
│   │   │ Gemini  │    │  tools  │    │  results  │  │       │       │
│   │   └─────────┘    └─────────┘    └───────────┘  │       │       │
│   │       ↑                                        │       │       │
│   │       └────────────────────────────────────────┘       │       │
│   │                                                         │       │
│   │   Tools: file I/O, shell, web, IPC, memory, planning,   │       │
│   │          collaboration, vision, feedback, plugins       │       │
│   │   LLM: Gemini, OpenAI, Anthropic, Ollama (multi-LLM)   │       │
│   │   Intelligence: reflection, planner, collaboration      │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     SHARED PROTOCOL                                 │
│                                                                     │
│   60+ command types (UI → Kernel)                                  │
│   60+ event types  (Kernel → UI)                                   │
│   Discriminated unions — fully typed, no guessing                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Module Map

```
aether-os/
│
├── shared/                  # Shared types and protocol
│   └── src/
│       ├── protocol.ts      # ALL message types between UI ↔ kernel
│       └── constants.ts     # System limits, ports, defaults
│
├── kernel/                  # The OS kernel
│   └── src/
│       ├── Kernel.ts            # Orchestrator — boots everything
│       ├── ProcessManager.ts    # PID table, signals, lifecycle
│       ├── VirtualFS.ts         # Real filesystem at /tmp/aether
│       ├── PTYManager.ts        # Terminal sessions (node-pty)
│       ├── ContainerManager.ts  # Docker containers + GPU
│       ├── StateStore.ts        # SQLite persistence (WAL mode)
│       ├── EventBus.ts          # Typed event pub/sub
│       ├── PluginManager.ts     # Agent plugin loading
│       ├── SnapshotManager.ts   # Process save/restore
│       ├── AuthManager.ts       # Users, JWT, scrypt passwords
│       ├── VNCManager.ts        # Graphical desktop proxy
│       ├── ClusterManager.ts    # Distributed kernel nodes
│       ├── BrowserManager.ts    # Playwright browser sessions
│       ├── MemoryManager.ts     # 4-layer memory with FTS5, profiles
│       └── CronManager.ts       # Cron jobs + event triggers
│
├── runtime/                 # Agent execution engine
│   └── src/
│       ├── AgentLoop.ts     # Think-act-observe cycle (memory-aware)
│       ├── tools.ts         # 28+ built-in tools for agents
│       ├── reflection.ts    # Post-task self-reflection engine
│       ├── planner.ts       # Goal decomposition & planning
│       ├── collaboration.ts # Structured multi-agent protocols
│       ├── templates.ts     # 8 pre-built agent templates
│       └── llm/             # Multi-LLM provider abstraction
│           ├── LLMProvider.ts      # Base interface (+ vision)
│           ├── GeminiProvider.ts
│           ├── OpenAIProvider.ts
│           ├── AnthropicProvider.ts
│           ├── OllamaProvider.ts
│           └── index.ts            # Provider registry + fallback
│
├── server/                  # HTTP + WebSocket transport
│   └── src/
│       └── index.ts         # Boots kernel, serves API + WS
│
├── components/              # React UI
│   ├── os/                  # Desktop environment
│   │   ├── Window.tsx           # Draggable/resizable windows
│   │   ├── Dock.tsx             # App launcher bar
│   │   ├── DesktopWidgets.tsx   # Clock, weather, activity
│   │   ├── LoginScreen.tsx      # Authentication screen
│   │   ├── UserMenu.tsx         # User dropdown
│   │   ├── VirtualDesktop.tsx   # Agent's virtual desktop
│   │   ├── XTerminal.tsx        # xterm.js terminal wrapper
│   │   ├── ContextMenu.tsx      # Right-click menu
│   │   └── VNCViewer.tsx        # VNC stream display
│   │
│   └── apps/                # Applications (20+)
│       ├── AgentDashboard.tsx      # Mission Control
│       ├── AgentVM.tsx             # Single agent viewer (+ plan, feedback)
│       ├── AgentTimeline.tsx       # Thought/action history
│       ├── SmartBar.tsx            # Cmd+K spotlight search
│       ├── TerminalApp.tsx         # Host terminal
│       ├── ChatApp.tsx             # Multi-LLM chat
│       ├── FileExplorer.tsx        # File browser
│       ├── CodeEditorApp.tsx       # Monaco code editor
│       ├── BrowserApp.tsx          # Chromium/iframe browser
│       ├── NotesApp.tsx            # Notes (kernel FS persistence)
│       ├── CalculatorApp.tsx       # Calculator
│       ├── PhotosApp.tsx           # Photo gallery
│       ├── VideoPlayerApp.tsx      # Video player
│       ├── SheetsApp.tsx           # Spreadsheet with formulas
│       ├── CanvasApp.tsx           # Drawing canvas
│       ├── WriterApp.tsx           # Markdown writer
│       ├── MusicApp.tsx            # Music/audio player + TTS
│       ├── DocumentsApp.tsx        # PDF viewer
│       ├── SystemMonitorApp.tsx    # Real-time system monitor
│       ├── MemoryInspectorApp.tsx  # Agent memory browser
│       └── SettingsApp.tsx         # Settings (+ automation tab)
│
├── services/                # Frontend ↔ kernel bridge
│   ├── kernelClient.ts      # WebSocket client + HTTP API
│   ├── useKernel.ts          # React hook for kernel state
│   └── geminiService.ts      # Gemini API integration
│
├── data/
│   └── mockFileSystem.ts    # Fallback mock FS (UI-only mode)
│
├── App.tsx                  # Main React app (window manager)
├── types.ts                 # Frontend type definitions
├── index.tsx                # React entry point
└── index.html               # HTML shell
```

## Data Flow

### Spawning an Agent

```
User clicks "Deploy Agent"
        │
        ▼
  AgentDashboard.tsx
  calls kernel.spawnAgent({ role, goal })
        │
        ▼
  kernelClient.ts
  sends WebSocket: { type: 'process.spawn', config: {...} }
        │
        ▼
  server/index.ts
  forwards to kernel.handleCommand()
        │
        ├───→ ProcessManager.spawn()     → allocates PID, creates ProcessInfo
        ├───→ VirtualFS.mkdir()          → creates /home/{agent_uid}/
        ├───→ ContainerManager.create()  → (if sandbox.type='container') Docker
        ├───→ PTYManager.open()          → creates terminal session
        └───→ AgentLoop.run()            → starts think-act-observe cycle
                    │
                    ▼
              Emits events via EventBus:
              'process.spawned', 'agent.thought', 'agent.action', ...
                    │
                    ▼
              server broadcasts via WebSocket
                    │
                    ▼
              kernelClient.ts receives → useKernel.ts updates state
                    │
                    ▼
              React re-renders: dashboard, agent VM, logs
```

### Agent Tool Execution

```
AgentLoop calls Gemini API
        │
        ▼
  Gemini returns: { tool: "write_file", args: { path: "/report.md", content: "..." } }
        │
        ▼
  AgentLoop finds tool in toolMap
        │
        ▼
  tool.execute(args, context)
        │
        ├── VirtualFS.writeFile()  → writes to /tmp/aether/home/{uid}/report.md
        ├── StateStore.logAction() → records in SQLite
        └── EventBus.emit()        → 'agent.action', 'agent.file_created'
                │
                ▼
          UI updates in real time
```

### Terminal I/O

```
User types in XTerminal
        │
        ▼
  WebSocket: { type: 'tty.input', ttyId, data }
        │
        ▼
  PTYManager.write(ttyId, data)
        │
        ▼
  node-pty writes to pseudo-terminal
        │
        ▼
  PTY output callback fires
        │
        ▼
  EventBus: 'tty.output' { ttyId, data }
        │
        ▼
  WebSocket broadcast to UI
        │
        ▼
  XTerminal writes ANSI data to xterm.js
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **TypeScript everywhere** | Single type system from UI to kernel. Protocol changes caught at compile time. |
| **Discriminated unions for protocol** | Every message has a `type` field. No ambiguity, exhaustive switch matching. |
| **Event-driven kernel** | Loose coupling between subsystems. ProcessManager doesn't know about UI. |
| **Real filesystem (not in-memory)** | Agents can use standard file I/O. Survives restarts. Can inspect from host. |
| **node-pty over child_process** | Real terminal emulation — ANSI colors, cursor movement, interactive programs. |
| **SQLite over Postgres** | Zero config, embedded, fast synchronous reads. Perfect for single-node. |
| **Dual-mode UI** | Works without kernel (mock mode) for frontend development. |
| **Multi-LLM provider** | Gemini, OpenAI, Anthropic, Ollama with automatic fallback and per-agent selection. |
| **WebSocket over REST** | Real-time bidirectional communication. Events stream continuously. |
| **Monorepo with shared package** | Protocol types are the contract. Both sides import from `@aether/shared`. |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | (required) |
| `AETHER_PORT` | Kernel server port | `3001` |
| `AETHER_FS_ROOT` | Virtual filesystem root | `/tmp/aether` |
| `AETHER_SECRET` | JWT signing secret | auto-generated |
| `AETHER_CLUSTER_ROLE` | `hub` / `node` / `standalone` | `standalone` |
| `AETHER_HUB_URL` | Hub WebSocket URL (node mode) | — |
| `AETHER_NODE_HOST` | Node hostname for hub | `localhost` |
| `AETHER_NODE_CAPACITY` | Max processes per node | `16` |
| `AETHER_REGISTRATION_OPEN` | Allow new user signups | `true` |
