# Aether OS — Remaining Tasks

Consolidated checklist of all outstanding work, derived from NEXT_STEPS.md, FEATURES.md, all roadmaps, and the research documents. Organized by urgency and version target.

**Last updated:** 2026-02-07 (post-v0.3 completion)

---

## Quick Wins (pre-v0.2, low effort / high impact)

- [x] **Pre-commit hooks** — husky + lint-staged configured (eslint --fix + prettier on staged .ts/.tsx)
- [ ] **Screenshots in README** — Add screenshots/GIFs of the UI to make the project more approachable
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

### Remaining
- [ ] App Store framework (manifest, sandbox, permissions, lifecycle, SDK, CLI, registry)
- [ ] External integrations (GitLab, Jira, Discord, Notion, S3, etc.)
- [ ] Python SDK
- [ ] Lightweight skill format (simpler than full React apps — gap identified in research)
- [ ] Remote access (Tailscale/SSH — not in any roadmap yet, identified as gap)

---

## v0.5 — Production, Scale & Beyond

Full details in [ROADMAP-v0.5.md](./ROADMAP-v0.5.md).

- [ ] Deployment & packaging (Docker, Compose, Helm, Electron, cloud templates)
- [ ] Database evolution (PostgreSQL migration, event sourcing, CQRS)
- [ ] Scaling (stateless kernel, load balancer, auto-scaling, cost tracking)
- [ ] Security hardening (TLS, MFA, capability-based permissions, prompt injection defense)
- [ ] Observability (Prometheus, Grafana, OpenTelemetry, alerting)
- [ ] Reliability (active-active clustering, zero-downtime deploys, circuit breakers)
- [ ] Performance (code splitting, WebSocket batching, Redis caching, smart model routing)
- [ ] Compliance (GDPR, AI governance, audit logging, bias detection)
- [ ] Mobile (PWA, responsive UI, push notifications)
- [ ] Accessibility (WCAG 2.1 AA, screen reader, keyboard nav, high contrast)

---

## Cross-Cutting Concerns (no version assigned)

These items appear across multiple docs or were identified as gaps:

| Item | Source | Notes |
|------|--------|-------|
| ~~Pre-commit hooks (husky)~~ | NEXT_STEPS.md | ✅ Done — husky + lint-staged configured |
| Screenshots in README | NEXT_STEPS.md | High impact, low effort |
| ~~File-based memory MVP~~ | RESEARCH-openclaw-ideas.md | ✅ Done — full MemoryManager with FTS5 in v0.3 |
| ~~Cron/scheduling detail~~ | RESEARCH-openclaw-ideas.md | ✅ Done — CronManager with cron parser + event triggers in v0.3 |
| Remote access | RESEARCH-future-plans-summary.md | Tailscale/SSH not planned in any roadmap |
| Context compaction | RESEARCH-future-plans-summary.md | Important for long-running agents |
| Lightweight skills | RESEARCH-openclaw-ideas.md | Simpler than full React apps for v0.4 |

---

*This file is auto-maintained alongside the roadmap docs. For detailed session-by-session implementation plans, see [SESSION-PROMPTS-v0.2.md](./SESSION-PROMPTS-v0.2.md).*
