# Aether OS - Agent Self-Knowledge

> This document describes the system you are running inside. Use it to understand
> your environment, capabilities, and how to interact with the platform.

## What is Aether OS?

Aether OS is an AI agent operating system. It provides a sandboxed Linux environment
where AI agents (like you) execute tasks through a think-act-observe loop. You run
inside a Docker container with your own filesystem, terminal, and optionally a
graphical desktop with browser access.

The system has three layers:

```
Frontend (React Desktop UI)
    ↕ WebSocket
Server (Express + WS transport, auth, rate limiting)
    ↕ Events
Kernel (20+ subsystems: processes, containers, filesystem, memory, etc.)
    ↕ Agent Loop
Runtime (your brain: LLM calls → tool execution → observation)
```

## Architecture Overview

### Kernel Subsystems

| Subsystem | Purpose |
|-----------|---------|
| **ProcessManager** | Tracks all agent processes (spawn, pause, resume, kill) |
| **VirtualFS** | Sandboxed filesystem per agent, home directories |
| **ContainerManager** | Docker container lifecycle, GPU allocation |
| **PTYManager** | Terminal sessions via node-pty |
| **EventBus** | Pub/sub event system connecting all components |
| **StateStore** | SQLite persistence (metrics, logs, profiles) |
| **MemoryManager** | Episodic and semantic memory across sessions |
| **SnapshotManager** | Full state snapshots for save/restore |
| **CronManager** | Scheduled jobs and event-driven triggers |
| **AuthManager** | User/org/team RBAC, JWT, MFA |
| **VNCManager** | VNC proxy for graphical desktop sessions |
| **BrowserManager** | Playwright web automation (when available) |
| **ModelRouter** | Smart LLM model selection based on task |
| **WebhookManager** | External webhook dispatch with retry + DLQ |
| **IntegrationManager** | Slack, GitHub, Discord, S3 connectors |
| **ResourceGovernor** | CPU/memory/token quotas per agent |
| **AuditLogger** | Security event logging |
| **MetricsExporter** | Prometheus metrics |
| **PluginRegistry** | Plugin marketplace |
| **SkillManager** | Reusable skill library |

### Your Execution Loop (runtime/src/AgentLoop.ts)

Your brain works like this:

```
1. Load context: memories, profile, active plan
2. Build system prompt with tools and rules
3. LOOP:
   a. Think: Ask LLM what to do next (with reasoning)
   b. Act: Execute the chosen tool
   c. Observe: Record the result
   d. Check: Am I done? (complete tool) / At step limit? / Aborted?
   e. Compact context if history grows too large
4. Reflect: Post-task reflection and learning
5. Emit completion event with outcome metrics
```

Each iteration you choose one tool to call. The loop continues until you call
`complete`, hit the step limit, or are killed/paused by the operator.

### Available Tools (runtime/src/tools.ts)

| Tool | Description |
|------|-------------|
| `run_command` | Execute a shell command in your container |
| `read_file` | Read file contents |
| `write_file` | Write/create a file |
| `list_files` | List directory contents |
| `browse_web` | Fetch a web page as structured text |
| `screenshot_page` | Take a browser screenshot (requires Playwright) |
| `click_element` | Click an element in the browser (requires Playwright) |
| `type_text` | Type text into a browser element (requires Playwright) |
| `remember` | Save information to persistent memory |
| `recall` | Retrieve relevant memories from past sessions |
| `think` | Internal reasoning step (no side effects) |
| `complete` | Signal task completion with a summary |
| `list_agents` | Discover other running agents |
| `send_message` | Send a message to another agent |
| `check_messages` | Check your IPC inbox for messages |
| `delegate_task` | Hand off a sub-task to another agent |

### LLM Providers (runtime/src/llm/)

The system supports multiple AI providers:
- **Gemini** (Google) - default
- **Claude** (Anthropic)
- **OpenAI** (GPT-4, o1)
- **Ollama** (local models)

The ModelRouter can automatically select the best model for your task.

## Key File Locations

### Server Side (Node.js/TypeScript)

```
kernel/src/
├── Kernel.ts              # Central coordinator, command routing
├── ProcessManager.ts      # Process lifecycle (spawn/pause/resume/kill)
├── VirtualFS.ts           # Filesystem sandboxing
├── ContainerManager.ts    # Docker containers, GPU, VNC ports
├── VNCManager.ts          # noVNC WebSocket proxy
├── EventBus.ts            # Event pub/sub
├── StateStore.ts          # SQLite persistence
├── MemoryManager.ts       # Agent memory (episodic/semantic)
├── AuthManager.ts         # Authentication and RBAC
├── BrowserManager.ts      # Playwright automation
├── ModelRouter.ts         # Smart model selection
└── integrations/          # Slack, GitHub, Discord, S3

runtime/src/
├── AgentLoop.ts           # Core think-act-observe loop (your brain)
├── tools.ts               # Tool definitions and execution
├── planner.ts             # Multi-step planning
├── reflection.ts          # Post-task learning
├── collaboration.ts       # Multi-agent coordination
├── guards.ts              # Prompt injection detection
└── llm/                   # LLM provider abstraction

server/src/
└── index.ts               # HTTP/WS server, auth middleware, event broadcasting
```

### Frontend (React/TypeScript)

```
components/
├── os/
│   ├── Window.tsx          # Draggable/resizable window manager
│   ├── Dock.tsx            # App launcher bar
│   ├── VirtualDesktop.tsx  # Multi-workspace with VNC viewer
│   ├── VNCViewer.tsx       # noVNC remote desktop viewer
│   ├── AgentDesktopView.tsx # Live agent screen (VNC/screencast/mock browser)
│   ├── XTerminal.tsx       # xterm.js terminal emulator
│   └── LoginScreen.tsx     # Authentication UI
├── apps/
│   ├── AgentDashboard.tsx  # Agent control panel
│   ├── AgentVM.tsx         # Agent VM view (logs, VNC, TTY)
│   ├── TerminalApp.tsx     # Interactive terminal
│   ├── FileExplorer.tsx    # File browser
│   ├── CodeEditorApp.tsx   # Monaco code editor
│   ├── ChatApp.tsx         # Chat interface
│   └── SmartBar.tsx        # Cmd+K command palette

services/
├── kernelClient.ts         # WebSocket client to kernel
└── useKernel.ts            # React hook for kernel state
```

### Docker & Deployment

```
Dockerfile.agent           # CLI agent container (Ubuntu 22.04, Python, Node.js)
Dockerfile.desktop         # Desktop container (Ubuntu 24.04, XFCE4, Firefox, VNC)
docker/entrypoint.sh       # Desktop container startup (Xvfb → XFCE4 → x11vnc)
docker-compose.yml         # Development stack
helm/aether-os/            # Kubernetes Helm charts
```

## Container Architecture

### CLI Agent Container (aether-agent:latest)
- Ubuntu 22.04
- Python 3, Node.js 22, pip, git, curl, wget
- No graphical components
- Lightweight (~2GB)

### Desktop Container (aether-desktop:latest)
- Ubuntu 24.04
- XFCE4 desktop + xfce4-terminal
- Firefox browser
- VS Code (code-server)
- Xvfb virtual framebuffer on display :99
- x11vnc on port 5999
- All CLI agent tools included

### VNC Data Flow
```
Browser (noVNC over WebSocket)
    ↓
VNCManager proxy (host port 6080+)
    ↓
x11vnc (container port 5999)
    ↓
Xvfb framebuffer (display :99)
    ↓
XFCE4 desktop / Firefox / apps
```

## Event System

Everything communicates through events:

```
Agent tool call → Kernel EventBus → Server broadcasts → UI updates
```

Key events:
- `process.spawned` / `process.exited` - Agent lifecycle
- `agent.step` - Each think-act-observe iteration
- `agent.paused` / `agent.resumed` - Operator takeover
- `agent.completed` - Task finished with outcome metrics
- `tty.output` - Terminal output
- `vnc.started` / `vnc.stopped` - Graphical session lifecycle
- `container.created` / `container.removed` - Container lifecycle

## Inter-Agent Communication

Agents can collaborate using IPC tools:
- `list_agents` → See all running agents with their roles and goals
- `send_message` → Direct message to another agent by PID
- `check_messages` → Read incoming messages from other agents
- `delegate_task` → Create a sub-task for another agent

Messages are queued in the ProcessManager and auto-drained into your
conversation history at each step of your loop.

## Memory System

You have persistent memory across sessions:
- **Episodic memory**: Specific events and experiences
- **Semantic memory**: General knowledge and patterns
- **Working memory**: Current task context (your conversation history)

Use `remember` to save discoveries and `recall` to retrieve them later.
The kernel stores memories in SQLite and retrieves them by semantic similarity.

## Security Model

- Each agent runs in an isolated Docker container
- Filesystem is sandboxed (VirtualFS prevents path traversal)
- RBAC controls what users/agents can do
- Prompt injection guards check all tool inputs
- Audit logger tracks all operations
- Resource governor enforces CPU/memory/token quotas

## Configuration

Key constants (shared/src/constants.ts):
- `DEFAULT_AGENT_MAX_STEPS`: 50 steps per task
- `DEFAULT_AGENT_TIMEOUT`: 5 minutes
- `DEFAULT_COMMAND_TIMEOUT`: 2 minutes per command
- `DEFAULT_CONTAINER_MEMORY_MB`: 512 MB
- `DEFAULT_CONTAINER_CPU_LIMIT`: 0.5 cores
- `CONTEXT_COMPACTION_TOKEN_THRESHOLD`: 30,000 tokens
- `DEFAULT_PORT`: 3001 (kernel server)

## Filesystem Layout (inside your container)

- `/home/aether/` → Your private home directory (scratch space)
- `/home/agent/shared/` → Shared directory visible to user and all agents
- Always save deliverables to `/home/agent/shared/`
- This document is available at `/home/agent/shared/CODEBASE.md`

The shared directory is mounted from the host (`~/.aether/shared/`) and persists
across sessions. All agents can read/write to it. Your home directory is a mounted
Docker volume that persists for the lifetime of the workspace.
