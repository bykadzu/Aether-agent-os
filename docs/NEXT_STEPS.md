# Aether OS — Next Steps & Roadmap

## Where We Are Now

Aether OS v0.1.0 has a working kernel, agent runtime, and desktop UI. Agents can be deployed, run autonomously with real tools, communicate with each other, and be observed in real time. The foundation is solid — process management, filesystem, terminals, persistence, auth, containers, clustering, and a plugin system are all implemented.

What's missing is the polish, hardening, and "last mile" work that turns a working prototype into something others can pick up and use confidently.

---

## Phase 1: Stabilize & Test

**Goal:** Make what exists reliable and verifiable.

### 1.1 Add a Test Suite
- **Unit tests** for each kernel module (ProcessManager, VirtualFS, StateStore, etc.)
- **Integration tests** for the full spawn → think → act → observe cycle
- **Protocol tests** — send every command type, verify every event type
- **Frontend component tests** for critical flows (deploy agent, approve action, terminal I/O)
- Recommended: Vitest for both server and client (matches Vite ecosystem)

### 1.2 Error Handling Audit
- Identify crash paths in the kernel (what happens if Docker isn't running? If SQLite is locked? If Gemini API key is missing?)
- Add graceful degradation — clear error messages instead of silent failures
- Handle WebSocket disconnection/reconnection more robustly in the UI
- Add proper error boundaries in React components

### 1.3 Process Cleanup
- Ensure zombie processes get reaped reliably
- Clean up Docker containers on kernel shutdown (handle SIGINT/SIGTERM)
- Clean up PTY sessions when processes die
- Add a `/tmp/aether` garbage collection routine for orphaned agent files

---

## Phase 2: Developer Experience

**Goal:** Make it easy for someone new to clone the repo and start working.

### 2.1 Setup & Onboarding
- Add a `.env.example` file documenting all environment variables
- Create a setup script (`scripts/setup.sh`) that checks dependencies (Node 22+, Docker optional, etc.)
- Add health check output on kernel boot showing what's available (Docker: yes/no, GPU: yes/no, etc.)
- Improve the existing README with quick-start instructions, screenshots, and a short video/GIF

### 2.2 Dev Tooling
- Add ESLint + Prettier configuration for consistent code style
- Add pre-commit hooks (husky + lint-staged)
- Set up CI pipeline (GitHub Actions) for lint, typecheck, and tests
- Add `npm run typecheck` script for all packages

### 2.3 Logging & Debugging
- Structured logging in the kernel (levels: debug, info, warn, error)
- Add a debug panel in the UI that shows raw WebSocket traffic
- Kernel boot log showing each subsystem status
- Agent loop debug mode with verbose step-by-step logging

---

## Phase 3: Core Feature Completion

**Goal:** Finish the features that are partially built.

### 3.1 Authentication & Authorization
- Test and harden the full login → register → token refresh flow
- Add role-based access control (admin can manage all agents, users only their own)
- Add session expiry and re-authentication prompts in the UI
- Password reset flow

### 3.2 Desktop App Improvements
- ~~**File Explorer:** Connect fully to kernel filesystem~~ **DONE** — Kernel FS browsing, breadcrumb nav, file stats, refresh
- ~~**Code Editor:** Syntax highlighting, save to kernel FS, open from File Explorer~~ **DONE** — Regex syntax highlighting, kernel read/write, cursor tracking, unsaved dot
- **Browser App:** Render fetched pages more faithfully, handle navigation
- ~~**Notes App:** Persist to kernel filesystem instead of localStorage~~ **DONE** — Kernel FS persistence at `/home/root/Documents/notes/`, auto-save with debounce
- ~~**Settings App:** Actually apply settings (theme, API keys, resource limits)~~ **DONE** — Kernel status, LLM providers with green/red indicators, GPU/Docker/cluster info, Gemini API key in mock mode

### 3.3 Agent Capabilities
- **Conversation memory:** Let agents remember context across restarts (load previous logs)
- ~~**Agent templates:** Pre-built configs for common roles~~ **DONE** — 8 templates (Web Researcher, Code Developer, Code Reviewer, Data Analyst, System Admin, Technical Writer, Test Engineer, Project Manager) with template-first deploy UI
- **Tool permissions per agent:** Configure which tools each agent role can use
- **Step budget management:** UI controls for adjusting max steps, pausing/resuming the loop

### 3.4 GitHub Integration
- ~~The "GitHub Sync" button exists in the UI but the handler isn't implemented~~ **DONE** — Modal for repo URL entry, clone into agent workspace
- ~~Add ability to clone repos into an agent's workspace~~ **DONE** — Via kernel TTY or clone script
- ~~Push agent-created code to branches~~ **DONE** — Commit via TTY with approval gating
- Display PR/issue status in Mission Control

---

## Phase 4: Multi-Agent Collaboration

**Goal:** Make agents work together meaningfully.

### 4.1 Agent-to-Agent Protocols
- Define standard message formats (task delegation, status updates, results)
- Build a "supervisor" agent type that can spawn and manage sub-agents
- Implement task queues — one agent produces work items, others consume them
- Add conversation threads between agents (visible in UI timeline)

### 4.2 Shared Workspaces (Enhanced)
- The shared mount system exists — add UI for creating and managing shared workspaces
- Show which agents are mounted to which workspaces
- File conflict detection when multiple agents write to the same file
- Collaborative editing visualization

### 4.3 Orchestration Patterns
- Pipeline: Agent A → Agent B → Agent C (sequential handoff)
- Fan-out: One task split across multiple agents in parallel
- Consensus: Multiple agents vote on a decision
- Add a visual orchestration builder in the UI

---

## Phase 5: Production Hardening

**Goal:** Make it deployable and trustworthy.

### 5.1 Security
- Sandbox escape audit — verify agents can't break out of their filesystem/container
- Rate limiting on agent API calls and tool execution
- Audit logging — who did what, when
- Network isolation options for agent containers
- Input sanitization on all kernel command parameters

### 5.2 Resource Management
- Per-agent resource quotas (CPU time, memory, disk, API calls)
- Resource usage dashboard in the UI
- Automatic throttling when system resources are constrained
- Cost tracking for LLM API usage per agent

### 5.3 Reliability
- Kernel crash recovery — resume agents from last snapshot on restart
- Database backups and rotation
- WebSocket message queuing during disconnection (no lost events)
- Graceful shutdown — save all agent state before kernel exits

### 5.4 Deployment
- Dockerfile for the full stack (kernel + UI in one container)
- Docker Compose for multi-node cluster setup
- Cloud deployment guide (AWS/GCP/Azure)
- ARM support (Raspberry Pi cluster?)

---

## Phase 6: Ecosystem & Extensibility

**Goal:** Let others build on top of Aether OS.

### 6.1 Plugin Ecosystem
- Plugin marketplace / registry
- Plugin SDK documentation with examples
- Common plugins: GitHub, Slack, database, email, calendar
- Plugin isolation (run plugins in their own sandbox)

### 6.2 Multi-LLM Support — **DONE**
- ~~Abstract the LLM layer — support OpenAI, Anthropic, local models (Ollama)~~ **DONE** — `runtime/src/llm/` with provider interface, 4 providers, auto-detection
- ~~Per-agent model selection in the UI~~ **DONE** — Model selector in deploy modal, format: `provider:model`
- Cost/quality tradeoff settings (fast model for simple tasks, smart model for hard ones)
- ~~Local model support for air-gapped deployments~~ **DONE** — OllamaProvider with prompt-based tool calling fallback

### 6.3 API & Integrations
- REST API for external systems to spawn and monitor agents
- Webhook support (notify external systems on agent events)
- CLI tool for headless agent management
- Embeddable agent widget for other web apps

### 6.4 Mobile & Accessibility
- Responsive UI for tablet/phone monitoring
- Push notifications for approval requests
- Keyboard shortcuts for all major actions
- Screen reader support

---

## Quick Wins (Can Do Anytime)

These are small improvements that would make an immediate difference:

| Quick Win | Effort | Impact |
|-----------|--------|--------|
| Add `.env.example` | 10 min | Prevents "where do I put my API key?" confusion |
| Add `npm run typecheck` | 5 min | Catch type errors without building |
| Kernel boot banner with subsystem status | 30 min | Know instantly what's working |
| Screenshots in README | 30 min | Makes the project 10x more approachable |
| Agent log export (download as JSON/text) | 1 hr | Let users save and share agent runs |
| Dark/light theme toggle | 1 hr | Already has dark theme, just add a switch |
| Keyboard shortcut overlay (Cmd+/) | 30 min | Discoverability |
| Loading skeleton for Mission Control | 30 min | Feels faster on initial load |

---

## Priority Recommendation

If I had to pick the top 5 things to do next:

1. **Test suite** — You can't confidently change anything without tests. Start with kernel unit tests.
2. **`.env.example` + setup script + README update** — Make it cloneable by anyone in 5 minutes.
3. **Error handling audit** — Find and fix the crash paths. One bad Gemini response shouldn't kill the kernel.
4. **Agent templates** — Lower the barrier from "configure an agent" to "click a button."
5. **Multi-LLM support** — Not everyone has a Gemini key. OpenAI and local model support widens the audience massively.
