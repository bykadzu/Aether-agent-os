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
| Virtual filesystem | Done | `kernel/src/VirtualFS.ts` — real files at `/tmp/aether`, per-agent home dirs, path traversal prevention |
| Pseudo-terminal sessions | Done | `kernel/src/PTYManager.ts` — node-pty for local, docker exec for containers, SIGWINCH resize |
| Docker container sandboxing | Done | `kernel/src/ContainerManager.ts` — auto-detects Docker, creates containers with CPU/memory limits |
| GPU passthrough | Done | `kernel/src/ContainerManager.ts` — nvidia-smi detection, GPU allocation tracking, `--gpus` flag |
| SQLite persistence | Done | `kernel/src/StateStore.ts` — process history, logs, metrics, files, snapshots, users; WAL mode |
| Event bus | Done | `kernel/src/EventBus.ts` — typed pub/sub, all kernel subsystems communicate through events |
| Plugin system | Done | `kernel/src/PluginManager.ts` — loads from `~/.config/aether-os/plugins/`, sample weather plugin |
| Process snapshots | Done | `kernel/src/SnapshotManager.ts` — SIGSTOP, capture state, SIGCONT, restore from snapshot |
| Shared filesystem mounts | Done | Agents can create shared workspaces and mount them into each other's filesystems |
| VNC / graphical desktop | Done | `kernel/src/VNCManager.ts` — Xvfb + x11vnc, WebSocket proxy for noVNC |
| Authentication | Done | `kernel/src/AuthManager.ts` — scrypt password hashing, HMAC-SHA256 JWT, user CRUD |
| Hub-and-spoke clustering | Done | `kernel/src/ClusterManager.ts` — hub accepts nodes, health monitoring, load-based routing |
| Kernel orchestrator | Done | `kernel/src/Kernel.ts` — boots all subsystems, routes commands to handlers |

## Agent Runtime

| Feature | Status | Details |
|---------|--------|---------|
| Think-act-observe loop | Done | `runtime/src/AgentLoop.ts` — iterative cycle calling Gemini, executing tools, logging |
| File I/O tools | Done | read, write, list, mkdir, rm, stat, mv, cp, watch |
| Shell command execution | Done | run_command tool — executes in agent's sandbox |
| Web browsing | Done | browse_web tool — HTTP fetch + text extraction |
| IPC messaging | Done | send_message, check_messages, list_agents |
| Shared workspace tools | Done | create_shared_workspace, mount_workspace, list_workspaces |
| Plugin tools | Done | Custom tools loaded from plugin manifests |
| Human approval gating | Done | Agent pauses and asks permission for sensitive operations |
| Completion signaling | Done | Agent calls `complete` tool when goal is achieved |
| Step budget / max steps | Done | Configurable per agent, defaults to 50 |
| Gemini integration | Done | Flash model for fast decisions, Pro for deeper reasoning |
| Agent memory / context window | Partial | Agents have context within a session but no cross-session memory |
| Multi-LLM support | Done | `runtime/src/llm/` — Gemini, OpenAI, Anthropic, Ollama providers with auto-detection |
| Agent templates | Done | `runtime/src/templates.ts` — 8 pre-built templates (Researcher, Coder, Reviewer, Analyst, SysAdmin, Writer, Tester, PM) |

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
| Light theme toggle | Stub | UI is dark-only currently |
| Responsive/mobile layout | Planned | Desktop-optimized only |

## Applications

| App | Status | Details |
|-----|--------|---------|
| Mission Control (Agent Dashboard) | Done | Grid of agents, deploy modal, live status, metrics cards |
| Agent VM | Done | Full agent view — terminal, thought logs, approval modal, timeline |
| Agent Timeline | Done | Color-coded history of thoughts, actions, observations |
| Terminal | Done | `xterm.js` wrapper, connects to kernel PTY or host shell |
| Chat | Done | Gemini-powered chat interface with streaming |
| File Explorer | Done | Connected to kernel FS with real directory browsing, breadcrumb navigation, file stats |
| Code Editor | Done | Kernel read/write, regex-based syntax highlighting, cursor tracking, unsaved indicator |
| Browser | Partial | URL bar + iframe, many sites block iframe embedding |
| Notes | Done | Persists to kernel FS at `/home/root/Documents/notes/`, auto-save with 2s debounce, localStorage fallback |
| Calculator | Done | Fully functional calculator |
| Photos | Partial | Gallery UI exists, Gemini image analysis, but no real photo source |
| Video Player | Partial | Player UI exists but no video source integration |
| Settings | Done | Shows kernel status, LLM providers with availability, GPU/Docker/cluster info, API key config |
| GitHub Sync | Done | Clone repos into agent workspace via modal, push changes with approval gating |

## Networking & Communication

| Feature | Status | Details |
|---------|--------|---------|
| WebSocket (UI ↔ kernel) | Done | `services/kernelClient.ts` — auto-reconnect, typed messages |
| HTTP API | Done | `/health`, `/api/auth/*`, `/api/processes`, `/api/gpu`, `/api/cluster`, `/api/llm/providers`, `/api/templates` |
| Cluster WebSocket | Done | `/cluster` path for node-to-hub communication |
| React kernel hook | Done | `services/useKernel.ts` — manages WS lifecycle, syncs state |
| Gemini service | Done | `services/geminiService.ts` — text, image, chat, agent decisions |
| Auto-reconnection | Done | Configurable retry with backoff |
| Token management | Done | JWT stored in localStorage, sent with WS and HTTP requests |

## Security

| Feature | Status | Details |
|---------|--------|---------|
| Password hashing (scrypt) | Done | AuthManager uses scrypt + random salt |
| JWT authentication | Done | HMAC-SHA256, 24-hour expiry |
| Per-agent filesystem isolation | Done | Each agent gets own `/home/{uid}`, can't traverse out |
| Docker container sandboxing | Done | Optional, with CPU/memory limits |
| Approval gating | Done | Agents must ask permission for sensitive operations |
| Rate limiting | Planned | Not yet implemented |
| Audit logging | Planned | Not yet implemented |
| Role-based access control | Partial | Admin/user roles exist but enforcement is minimal |
| Network isolation for containers | Partial | Container networking exists but no fine-grained control |

## Infrastructure

| Feature | Status | Details |
|---------|--------|---------|
| TypeScript monorepo | Done | shared/, kernel/, runtime/, server/ packages |
| Vite build | Done | Frontend builds, HMR in dev |
| Dual-mode runtime | Done | Works with kernel (full) or without (mock/client-side) |
| SQLite database | Done | WAL mode, prepared statements, automatic schema creation |
| Docker support | Done | Auto-detected, graceful fallback to child_process |
| GPU detection | Done | nvidia-smi parsing |
| Automated tests | Done | Vitest — 149 tests across 10 suites (kernel, runtime, shared, integration) |
| CI/CD pipeline | Done | `.github/workflows/ci.yml` — lint + test on push/PR |
| Linting / formatting | Done | ESLint (flat config) + Prettier, `npm run lint` / `npm run format` |
| Error boundaries (React) | Done | `ErrorBoundary` wraps windows, dock, widgets; WS reconnect banner |
| Error handling audit | Done | Graceful degradation for Docker, SQLite, PTY, VFS, API rate limits |
| Setup script | Done | `scripts/setup.sh` — checks deps, installs packages, creates `.env` |
| Production Dockerfile | Not started | No containerized deployment |
| Documentation | Partial | You're reading it |
