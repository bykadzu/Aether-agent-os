# Aether OS Architecture

> Last updated: 2026-02-13 (comprehensive deep-dive, post-v0.6 MCP + OpenClaw)

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Kernel Subsystems](#kernel-subsystems)
3. [Agent Lifecycle](#agent-lifecycle)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [WebSocket Protocol](#websocket-protocol)
6. [Persistence (SQLite)](#persistence-sqlite)
7. [Memory System](#memory-system)
8. [Key Design Decisions](#key-design-decisions)
9. [Module Map](#module-map)
10. [Environment Variables](#environment-variables)
11. [Version History](#version-history)

---

## System Overview

Aether OS is a three-tier agent operating system: a **React PWA desktop UI**, a **WebSocket/HTTP transport server**, and a **kernel** with 28 subsystems that orchestrate agent execution, memory, containers, and persistence.

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
│   REST API: /api/v1/* (58+ endpoints, OpenAPI spec)                 │
│   Static: /manifest.json, /sw.js, /icons/*                         │
│   Metrics: /metrics (Prometheus), /health                          │
│   WebSocket: /kernel (UI <-> kernel), /cluster (node <-> hub)      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        KERNEL (28 subsystems)                       │
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
│   │ (WS-to-TCP)    │            ├──────────────────┤                │
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
│   INTEROPERABILITY                                                  │
│   ┌────────────────┐  ┌──────────────────┐                          │
│   │ MCPManager     │  │ OpenClawAdapter  │                          │
│   │ (MCP client,   │  │ (SKILL.md import │                          │
│   │  tool bridge)  │  │  + dep check)    │                          │
│   └────────────────┘  └──────────────────┘                          │
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
│   │   Tools: 30+ (file I/O, shell, web, IPC, memory,      │       │
│   │          planning, collaboration, vision, feedback)     │       │
│   │   LLM: Gemini, GPT, Claude, Ollama                    │       │
│   │   Guards: prompt injection detection, input validation  │       │
│   │   Tracing: OpenTelemetry spans per loop iteration       │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                     SHARED PROTOCOL                                 │
│                                                                     │
│   110+ command types (UI -> Kernel)                                │
│   90+ event types   (Kernel -> UI)                                 │
│   Discriminated unions -- fully typed, no guessing                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Kernel Subsystems

The kernel (`kernel/src/Kernel.ts`) is the central orchestrator. It instantiates all 28 subsystems in its constructor and wires them via dependency injection. The `boot()` method initializes subsystems in order; `shutdown()` tears them down in reverse. The `handleCommand(cmd, user)` method dispatches ~110 command types as a giant discriminated-union switch.

### EventBus

**File:** `kernel/src/EventBus.ts`
**Purpose:** Central pub/sub nervous system. All 28 subsystems communicate through typed events on this bus, not direct calls.

| Method | Description |
|--------|-------------|
| `on(event, listener)` | Subscribe to event type. Returns unsubscribe function. |
| `once(event, listener)` | Subscribe for a single firing. |
| `emit(event, data)` | Fire event to all subscribers + wildcard `*` channel. |
| `off(event?)` | Remove listeners for one event, or all. |
| `wait(event, timeout?)` | Promise-based wait for next event of type. |
| `isDuplicate(type, id)` | Check if event ID already processed (for external callers). |

**Deduplication:** Every emitted event gets stamped with `__eventId` (UUID). The bus maintains a per-event-type set of seen IDs, capped at 500 per type. Duplicate emissions are silently dropped.

**Wildcard:** Subscribing to `*` receives all events wrapped as `{ event, data }`.

### ProcessManager

**File:** `kernel/src/ProcessManager.ts`
**Purpose:** Lifecycle manager for all agent processes. Unix-inspired PID table with signals, states, priority scheduling, and IPC.

| Method | Description |
|--------|-------------|
| `spawn(config, ppid, ownerUid)` | Create process (or queue if at capacity). Returns `ManagedProcess`. |
| `setState(pid, state, agentPhase?)` | Transition process state. Auto-dequeues on terminal states. |
| `signal(pid, sig)` | Send signal (SIGTERM, SIGKILL, SIGSTOP, SIGCONT, SIGINT). |
| `exit(pid, code)` | Mark process exited. Auto-reaps after 2s delay. |
| `reap(pid)` | Clean up zombie process (like `waitpid`). |
| `pause(pid)` / `resume(pid)` | Pause agent for human takeover; resume control. |
| `setPriority(pid, priority)` | Set priority 1-5 (1=highest). |
| `sendMessage(from, to, channel, payload)` | IPC message delivery (queue-based). |
| `drainMessages(pid)` | Consume all pending IPC messages. |
| `queueUserMessage(pid, msg)` | Queue user chat message for live agent interaction. |
| `drainUserMessages(pid)` | Consume pending user chat messages. |

**Scheduling:** Max 20 concurrent active processes (configurable). Excess spawns are queued sorted by priority (1=highest), then FIFO. When a process exits, the highest-priority queued request is automatically dequeued.

**PID Allocation:** Sequential starting at 1, wrapping at `MAX_PROCESSES * 2` (128). Skips non-dead entries.

**IPC:** Each process has a `messageQueue: IPCMessage[]` and `userMessages: string[]`. Messages are queued and drained by the agent on its next loop step. Queue cap defined by `IPC_QUEUE_MAX_LENGTH` (oldest dropped on overflow).

### VirtualFS

**File:** `kernel/src/VirtualFS.ts`
**Purpose:** Sandboxed filesystem backed by the host OS. Root at `~/.aether` (or `AETHER_FS_ROOT` env).

**Directory Layout:**
```
~/.aether/
├── home/
│   └── agent_{pid}/
│       ├── Desktop/
│       ├── Documents/
│       ├── Downloads/
│       ├── Projects/
│       └── .config/
│           └── plugins/
├── tmp/
├── etc/
├── shared/
└── var/
    └── log/
```

**Security:** `resolvePath()` prevents directory traversal and symlink escape. All paths are resolved against the filesystem root and validated to stay within bounds.

**Features:**
- Atomic writes (temp file + rename)
- File watching (host fs watcher)
- Shared mounts via symlinks
- Per-agent home directory creation on spawn

### StateStore

**File:** `kernel/src/StateStore.ts`
**Purpose:** SQLite persistence via `better-sqlite3`. WAL journal mode with NORMAL synchronous for write performance.

**Initialization:** Opens DB at `~/.aether/state.db`. On corruption, attempts recreation. Falls back to `:memory:` as last resort with persistence disabled.

**~230 prepared statements** for all CRUD operations across 25+ tables. See [Persistence](#persistence-sqlite) section for full schema.

### ContainerManager

**File:** `kernel/src/ContainerManager.ts`
**Purpose:** Docker container lifecycle for isolated agent execution environments.

**Features:**
- Auto-detects Docker daemon availability
- Auto-detects NVIDIA GPUs for GPU passthrough (`--gpus all`)
- Memory/CPU limits per container
- Network isolation
- Volume mounts (agent workspace directory)
- Graphical containers with Xvfb + x11vnc for VNC-enabled desktops
- VNC port mapping from `VNC_BASE_PORT` (5900)

| Method | Description |
|--------|-------------|
| `create(pid, hostVolumePath, sandbox?, internalHomePath?)` | Build and start container with docker run args. |
| `exec(pid, command, options)` | Execute command inside a running container. |
| `destroy(pid)` | Stop and remove container. |

### BrowserManager

**File:** `kernel/src/BrowserManager.ts`
**Purpose:** Playwright Chromium automation for web-browsing agents.

**Architecture:** Lazy browser launch (first session triggers `chromium.launch()`). Each agent gets an isolated `Page`. Graceful fallback if Playwright is not installed.

| Method | Description |
|--------|-------------|
| `createSession(id, options?)` | Open new page with configurable viewport (default 1280x720). |
| `destroySession(id)` | Close page and clean up. |
| `navigateTo(id, url)` | Navigate with `waitUntil: 'load'` + 2s JS-render delay. |
| `getScreenshot(id)` | PNG screenshot as base64. |
| `getDOMSnapshot(id)` | Structured extraction of interactive elements (links, buttons, inputs, headings). |
| `clickBySelector(id, {text?, css?, xpath?})` | Find element and click its center. |
| `type(id, text)` | Type at current focus. |
| `keyPress(id, key)` | Press key (Enter, Tab, Escape, etc.). |
| `scroll(id, deltaX, deltaY)` | Mouse wheel scroll. |
| `startScreencast(id, fps)` | Emit periodic screenshots via EventBus. |

**DOM Snapshot:** Uses `page.evaluate()` with a raw string (not a named function) to avoid esbuild `__name` helper injection. Walks the DOM tree with a TreeWalker, extracting tags, text, hrefs, input values, ARIA labels, and roles.

### VNCManager

**File:** `kernel/src/VNCManager.ts`
**Purpose:** WebSocket-to-TCP proxy that bridges noVNC web clients to container VNC servers.

**Architecture:** Creates an HTTP+WebSocket server per agent. Incoming WebSocket connections are piped to the container's x11vnc TCP port. Retry logic with 8 attempts and exponential backoff handles container startup delay.

| Method | Description |
|--------|-------------|
| `startProxy(pid, vncPort)` | Create WS-to-TCP proxy. |
| `stopProxy(pid)` | Shut down proxy server. |
| `resizeDisplay(pid, w, h)` | Resize container's virtual display (via `xrandr`). |

### MemoryManager

**File:** `kernel/src/MemoryManager.ts`
**Purpose:** Four-layer cognitive memory with full-text search and importance decay. See [Memory System](#memory-system) section for full details.

### PluginManager

**File:** `kernel/src/PluginManager.ts`
**Purpose:** Per-agent plugin loading from `~/.config/plugins/`.

**Plugin Structure:** Each plugin is a directory containing `manifest.json` (name, version, description, tools, hooks) and `handler.js` (exported functions for each tool/hook). Security: handler paths are validated against directory traversal before dynamic import.

### Additional Subsystems (Summary)

| Subsystem | Purpose |
|-----------|---------|
| **PTYManager** | Terminal sessions via `node-pty` (host) or `docker exec` (container). Real ANSI terminal emulation. |
| **CronManager** | Scheduled agent spawns via cron expressions. Stores jobs in SQLite with next-run calculation. |
| **SnapshotManager** | Atomic save/restore of process state + filesystem. Creates tarballs of agent home directories. |
| **ClusterManager** | Hub-and-spoke distributed kernel. Roles: `hub`, `node`, `standalone`. WebSocket at `/cluster`. |
| **AuthManager** | JWT authentication with scrypt password hashing. MFA/TOTP support. Organization/team hierarchy with role-based access. |
| **AuditLogger** | Append-only audit trail. Logs every kernel command with actor, target, sanitized args, result hash. |
| **ResourceGovernor** | Per-agent resource quotas (tokens, steps, disk). Runaway detection and throttling. |
| **ModelRouter** | Smart LLM model routing across tiers: `flash` (cheap/fast), `standard` (balanced), `frontier` (best quality). |
| **MetricsExporter** | Prometheus metrics at `/metrics`. Process counts, event throughput, LLM token usage, memory stats. |
| **ToolCompatLayer** | Import/export tools in LangChain and OpenAI function-calling format. |
| **WebhookManager** | Outbound/inbound webhooks. Exponential retry with configurable attempts. Dead letter queue (DLQ) for exhausted retries. |
| **AppManager** | App store lifecycle. Install, enable/disable, list desktop apps. |
| **PluginRegistryManager** | Plugin marketplace with ratings, downloads, categories. |
| **IntegrationManager** | External service connectors: GitHub, Slack, S3, Discord. Credential storage, health checks. |
| **TemplateManager** | Agent template marketplace. Preconfigured roles with suggested goals, categories, ratings. |
| **SkillManager** | YAML declarative skill definitions for agents. |
| **RemoteAccessManager** | SSH tunnel and Tailscale VPN setup for remote agent access. |
| **MCPManager** | Model Context Protocol client. Connects to external MCP servers (stdio/SSE), discovers tools, bridges tool calls. 27th subsystem (v0.6). |
| **OpenClawAdapter** | Imports OpenClaw SKILL.md files. Parses frontmatter, validates dependencies (bins, env, OS), maps to PluginRegistryManifest. 28th subsystem (v0.6). |

---

## Agent Lifecycle

### Process States (Unix-inspired)

```
                    spawn()
                      │
                      v
               ┌─────────────┐
               │   CREATED    │
               └──────┬──────┘
                      │ AgentLoop starts
                      v
               ┌─────────────┐     SIGSTOP      ┌─────────────┐
               │   RUNNING    │─────────────────>│   STOPPED    │
               │              │<─────────────────│              │
               └──────┬──────┘     SIGCONT       └─────────────┘
                      │
                 ┌────┴────┐
                 │         │
        pause()  │         │  exit(code)
                 v         v
          ┌──────────┐  ┌──────────┐
          │  PAUSED   │  │  ZOMBIE   │
          │ (human    │  │ (exited,  │
          │ takeover) │  │ awaiting  │
          └─────┬────┘  │  reap)    │
                │       └─────┬────┘
       resume() │             │ reap() (after 2s)
                v             v
          ┌──────────┐  ┌──────────┐
          │ RUNNING   │  │   DEAD    │
          └──────────┘  └──────────┘
```

**States:**
- `created` -- PID allocated, process object created, not yet executing
- `running` -- Agent loop is actively executing think-act-observe cycles
- `sleeping` -- Waiting for external input (e.g., user message, IPC)
- `stopped` -- Halted by SIGSTOP signal
- `paused` -- Agent paused for human desktop takeover via VNC
- `zombie` -- Execution finished, awaiting cleanup (like Unix zombie)
- `dead` -- Fully cleaned up, PID slot recyclable

### Agent Phases (layered on process states)

While a process is `running`, the agent phase provides finer detail about what the agent is doing:

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ BOOTING  │───>│ THINKING │───>│EXECUTING │───>│OBSERVING │
└──────────┘    └────┬─────┘    └──────────┘    └────┬─────┘
                     ^                               │
                     └───────────────────────────────┘
                                 (loop)

                ┌──────────┐    ┌──────────┐    ┌──────────┐
                │  WAITING │    │COMPLETED │    │  FAILED  │
                │(step limit│    │(goal done)│    │  (error) │
                │ hit, wait │    └──────────┘    └──────────┘
                │ for user) │
                └──────────┘
```

- `booting` -- Loading plugins, resolving LLM provider, loading memories, building system prompt
- `thinking` -- Waiting for LLM response (the "think" step)
- `executing` -- Running a tool (the "act" step)
- `observing` -- Processing tool output, updating context (the "observe" step)
- `waiting` -- Step limit reached, agent waits up to 5 minutes for user `continue` signal
- `idle` -- No active goal, sitting in sleep loop
- `completed` -- Goal achieved, exit code 0
- `failed` -- Unrecoverable error or killed, exit code non-zero

### Agent Loop Execution Flow

The core loop lives in `runtime/src/AgentLoop.ts`:

```
runAgentLoop(kernel, pid, config, options)
  │
  ├─ 1. Load plugins for agent
  ├─ 2. Resolve LLM provider (via ModelRouter or config.model)
  ├─ 3. Load memories relevant to goal (MemoryManager.getMemoriesForContext)
  ├─ 4. Load active plan (if any)
  ├─ 5. Build system prompt (role, goal, memories, plan, available tools)
  │
  └─ 6. MAIN LOOP (for each step up to maxSteps):
       │
       ├─ Check abort signal (SIGTERM/SIGKILL)
       ├─ Check process state (sleep if paused/stopped)
       ├─ Drain user messages -> inject into context
       ├─ Drain IPC messages -> inject into context
       │
       ├─ Context compaction check:
       │    Every 10 steps or >30K tokens estimated:
       │    Summarize old history via cheap LLM (flash tier)
       │    Replace old entries with summary
       │
       ├─ THINK: Send context to LLM, get response
       │    If no LLM available: heuristic fallback
       │    If tool call returned: proceed to ACT
       │    If text-only: log thought, continue
       │    If "complete" tool called: break loop
       │
       ├─ ACT: Execute tool
       │    guards.ts validates args (prompt injection check)
       │    tracing.ts creates OpenTelemetry span
       │    tool.execute(args, context)
       │    Log action to StateStore
       │    ResourceGovernor tracks usage
       │
       ├─ OBSERVE: Process tool result
       │    Add result to context history
       │    Auto-journal important observations to memory
       │    Emit 'agent.action' event via EventBus
       │
       └─ Wait AGENT_STEP_INTERVAL (3000ms) between steps

  On completion:
    Run reflection (self-rate quality 1-5, extract lessons)
    Store reflection as procedural memory (importance=0.8)
    Update agent profile stats
    Exit process with code 0 (success) or 1 (failure)

  On step limit:
    Set phase to 'waiting'
    Wait up to 5 minutes for 'continue' signal from user
    If received: reset step counter, resume loop
    If timeout: exit with code 0
```

---

## Data Flow Diagrams

### 1. Spawning an Agent

```
User clicks "Deploy Agent" in UI
        │
        v
  AgentDashboard.tsx
  calls kernel.spawnAgent({ role, goal, model? })
        │
        v
  kernelClient.ts
  sends WebSocket: { type: 'process.spawn', config: {...} }
        │
        v
  server/index.ts
  authenticates JWT, forwards to kernel.handleCommand()
        │
        │──> ProcessManager.spawn()     -> allocates PID, checks queue
        │──> ResourceGovernor.check()   -> verify quota not exceeded
        │──> VirtualFS.mkdir()          -> creates /home/agent_{pid}/
        │──> ContainerManager.create()  -> (if Docker) isolated container
        │──> PTYManager.open()          -> creates terminal session
        │──> AuditLogger.log()          -> records spawn event
        └──> AgentLoop.run()            -> starts think-act-observe cycle
                    │
                    v
              Emits events via EventBus (deduped):
              'process.spawned', 'agent.thought', 'agent.action', ...
                    │
                    v
              server broadcasts via WebSocket (50ms batch window)
                    │
                    v
              React re-renders: dashboard, agent VM, logs
```

### 2. Agent Web Browsing

```
Agent decides to browse the web (LLM returns browse_web tool call)
        │
        v
  AgentLoop recognizes tool: "browse_web"
  args: { url: "https://example.com", sessionId: "browser_1" }
        │
        v
  tools.ts -> browse_web handler:
        │
        ├─ If Playwright available:
        │    BrowserManager.createSession("browser_1")
        │      └─ chromium.launch() (lazy, first time only)
        │      └─ browser.newPage()
        │      └─ page.setViewportSize(1280, 720)
        │    BrowserManager.navigateTo("browser_1", url)
        │      └─ page.goto(url, { waitUntil: 'load' })
        │      └─ setTimeout(2000) -- wait for JS rendering
        │    BrowserManager.getDOMSnapshot("browser_1")
        │      └─ page.evaluate() -- TreeWalker extracts DOM elements
        │    BrowserManager.getScreenshot("browser_1")
        │      └─ page.screenshot({ type: 'png' }) -> base64
        │    Return: { url, title, elements[], screenshot }
        │
        └─ If Playwright NOT available:
             HTTP fetch (Node.js fetch API)
             Extract text via simple HTML parsing
             Return: { url, text }
        │
        v
  EventBus emits:
    'browser:created', 'browser:navigated', 'browser:screenshot'
        │
        v
  Agent observes: DOM snapshot + screenshot
  Decides next action (click link, fill form, etc.)
```

### 3. File Operations

```
Agent calls write_file tool
  args: { path: "/report.md", content: "# Report\n..." }
        │
        v
  tools.ts -> write_file handler:
        │
        ├─ Resolve path: VirtualFS.resolvePath("/report.md", agentUid)
        │    Result: ~/.aether/home/agent_3/report.md
        │    Security: path traversal check passes
        │
        ├─ VirtualFS.writeFile(resolvedPath, content)
        │    └─ Atomic write: write to .tmp file, then rename
        │    └─ Create parent directories if needed
        │
        ├─ StateStore.upsertFile({ path, owner_uid, size, ... })
        │    └─ Update file metadata index in SQLite
        │
        ├─ ResourceGovernor.recordDisk(agentUid, sizeBytes)
        │    └─ Check quota, warn if approaching limit
        │
        └─ EventBus.emit('fs.write', { path, uid })
              │
              v
        UI file explorer updates in real time
```

### 4. VNC Desktop Pipeline

```
Agent has graphical container with Xvfb + x11vnc
        │
        v
  ContainerManager.create(pid, hostPath, sandbox)
    └─ docker run with:
       --env DISPLAY=:99
       Xvfb :99 -screen 0 1280x720x24 &
       x11vnc -display :99 -forever -nopw -rfbport 5901 &
    └─ Maps container port 5901 -> host VNC_BASE_PORT + pid
        │
        v
  VNCManager.startProxy(pid, vncPort)
    └─ Creates HTTP + WebSocket server on ephemeral port
    └─ On WS connection:
       ├─ Connect TCP socket to localhost:vncPort
       ├─ Pipe: WS <-> TCP (bidirectional)
       └─ Retry up to 8 times with backoff if VNC not ready
        │
        v
  UI: VNCViewer.tsx
    └─ Uses noVNC client library
    └─ Connects to VNCManager's WS proxy endpoint
    └─ Renders live desktop stream in canvas
        │
        v
  Human takeover:
    ProcessManager.pause(pid)  -> agent loop spin-waits
    User interacts via VNC (mouse, keyboard)
    ProcessManager.resume(pid) -> agent resumes execution
```

### 5. Agent-to-Agent IPC

```
Agent A (PID 3) wants to delegate task to Agent B (PID 5)
        │
        v
  Agent A calls send_message tool:
    args: { to_pid: 5, channel: "task", payload: { goal: "..." } }
        │
        v
  tools.ts -> send_message handler:
    ProcessManager.sendMessage(3, 5, "task", payload)
      └─ Creates IPCMessage { id, fromPid:3, toPid:5, channel, payload, timestamp }
      └─ Pushes to Agent B's messageQueue[]
      └─ Enforces IPC_QUEUE_MAX_LENGTH (drops oldest on overflow)
      └─ EventBus.emit('ipc.message', { message })
        │
        v
  Agent B's next loop iteration:
    drainMessages(5) -> returns [IPCMessage]
    Messages injected into LLM context as system messages
    Agent B processes the delegation request
        │
        v
  Agent B responds:
    send_message(5, 3, "task_result", { result: "..." })
      └─ Same path in reverse
```

---

## WebSocket Protocol

### Connection

The server exposes a WebSocket endpoint at `/kernel` on port 3001 (configurable via `AETHER_PORT`).

**Authentication:** Clients send JWT token as a query parameter or in the first message. The server validates via `AuthManager.verifyToken()`.

**Session Dedup:** `kernelClient.ts` on the UI side prevents duplicate WebSocket connections per browser tab/session.

### Message Format

All messages are JSON with a `type` discriminator field:

**Commands (UI -> Kernel):**
```typescript
{ type: 'process.spawn', config: AgentConfig }
{ type: 'process.signal', pid: number, signal: Signal }
{ type: 'process.list' }
{ type: 'fs.read', path: string }
{ type: 'fs.write', path: string, content: string }
{ type: 'browser.navigate', sessionId: string, url: string }
{ type: 'memory.store', request: MemoryStoreRequest }
{ type: 'memory.recall', query: MemoryQuery }
// ... ~110 total command types
```

**Events (Kernel -> UI):**
```typescript
{ type: 'process.spawned', pid: number, info: ProcessInfo }
{ type: 'process.stateChange', pid: number, state: ProcessState }
{ type: 'process.exit', pid: number, code: number }
{ type: 'agent.thought', pid: number, content: string }
{ type: 'agent.action', pid: number, tool: string, args: any }
{ type: 'browser:screenshot', sessionId: string, data: string }
{ type: 'memory.stored', memoryId: string }
// ... ~90 total event types
```

### Command Categories

| Category | Example Commands | Count |
|----------|-----------------|-------|
| Process | spawn, signal, list, pause, resume, setPriority, chat | ~10 |
| Filesystem | read, write, list, mkdir, rm, stat, mv, cp, watch | ~10 |
| Browser | create, navigate, screenshot, click, type, DOM snapshot | ~10 |
| Memory | store, recall, forget, share, consolidate, stats | ~8 |
| Planning | create, update, get, list | ~4 |
| Cron/Triggers | create, list, enable, disable, delete | ~8 |
| Auth | login, register, listUsers, updateUser, MFA setup/verify | ~10 |
| Webhooks | create, list, enable, test, DLQ operations | ~10 |
| Integrations | connect, disconnect, list, execute | ~6 |
| Plugins | install, list, enable, disable, marketplace browse | ~6 |
| System | stats, health, metrics, snapshot, restore | ~8 |
| Org/Team | create, invite, remove, listMembers, updateRole | ~10 |
| MCP | addServer, connect, disconnect, listTools, callTool | ~8 |
| OpenClaw | importSkill, importDirectory, listImported, removeImport, getInstructions | ~5 |

### Batching

The server batches outbound events in a 50ms window to reduce WebSocket frame overhead. Multiple events within the window are sent as a JSON array in a single frame.

### Rate Limiting

Sliding window rate limiter in `server/src/index.ts`:
- Authenticated users: 120 requests/minute
- Unauthenticated: 30 requests/minute

---

## Persistence (SQLite)

All kernel state is persisted in `~/.aether/state.db` using `better-sqlite3` (synchronous, C++ bindings). WAL journal mode + NORMAL synchronous for write performance.

### Schema Overview

```
┌─────────────────────────────────────────────────────┐
│                    CORE TABLES                       │
├─────────────────────────────────────────────────────┤
│ processes          -- Agent process history          │
│ agent_logs         -- Full thought/action/observe    │
│ file_metadata      -- File ownership index           │
│ kernel_metrics     -- Time-series system metrics     │
│ snapshots          -- Atomic state snapshots         │
│ shared_mounts      -- Shared workspace registry      │
│ shared_mount_members -- Workspace participants       │
├─────────────────────────────────────────────────────┤
│                    AUTH TABLES                        │
├─────────────────────────────────────────────────────┤
│ users              -- User accounts (+ MFA columns)  │
│ organizations      -- Multi-tenant orgs              │
│ teams              -- Teams within orgs              │
│ org_members        -- Org membership + roles         │
│ team_members       -- Team membership + roles        │
│ permission_policies -- Granular RBAC policies        │
├─────────────────────────────────────────────────────┤
│                  MEMORY TABLES                       │
├─────────────────────────────────────────────────────┤
│ agent_memories     -- 4-layer memory records         │
│ agent_memories_fts -- FTS5 full-text search index    │
│ agent_profiles     -- Per-agent stats and expertise  │
│ agent_reflections  -- Post-task self-evaluations     │
│ agent_plans        -- Hierarchical goal plans        │
│ agent_feedback     -- User thumbs-up/down per step   │
├─────────────────────────────────────────────────────┤
│                AUTOMATION TABLES                     │
├─────────────────────────────────────────────────────┤
│ cron_jobs          -- Scheduled agent spawns         │
│ event_triggers     -- Event-driven agent spawns      │
├─────────────────────────────────────────────────────┤
│                ECOSYSTEM TABLES                      │
├─────────────────────────────────────────────────────┤
│ webhooks           -- Outbound webhook configs       │
│ webhook_logs       -- Delivery attempt logs          │
│ webhook_dlq        -- Dead letter queue              │
│ inbound_webhooks   -- Inbound webhook endpoints      │
│ plugin_registry    -- Installed plugins              │
│ plugin_ratings     -- Plugin reviews                 │
│ plugin_settings    -- Plugin configuration KV        │
│ integrations       -- External service connections   │
│ integration_logs   -- Integration activity logs      │
│ installed_apps     -- Desktop app installations      │
│ template_marketplace -- Agent template catalog       │
│ template_ratings   -- Template reviews               │
├─────────────────────────────────────────────────────┤
│             INTEROPERABILITY TABLES (v0.6)            │
├─────────────────────────────────────────────────────┤
│ mcp_servers        -- MCP server configs + status    │
│ openclaw_imports   -- Imported OpenClaw skills        │
├─────────────────────────────────────────────────────┤
│                 SYSTEM TABLES                        │
├─────────────────────────────────────────────────────┤
│ kv_store           -- Generic key-value store        │
│ audit_log          -- Append-only audit trail        │
└─────────────────────────────────────────────────────┘
```

### Key Table Schemas

**processes:**
```sql
CREATE TABLE processes (
  pid INTEGER PRIMARY KEY,
  uid TEXT NOT NULL,               -- 'agent_{pid}'
  name TEXT NOT NULL,              -- '{role} Agent'
  role TEXT NOT NULL,
  goal TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'created',
  agent_phase TEXT,
  exit_code INTEGER,
  created_at INTEGER NOT NULL,     -- epoch ms
  exited_at INTEGER
);
```

**agent_logs:**
```sql
CREATE TABLE agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid INTEGER NOT NULL,
  step INTEGER NOT NULL,
  phase TEXT NOT NULL,             -- 'thought' | 'action' | 'observation' | 'error'
  tool TEXT,                       -- tool name if action
  content TEXT NOT NULL,           -- full content
  timestamp INTEGER NOT NULL
);
-- Indexes: (pid), (pid, step)
```

**agent_memories:**
```sql
CREATE TABLE agent_memories (
  id TEXT PRIMARY KEY,             -- UUID
  agent_uid TEXT NOT NULL,
  layer TEXT NOT NULL CHECK(layer IN ('episodic','semantic','procedural','social')),
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  importance REAL NOT NULL DEFAULT 0.5,  -- 0.0 to 1.0
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  expires_at INTEGER,              -- nullable, epoch ms
  source_pid INTEGER,
  related_memories TEXT NOT NULL DEFAULT '[]'  -- JSON array of IDs
);
-- FTS5 virtual table: agent_memories_fts(id UNINDEXED, content, tags)
-- Indexes: (agent_uid), (agent_uid, layer), (importance DESC)
```

**audit_log:**
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_pid INTEGER,
  actor_uid TEXT,
  action TEXT NOT NULL,
  target TEXT,
  args_sanitized TEXT,             -- sensitive data redacted
  result_hash TEXT,
  metadata TEXT
);
-- Indexes: (timestamp), (event_type), (actor_pid, actor_uid)
```

**permission_policies:**
```sql
CREATE TABLE permission_policies (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,           -- user/role/team wildcard
  action TEXT NOT NULL,            -- 'process.spawn', 'fs.write', etc.
  resource TEXT NOT NULL,          -- resource pattern (glob)
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  created_at INTEGER NOT NULL,
  created_by TEXT
);
```

---

## Memory System

Aether implements a four-layer cognitive memory architecture inspired by human memory models. The kernel provides storage and retrieval; intelligence (when to remember, what to recall) lives in the runtime.

### Memory Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY LAYERS                             │
├──────────────┬──────────────────────────────────────────────┤
│  EPISODIC    │ What happened. Experiences, events, task     │
│              │ outcomes. Auto-journaled by AgentLoop.       │
│              │ Example: "Deployed Express API to container" │
├──────────────┼──────────────────────────────────────────────┤
│  SEMANTIC    │ What I know. Facts, knowledge, references.   │
│              │ Stored via 'remember' tool explicitly.       │
│              │ Example: "API key for service X is in .env"  │
├──────────────┼──────────────────────────────────────────────┤
│  PROCEDURAL  │ How I do things. Skills, patterns, lessons.  │
│              │ Stored by reflection system after tasks.     │
│              │ Example: "Always check port conflicts first" │
├──────────────┼──────────────────────────────────────────────┤
│  SOCIAL      │ Who I know. Relationships, interactions.     │
│              │ Stored via collaboration tools.              │
│              │ Example: "Agent_5 specializes in frontend"   │
└──────────────┴──────────────────────────────────────────────┘
```

### Storage and Retrieval

**Store:** `MemoryManager.store(request)` creates a record with UUID, importance (0.0-1.0), tags (JSON array), and optional expiry. Per-layer limit of 1000 memories per agent. When at capacity, lowest-importance memories are evicted.

**Recall:** `MemoryManager.recall(query)` supports multiple retrieval modes:
1. **Full-text search** -- Uses SQLite FTS5 with the query string. Over-fetches 2x then post-filters.
2. **Layer filter** -- Returns all memories from a specific layer.
3. **Tag filter** -- Matches any of the specified tags.
4. **Importance threshold** -- Filters by minimum effective importance (after decay).

**Ranking:** Results are sorted by effective importance:
```
effective_importance = importance * (0.99 ^ days_since_last_access)
```
This means a memory with importance=1.0 that hasn't been accessed in 30 days has effective importance of 0.74. After 100 days: 0.37. After 365 days: 0.03.

**Context Loading:** `getMemoriesForContext(agent_uid, goal, limit)` is called by AgentLoop on startup. It first searches memories relevant to the goal (FTS5), then fills remaining slots with highest-importance memories. Results are injected into the system prompt.

### Memory Lifecycle

```
Agent starts task
  │
  ├─ AgentLoop calls getMemoriesForContext(uid, goal, 10)
  │    └─ FTS5 search for goal-relevant memories
  │    └─ Fill with high-importance memories
  │    └─ Inject into system prompt: "Your relevant memories: ..."
  │
  ├─ During execution:
  │    Agent may call 'remember' tool -> store(semantic memory)
  │    Agent may call 'recall' tool   -> recall(query)
  │    Agent may call 'forget' tool   -> forget(memoryId)
  │    Auto-journal: important observations -> store(episodic)
  │
  └─ On completion:
       reflection.ts rates quality 1-5
       Lessons learned -> store(procedural memory, importance=0.8)
       Profile updated: tasks++, success_rate, expertise tags
```

### Memory Sharing

`MemoryManager.share(memoryId, from_uid, to_uid)` copies a memory from one agent to another with:
- Importance reduced to 80% of original
- Tagged with `shared_from:{from_uid}`
- Original memory ID stored in `related_memories`

### Consolidation

`MemoryManager.consolidate(agent_uid)` performs garbage collection:
1. Removes expired memories (past `expires_at`)
2. Enforces per-layer limits (1000/layer)
3. Evicts lowest-importance memories when over limit

### Agent Profiles

Each agent has a persistent profile tracking:
- `total_tasks`, `successful_tasks`, `failed_tasks`, `success_rate`
- `expertise[]` -- accumulated from task tags (max 20)
- `avg_quality_rating` -- running average from reflections
- `total_steps` -- cumulative loop iterations
- `first_seen`, `last_active` timestamps

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **TypeScript everywhere** | Single type system from UI to kernel. Protocol changes caught at compile time. |
| **Discriminated unions for protocol** | Every message has a `type` field. Exhaustive switch matching, no ambiguity. |
| **Event-driven kernel** | Loose coupling -- 28 subsystems communicate via EventBus, not direct calls. |
| **SQLite (not Postgres)** | Zero config, embedded, synchronous reads. Scales to 100+ agents on single node. |
| **Real filesystem at ~/.aether** | Agents use standard file I/O. Survives reboots. Can inspect from host. |
| **node-pty for terminals** | Real terminal emulation -- ANSI colors, cursor, interactive programs. |
| **Multi-LLM with fallback** | Gemini, GPT, Claude, Ollama. Per-agent selection. Auto-fallback on failure. |
| **WebSocket (not REST) for events** | Real-time bidirectional. 50ms batching reduces frame overhead at scale. |
| **Docker for agent isolation** | Full Linux desktops per agent. GPU passthrough. VNC for human takeover. |
| **Monorepo + @aether/shared** | Protocol types are the contract. Both sides import from shared package. |
| **PWA (not Electron)** | Installable on any device. Service worker for offline shell. No native deps. |
| **Deny-by-default RBAC** | Fine-grained permission policies. Admin bypass. Wildcard matching. |
| **Memory importance decay** | `0.99^days` prevents stale memories from dominating recall. Natural forgetting curve. |
| **Context compaction** | LLM-based summarization of old history prevents context overflow. Cheap model used. |
| **Heuristic fallback** | If no LLM API key configured, agents use pattern-matching heuristics. Always functional. |

---

## Module Map

```
Aether_Agent_OS/
│
├── shared/                  # Shared types and protocol
│   └── src/
│       ├── protocol.ts      # ALL message types (110+ commands, 90+ events)
│       └── constants.ts     # Version, ports, limits, intervals
│
├── kernel/                  # The OS kernel (28 subsystems)
│   └── src/
│       ├── Kernel.ts            # Orchestrator -- boots and wires everything
│       ├── EventBus.ts          # Typed event pub/sub (dedup, wildcard)
│       ├── ProcessManager.ts    # PID table, signals, priority scheduling, IPC
│       ├── VirtualFS.ts         # Sandboxed filesystem at ~/.aether
│       ├── PTYManager.ts        # Terminal sessions (node-pty / docker exec)
│       ├── ContainerManager.ts  # Docker containers + GPU passthrough
│       ├── StateStore.ts        # SQLite persistence (WAL mode, 25+ tables)
│       ├── AuthManager.ts       # JWT, scrypt, MFA/TOTP, orgs/teams, RBAC
│       ├── MemoryManager.ts     # 4-layer memory (episodic/semantic/procedural/social)
│       ├── CronManager.ts       # Cron jobs + event triggers
│       ├── SnapshotManager.ts   # Atomic process save/restore
│       ├── VNCManager.ts        # WebSocket-to-TCP VNC proxy
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
│       ├── MCPManager.ts            # MCP protocol client (stdio/SSE transports)
│       ├── OpenClawAdapter.ts       # OpenClaw SKILL.md import adapter
│       └── __tests__/               # Unit tests
│
├── runtime/                 # Agent execution engine
│   └── src/
│       ├── AgentLoop.ts     # Think-act-observe (memory-aware, context compaction)
│       ├── tools.ts         # 30+ built-in tools
│       ├── reflection.ts    # Post-task self-reflection (quality 1-5)
│       ├── planner.ts       # Hierarchical goal decomposition
│       ├── collaboration.ts # Multi-agent protocols
│       ├── guards.ts        # Prompt injection detection
│       ├── tracing.ts       # OpenTelemetry instrumentation
│       ├── templates.ts     # 16 pre-built agent templates
│       └── llm/             # Multi-LLM provider abstraction
│           ├── LLMProvider.ts     # Interface: chat(), isAvailable(), supportsVision()
│           ├── GeminiProvider.ts  # Google Gemini
│           ├── OpenAIProvider.ts  # OpenAI GPT
│           ├── AnthropicProvider.ts # Anthropic Claude
│           ├── OllamaProvider.ts  # Local models via Ollama
│           └── index.ts           # Registry: parseModelString(), getProvider()
│
├── server/                  # HTTP + WebSocket transport
│   └── src/
│       ├── index.ts         # Boots kernel, TLS, rate limiting, WS handler
│       ├── routes/v1.ts     # REST API v1 (58+ endpoints)
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
│       ├── SettingsApp.tsx         # Settings, orgs, automation, MCP
│       └── OpenClawImporter.tsx   # OpenClaw SKILL.md import UI
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

---

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

---

## Version History

| Version | Theme | Key Additions |
|---------|-------|---------------|
| v0.1 | Foundation | Kernel, ProcessManager, VirtualFS, PTY, Docker, SQLite |
| v0.2 | Real Apps | Playwright browser, Monaco editor, 18 desktop apps, shortcuts |
| v0.3 | Intelligence | 4-layer memory, planning, reflection, vision, collaboration |
| v0.4 | Ecosystem | REST API, webhooks, Slack/GitHub/S3/Discord, plugin marketplace, CLI, SDK |
| v0.5 | Production | Resource governance, audit logging, Prometheus, TLS, MFA, Helm, RBAC, PWA, LangChain compat |
| v0.6 | Interoperability | MCP protocol client (stdio/SSE), OpenClaw SKILL.md adapter, tool bridging, 28 subsystems |

---

## Related Docs

- [WHAT_IS_AETHER.md](WHAT_IS_AETHER.md) -- What is Aether OS? (plain English)
- [VISION.md](VISION.md) -- Strategic vision and design principles
- [FEATURES.md](FEATURES.md) -- Complete feature inventory with status
- [EXTENSION-GUIDE.md](EXTENSION-GUIDE.md) -- How to extend Aether OS
- [TODO.md](TODO.md) -- Active task list and remaining work
- [CODEBASE.md](CODEBASE.md) -- Agent self-knowledge (auto-seeded to containers)
