# Aether OS — Remaining Tasks

Consolidated checklist of all outstanding work, derived from NEXT_STEPS.md, FEATURES.md, all roadmaps, and the research documents. Organized by urgency and version target.

**Last updated:** 2026-02-07

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
- [ ] **B1: Notification Center** — system-wide toast/notification framework (component exists, needs kernel integration)
- [ ] **D1: Keyboard Shortcuts** — global shortcut registry and overlay (ShortcutOverlay exists, needs expansion)
- [ ] **F1: Raw File Serving** — `/api/files/raw/:path` endpoint for binary file access

### Wave 2 (depends on Wave 1)
- [ ] **A2: BrowserApp** — UI for the real Chromium browser (depends on A1)
- [x] **A3: Monaco Code Editor** — Replace regex highlighter with Monaco Editor ✅ Multi-tab, file tree sidebar, language auto-detection, VS Code dark theme
- [x] **B2: System Monitor** — Real-time CPU/memory/disk/network dashboard ✅ SVG charts, 2s polling, per-agent resource breakdown, `/api/system/stats` endpoint
- [ ] **B3: Music/Audio Player** — Audio playback with playlists, waveform visualization

### Wave 3 (depends on Wave 1-2)
- [ ] **B4: PDF Viewer** — pdf.js-based viewer with annotation and text extraction
- [ ] **C1: Spreadsheet** — HyperFormula-based spreadsheet (SheetsApp exists, needs formula engine)
- [ ] **C2: Drawing Canvas** — tldraw or Excalidraw integration (CanvasApp exists, needs upgrade)
- [ ] **C3: Markdown Writer** — Milkdown editor with live preview (WriterApp exists, needs upgrade)
- [x] **E1: Agent Browser Tools** — Upgrade `browse_web` tool from HTTP fetch to real Chromium ✅ browse_web uses BrowserManager with fallback, added screenshot_page, click_element, type_text tools

### Wave 4 (depends on D1)
- [ ] **D2: Multi-Desktop Workspaces** — Virtual workspace switching (WorkspaceSwitcher exists, needs polish)
- [ ] **D3: Light Theme + Theme System** — Full theming with light/dark toggle and CSS variable system

### v0.2 Success Criteria
- [x] Agent can browse any website (not blocked by iframe restrictions) ✅ BrowserManager + agent tools
- [x] Code editor has syntax highlighting, autocomplete, and multi-file tabs ✅ Monaco Editor
- [ ] All 14+ apps launch, function, and persist state through the kernel
- [ ] Notification center aggregates events from kernel and agents
- [x] System monitor shows real resource usage ✅ SystemMonitorApp + /api/system/stats
- [ ] Theme toggle works between light and dark

---

## v0.3 — Agent Intelligence & Autonomy

Full details in [ROADMAP-v0.3.md](./ROADMAP-v0.3.md).

- [ ] **Long-term memory** — 5-layer architecture (working, episodic, semantic, procedural, social) with vector store
- [ ] **Goal decomposition & planning** — Hierarchical task networks, plan execution engine
- [ ] **Self-reflection & metacognition** — Post-task evaluation, strategy journal, confidence calibration
- [ ] **Multi-modal perception** — Screenshot analysis, vision, audio, speech-to-text/TTS
- [ ] **Personality & specialization** — Working styles, risk tolerance, preference learning
- [ ] **Agent collaboration protocols** — Pair programming, code review, standup, handoff patterns
- [ ] **Proactive behavior** — File watchers, cron-style scheduling, event-driven spawning
- [ ] **Learning & adaptation** — User feedback loops, outcome tracking, strategy evolution

### Identified Gaps (from research docs)
- [ ] **Cron/scheduling** — Underspecified in v0.3 roadmap despite being a top user-requested feature (see RESEARCH-openclaw-ideas.md)
- [ ] **Context compaction** — Not explicitly planned; important for long-running agents to avoid context window overflow
- [ ] **Bidirectional messaging integration** — v0.4 only plans push notifications; real messaging channels (Slack, Discord, Telegram) should be bidirectional

---

## v0.4 — Ecosystem, Marketplace & Integrations

Full details in [ROADMAP-v0.4.md](./ROADMAP-v0.4.md).

- [ ] App Store framework (manifest, sandbox, permissions, lifecycle, SDK, CLI, registry)
- [ ] Plugin Marketplace (8 categories, SDK, installer, auto-updates)
- [ ] External integrations (GitHub, GitLab, Jira, Slack, Discord, Notion, S3, etc.)
- [ ] REST API & SDKs (TypeScript, Python, CLI)
- [ ] Agent Marketplace (template publishing, ratings)
- [ ] Multi-tenant platform (organizations, teams, RBAC, billing, SSO)
- [ ] Webhook & event system (inbound/outbound)
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
| File-based memory MVP | RESEARCH-openclaw-ideas.md | Quick win before full v0.3 memory system |
| Cron/scheduling detail | RESEARCH-openclaw-ideas.md, RESEARCH-future-plans-summary.md | v0.3 mentions it but underspecifies |
| Remote access | RESEARCH-future-plans-summary.md | Tailscale/SSH not planned in any roadmap |
| Context compaction | RESEARCH-future-plans-summary.md | Important for long-running agents |
| Lightweight skills | RESEARCH-openclaw-ideas.md | Simpler than full React apps for v0.4 |

---

*This file is auto-maintained alongside the roadmap docs. For detailed session-by-session implementation plans, see [SESSION-PROMPTS-v0.2.md](./SESSION-PROMPTS-v0.2.md).*
