# Implementation Plan: OpenClaw / Claude Code Agent Runtime Integration

> Date: 2026-02-13
> Status: Draft
> Authors: Architecture Team
> Depends on: Aether OS v0.7

---

## 1. The Big Idea

**Stop building a worse agent loop. Start building a better agent OS.**

Instead of Aether's custom `AgentLoop.ts` (think-act-observe with basic tool calling), we run **OpenClaw or Claude Code as the actual agent runtime** inside Aether OS. Aether becomes the operating system layer that:

- Spawns and manages agent processes (OpenClaw/Claude Code instances)
- Exposes its 29 subsystems as **MCP tools** the agent can use
- Provides persistent memory, skill management, and self-modification
- Gives users a desktop UI to observe, interact with, and control agents
- Orchestrates multi-agent collaboration
- Grants agents access to the Aether OS repo itself for self-improvement

```
┌─────────────────────────────────────────────────────┐
│                   AETHER OS UI                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Agent VM │ │ Agent VM │ │ Terminal │  ...        │
│  │ (live)   │ │ (live)   │ │          │            │
│  └────┬─────┘ └────┬─────┘ └──────────┘            │
│       │             │                                │
├───────┼─────────────┼────────────────────────────────┤
│       ▼             ▼                                │
│  ┌─────────────────────────────────────────────┐    │
│  │           AETHER KERNEL (29 subsystems)      │    │
│  │                                              │    │
│  │  ProcessManager  MemoryManager  SkillForge   │    │
│  │  EventBus        StateStore     PluginReg    │    │
│  │  VirtualFS       AuditLogger    MCPManager   │    │
│  │  ...                                         │    │
│  └──────────┬──────────────┬────────────────────┘    │
│             │              │                          │
│     ┌───────▼──────┐ ┌────▼─────────┐               │
│     │ MCP Server   │ │ MCP Server   │               │
│     │ (aether://   │ │ (aether://   │               │
│     │  agent-1)    │ │  agent-2)    │               │
│     └───────┬──────┘ └────┬─────────┘               │
│             │              │                          │
│     ┌───────▼──────┐ ┌────▼─────────┐               │
│     │ OpenClaw /   │ │ OpenClaw /   │               │
│     │ Claude Code  │ │ Claude Code  │               │
│     │ (subprocess) │ │ (subprocess) │               │
│     └──────────────┘ └──────────────┘               │
└─────────────────────────────────────────────────────┘
```

---

## 2. Why This Is The Right Move

### What We Stop Doing (save effort)
- Maintaining a custom LLM agent loop (AgentLoop.ts)
- Building custom tool implementations for browsing, coding, file editing
- Competing with OpenClaw's 190k-star, battle-tested agent runtime
- Building computer use from scratch (screen, keyboard, mouse)

### What We Keep (our differentiators)
- The OS metaphor (windows, dock, workspaces, multi-app desktop)
- 29 kernel subsystems (memory, skills, plugins, audit, metrics, etc.)
- Multi-agent orchestration (IPC, shared workspaces, process management)
- SkillForge self-modification pipeline
- Persistent state across sessions (SQLite, memory layers)
- The desktop UI for observing and controlling agents

### What We Gain (new superpowers)
- OpenClaw's full computer use (screen interaction, browser, terminal)
- Claude Code's coding capabilities (codebase understanding, multi-file edits)
- Access to 5,700+ ClawHub skills immediately
- Community-maintained tool quality instead of our own
- Agents that can work on the Aether OS repo itself

---

## 3. Architecture: Aether as MCP Server

The key insight: **Aether OS exposes itself as an MCP server to each agent.**

When an agent (OpenClaw/Claude Code) starts, it connects to Aether's MCP server and gets access to:

### 3.1 MCP Tools Exposed to Agents

```
MEMORY TOOLS (from MemoryManager)
├── aether_remember        — Store memory (episodic/semantic/procedural/social)
├── aether_recall           — Search memories by query/layer/tags
├── aether_forget           — Delete a memory
└── aether_get_profile      — Get agent's expertise profile

SKILL TOOLS (from SkillForge)
├── aether_discover_skills  — Search local + ClawHub skills
├── aether_install_skill    — Import a SKILL.md
├── aether_create_skill     — Generate a new skill
├── aether_compose_skills   — Chain skills together
└── aether_share_skill      — Share with other agents

COLLABORATION TOOLS (from ProcessManager)
├── aether_list_agents      — See other running agents
├── aether_send_message     — IPC to another agent
├── aether_check_messages   — Read incoming IPC messages
├── aether_spawn_agent      — Launch a child agent
└── aether_delegate_task    — Assign work to another agent

OS TOOLS (from Kernel)
├── aether_get_status       — System status (subsystems, resources)
├── aether_audit_log        — Query audit trail
├── aether_cron_schedule    — Schedule recurring tasks
└── aether_webhook_fire     — Trigger a webhook

SELF-MODIFICATION TOOLS (new)
├── aether_read_source      — Read Aether OS source files
├── aether_propose_patch    — Propose a code change (creates git branch + PR)
├── aether_run_tests        — Run Aether's test suite
└── aether_get_architecture — Read ARCHITECTURE.md for self-knowledge
```

### 3.2 MCP Resources Exposed

```
CONTEXT RESOURCES
├── aether://agent/{id}/profile      — Agent's expertise, history, success rate
├── aether://agent/{id}/memories     — Recent relevant memories
├── aether://agent/{id}/skills       — Installed skills
├── aether://agent/{id}/plan         — Current execution plan
├── aether://system/architecture     — System architecture doc
├── aether://system/status           — Live system status
└── aether://repo/file/{path}        — Aether OS source code
```

---

## 4. Agent Lifecycle (New Flow)

### 4.1 Spawning an Agent

```
User clicks "New Agent" in UI
    │
    ▼
Kernel.ProcessManager.spawn({
    role: "Coder",
    goal: "Fix the login bug in auth.ts",
    runtime: "claude-code",        // or "openclaw"
    skills: ["git-workflow", "test-runner"],
    model: "claude-sonnet-4",
    graphical: true,               // OpenClaw computer use
})
    │
    ▼
ProcessManager creates:
  1. Working directory in VirtualFS (/home/agent_{pid}/)
  2. Writes .claude/settings.json (or .openclaw config)
  3. Writes MCP server config pointing to Aether kernel
  4. Pre-loads skills from SkillForge into project skills/
  5. Injects system prompt with agent profile + memories
  6. Spawns subprocess: `claude --mcp-server aether://localhost:3001/agent/{pid}`
     OR: `openclaw agent --mcp aether://localhost:3001/agent/{pid}`
    │
    ▼
Agent connects to Aether MCP server
  → Discovers aether_* tools
  → Loads memories and skills from context resources
  → Starts working on the goal
    │
    ▼
Aether captures:
  - stdout/stderr → EventBus → UI log viewer
  - Tool calls → AuditLogger
  - MCP tool results → MemoryManager (auto-store observations)
  - Agent status → ProcessManager state updates
```

### 4.2 User Interaction During Execution

```
┌──────────────────────────────────────────────────────┐
│ Agent VM Window                                       │
│                                                       │
│ ┌───────────────────────────────────┐ ┌────────────┐ │
│ │                                   │ │ Live Logs  │ │
│ │   AGENT'S TERMINAL / SCREEN       │ │            │ │
│ │                                   │ │ THOUGHT:   │ │
│ │   (Real OpenClaw/Claude Code      │ │ I need to  │ │
│ │    output streamed live)           │ │ read the   │ │
│ │                                   │ │ auth.ts... │ │
│ │   $ claude "Fix the login bug"    │ │            │ │
│ │   > Reading auth.ts...            │ │ ACTION:    │ │
│ │   > Found issue on line 42        │ │ read_file  │ │
│ │   > Editing...                    │ │ auth.ts    │ │
│ │                                   │ │            │ │
│ │                                   │ │ SKILL:     │ │
│ │                                   │ │ Used       │ │
│ │                                   │ │ git-wkflow │ │
│ └───────────────────────────────────┘ └────────────┘ │
│                                                       │
│ [Pause] [Send Message] [Take Over] [Stop]            │
│                                                       │
│ Memory: 12 stored | Skills: 3 active | IPC: 0 queued │
└──────────────────────────────────────────────────────┘
```

**Pause** — sends SIGSTOP to subprocess, user can read state
**Send Message** — injects text into agent's stdin (OpenClaw supports this)
**Take Over** — pauses agent, gives user direct terminal/desktop control
**Stop** — SIGTERM with graceful cleanup

### 4.3 Agent Takeover (The Killer Feature)

```
User clicks "Take Over"
    │
    ▼
1. Agent subprocess paused (SIGSTOP)
2. If graphical: VNC session handed to user (already connected)
3. If terminal: PTY session attached to user's terminal window
4. User does whatever they need (fix something, check state, etc.)
5. User clicks "Resume"
6. Optionally inject a message: "I fixed the config file, continue from there"
7. Agent subprocess resumed (SIGCONT)
8. Agent reads injected message and adapts
```

---

## 5. Implementation Phases

### Phase 1: Aether MCP Server (Foundation)

Create a new kernel subsystem that exposes Aether's capabilities as an MCP server.

**New file: `kernel/src/AetherMCPServer.ts`**
- Starts an MCP server (stdio transport) per agent process
- Registers tools from MemoryManager, SkillForge, ProcessManager, etc.
- Handles tool calls by delegating to existing kernel subsystems
- Serves MCP resources (agent profile, memories, system status)

**Changes to: `kernel/src/ProcessManager.ts`**
- Add `runtime` field to spawn config: `'builtin' | 'claude-code' | 'openclaw'`
- When runtime is external, spawn as subprocess instead of running AgentLoop
- Pipe stdout/stderr through EventBus
- Handle SIGSTOP/SIGCONT for pause/resume

**New file: `kernel/src/AgentSubprocess.ts`**
- Manages the lifecycle of an external agent subprocess
- Writes MCP config to agent's working directory
- Spawns the process with correct env vars and args
- Captures output, maps to Aether events
- Handles graceful shutdown

**Estimated: ~600 lines across 3 files**

### Phase 2: Claude Code Integration

**Config generation:**
- Write `.claude/settings.json` with MCP server pointing to Aether
- Write `.claude/CLAUDE.md` with agent role, goal, and context
- Pre-load skills as `.claude/commands/` or project skills

**Process management:**
- Spawn: `claude --print --mcp-config /path/to/mcp.json "Your goal: {goal}"`
- Or interactive: `claude --mcp-config /path/to/mcp.json` with stdin pipe
- Parse Claude Code's streaming output format
- Map to Aether event types (thought, action, observation)

**Estimated: ~300 lines**

### Phase 3: OpenClaw Integration

**Config generation:**
- Write `.openclaw/settings.json` with MCP servers
- Copy skills to project `skills/` directory
- Write system prompt to `.openclaw/INSTRUCTIONS.md`

**Process management:**
- Spawn: `openclaw agent "Your goal: {goal}" --mcp aether`
- OpenClaw has built-in computer use (screen, browser, terminal)
- Parse OpenClaw's output format
- Map to Aether events

**Estimated: ~300 lines**

### Phase 4: Agent Takeover UX

**Redesign AgentVM.tsx:**
- Remove fake simulated desktop entirely
- Real-time terminal view (agent's actual stdout)
- Pause/Resume with message injection
- Take Over button → attaches user to agent's terminal or VNC
- Skill usage indicators (which Aether skills the agent is calling)
- Memory activity (what's being stored/recalled)
- IPC activity (messages to/from other agents)

**Estimated: ~400 lines (mostly simplification — removing fake UI)**

### Phase 5: Self-Modification via Repo Access

**New MCP tools:**
- `aether_read_source(path)` — read any file in the Aether OS repo
- `aether_propose_patch(files, description)` — create a git branch with changes
- `aether_run_tests(suite?)` — run kernel/runtime/UI tests
- `aether_get_architecture()` — read ARCHITECTURE.md + CODEBASE.md

**Safety:**
- All patches go to feature branches, never main
- Patches require human approval before merge
- Test suite must pass before PR is created
- Changes are audited via AuditLogger
- Rate limited: max 3 patches per agent per hour

**Estimated: ~200 lines**

---

## 6. What Changes vs What Stays

### KEEP (no changes needed)
- EventBus, StateStore, MemoryManager, SkillForge
- PluginRegistry, AuditLogger, MetricsExporter
- CronManager, WebhookManager, AuthManager
- ClusterManager, ResourceGovernor, ModelRouter
- MCPManager (client-side, for connecting TO external MCP servers)
- OpenClawAdapter (SKILL.md import pipeline)
- Desktop UI shell (Dock, Window manager, workspaces)
- All non-agent apps (Browser, Terminal, Notes, Settings, etc.)

### MODIFY
- ProcessManager — add external runtime support
- AgentVM.tsx — replace fake desktop with real terminal/VNC viewer
- AgentDashboard.tsx — add runtime selector (builtin/claude-code/openclaw)
- VirtualDesktop.tsx — simplify, remove simulated windows
- Kernel.ts — register AetherMCPServer subsystem (#30)

### ADD
- `kernel/src/AetherMCPServer.ts` — MCP server exposing kernel to agents
- `kernel/src/AgentSubprocess.ts` — external agent process management
- Config generators for Claude Code and OpenClaw

### DEPRECATE (keep but don't invest in)
- `runtime/src/AgentLoop.ts` — still works as fallback ("builtin" mode)
- `runtime/src/tools.ts` — only used by builtin mode
- Simulated desktop (VirtualDesktop fake windows)

---

## 7. Migration Path

**Phase 1** gives us the MCP server — agents can already use Aether's memory and skills.
**Phase 2** adds Claude Code as an option — power users can select it.
**Phase 3** adds OpenClaw — full computer use with Aether's brain.
**Phase 4** fixes the UX — real agent viewing instead of fake desktop.
**Phase 5** enables self-modification — agents improving the OS they run on.

The builtin agent loop stays as a fallback for simple tasks or when external runtimes aren't installed. No breaking changes — just new options that are strictly better.

---

## 8. The End State

An Aether OS where:

1. You click "New Agent", pick Claude Code or OpenClaw as the runtime
2. The agent gets Aether's full brain (memory, skills, IPC, audit) as MCP tools
3. You watch it work in real-time through a live terminal or VNC desktop
4. You can pause it, take over, inject instructions, and resume
5. It can discover and create skills, share them with other agents
6. Multiple agents collaborate via IPC, delegating subtasks to each other
7. Agents can read the Aether OS source code and propose improvements
8. You approve patches, the OS evolves, agents get better

**Aether OS becomes the first operating system that improves itself through the agents it runs.**
