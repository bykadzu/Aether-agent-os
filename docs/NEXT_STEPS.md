# Aether OS — Next Steps & Roadmap

## Where We Are Now

Aether OS v0.5 is complete. The system has 26 kernel subsystems, 20+ desktop apps, 28+ agent tools, 4 LLM providers, and 900+ tests.

**Completed versions:**
- **v0.1** — Kernel foundation (12 subsystems), agent runtime, desktop UI, 14 apps
- **v0.2** — Real apps (Playwright browser, Monaco editor, music player, PDF viewer, spreadsheet, canvas, writer, system monitor, theme system, workspaces)
- **v0.3** — Agent intelligence (memory, planning, reflection, feedback, profiles, collaboration, vision, cron scheduling, Memory Inspector, automation UI)
- **v0.4** — Ecosystem (REST API v1, webhooks, Slack/GitHub/S3/Discord integrations, plugin marketplace, agent templates, CLI, SDK, RBAC organizations)
- **v0.5** — Production (resource governance, audit logging, Prometheus metrics, TLS, MFA/TOTP, Helm chart, priority scheduling, model routing, WebSocket batching, LangChain/OpenAI tool compat, granular RBAC, PWA, responsive UI). **Post-v0.5:** agent self-knowledge (CODEBASE.md auto-seeded), functional Linux desktop (Dockerfile.desktop + WebSocket VNC proxy), graphical agent metadata parsing

**Next:** Testing, stabilization, and v0.6 planning

---

## Phase 1: Stabilize & Test ✅ COMPLETE

**Goal:** Make what exists reliable and verifiable.

### 1.1 Add a Test Suite ✅
- **Unit tests** for each kernel module (ProcessManager, VirtualFS, StateStore, AuthManager, EventBus, PluginManager, SnapshotManager)
- **Integration tests** for the full spawn → signal → exit cycle
- **Protocol tests** — every command/event type constructable, constants verified
- **Runtime tests** — all tools tested with mocked kernel
- 304 tests across 16 suites, all passing (Vitest)

### 1.2 Error Handling Audit ✅
- ContainerManager: Docker re-check + fallback if Docker disappears mid-session, command timeout safety
- StateStore: Corrupt/locked DB → recreate or fall back to in-memory
- PTYManager: Spawn failures caught, error events emitted to UI
- VirtualFS: ENOSPC (disk full) and EACCES (permission denied) caught with clear messages
- AgentLoop: API rate limit → exponential backoff (3 retries), malformed LLM response → graceful skip
- AuthManager: Missing secret → auto-generate + warn (verified)
- ClusterManager: Hub disconnect → reconnect with exponential backoff
- React ErrorBoundary wrapping windows, dock, desktop widgets
- WebSocket disconnect → reconnecting banner in UI

### 1.3 Process Cleanup
- Ensure zombie processes get reaped reliably
- Clean up Docker containers on kernel shutdown (handle SIGINT/SIGTERM)
- Clean up PTY sessions when processes die
- Add a `~/.aether` garbage collection routine for orphaned agent files

---

## Phase 2: Developer Experience ✅ MOSTLY COMPLETE

**Goal:** Make it easy for someone new to clone the repo and start working.

### 2.1 Setup & Onboarding ✅
- `.env.example` created with all environment variables documented
- `scripts/setup.sh` checks Node 22+, npm, Docker (optional), GPU (optional)
- Setup script installs all packages and creates `.env` from `.env.example`
- CI badge added to README

### 2.2 Dev Tooling ✅
- ESLint (flat config) + Prettier configured with TypeScript + React hooks rules
- CI pipeline (`.github/workflows/ci.yml`) — lint + test on push/PR to main
- Scripts added: `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run typecheck`
- ~~Pre-commit hooks (husky + lint-staged)~~ **DONE** — husky 9 + lint-staged 16 configured

### 2.3 Logging & Debugging
- Structured logging in the kernel (levels: debug, info, warn, error)
- Add a debug panel in the UI that shows raw WebSocket traffic
- Kernel boot log showing each subsystem status
- Agent loop debug mode with verbose step-by-step logging

---

## Phase 3: Core Feature Completion — PARTIALLY COMPLETE

**Goal:** Finish the features that are partially built.

### 3.1 Authentication & Authorization
- Test and harden the full login → register → token refresh flow
- Add role-based access control (admin can manage all agents, users only their own)
- Add session expiry and re-authentication prompts in the UI
- Password reset flow

### 3.2 Desktop App Improvements
- ~~**File Explorer:** Connect fully to kernel filesystem~~ **DONE** — Kernel FS browsing, breadcrumb nav, file stats, refresh
- ~~**Code Editor:** Syntax highlighting, save to kernel FS, open from File Explorer~~ **DONE** — Monaco Editor with multi-tab, file tree sidebar, language auto-detection, kernel read/write
- ~~**Browser App:** Render fetched pages more faithfully, handle navigation~~ **DONE** — Full browser UI with tab bar, canvas viewport, keyboard/mouse event forwarding, dual-mode (Chromium kernel / iframe fallback)
- ~~**Notes App:** Persist to kernel filesystem instead of localStorage~~ **DONE** — Kernel FS persistence at `/home/root/Documents/notes/`, auto-save with debounce
- ~~**Settings App:** Actually apply settings (theme, API keys, resource limits)~~ **DONE** — Kernel status, LLM providers with green/red indicators, GPU/Docker/cluster info, Gemini API key in mock mode

### 3.3 Agent Capabilities
- ~~**Conversation memory:** Let agents remember context across restarts~~ **DONE** — MemoryManager with FTS5 search, memory-aware agent loop, auto-journaling (v0.3)
- ~~**Agent templates:** Pre-built configs for common roles~~ **DONE** — 8 templates (Web Researcher, Code Developer, Code Reviewer, Data Analyst, System Admin, Technical Writer, Test Engineer, Project Manager) with template-first deploy UI
- **Tool permissions per agent:** Configure which tools each agent role can use
- **Step budget management:** UI controls for adjusting max steps, pausing/resuming the loop

### 3.4 GitHub Integration
- ~~The "GitHub Sync" button exists in the UI but the handler isn't implemented~~ **DONE** — Modal for repo URL entry, clone into agent workspace
- ~~Add ability to clone repos into an agent's workspace~~ **DONE** — Via kernel TTY or clone script
- ~~Push agent-created code to branches~~ **DONE** — Commit via TTY with approval gating
- Display PR/issue status in Mission Control

---

## Phase 4: Multi-Agent Collaboration — PARTIALLY COMPLETE (v0.3)

**Goal:** Make agents work together meaningfully.

### 4.1 Agent-to-Agent Protocols
- ~~Define standard message formats (task delegation, status updates, results)~~ **DONE** — 8 collaboration protocol types in `runtime/src/collaboration.ts` (v0.3)
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
| ~~Add `.env.example`~~ | ~~10 min~~ | ✅ Done |
| ~~Add `npm run typecheck`~~ | ~~5 min~~ | ✅ Done |
| ~~Kernel boot banner with subsystem status~~ | ~~30 min~~ | ✅ Done — prints 12 subsystems + port + FS root + cluster |
| Screenshots in README | 30 min | Makes the project 10x more approachable |
| ~~Agent log export (download as JSON/text)~~ | ~~1 hr~~ | ✅ Done — JSON + text download from AgentVM |
| ~~Dark/light theme toggle~~ | ~~1 hr~~ | ✅ Done — ThemeProvider context, dark/light/system modes, CSS custom properties, ThemeToggle in menu bar |
| ~~Keyboard shortcut overlay (Cmd+/)~~ | ~~30 min~~ | ✅ Done — `ShortcutOverlay.tsx` |
| ~~Loading skeleton for Mission Control~~ | ~~30 min~~ | ✅ Done — animated pulse cards during initial load |

---

## Priority Recommendation

**Completed priorities (v0.1–v0.3):**
1. ~~**Test suite**~~ ✅ Done — 345+ tests, 19+ suites
2. ~~**`.env.example` + setup script + README update**~~ ✅ Done
3. ~~**Error handling audit**~~ ✅ Done — all crash paths addressed
4. ~~**Agent templates**~~ ✅ Done — 8 pre-built templates with curated tool sets
5. ~~**Multi-LLM support**~~ ✅ Done — Gemini, OpenAI, Anthropic, Ollama with auto-fallback
6. ~~**Cross-session memory**~~ ✅ Done — MemoryManager with FTS5 (v0.3)
7. ~~**Self-reflection & planning**~~ ✅ Done — reflection.ts + planner.ts (v0.3)
8. ~~**Cron scheduling**~~ ✅ Done — CronManager with event triggers (v0.3)
9. ~~**Agent collaboration**~~ ✅ Done — Structured protocols (v0.3)
10. ~~**Vision capability**~~ ✅ Done — All 4 LLM providers (v0.3)

**Next priorities (v0.4):**
1. **App Store framework** — App manifest, sandbox, permissions, SDK
2. **Plugin Marketplace** — Searchable catalog, one-click install
3. **External integrations** — GitHub, Slack, Discord (bidirectional)
4. **REST API & SDKs** — Public API, TypeScript/Python SDKs
5. **Lightweight skills format** — Simpler than full React apps for community contributions
