# Agent Integration Research — OpenClaw + Orgo.ai + Aether OS

> Written 2026-02-12. Research into how to make Aether OS agents world-class by integrating the best open-source agent loop (OpenClaw) and studying the best computer-use infrastructure (Orgo.ai).

---

## The Problem

Aether OS has a working agent loop (`runtime/src/AgentLoop.ts`) with 33 tools, 4-layer memory, injection guards, context compaction, and inter-agent IPC. But the core reasoning is:

- Sequential and single-threaded (no parallel tool execution)
- Static system prompts (not dynamically adjusted mid-task)
- No streaming responses
- No checkpointing or mid-task recovery
- Tool output truncated to 1000 chars (information loss)
- No model failover (if one provider fails, the agent fails)
- No auth rotation (single API key per provider)
- Heuristic fallback is demo-quality only

The agent loop works, but it's not competitive with the best available. Rather than rebuilding from scratch, we should integrate what already exists.

---

## OpenClaw — The Best Open-Source Agent Loop

### What It Is

OpenClaw (formerly Clawdbot/Moltbot) is a free, open-source autonomous AI agent by Peter Steinberger. MIT licensed, TypeScript/Node.js, 145k+ GitHub stars. It runs as a standalone agent runtime with its own WebSocket Gateway, CLI, and web UI.

- Repository: github.com/openclaw/openclaw
- License: MIT
- Runtime: Node.js >= 22
- Language: TypeScript (same stack as Aether OS)

### What Makes Its Agent Loop Better

| Feature | Aether OS (current) | OpenClaw |
|---------|---------------------|----------|
| Execution model | Sequential async function | Async generator, serialized per-session lane |
| Context management | Truncate at fixed intervals | Auto-compaction with memory flush (promotes facts before condensing) |
| Model failover | None — if provider fails, agent fails | Automatic switch to backup model with portable context |
| Auth handling | Single API key per provider | Multiple keys with rotation and cooldown tracking |
| Streaming | No (full message awaited) | Incremental delta streaming with reasoning stream |
| Hook system | None | 13+ hook points (before/after tool call, compaction, bootstrap, etc.) |
| Error recovery | Exponential backoff, heuristic fallback | Auth rotation + model failover + in-loop learning |
| Session persistence | Kernel-managed process state | Append-only JSONL event logs with branching |
| Context portability | Provider-locked | Fully serializable — save with Claude, resume with GPT |
| Tool ecosystem | 33 built-in tools | Core tools + 3,000+ community skills on ClawHub |
| Concurrency | No serialization guarantees | "Default Serial, Explicit Parallel" per-session lanes |

### The 6-Phase Loop

1. **Entry & Validation** — accepts message, validates, resolves session, returns immediately (async)
2. **Preparation** — resolves model, loads skills, assembles prompt from AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, skill definitions, memory search
3. **Execution** — manages loop: queuing runs per-session, building model session, subscribing to events, enforcing timeouts (600s default)
4. **Event Translation** — internal events bridged to stream protocol (tool, assistant, lifecycle)
5. **Tool Execution** — model proposes tool calls, runtime executes (Docker sandbox for non-operator sessions), results backfilled, loop continues
6. **Completion** — polls for lifecycle end/error, returns final status

### Model Support

Built-in: Anthropic, OpenAI, Google Gemini, Vertex AI, OpenRouter, xAI, Groq, Cerebras, Mistral, GitHub Copilot, Vercel AI Gateway.

Custom providers (via config): Moonshot AI / Kimi K2.5, Qwen, Ollama, LM Studio, vLLM, LiteLLM — any OpenAI-compatible endpoint.

### "KimiClaw"

Not a separate product. It's the informal name for Kimi K2.5 running inside OpenClaw. Notable because:
- Kimi K2.5: 1 trillion parameter MoE model, MIT licensed
- Supports Agent Swarm: up to 100 sub-agents for parallel execution
- Sustains 200-300 sequential tool calls without drift, up to 1,500 coordinated steps
- $3/1M output tokens vs Claude's $25/1M (~8x cost savings)

### Risks

- **Fast-moving target** — renamed twice in one week. API stability uncertain.
- **Security concerns** — researchers flagged "lethal trifecta" of high autonomy + broad system access + open internet
- **MCP not native** — only via community skills (GitHub issue #8188 open)
- **pi-agent-core not independently packaged** — extracting it means maintaining a fork
- **Custom Gateway protocol** — not a standard like MCP or OpenAPI

---

## Orgo.ai — Computer-Use Infrastructure

### What It Is

Orgo (orgo.ai) is an infrastructure-as-a-service platform providing on-demand cloud virtual desktops for AI agents. Their tagline: "Computers for AI Agents." It is NOT an AI agent — it is the runtime environment layer.

- Product: Managed headless Linux VMs (Ubuntu) with sub-500ms boot times
- Interface: REST API + Python/TypeScript SDKs + React VNC component
- Pricing: $20/mo (Developer), $99/mo (Startup), Enterprise (custom)

### What It Does

Standard See-Decide-Act loop infrastructure:

```
1. computer.screenshot()        -> base64 PNG
2. Send to LLM                  -> model returns action
3. computer.left_click(x, y)    -> executes on VM
   OR computer.type("hello")
   OR computer.key("ctrl+c")
   OR computer.bash("ls -la")
4. Repeat
```

API surface: screenshot, click, drag, scroll, type, key, bash, exec, wait, file upload/download, VNC access, RTMP streaming.

### The Takeover Question

**Orgo does NOT have pause/takeover/resume.** It provides building blocks:

- `orgo-vnc` React component with `readOnly` boolean prop — when false, human can interact
- VNC password API endpoint
- RTMP streaming for observation

But the actual pause/resume logic must live in YOUR agent loop, not their infrastructure. This confirms: **takeover is an agent-loop feature, not a VM feature.**

### How Aether Compares to Orgo

| | Orgo | Aether OS |
|---|---|---|
| What it is | VM infrastructure (IaaS) | Full agent OS + control plane |
| VMs | Managed headless Ubuntu | Docker containers with XFCE |
| Agent loop | You build it | Built-in (AgentLoop.ts) |
| VNC | API + React component | Xvfb + x11vnc + noVNC |
| Human takeover | Building blocks only | View-only (v0.5), planned |
| GPU | A10, L40s, A100 | Docker GPU passthrough |
| Multi-agent | Fleet management | ProcessManager + IPC |
| Open source | No (closed SaaS) | Yes (planned) |
| Boot time | sub-500ms | Docker-dependent (1-5s) |

**Key insight:** Orgo solves the same problem as Aether's ContainerManager + VNCManager. They are complementary, not competitive. Aether has the full OS layer that Orgo doesn't.

### Reference: rtrvr.ai VNC Relay Architecture

For scaling VNC takeover beyond a single host:
- Three-service pattern: Runner (owns desktop, VNC on localhost), Relay (matches viewer to runner via signed tokens), Viewer (noVNC in browser)
- Token-based pairing with short-lived signed tokens
- Same display stack as Aether: Xvfb + x11vnc + noVNC

---

## Current Aether Agent Loop — Detailed Assessment

### What We Have (runtime/src/AgentLoop.ts)

**The Loop:** Think (getNextAction) -> Act (execute tool) -> Observe (record result) -> repeat until `complete` tool or max steps.

**Tools (33 total):**
- File ops: read_file, write_file, list_files, mkdir, rm, stat, mv, cp
- Shell: run_command (Docker preferred, child_process fallback)
- Web: browse_web, screenshot_page, click_element, type_text
- Agent-to-agent: list_agents, send_message, check_messages, request_review, respond_to_review, delegate_task, share_knowledge
- Memory: remember, recall, forget
- Planning: create_plan, update_plan, think
- Collaboration: create_shared_workspace, mount_workspace, list_workspaces
- Vision: analyze_image
- Meta: complete, get_feedback

**Strengths:**
- OS-level process abstraction (PIDs, signals, IPC) — unique
- Multi-agent collaboration primitives (delegation, review, shared workspaces)
- 4-layer persistent memory (episodic/semantic/procedural/social)
- Real filesystem sandbox + Docker containers
- Multi-LLM provider abstraction
- LangChain/OpenAI tool compatibility layer (v0.5)
- Post-task self-reflection with quality rating
- Injection guards (pattern-based detection)
- Priority scheduling with resource fairness

**Weaknesses:**
- Single-threaded sequential execution
- Static system prompts
- No streaming
- No checkpointing / mid-task recovery
- Tool output truncated to 1000 chars
- No model failover
- No auth rotation
- Token estimation uses naive chars/4 heuristic
- Memory recall is BM25 string matching (not semantic embedding)
- No cost tracking

---

## The Integration Plan

### Strategy: Apple Model

Aether OS = the platform. OpenClaw = the brain. Takeover UX = the differentiator.

OpenClaw handles reasoning, model failover, streaming, compaction. Aether handles everything the agent lives in — containers, desktops, VNC, multi-agent coordination, the UI. The human can step in and out at any time. Nobody else offers this combination.

### Option A: OpenClaw as External Agent Provider (Recommended)

- Aether spawns an OpenClaw Gateway as a managed service
- Write a Gateway client adapter that connects via OpenClaw's WebSocket protocol
- Aether agents route through OpenClaw's loop instead of AgentLoop.ts
- Aether keeps owning: containers, VNC, desktop, multi-agent coordination, UI, process lifecycle
- OpenClaw provides: reasoning, model failover, streaming, compaction, skill ecosystem

**Effort:** Medium. Implement OpenClaw Gateway client in `server/`.

**What you get for free:**
- Model failover with portable context
- Auth rotation with cooldown
- Streaming responses
- Session persistence (JSONL)
- Auto-compaction with memory flush
- 3,000+ ClawHub skills
- 13+ hook points for instrumentation

### Option B: Adopt OpenClaw's SKILL.md Format

- Make Aether tools loadable from SKILL.md manifests
- Map SKILL.md YAML frontmatter to Aether's `ToolDefinition` interface
- Access ClawHub's 3,000+ community skills immediately
- Can be done incrementally, independent of agent loop changes

**Effort:** Low-Medium. Write a skill loader.

### Option C: Port Key Patterns to AgentLoop.ts

If full OpenClaw integration is too heavy, port the highest-value patterns:

1. **Session-serialized execution** — add per-session lanes to prevent race conditions
2. **Auto-compaction with memory flush** — promote facts before condensing
3. **Model failover** — try backup model on provider failure
4. **Auth rotation** — multiple API keys per provider with cooldown
5. **Hook system** — before/after tool call, compaction, bootstrap

**Effort:** Medium-High. Surgical changes to AgentLoop.ts.

### The Takeover Feature (Build Ourselves)

Neither OpenClaw nor Orgo does this. It's our differentiator.

**Phase 1: Agent Pause/Resume Protocol**
- Add `paused` state to ProcessManager (alongside running, stopped, etc.)
- Before each loop iteration: `if (process.state === 'paused') await this.waitForResume(pid)`
- REST endpoints: `POST /api/v1/agents/{pid}/pause` and `/resume`
- Events: `agent.paused`, `agent.resumed` on EventBus

**Phase 2: Interactive VNC Toggle**
- VNCManager already provides view-only VNC via WebSocket proxy
- Toggle noVNC's `viewOnly` property to `false` when agent is paused
- Human's mouse/keyboard events pass through to container's X11 display

**Phase 3: State Handoff**
- On resume, agent takes fresh screenshot of whatever the human left
- Inject system message: "The human interacted with the desktop. Take a new screenshot to understand the current state."
- Agent continues from new visual state

### Reference Implementation: OpenHands

OpenHands (open source) is the closest existing implementation to what we want:
- VNC desktop + pause/resume + history restore
- Worth studying for the takeover UX specifically

---

## Competitive Landscape

| Platform | Agent Loop | Desktop/VM | Human Takeover | Open Source |
|----------|-----------|------------|----------------|-------------|
| **Aether OS** | Built-in (33 tools) | Docker + XFCE + VNC | View-only (planned) | Planned |
| **OpenClaw** | Best-in-class (MIT) | None | None | Yes (MIT) |
| **Orgo.ai** | None (you build it) | Managed Ubuntu VMs | Building blocks only | No |
| **OpenHands** | Built-in | VNC desktop | Yes (pause/resume) | Yes |
| **Anthropic Computer Use** | Claude-native | You provide | No | No |
| **OpenAI Operator** | GPT-native | Built-in browser | Rudimentary (permission asks) | No |
| **E2B** | None (you build it) | Linux sandboxes | No | Yes (runtime) |

**Aether's unique position:** The only system combining a full agent OS (kernel, scheduler, memory, multi-LLM) with containerized desktops, building toward interactive takeover, with plans to integrate the best open-source agent loop.

---

## What to Do Next

1. **Finish testing v0.5** — collect bugs, fix what breaks (see TESTING-NOTES.md)
2. **Study OpenClaw's Gateway protocol** — understand the WebSocket frame format and auth flow
3. **Prototype Option A** — minimal Gateway client that sends a task and streams results
4. **Build takeover Phase 1** — pause/resume in ProcessManager (no VNC interaction yet)
5. **Adopt SKILL.md format** — low effort, high ecosystem payoff
6. **Study OpenHands** — reference implementation for takeover UX

Don't do all of this at once. The sequence matters: test first, then integrate the brain, then build the differentiator.

---

*Sources: OpenClaw docs (docs.openclaw.ai), Orgo docs (docs.orgo.ai), rtrvr.ai VNC architecture blog, Aether OS codebase analysis, OpenHands project.*
