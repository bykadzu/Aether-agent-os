# Aether OS Architecture

> Last updated: 2026-02-13 (post-v0.5 — agent self-knowledge, functional desktop)

## System Overview

Aether OS is a two-layer system: a **Control Plane** (web UI) for managing agents and a **Workspace Plane** (Docker containers) where agents execute tasks in isolated Linux desktops.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BROWSER (PWA, port 3000)                        │
│                                                                     │
│   ┌───────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│   │Mission Control │  │  Agent VM    │  │  20+ Desktop Apps      │  │
│   │ (responsive)   │  │ (term+logs)  │  │  (files, code, chat…)  │  │
│   └───────┬───────┘  └──────┬───────┘  └────────────┬───────────┘  │
│           │                 │                        │              │
│   ┌───────┴─────────────────┴────────────────────────┴───────────┐  │
│   │              kernelClient.ts (session dedup)                  │  │
│   │        WebSocket + REST API bridge to kernel                 │  │
│   └──────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ WebSocket (JSON, batched)
                               │ port 3001 (TLS optional)
┌──────────────────────────────┼──────────────────────────────────────┐
│                        SERVER / TRANSPORT                            │
│                                                                     │
│   REST API: /api/v1/* (53 endpoints, OpenAPI spec)                 │
│   Static: /manifest.json, /sw.js, /icons/*                         │
│   Metrics: /metrics (Prometheus), /health                          │
│   WebSocket: /kernel (UI ↔ kernel), /cluster (node ↔ hub)         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        KERNEL (26 subsystems)                       │
│                                                                     │
│   CORE                          INTELLIGENCE                        │
│   ┌────────────────┐            ┌──────────────────┐                │
│   │ ProcessManager │            │ MemoryManager    │                │
│   │ VirtualFS      │            │ (4-layer + FTS5) │                │
│   │ PTYManager     │            ├──────────────────┤                │
│   │ EventBus       │            │ ModelRouter      │                │
│   │ StateStore     │            │ (smart routing)  │                │
│   └────────────────┘            └──────────────────┘                │
│                                                                     │
│   CONTAINERS                    SECURITY                            │
│   ┌────────────────┐            ┌──────────────────┐                │
│   │ContainerManager│            │ AuthManager      │                │
│   │ (Docker + GPU) │            │ (JWT, MFA/TOTP,  │                │
│   ├────────────────┤            │  orgs, teams,    │                │
│   │ VNCManager     │            │  granular RBAC)  │                │
│   │ (WS-to-TCP proxy)│            ├──────────────────┤                │
│   ├────────────────┤            │ AuditLogger      │                │
│   │ BrowserManager │            │ ResourceGovernor │                │
│   │ (Playwright)   │            └──────────────────┘                │
│   └────────────────┘                                                │
│                                                                     │
│   ECOSYSTEM                     OBSERVABILITY                       │
│   ┌────────────────┐            ┌──────────────────┐                │
│   │ AppManager     │            │ MetricsExporter  │                │
│   │ PluginRegistry │            │ (Prometheus)     │                │
│   │ IntegrationMgr │            ├──────────────────┤                │
│   │ TemplateManager│            │ ToolCompatLayer  │                │
│   │ SkillManager   │            │ (LangChain +     │                │
│   │ WebhookManager │            │  OpenAI compat)  │                │
│   │ (retry + DLQ)  │            └──────────────────┘                │
│   └────────────────┘                                                │
│                                                                     │
│   INFRASTRUCTURE                                                    │
│   ┌────────────────┐  ┌────────────┐  ┌──────────────────────┐     │
│   │ ClusterManager │  │ CronManager│  │  RemoteAccessManager │     │
│   │ PluginManager  │  │ SnapshotMgr│  │  (SSH + Tailscale)   │     │
│   └────────────────┘  └────────────┘  └──────────────────────┘     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                       AGENT RUNTIME                                 │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │                    AgentLoop                            │       │
│   │                                                         │       │
│   │   ┌─────────┐    ┌─────────┐    ┌───────────┐          │       │
│   │   │  THINK  │───>│   ACT   │───>│  OBSERVE  │──┐       │       │
│   │   │  (LLM)  │    │ (tools) │    │ (results) │  │       │       │
│   │   └─────────┘    └─────────┘    └───────────┘  │       │       │
│   │       ^                                        │       │       │
│   │       └────────────────────────────────────────┘       │       │
│   │                                                         │       │
│   │   Tools: 28+ (file I/O, shell, web, IPC, memory,      │       │
│   │          planning, collaboration, vision, feedback)     │       │
│   │   LLM: Gemini 3, GPT-5, Claude Opus 4, Ollama         │       │
│   │   Guards: prompt injection detection, input validation  │       │
│   │   Tracing: OpenTelemetry spans per loop iteration       │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     SHARED PROTOCOL                                 │
│                                                                     │
│   100+ command types (UI -> Kernel)                                │
│   100+ event types  (Kernel -> UI)                                 │
│   Discriminated unions — fully typed, no guessing                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Module Map

```
Aether_Agent_OS/
│
├── shared/                  # Shared types and protocol
│   └── src/
│       └── protocol.ts      # ALL message types (100+ commands, 100+ events)
│
├── kernel/                  # The OS kernel (26 subsystems)
│   └── src/
│       ├── Kernel.ts            # Orchestrator — boots and wires everything
│       ├── EventBus.ts          # Typed event pub/sub (dedup, batching)
│       ├── ProcessManager.ts    # PID table, signals, priority scheduling
│       ├── VirtualFS.ts         # Sandboxed filesystem at ~/.aether
│       ├── PTYManager.ts        # Terminal sessions (node-pty / docker exec)
│       ├── ContainerManager.ts  # Docker containers + GPU passthrough
│       ├── StateStore.ts        # SQLite persistence (WAL mode, 15+ tables)
│       ├── AuthManager.ts       # JWT, scrypt, MFA/TOTP, orgs/teams, RBAC policies
│       ├── MemoryManager.ts     # 4-layer memory (episodic/semantic/procedural/social)
│       ├── CronManager.ts       # Cron jobs + event triggers
│       ├── SnapshotManager.ts   # Atomic process save/restore
│       ├── VNCManager.ts        # WebSocket-to-TCP VNC proxy (ws library)
│       ├── BrowserManager.ts    # Playwright browser sessions
│       ├── ClusterManager.ts    # Hub-and-spoke distributed kernel
│       ├── PluginManager.ts     # Agent plugin loading
│       ├── AppManager.ts        # App store + lifecycle
│       ├── WebhookManager.ts    # Outbound/inbound webhooks, retry + DLQ
│       ├── PluginRegistryManager.ts  # Plugin marketplace
│       ├── IntegrationManager.ts     # GitHub, Slack, S3, Discord
│       ├── TemplateManager.ts        # Agent template marketplace
│       ├── SkillManager.ts           # YAML declarative skills
│       ├── RemoteAccessManager.ts    # SSH tunnels + Tailscale VPN
│       ├── ResourceGovernor.ts       # Per-agent quotas, runaway detection
│       ├── AuditLogger.ts            # Append-only audit trail
│       ├── ModelRouter.ts            # Smart model routing (flash/standard/frontier)
│       ├── MetricsExporter.ts        # Prometheus metrics at /metrics
│       ├── ToolCompatLayer.ts        # LangChain/OpenAI tool import/export
│       └── __tests__/               # 900+ unit tests
│
├── runtime/                 # Agent execution engine
│   └── src/
│       ├── AgentLoop.ts     # Think-act-observe (memory-aware, context compaction)
│       ├── tools.ts         # 28+ built-in tools
│       ├── reflection.ts    # Post-task self-reflection
│       ├── planner.ts       # Hierarchical goal decomposition
│       ├── collaboration.ts # Multi-agent protocols
│       ├── guards.ts        # Prompt injection detection
│       ├── tracing.ts       # OpenTelemetry instrumentation
│       ├── templates.ts     # 16 pre-built agent templates
│       └── llm/             # Multi-LLM provider abstraction
│           ├── GeminiProvider.ts    # Google Gemini 3
│           ├── OpenAIProvider.ts    # OpenAI GPT-5
│           ├── AnthropicProvider.ts # Anthropic Claude Opus 4
│           └── OllamaProvider.ts    # Local models
│
├── server/                  # HTTP + WebSocket transport
│   └── src/
│       ├── index.ts         # Boots kernel, TLS, WS session dedup
│       ├── routes/v1.ts     # REST API v1 (53 endpoints)
│       └── openapi.ts       # OpenAPI 3.0 spec generator
│
├── components/              # React UI (PWA)
│   ├── os/                  # Desktop environment
│   │   ├── Window.tsx           # Draggable/resizable + edge snapping
│   │   ├── Dock.tsx             # App launcher (responsive)
│   │   ├── MenuBar.tsx          # Top bar (responsive collapse)
│   │   ├── LoginScreen.tsx      # JWT auth + MFA
│   │   ├── VNCViewer.tsx        # VNC stream + clipboard sync
│   │   ├── XTerminal.tsx        # xterm.js terminal
│   │   └── ShortcutOverlay.tsx  # Keyboard shortcut help
│   │
│   └── apps/                # 20+ applications
│       ├── AgentDashboard.tsx      # Mission Control (responsive grid)
│       ├── AgentVM.tsx             # Agent viewer (terminal, plan, feedback)
│       ├── CodeEditorApp.tsx       # Monaco code editor
│       ├── BrowserApp.tsx          # Chromium/iframe browser
│       ├── FileExplorer.tsx        # File browser
│       ├── TerminalApp.tsx         # Host terminal
│       ├── ChatApp.tsx             # Multi-LLM chat
│       ├── SheetsApp.tsx           # Spreadsheet with formula engine
│       ├── CanvasApp.tsx           # Drawing canvas
│       ├── WriterApp.tsx           # Markdown writer
│       ├── MemoryInspectorApp.tsx  # Agent memory browser
│       ├── SystemMonitorApp.tsx    # Real-time metrics
│       └── SettingsApp.tsx         # Settings, orgs, automation
│
├── services/                # Frontend services
│   ├── kernelClient.ts      # WebSocket client (session dedup, batching)
│   ├── useKernel.ts         # React hook for kernel state
│   └── shortcutManager.ts   # Scope-aware keyboard shortcuts
│
├── public/                  # PWA assets
│   ├── manifest.json        # Web app manifest
│   ├── sw.js                # Service worker (cache-first static)
│   └── icons/               # App icons (SVG)
│
├── helm/aether-os/          # Kubernetes Helm chart
├── docker-compose.yml       # One-command deployment
├── Dockerfile               # Kernel multi-stage build
├── Dockerfile.ui            # UI nginx build
├── Dockerfile.desktop       # Agent desktop image (XFCE4)
└── scripts/doctor.ts        # Setup diagnostic tool
```

## Data Flow

### Spawning an Agent

```
User clicks "Deploy Agent"
        |
        v
  AgentDashboard.tsx
  calls kernel.spawnAgent({ role, goal })
        |
        v
  kernelClient.ts
  sends WebSocket: { type: 'process.spawn', config: {...} }
        |
        v
  server/index.ts
  forwards to kernel.handleCommand()
        |
        |---> ProcessManager.spawn()     -> allocates PID, priority queue
        |---> ResourceGovernor.check()   -> verify quota not exceeded
        |---> VirtualFS.mkdir()          -> creates /home/{agent_uid}/
        |---> ContainerManager.create()  -> (if Docker) isolated container
        |---> PTYManager.open()          -> creates terminal session
        |---> AuditLogger.log()          -> records spawn event
        '---> AgentLoop.run()            -> starts think-act-observe cycle
                    |
                    v
              Emits events via EventBus (deduped, batched):
              'process.spawned', 'agent.thought', 'agent.action', ...
                    |
                    v
              server broadcasts via WebSocket (50ms batch window)
                    |
                    v
              React re-renders: dashboard, agent VM, logs
```

### Agent Tool Execution

```
AgentLoop calls LLM (Gemini/GPT/Claude/Ollama)
        |
        v
  LLM returns: { tool: "write_file", args: { path: "/report.md", content: "..." } }
        |
        v
  guards.ts validates args (prompt injection check)
        |
        v
  tracing.ts creates OpenTelemetry span
        |
        v
  tool.execute(args, context)
        |
        |-- VirtualFS.writeFile()  -> atomic write to ~/.aether/home/{uid}/
        |-- StateStore.logAction() -> records in SQLite
        |-- ResourceGovernor.record() -> track token/step usage
        '-- EventBus.emit()        -> 'agent.action'
                |
                v
          UI updates in real time
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **TypeScript everywhere** | Single type system from UI to kernel. Protocol changes caught at compile time. |
| **Discriminated unions for protocol** | Every message has a `type` field. Exhaustive switch matching, no ambiguity. |
| **Event-driven kernel** | Loose coupling — 26 subsystems communicate via EventBus, not direct calls. |
| **SQLite (not Postgres)** | Zero config, embedded, synchronous reads. Scales to 100+ agents on single node. |
| **Real filesystem at ~/.aether** | Agents use standard file I/O. Survives reboots. Can inspect from host. |
| **node-pty for terminals** | Real terminal emulation — ANSI colors, cursor, interactive programs. |
| **Multi-LLM with fallback** | Gemini, GPT, Claude, Ollama. Per-agent selection. Auto-fallback on failure. |
| **WebSocket (not REST) for events** | Real-time bidirectional. 50ms batching reduces frame overhead at scale. |
| **Docker for agent isolation** | Full Linux desktops per agent. GPU passthrough. VNC for human takeover. |
| **Monorepo + @aether/shared** | Protocol types are the contract. Both sides import from shared package. |
| **PWA (not Electron)** | Installable on any device. Service worker for offline shell. No native deps. |
| **Deny-by-default RBAC** | Fine-grained permission policies. Admin bypass. Wildcard matching. |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | (required for agents) |
| `OPENAI_API_KEY` | OpenAI API key | (optional) |
| `ANTHROPIC_API_KEY` | Anthropic API key | (optional) |
| `AETHER_PORT` | Kernel server port | `3001` |
| `AETHER_FS_ROOT` | Virtual filesystem root | `~/.aether` |
| `AETHER_SECRET` | JWT signing secret | (persistent, auto-generated) |
| `TLS_CERT_PATH` | TLS certificate path | (optional, enables HTTPS) |
| `TLS_KEY_PATH` | TLS private key path | (optional, enables HTTPS) |
| `AETHER_CLUSTER_ROLE` | `hub` / `node` / `standalone` | `standalone` |
| `AETHER_REGISTRATION_OPEN` | Allow new user signups | `true` |

## Version History

| Version | Theme | Key Additions |
|---------|-------|---------------|
| v0.1 | Foundation | Kernel, ProcessManager, VirtualFS, PTY, Docker, SQLite |
| v0.2 | Real Apps | Playwright browser, Monaco editor, 18 desktop apps, shortcuts |
| v0.3 | Intelligence | 4-layer memory, planning, reflection, vision, collaboration |
| v0.4 | Ecosystem | REST API, webhooks, Slack/GitHub/S3/Discord, plugin marketplace, CLI, SDK |
| v0.5 | Production | Resource governance, audit logging, Prometheus, TLS, MFA, Helm, RBAC, PWA, LangChain compat |

## Related Docs

- [WHAT_IS_AETHER.md](WHAT_IS_AETHER.md) — What is Aether OS? (plain English)
- [VISION.md](VISION.md) — Strategic vision and design principles
- [FEATURES.md](FEATURES.md) — Complete feature inventory with status
- [TODO.md](TODO.md) — Active task list and remaining work
- [AGENT-FUNCTIONALITY-ANALYSIS.md](../AGENT-FUNCTIONALITY-ANALYSIS.md) — Honest assessment of what works
- [CODEBASE.md](CODEBASE.md) — Agent self-knowledge (auto-seeded to containers)
