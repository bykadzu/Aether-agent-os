# Aether OS — Feature Inventory

Status legend:
- **Done** — Implemented and functional
- **Partial** — Code exists but incomplete or not fully connected
- **Stub** — UI element or handler exists but no real logic behind it
- **Planned** — Discussed or designed but not yet coded

---

## Kernel

| Feature | Status | Details |
|---------|--------|---------|
| Process management (PID, lifecycle, signals) | Done | `kernel/src/ProcessManager.ts` — PIDs, states (created→running→zombie→dead), SIGTERM/KILL/STOP/CONT/INT/USR1/USR2 |
| Virtual filesystem | Done | `kernel/src/VirtualFS.ts` — real files at `~/.aether`, per-agent home dirs, path traversal prevention |
| Pseudo-terminal sessions | Done | `kernel/src/PTYManager.ts` — node-pty for local, docker exec for containers, SIGWINCH resize |
| Docker container sandboxing | Done | `kernel/src/ContainerManager.ts` — auto-detects Docker, creates containers with CPU/memory limits |
| GPU passthrough | Done | `kernel/src/ContainerManager.ts` — nvidia-smi detection, GPU allocation tracking, `--gpus` flag |
| SQLite persistence | Done | `kernel/src/StateStore.ts` — process history, logs, metrics, files, snapshots, users; WAL mode |
| Event bus | Done | `kernel/src/EventBus.ts` — typed pub/sub, all kernel subsystems communicate through events |
| Plugin system | Done | `kernel/src/PluginManager.ts` — loads from `~/.config/aether-os/plugins/`, sample weather plugin |
| Process snapshots | Done | `kernel/src/SnapshotManager.ts` — SIGSTOP, capture state, SIGCONT, restore from snapshot |
| Shared filesystem mounts | Done | Agents can create shared workspaces and mount them into each other's filesystems |
| VNC / graphical desktop | Done | `kernel/src/VNCManager.ts` — WebSocket-to-TCP proxy (ws library) bridges noVNC to container x11vnc |
| Authentication | Done | `kernel/src/AuthManager.ts` — scrypt password hashing, HMAC-SHA256 JWT, user CRUD |
| RBAC & Organizations | Done | Organizations, teams, 5-tier role hierarchy (owner/admin/manager/member/viewer), 25+ permissions, permission checking, backward-compatible |
| Hub-and-spoke clustering | Done | `kernel/src/ClusterManager.ts` — hub accepts nodes, health monitoring, load-based routing |
| Kernel orchestrator | Done | `kernel/src/Kernel.ts` — boots all subsystems, routes commands to handlers |
| Memory management | Done | `kernel/src/MemoryManager.ts` — 4-layer memory (episodic, semantic, procedural, social), FTS5 search, importance decay, consolidation, sharing, agent profiles |
| Cron scheduling | Done | `kernel/src/CronManager.ts` — 5-field cron parser, scheduled agent spawning, event triggers with cooldown, SQLite persistence |
| Agent self-knowledge | Done | `docs/CODEBASE.md` auto-seeded to `~/.aether/shared/` on kernel boot; agents read it at `/home/agent/shared/CODEBASE.md`; system prompt references it |

## Agent Runtime

| Feature | Status | Details |
|---------|--------|---------|
| Think-act-observe loop | Done | `runtime/src/AgentLoop.ts` — iterative cycle calling Gemini, executing tools, logging |
| File I/O tools | Done | read, write, list, mkdir, rm, stat, mv, cp, watch |
| Shell command execution | Done | run_command tool — executes in agent's sandbox |
| Web browsing | Done | browse_web tool — Playwright BrowserManager with HTTP fetch fallback; screenshot_page, click_element, type_text agent tools |
| IPC messaging | Done | send_message, check_messages, list_agents |
| Shared workspace tools | Done | create_shared_workspace, mount_workspace, list_workspaces |
| Plugin tools | Done | Custom tools loaded from plugin manifests |
| Human approval gating | Done | Agent pauses and asks permission for sensitive operations |
| Completion signaling | Done | Agent calls `complete` tool when goal is achieved |
| Step budget / max steps | Done | Configurable per agent, defaults to 50 |
| Gemini integration | Done | Flash model for fast decisions, Pro for deeper reasoning |
| Agent memory / context window | Done | Cross-session memory via MemoryManager (FTS5), memory-aware agent loop loads relevant memories on startup, auto-journals on completion |
| Multi-LLM support | Done | `runtime/src/llm/` — Gemini, OpenAI, Anthropic, Ollama providers with auto-detection |
| Agent templates | Done | `runtime/src/templates.ts` — 8 pre-built templates (Researcher, Coder, Reviewer, Analyst, SysAdmin, Writer, Tester, PM) |
| Self-reflection | Done | `runtime/src/reflection.ts` — post-task reflection via LLM, quality ratings (1-5), lessons/strategies stored as procedural memory |
| Goal decomposition & planning | Done | `runtime/src/planner.ts` — hierarchical task trees, create/update/get plan tools, plan state injected into system prompt |
| Agent profiles | Done | Auto-tracked stats per agent (tasks, success rate, expertise, quality rating), stored in SQLite, injected into system prompts |
| Collaboration protocols | Done | `runtime/src/collaboration.ts` — review requests, task delegation, status broadcasts, knowledge sharing (8 protocol types, 10 functions) |
| Vision capability | Done | `analyze_image` tool, `supportsVision()` + `analyzeImage()` in all 4 LLM providers (Gemini, OpenAI, Anthropic, Ollama) |
| Feedback system | Done | POST /api/feedback, `get_feedback` agent tool, thumbs up/down per action with optional comments |

## Desktop UI

| Feature | Status | Details |
|---------|--------|---------|
| Window manager | Done | `components/os/Window.tsx` — drag, resize, minimize, maximize, z-index |
| App dock | Done | `components/os/Dock.tsx` — app launcher with icons and tooltips |
| Menu bar | Done | `App.tsx` — time, battery, wifi, search, user menu |
| Desktop widgets | Done | `components/os/DesktopWidgets.tsx` — clock, weather, activity monitor |
| Context menu | Done | `components/os/ContextMenu.tsx` — right-click on desktop |
| Login screen | Done | `components/os/LoginScreen.tsx` — full-screen auth with animation |
| User menu | Done | `components/os/UserMenu.tsx` — dropdown with user info and logout |
| Boot animation | Done | `App.tsx` — Aether logo + loading bar on startup |
| Smart Bar (Cmd+K) | Done | `components/apps/SmartBar.tsx` — Spotlight-style search, Gemini-powered |
| VNC viewer | Done | `components/os/VNCViewer.tsx` — renders graphical agent desktops |
| Virtual desktop | Done | `components/os/VirtualDesktop.tsx` — renders agent's simulated desktop windows |
| Dark theme | Done | Tokyo Night inspired, glassmorphism throughout |
| Light/Dark/System theme toggle | Done | `services/themeManager.ts` — ThemeProvider context, useTheme() hook, CSS custom properties, dark/light/system modes, ThemeToggle in menu bar, localStorage persistence |
| Notification center | Done | `components/os/NotificationCenter.tsx` — toast notifications |
| Keyboard shortcut overlay | Done | `components/os/ShortcutOverlay.tsx` — Cmd+? help overlay |
| Workspace switcher | Done | `components/os/WorkspaceSwitcher.tsx` — virtual workspace switching |
| Shortcut manager | Done | `services/shortcutManager.ts` — keyboard shortcut handling |
| Responsive/mobile layout | Planned | Desktop-optimized only |

## Applications

| App | Status | Details |
|-----|--------|---------|
| Mission Control (Agent Dashboard) | Done | Grid of agents, deploy modal, live status, metrics cards |
| Agent VM | Done | Full agent view — Screen/Logs tabs, live desktop view (VNC/screencast/mock browser), terminal, thought logs, approval modal, timeline, Plan Viewer tab, feedback thumbs up/down on actions |
| Agent Desktop View | Done | `components/os/AgentDesktopView.tsx` — live agent screen with 3-tier fallback: VNC desktop (graphical containers), browser screencast (kernel Playwright), mock browser (iframe with simulated chrome). Watch/control modes, fullscreen, status badges |
| Agent Timeline | Done | Color-coded history of thoughts, actions, observations |
| Terminal | Done | `xterm.js` wrapper, connects to kernel PTY or host shell |
| Chat | Done | Gemini-powered chat interface with streaming |
| File Explorer | Done | Connected to kernel FS with real directory browsing, breadcrumb navigation, file stats |
| Code Editor | Done | Monaco Editor with multi-tab support, file tree sidebar, language auto-detection (18 languages), kernel FS read/write, VS Code dark theme |
| Browser | Done | Full browser UI with tab bar, navigation chrome, canvas viewport rendering, keyboard/mouse event forwarding, dual-mode (Chromium kernel / iframe fallback), Playwright-based BrowserManager |
| Notes | Done | Persists to kernel FS at `/home/root/Documents/notes/`, auto-save with 2s debounce, localStorage fallback |
| Calculator | Done | Fully functional calculator |
| Photos | Partial | Gallery UI exists, Gemini image analysis, but no real photo source |
| Video Player | Partial | Player UI exists but no video source integration |
| Sheets (Spreadsheet) | Done | `components/apps/SheetsApp.tsx` — formula engine (SUM, AVERAGE, COUNT, MIN, MAX, IF), virtual-scrolled grid (1000 rows), cell formatting, CSV import/export, kernel FS persistence |
| Canvas (Drawing) | Done | `components/apps/CanvasApp.tsx` — 8 tools (pen, line, rect, circle, arrow, text, eraser, select), undo/redo, export PNG, pan/zoom, color picker, stroke/fill controls |
| Writer (Document Editor) | Done | `components/apps/WriterApp.tsx` — split view with live markdown preview, formatting toolbar, AI writing assist via Gemini, file management |
| Music/Audio Player | Done | `components/apps/MusicApp.tsx` — HTML5 audio with /api/fs/raw streaming, play/pause/seek/volume, shuffle/repeat, Web Audio API frequency visualizer, TTS tab with speechSynthesis, file browser sidebar |
| Documents/PDF Viewer | Done | `components/apps/DocumentsApp.tsx` — PDF rendering via embed, page navigation, zoom controls, file browser sidebar, AI summarization via Gemini, search, dual view modes |
| Memory Inspector | Done | `components/apps/MemoryInspectorApp.tsx` — agent list sidebar, 4-layer filter tabs, FTS5 search, memory cards with importance/tags, stats header, agent profile cards, mock data fallback |
| Settings | Done | Shows kernel status, LLM providers with availability, GPU/Docker/cluster info, API key config, Appearance tab with theme toggle, Automation tab for cron jobs and event triggers, Organization tab for RBAC management |
| GitHub Sync | Done | Clone repos into agent workspace via modal, push changes with approval gating |
| System Monitor | Done | `components/apps/SystemMonitorApp.tsx` — real-time CPU/memory/disk/network charts, 2s polling, per-agent resource breakdown, `/api/system/stats` endpoint |

## Networking & Communication

| Feature | Status | Details |
|---------|--------|---------|
| WebSocket (UI ↔ kernel) | Done | `services/kernelClient.ts` — auto-reconnect, typed messages |
| HTTP API | Done | `/health`, `/api/auth/*`, `/api/processes`, `/api/gpu`, `/api/cluster`, `/api/llm/providers`, `/api/templates`, `/api/system/stats` |
| Cluster WebSocket | Done | `/cluster` path for node-to-hub communication |
| React kernel hook | Done | `services/useKernel.ts` — manages WS lifecycle, syncs state |
| Gemini service | Done | `services/geminiService.ts` — text, image, chat, agent decisions |
| Auto-reconnection | Done | Configurable retry with backoff |
| Token management | Done | JWT stored in localStorage, sent with WS and HTTP requests |
| REST API v1 | Done | 48+ routes at /api/v1/ covering agents, fs, system, cron, webhooks, integrations, orgs, teams |
| Slack Integration | Done | Bidirectional — 8 actions, event-to-Slack bridge, slash commands, Events API receiver |
| GitHub Integration | Done | 10 actions — repos, PRs, issues, comments |
| TypeScript SDK | Done | `@aether/sdk` — AetherClient with namespaced methods (agents, fs, templates, system, events, cron, triggers, marketplace, orgs) |
| CLI Tool | Done | `@aether/cli` — 20+ commands for headless management, ANSI output, --json flag |

## Security

| Feature | Status | Details |
|---------|--------|---------|
| Password hashing (scrypt) | Done | AuthManager uses scrypt + random salt |
| JWT authentication | Done | HMAC-SHA256, 24-hour expiry |
| Per-agent filesystem isolation | Done | Each agent gets own `/home/{uid}`, can't traverse out |
| Docker container sandboxing | Done | Optional, with CPU/memory limits |
| Approval gating | Done | Agents must ask permission for sensitive operations |
| Rate limiting | Done | In-memory sliding window rate limiter (120/min auth, 30/min unauth), HTTP 429 with Retry-After |
| Audit logging | Done | AuditLogger subsystem with append-only SQLite table, EventBus auto-logging, sanitization, retention pruning, REST API |
| Role-based access control | Done | Full RBAC with organizations, teams, 5-tier role hierarchy, 25+ permissions, requirePermission middleware |
| Network isolation for containers | Partial | Container networking exists but no fine-grained control |

## Infrastructure

| Feature | Status | Details |
|---------|--------|---------|
| TypeScript monorepo | Done | shared/, kernel/, runtime/, server/, sdk/, cli/ packages |
| Vite build | Done | Frontend builds, HMR in dev |
| Dual-mode runtime | Done | Works with kernel (full) or without (mock/client-side) |
| SQLite database | Done | WAL mode, prepared statements, automatic schema creation |
| Docker support | Done | Auto-detected, graceful fallback to child_process |
| GPU detection | Done | nvidia-smi parsing |
| Automated tests | Done | Vitest — 600+ tests across 35+ suites (kernel, runtime, shared, server, CLI, component tests) |
| CI/CD pipeline | Done | `.github/workflows/ci.yml` — lint + test on push/PR |
| Linting / formatting | Done | ESLint (flat config) + Prettier, `npm run lint` / `npm run format` |
| Error boundaries (React) | Done | `ErrorBoundary` wraps windows, dock, widgets; WS reconnect banner |
| Error handling audit | Done | Graceful degradation for Docker, SQLite, PTY, VFS, API rate limits |
| Setup script | Done | `scripts/setup.sh` — checks deps, installs packages, creates `.env` |
| Production Dockerfile | Done | Dockerfile (kernel multi-stage), Dockerfile.ui (nginx), Dockerfile.desktop (Ubuntu 24.04, XFCE4, Firefox, code-server, dev tools, pip packages) |
| Documentation | Done | 18 markdown files: README, ARCHITECTURE, FEATURES, VISION, WHAT_IS_AETHER, NEXT_STEPS, TODO, 4 roadmaps, 2 execution plans, IDEAS, 2 research docs, 2 session prompts |
