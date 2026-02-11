# Aether OS — Remaining Tasks

Consolidated checklist of all outstanding work, derived from NEXT_STEPS.md, FEATURES.md, all roadmaps, and the research documents. Organized by urgency and version target.

**Last updated:** 2026-02-11 (v0.4.3 complete — auth fix, boot screen fix, hybrid architecture documented)

---

## Quick Wins (pre-v0.2, low effort / high impact)

- [x] **Pre-commit hooks** — husky + lint-staged configured (eslint --fix + prettier on staged .ts/.tsx)
- [ ] **Screenshots in README** — Add screenshots/GIFs of the UI to make the project more approachable. Capture: Mission Control grid, AgentVM with live terminal + plan tree, BrowserApp screencast, theme toggle, Memory Inspector, multi-workspace overview. Also add a "Current Status" badge/section at top (e.g., "v0.4.2 stable on Windows/macOS/Linux · v0.5 Phase 1 in progress") so visitors immediately understand maturity level. Highest-impact single task for contributor onboarding.
- [x] **Kernel boot banner** — Prints all 12 subsystems with status, port, FS root, cluster role on startup
- [x] **Agent log export** — Download button in AgentVM control bar (JSON + plain text formats)
- [x] **Loading skeleton for Mission Control** — Animated pulse skeleton cards during initial load
- [ ] **Dark/light theme toggle** — UI switch exists as a stub; wire up a light theme (or defer to v0.2 D3)
- [ ] **File-based memory MVP** — Simple file-based persistent memory per agent (quick win before the full v0.3 vector store; see RESEARCH-openclaw-ideas.md)

---

## v0.1.x — Polish & Hardening (before v0.2)

### Phase 3 Remaining (NEXT_STEPS.md)

**Authentication & Authorization:**
- [ ] Test and harden the full login → register → token refresh flow
- [ ] Enforce role-based access control (admin manages all agents, users only their own)
- [ ] Session expiry and re-authentication prompts in the UI
- [ ] Password reset flow

**Desktop App Improvements:**
- [ ] Browser App — render fetched pages more faithfully, handle navigation (currently iframe-only)
- [ ] Photos App — connect to a real photo source (currently gallery UI with no backend)
- [ ] Video Player — integrate a real video source (currently player UI with no backend)

**Agent Capabilities:**
- [ ] Conversation memory — load previous logs across restarts
- [ ] Tool permissions per agent — configure which tools each agent role can use
- [ ] Step budget management — UI controls for adjusting max steps, pausing/resuming the loop

**GitHub Integration:**
- [ ] Display PR/issue status in Mission Control

**Security:**
- [ ] Rate limiting on agent API calls and tool execution
- [ ] Audit logging — who did what, when
- [ ] Fine-grained network isolation for containers
- [ ] Input sanitization audit on all kernel command parameters

**Infrastructure:**
- [ ] Production Dockerfile (not started)
- [ ] Responsive/mobile layout (planned, may defer to v0.5)

---

## v0.2 — Real Apps & Real Browser

Full details in [ROADMAP-v0.2.md](./ROADMAP-v0.2.md) and [SESSION-PROMPTS-v0.2.md](./SESSION-PROMPTS-v0.2.md).

14 parallel session prompts are ready for execution in 4 waves:

### Wave 1 (no dependencies)
- [x] **A1: BrowserManager** — Playwright-based kernel browser subsystem (replaces iframe approach) ✅ Fully implemented with session management, navigation, input, screenshots, screencasting
- [x] **B1: Notification Center** — system-wide toast/notification framework ✅ NotificationProvider context, toast system, bell icon with history panel, kernel event wiring, localStorage persistence
- [x] **D1: Keyboard Shortcuts** — global shortcut registry and overlay ✅ ShortcutManager singleton, 40+ shortcuts, app-specific scopes, Cmd+/ overlay with search
- [x] **F1: Raw File Serving** — `/api/fs/raw?path=` endpoint ✅ Binary file serving with MIME types, Range requests for audio/video seeking, path traversal protection

### Wave 2 (depends on Wave 1)
- [x] **A2: BrowserApp** — Full browser UI ✅ Tab bar with multiple sessions, canvas viewport with screencast rendering, keyboard/mouse event forwarding, dual-mode (Chromium kernel / iframe fallback)
- [x] **A3: Monaco Code Editor** — Replace regex highlighter with Monaco Editor ✅ Multi-tab, file tree sidebar, language auto-detection, VS Code dark theme
- [x] **B2: System Monitor** — Real-time CPU/memory/disk/network dashboard ✅ SVG charts, 2s polling, per-agent resource breakdown, `/api/system/stats` endpoint
- [x] **B3: Music/Audio Player** — Audio playback ✅ HTML5 audio with /api/fs/raw streaming, play/pause/seek/volume, shuffle/repeat, Web Audio API visualizer, TTS tab with speechSynthesis, file browser

### Wave 3 (depends on Wave 1-2)
- [x] **B4: PDF Viewer** — Document viewer ✅ PDF rendering via embed with custom chrome, page navigation, zoom controls, file browser sidebar, AI summarization via Gemini, search, dual view modes
- [x] **C1: Spreadsheet** — Full spreadsheet ✅ Formula engine (SUM, AVERAGE, COUNT, MIN, MAX, IF), virtual-scrolled grid (1000 rows), cell formatting, CSV import/export, kernel FS persistence
- [x] **C2: Drawing Canvas** — Drawing app ✅ Object-based drawing (pen, line, rect, circle, arrow, text, eraser), select/move/resize, undo/redo, export PNG, pan/zoom, color picker
- [x] **C3: Markdown Writer** — Writer app ✅ Split view with live markdown preview, formatting toolbar, AI writing assist via Gemini, file management, kernel FS persistence
- [x] **E1: Agent Browser Tools** — Upgrade `browse_web` tool from HTTP fetch to real Chromium ✅ browse_web uses BrowserManager with fallback, added screenshot_page, click_element, type_text tools

### Wave 4 (depends on D1)
- [x] **D2: Multi-Desktop Workspaces** — Virtual workspace switching ✅ 3 workspaces, Ctrl+Left/Right to switch, dots in menu bar, move windows between workspaces, overview mode (Ctrl+Up)
- [x] **D3: Light Theme + Theme System** — Full theming ✅ ThemeManager with CSS custom properties, ThemeProvider context + useTheme() hook, dark/light/system modes, ThemeToggle in menu bar, SettingsApp appearance tab, localStorage persistence

### v0.2 Success Criteria
- [x] Agent can browse any website (not blocked by iframe restrictions) ✅ BrowserManager + agent tools
- [x] Code editor has syntax highlighting, autocomplete, and multi-file tabs ✅ Monaco Editor
- [x] All 14+ apps launch, function, and persist state through the kernel ✅ 18 apps total: Notes, Photos, Files, Chat, Settings, Terminal, Browser, Calculator, Code, Video, Agents, VM, Sheets, Canvas, Writer, System Monitor, Music, Documents
- [x] Notification center aggregates events from kernel and agents ✅ Agent completed/failed/approval events, kernel connect/disconnect
- [x] System monitor shows real resource usage ✅ SystemMonitorApp + /api/system/stats
- [x] Theme toggle works between light and dark ✅ ThemeToggle in menu bar, dark/light/system modes

---

## v0.3 — Agent Intelligence & Autonomy ✅ COMPLETE

Full details in [ROADMAP-v0.3.md](./ROADMAP-v0.3.md) and [ROADMAP-v0.3-execution.md](./ROADMAP-v0.3-execution.md).

Implemented in 4 waves across PRs #31 and #32, merged to main.

### Wave 1: Foundation — Memory & Scheduling
- [x] **MemoryManager subsystem** — 4-layer memory (episodic, semantic, procedural, social), SQLite FTS5 search, importance decay, consolidation, sharing between agents
- [x] **CronManager subsystem** — 5-field cron parser, event triggers with cooldown, cron jobs stored in SQLite, auto-spawns agents on schedule
- [x] **Memory-aware agent loop** — Loads relevant memories on startup, injects into system prompt, auto-journals on completion
- [x] **Memory agent tools** — `remember`, `recall`, `forget` tools for agents

### Wave 2: Intelligence Layer
- [x] **Self-reflection system** — Post-task reflection via LLM, quality ratings (1-5), lessons/strategies/improvements parsed and stored as procedural memory
- [x] **Goal decomposition & planning** — `create_plan` / `update_plan` / `get_plan` tools, hierarchical task trees stored in SQLite, plan state injected into system prompt
- [x] **Feedback system** — POST /api/feedback endpoint, thumbs up/down per action, `get_feedback` agent tool, stored in SQLite

### Wave 3: UI Components
- [x] **Memory Inspector App** — New app with agent list sidebar, 4-layer filter tabs, search, memory cards with importance bars/tags, stats header, mock data fallback
- [x] **Plan Viewer** — New "Plan" tab in AgentVM with collapsible tree view, status icons, progress bar
- [x] **Feedback UI** — Thumbs up/down buttons on AgentVM action entries, optional comment on negative feedback
- [x] **Automation Manager** — New "Automation" tab in SettingsApp for cron jobs and event triggers with create/delete/toggle

### Wave 4: Advanced Features
- [x] **Agent Profiles** — Auto-tracked stats per agent (tasks, success rate, expertise, quality), SQLite persistence, injected into system prompts, ProfileCard in Memory Inspector
- [x] **Collaboration Protocols** — Structured agent-to-agent coordination (review requests, task delegation, status broadcasts, knowledge sharing), 10 exported functions
- [x] **Vision Capability** — `analyze_image` tool, vision support in all 4 LLM providers (Gemini, OpenAI, Anthropic, Ollama), browser screenshot capture

### Remaining Gaps (deferred)
- [ ] **Vector embeddings** — FTS5 text search is implemented; true vector similarity search deferred to v0.3.1
- [ ] **Context compaction** — Not yet implemented; important for long-running agents
- [ ] **Bidirectional messaging integration** — Deferred to v0.4 (Slack, Discord, Telegram channels)
- [ ] **Visual workflow builder** — Orchestration UI deferred to v0.4

---

## v0.4 — Ecosystem, Marketplace & Integrations

Full details in [ROADMAP-v0.4.md](./ROADMAP-v0.4.md).

### Wave 1 (Complete)
- [x] **REST API v1** — 34 routes at /api/v1/, WebhookManager (outbound + inbound), AppManager (manifest + lifecycle), App Store UI
- [x] **Webhook & event system** — Inbound/outbound webhooks, event-triggered notifications

### Wave 2 (Complete)
- [x] **Plugin Marketplace** — PluginRegistryManager, Marketplace UI (7 categories, ratings, settings)
- [x] **External integrations (GitHub)** — IntegrationManager + GitHubIntegration (10 actions)
- [x] **TypeScript SDK** — @aether/sdk client with namespaced methods
- [x] **Agent Marketplace** — TemplateManager (publish/rate/fork)

### Wave 3 (Complete)
- [x] **Slack Integration (bidirectional)** — SlackIntegration with 8 actions (send_message, list_channels, read_channel, add_reaction, set_topic, upload_file, list_users, send_dm), event-to-Slack bridge with Mustache templates, inbound slash commands (/aether spawn/status/kill/ask), Slack Events API receiver with signature verification
- [x] **CLI Tool (@aether/cli)** — Headless CLI with hand-rolled arg parser, 20+ commands (agents, fs, system, cron, webhooks, templates), ANSI colored output, --json flag, ~/.aether/config.json storage
- [x] **RBAC & Organizations** — Organizations, teams, 5-tier role hierarchy (owner/admin/manager/member/viewer), 25+ permissions, requirePermission middleware, 14 new REST routes, Organization tab in Settings UI, backward-compatible

### Wave 4 (Complete)
- [x] **S3 Integration** — S3Integration with AWS Signature V4 signing (7 actions: list_buckets, list_objects, get_object, put_object, delete_object, copy_object, head_object), zero external dependencies
- [x] **Discord Integration** — DiscordIntegration with bot token auth (6 actions: send_message, list_guilds, list_channels, read_messages, add_reaction, get_guild_members)
- [x] **Embeddable Widget** — `<aether-agent>` Web Component (embed/ package), shadow DOM, dark/light themes, 4 position modes, auto-spawn with templates, SSE polling, self-contained bundle
- [x] **OpenAPI Spec** — Full OpenAPI 3.0.0 spec (53 endpoints, 11 tags, reusable schemas), served at GET /api/v1/openapi.json
- [x] **Template Seeding** — 16 pre-built agent templates (development, research, data, creative, ops categories) auto-seeded on first run
- [x] **Reference Plugins** — 3 reference plugin manifests (S3 Storage, Slack Notifications, GitHub Actions) auto-seeded on first run
- [x] **SDK Extensions** — Added integrations, webhooks, plugins namespaces to AetherClient
- [x] **CLI Integrations Command** — `aether integrations list|test|exec` commands

### Wave 5 — Final Items (Complete)
- [x] **Python SDK** — `aether-os-sdk` Python package (sdk-python/), httpx-based sync+async clients, full namespace coverage mirroring TypeScript SDK, SSE event streaming, pytest test suite
- [x] **Lightweight Skill Format** — SkillManager kernel subsystem, YAML-based declarative skills with step pipelines, 8 built-in actions (http.get/post, llm.complete, fs.read/write, shell.exec, transform.json/text), template interpolation, 5 bundled example skills, REST API routes, kernel commands
- [x] **Remote Access (SSH + Tailscale)** — RemoteAccessManager kernel subsystem, SSH tunnel management (local/remote/dynamic), Tailscale VPN integration (status/up/down/devices/serve), authorized key management, auto-reconnect with exponential backoff, REST API routes, kernel commands

---

## v0.4.1 — Hotfix Sprint (2026-02-10/11)

Critical fixes to get agents actually running on Windows. These were identified and fixed during the first real end-to-end test session.

### Fixed

- [x] **WebSocket frame corruption** — Two WSS instances on same httpServer caused RSV1 bit errors in ws v8. Fix: `noServer: true` + manual upgrade routing
- [x] **Duplicate agent windows** — `process.spawned` emitted twice (ProcessManager + Kernel.handleCommand). Removed duplicate + PID dedup in useKernel
- [x] **Agent stuck at "Booting"** — Error handler only logged, didn't set state. Now sets `failed` state on agent loop errors
- [x] **PTY crash on Windows** — Hardcoded `/bin/bash`. Now detects platform: `cmd.exe` on win32, no `--login` flag
- [x] **PTY directory error (code 267)** — Agent home dir didn't exist. Now creates `cwd` with `mkdirSync` before spawn
- [x] **"fetch failed" from LLM** — Server didn't load `.env`. Added dotenv loading with ESM-compatible path resolution
- [x] **"require is not defined"** — CJS `require()` in ESM context. Changed to top-level ES import for GeminiProvider
- [x] **Gemini API 400 error** — `args` schema used `type: 'object'` with no properties. Changed to `type: 'string'` + JSON parse on return
- [x] **JWT token invalid after restart** — Random signing secret each boot. Added persistent `AETHER_SECRET` in `.env`
- [x] **401 REST API errors** — UI fetch calls missing auth headers. Added Bearer token to all protected endpoints (AgentDashboard, SettingsApp, AgentVM, kernelClient GPU endpoints)
- [x] **Agent tries Linux commands on Windows** — System prompt hardcoded "Linux terminal with bash". Now platform-aware (Windows/macOS/Linux) with correct shell, commands, and package managers
- [x] **ProcessManager POSIX paths** — `cwd` was changed to real Windows paths, breaking VirtualFS double-mapping. Reverted to virtual POSIX paths
- [x] **`run_command` empty output** — PTY marker-based capture failed on Windows cmd.exe. Replaced with `child_process.exec()` for reliable stdout/stderr capture
- [x] **`write_file` double-path bug** — `C:\temp\aether\C:\temp\aether\home\agent_1`. Fixed `resolveCwd` to normalize backslashes + handle Windows absolute paths
- [x] **Empty tool args** — Gemini sometimes returns `run_command({})` or `write_file({})`. Added validation guards with helpful error messages
- [x] **Duplicate log entries (4x)** — Interleaved events bypassed consecutive-only dedup. Improved `appendLog` to check last N entries of same type
- [x] **Long-running command FAIL** — Graphical apps (Pygame) timed out and reported FAIL. Now returns partial success with stdout if process was killed

### Known Issues (Still Open) — Prioritized

**High priority (reliability blockers):**
- [ ] **Gemini empty args on first call** — LLM sometimes returns empty JSON args before figuring out the correct format. The guards help but the root cause is in the Gemini response schema. *Fix: add few-shot examples to system prompt showing correct tool call format; add retry-with-guidance loop in GeminiProvider when args parse as empty.*
- [ ] **Duplicate events at source** — Events still emit 2-3x through EventBus wildcard + server broadcast chain. Client-side dedup mitigates but a proper fix needs event IDs or server-side dedup. *Fix: add UUIDv7 event IDs in EventBus.emit(); enforce dedup server-side before WebSocket broadcast. Make event ID mandatory at emission point (not optional) to prevent regressions when new event sources are added.*
- [ ] **Context compaction** — Long-running agents hit LLM context limits. No compaction/summarization yet. *Fix: implement periodic summarization (every N steps or on token threshold) using a cheap model (e.g., gemini-3-flash or gpt-4o-mini) to compress episodic history. Safeguard: if summarization fails (LLM error/timeout), preserve last N raw entries rather than dropping context. Critical for extended autonomy.*
- [ ] **Agent commands run on host** — No sandboxing yet; `run_command` executes directly on the host OS. Should use Docker containers when available. *Fix: activate ContainerManager for run_command when Docker is available; fall back to child_process only when Docker is unavailable.*

**Medium priority (usability):**
- [ ] **ShortcutManager conflicts** — `Ctrl+1` through `Ctrl+9` keyboard shortcuts overwrite each other. *Fix: use workspace-specific or app-scoped shortcut registries; add conflict detection and logging.*
- [ ] **Playwright not installed** — BrowserManager disabled; agents can't browse web. *Fix: add `npx playwright install --with-deps` to setup.sh or post-install script; add Dockerfile instruction.*
- [ ] **Multiple WebSocket connections** — Browser sometimes opens 2+ connections (StrictMode, HMR). *Fix: implement session ID in connect handshake; reject duplicate connections or multiplex.*
- [ ] **Agent home directory cleanup** — Spawned agent dirs under `C:\temp\aether\home\` not cleaned up on process exit. *Fix: hook into ProcessManager zombie→dead transition to rm -rf home dir (with safety checks, skip if snapshot exists).*

---

## v0.4.2 — Last Mile Polish (2026-02-11)

### Model Updates
- [x] **Updated LLM defaults to 2026 frontier models** — Gemini 3 Flash/Pro, GPT-5.2/5.3-Codex, Claude Opus 4.6 (older models still available as options)
- [x] **Updated Settings model selector** — Cron job model dropdown now lists all 7 current models across providers
- [x] **Updated .env.example** — Model name comments reflect current defaults

### Reliability (Tier 1)
- [x] **Persistent storage default** — Changed AETHER_ROOT from `/tmp/aether` to `~/.aether` (survives reboots). Configurable via `AETHER_FS_ROOT` env var. Migration warning on boot if legacy `/tmp/aether` data found.
- [x] **Atomic file save** — VirtualFS.writeFile now uses write-to-temp-then-rename pattern (crash-safe on all platforms).
- [x] **Configurable command timeout** — `run_command` accepts optional `timeout` arg (seconds), default 30s, max 5 min. Added `DEFAULT_COMMAND_TIMEOUT` / `MAX_COMMAND_TIMEOUT` constants.
- [x] **Container terminal resize fix** — PTYManager now sends resize signal to containerized sessions via `ContainerManager.resizeTTY()`.
- [x] **Test scoped filtering** — Vitest workspace projects: `npm run test:kernel`, `test:runtime`, `test:server`, `test:components`, `test:unit`. Not all 1300+ tests need to run every time.
- [x] **`npm run doctor` diagnostic** — New `scripts/doctor.ts` checks 9 prerequisites (Node, npm, Docker, Playwright, .env, API keys, port, data dir, disk space) with green/yellow/red output and actionable fix suggestions.

### Quality of Life (Tier 2)
- [x] **Agent pause/resume** — New `agent.pause` / `agent.resume` kernel commands. AgentLoop already supported stopped state; now exposed via `kernelClient.pauseAgent()` / `resumeAgent()` and UI buttons in AgentDashboard.
- [x] **Step limit auto-continue** — When agents hit step limit, they emit `agent.stepLimitReached` and wait up to 5 min for a continue signal. UI shows "Continue (+25 steps)" button. `kernelClient.continueAgent(pid, extraSteps)` API.
- [x] **Dead keyboard shortcuts removed** — Removed 10 unimplemented shortcuts (Cmd+P, Cmd+Shift+F, Cmd+B/I, etc.). Wired Terminal Cmd+T to open new terminal window.
- [x] **Browser download handling** — `page.on('download')` captures files and routes them into agent VFS via `browser:download` event.
- [x] **Enhanced setup.sh** — Now prompts for API key, verifies Playwright, runs doctor check, and shows scoped test commands.
- [x] **Integration smoke tests** — 9 smoke tests covering: kernel lifecycle, file lifecycle (write/read/list/delete), atomic write verification, auth flow, agent pause/resume, process spawn/info/list.

### Polish (Tier 3)
- [x] **Window edge snapping** — Drag a window to screen edge to snap: left edge = left half, right edge = right half, top edge = maximize. 20px threshold with blue preview overlay.
- [x] **File upload endpoint** — `POST /api/fs/upload?path=...` with raw binary body (50 MB limit). New `VirtualFS.writeFileBinary()` method. Upload button in File Explorer toolbar. `kernelClient.uploadFile()` client method.
- [x] **Screenshot polling optimization** — BrowserApp stops polling once kernel starts pushing screencast frames. Saves bandwidth and CPU in kernel mode.
- [x] **Iframe coordinate scaling fix** — `scaleCoords()` now uses viewport container rect instead of just canvas, and clamps coordinates to valid viewport range.

---

## v0.4.3 — Auth Fix + Hybrid Architecture Foundation (2026-02-11)

### Bug Fixes
- [x] **WebSocket auth race condition** — `useKernel()` called `connect()` before token was set, leaving WS permanently unauthenticated. All apps got "Authentication required" errors. Fix: removed auto-connect from useKernel hook, App.tsx controls WS lifecycle (connects only after token validation). Added `kernelClient.reconnect()` method.
- [x] **Boot screen progress bar** — `animate-[width_2s_ease-out_forwards]` referenced nonexistent keyframe; bar stuck at 0%. Fix: added `progressFill` keyframe to Tailwind config, use `animate-progress-fill`.

### Hybrid Architecture Vision (documented, implementation in v0.5)

Aether OS is a **two-layer system**:

| Layer | What | Technology | Status |
|-------|------|-----------|--------|
| **Control Plane** | Web UI — spawn agents, monitor, manage files, view logs | React + Vite | Working (v0.4.3) |
| **Workspace Plane** | Real Linux desktops where agents + humans work | Docker + Xvfb + x11vnc + noVNC | Infrastructure exists, needs desktop image |

**What already works:**
- `ContainerManager` creates Docker containers with graphical mode (Xvfb + x11vnc)
- `VNCManager` bridges browser WebSocket to container VNC (port 6080+)
- `VNCViewer` renders noVNC client in the window system
- `Kernel.ts` full spawn flow: agent config → container → VNC proxy → event
- `PTYManager` attaches terminal sessions to container shells

**What's missing (v0.5 scope):**
- [ ] **Container desktop image** — Pre-built `aether-desktop` Docker image with XFCE4, Firefox, VS Code Server, dev tools
- [ ] **Persistent home directories** — Mount `~/.aether/workspaces/{pid}:/home/aether` in containers
- [ ] **VNC quality + input** — Clipboard sync, dynamic resize (`xrandr`), bandwidth-adaptive quality
- [ ] **Docker Compose packaging** — One-command `docker compose up` with kernel + UI + dynamic containers
- [ ] **Agent desktop integration** — GUI app launching via tools, human takeover UX, shared state indicators

**Competitive position (as of Feb 2026):**
- No other project combines: visual containerized Linux desktops + human VNC takeover + web Control Plane
- Closest: Windows Agent Workspace (Microsoft, proprietary, no multi-agent control), OpenClaw (messaging-only, host access, no isolation), UI-TARS (host GUI automation, no containers)

---

## v0.5 — Production, Scale & Beyond

Full details in [ROADMAP-v0.5.md](./ROADMAP-v0.5.md).

### Recommended Execution Phases

**Phase 1 — Foundation & Safety** (target: 2-4 weeks)
> Focus: survive 50+ agents without host compromise or runaway costs.
- Resource governance: quotas, token budgets, runaway detection, basic cost tracking
- Security basics: audit logging schema + append, rate limiting middleware, prompt injection guards
- Database: PostgreSQL migration (core tables: agents, memory, events, audits) with SQLite read fallback during transition
- Reliable snapshots: atomic capture (state + fs delta + memory dump)
- Context compaction: periodic summarization for long-running agents (moved up from v0.4.1 known issues)

*Validation milestone: Spawn 50 cron-scheduled agents → observe resource enforcement → kill 3 runaways → verify audit logs → restore from snapshot.*

*Tooling: Create `scripts/validate-phase1.sh` — spawns 50 agents via CLI, applies quotas, triggers one runaway (infinite loop agent), asserts detection + termination, exports audit log slice, restores from latest snapshot and verifies agent resumes. Doubles as a smoke test and demo artifact.*

**Phase 2 — Scale & Performance** (can parallelize with Phase 1)
> Focus: median loop latency down 30-50%, support 100+ concurrent agents.
- Redis for caching (EventBus, memory hot paths)
- Smart model routing (rule-based: task length/complexity → model family)
- Priority/fair-share scheduling in ProcessManager
- WebSocket batching + frontend lazy loading

*Validation milestone: 100 concurrent agents with <2s median loop latency, no SQLite lock contention.*

**Phase 3 — Production & Observability**
> Focus: deployable to staging with dashboards and alerts.
- Production Dockerfile + Compose + basic Helm
- Prometheus + OpenTelemetry (agent loops, tool calls, LLM calls)
- TLS enforcement + MFA
- Webhook retry + DLQ

*Validation milestone: Deploy to cloud VM, Grafana dashboard shows all agent metrics, TLS terminates correctly, webhook failures retry and land in DLQ.*

**Phase 4 — Ecosystem & Polish**
> Focus: third-party integrations viable, mobile supervision possible.
- Public OpenAPI + LangChain compatibility adapter
- Fine-grained RBAC (per-tool/per-LLM)
- PWA / responsiveness basics

*Validation milestone: External tool registered via LangChain adapter, mobile browser can view Mission Control and kill an agent.*

---

### Detailed Breakdown

### Deployment & Packaging
- [ ] Production Dockerfile + multi-stage build
- [ ] Docker Compose stack (kernel + UI + PostgreSQL + Redis)
- [ ] Helm chart for Kubernetes deployment
- [ ] Electron wrapper for desktop app
- [ ] Cloud deployment templates (AWS, GCP, Azure)

### Database & Persistence
- [ ] PostgreSQL migration (replace SQLite for multi-instance)
- [ ] Sharding strategy for large agent populations
- [ ] Event sourcing / CQRS for audit trail
- [ ] Consistent snapshots — capture process state + filesystem delta + memory + plans atomically (current SnapshotManager only tarballs the filesystem)

### Resource Governance
- [ ] Per-agent resource quotas (CPU, memory, GPU time, network egress) enforced by ProcessManager or dedicated ResourceQuota subsystem
- [ ] LLM token budgets per agent — track and cap token usage per session/day
- [ ] Cost tracking dashboard — aggregate LLM spend across providers per agent/user/org
- [ ] Runaway agent detection — auto-kill agents exceeding resource limits

### Scheduling & Concurrency
- [ ] Priority queues / fair-share scheduling for multi-agent scenarios
- [ ] Evaluate actor-model semantics for agent coordination patterns
- [ ] EventBus throughput hardening for 50+ concurrent agents

### Security Hardening
- [ ] TLS everywhere (WebSocket + HTTP)
- [ ] MFA / TOTP support for user auth
- [ ] AppArmor/SELinux-style profiles for node-pty and Docker containers
- [ ] Fine-grained RBAC expansion — per-tool, per-directory, per-LLM-provider permissions
- [ ] Audit logging — every tool invocation logged to StateStore with caller, args, result hash
- [ ] Secret management integration (HashiCorp Vault or native encrypted keyring)
- [ ] Rate limiting and circuit breakers on external integrations (GitHub, Slack, S3, Discord)
- [ ] Prompt injection defense — input sanitization on agent tool args
- [ ] Capability-based permissions for agent tool access

### Observability
- [ ] Prometheus metrics exporter
- [ ] Grafana dashboards (agent lifecycle, LLM latency, resource usage)
- [ ] OpenTelemetry tracing for agent loops and tool executions
- [ ] Alerting rules (agent failures, resource exhaustion, auth anomalies)

### Performance
- [ ] Redis caching layer for EventBus hot paths and frequent memory lookups (SQLite is bottleneck under concurrent memory writes)
- [ ] WebSocket message batching to reduce frame overhead
- [ ] Frontend code splitting and lazy loading
- [ ] Smart model routing — use cheaper models for simple tasks, frontier for complex

### Reliability
- [ ] Active-active clustering (current hub-spoke is single hub)
- [ ] Zero-downtime kernel deploys
- [ ] Circuit breakers on LLM providers with automatic fallback

### Ecosystem & Interoperability
- [ ] Publish OpenAPI spec publicly for third-party integrations
- [ ] Compatibility layer for LangChain tools schema
- [ ] OpenAI function calling format adapter for external tool registries
- [ ] Webhook retry with exponential backoff and dead letter queue

### Compliance & Governance
- [ ] GDPR data export/deletion for agent memory and user data
- [ ] AI governance policies — agent action approval workflows
- [ ] Bias detection in agent outputs

### Mobile & Accessibility
- [ ] PWA with responsive UI and push notifications
- [ ] WCAG 2.1 AA compliance (screen reader, keyboard nav, high contrast)
- [ ] Touch-friendly Mission Control for tablets

---

## Cross-Cutting Concerns (no version assigned)

These items appear across multiple docs or were identified as gaps:

| Item | Source | Notes |
|------|--------|-------|
| ~~Pre-commit hooks (husky)~~ | NEXT_STEPS.md | ✅ Done — husky + lint-staged configured |
| Screenshots in README | NEXT_STEPS.md | High impact, low effort |
| ~~File-based memory MVP~~ | RESEARCH-openclaw-ideas.md | ✅ Done — full MemoryManager with FTS5 in v0.3 |
| ~~Cron/scheduling detail~~ | RESEARCH-openclaw-ideas.md | ✅ Done — CronManager with cron parser + event triggers in v0.3 |
| ~~Remote access~~ | RESEARCH-future-plans-summary.md | ✅ Done — RemoteAccessManager with SSH tunnels + Tailscale in v0.4 |
| Context compaction | RESEARCH-future-plans-summary.md | Important for long-running agents |
| ~~Lightweight skills~~ | RESEARCH-openclaw-ideas.md | ✅ Done — SkillManager with YAML skills + step pipelines in v0.4 |

---

---

## Testing Guidelines

### Running Tests

**Recommended test command** (avoids OOM and slow integration tests):

```bash
npx vitest run --exclude "**/raw-file-endpoint*" --exclude "**/kernel-integration*"
```

**Why:** The `raw-file-endpoint.test.ts` and `kernel-integration.test.ts` suites each boot a full kernel (SQLite, Docker detection, GPU scan, all 19 subsystems) for **every single test case**. This causes:
- ~8 seconds per test (vs <100ms for unit tests)
- JavaScript heap OOM (`FATAL ERROR: Ineffective mark-compacts near heap limit`) when run alongside the rest of the suite
- Total suite time >10 minutes on most machines

**For CI/validation of new code:** Run the targeted tests above. The slow integration tests should only be run in isolation when modifying server/kernel boot code.

**For new Wave/feature tests:** Run the specific new test files first, then the exclude command above for regression checking.

### Recommended CI Improvements

- [ ] **Windows CI runner** — Add `windows-latest` runner to GitHub Actions to catch PTY/path/shell regressions early (v0.4.1 had 17 Windows-specific bugs)
- [ ] **Quick CI workflow** — Add a `--quick` Vitest flag or dedicated `ci-quick.yml` for PR validation (unit tests only, <30s)
- [ ] **Integration test isolation** — Run `raw-file-endpoint` and `kernel-integration` suites in a separate CI job with increased heap (`--max-old-space-size=4096`)

### Known Pre-existing Failures

- `VirtualFS.test.ts` — 2 symlink tests (`mountShared creates symlink`, `unmountShared removes symlink`) fail on Windows due to lack of symlink permissions. These pass on Linux/macOS/CI.

---

*This file is auto-maintained alongside the roadmap docs. For detailed session-by-session implementation plans, see [SESSION-PROMPTS-v0.2.md](./SESSION-PROMPTS-v0.2.md).*
