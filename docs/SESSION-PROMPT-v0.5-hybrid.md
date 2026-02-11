# Aether OS v0.5 — Hybrid Architecture Session Prompt

**Purpose:** Copy-paste this into a fresh Claude Code session. It uses agent teams to parallelize the v0.5 hybrid architecture work across multiple agents.

**Prerequisites:**
- v0.4.3 committed (auth fix + boot screen fix)
- Docker installed and running
- At least one LLM API key in `.env`

---

## The Prompt

```
You are working on Aether OS, an AI-native operating system at C:\Users\gentl\Documents\Aether_Agent_OS.

PROJECT STATE: v0.4.3 is shipped. The web UI control plane works (auth, agents, apps, terminal, browser, file manager). The hybrid architecture infrastructure EXISTS but needs completion:
- kernel/src/ContainerManager.ts — Creates Docker containers with graphical mode (Xvfb + x11vnc)
- kernel/src/VNCManager.ts — WebSocket proxy bridging browser to container VNC
- components/os/VNCViewer.tsx — noVNC client component
- kernel/src/Kernel.ts (lines 304-324) — Full spawn flow: agent config → container → VNC → events
- kernel/src/PTYManager.ts — Terminal sessions attach to container shells

GOAL: Implement v0.5 Phase 1-3 of the hybrid architecture using a team of agents working in parallel.

Read these files first to understand current state:
- docs/TODO.md (full task list with v0.4.3 section documenting hybrid vision)
- docs/ROADMAP-v0.5.md (production roadmap)
- AGENT-FUNCTIONALITY-ANALYSIS.md (gap analysis)

Then create a team with these agents and tasks:

TEAM STRUCTURE:
1. "container-builder" (general-purpose agent) — Build the aether-desktop Docker image
   - Create Dockerfile.desktop based on Ubuntu 24.04
   - Install: XFCE4 desktop, x11vnc, Xvfb, Firefox, VS Code Server, Node.js 22, Python 3.12, git
   - Create entrypoint script that starts Xvfb :99, XFCE4 session, x11vnc on :99
   - Test: docker build + docker run, verify VNC connects
   - Files: NEW Dockerfile.desktop, NEW docker/entrypoint.sh

2. "workspace-manager" (general-purpose agent) — Persistent workspaces + volume mounts
   - Update ContainerManager.createContainer() to mount ~/.aether/workspaces/{agent-name}:/home/aether
   - Create workspace directory on agent spawn, preserve on agent exit
   - Add workspace list/cleanup kernel commands
   - Update VFS to map container paths to workspace volumes
   - Files: kernel/src/ContainerManager.ts, kernel/src/Kernel.ts, shared/src/protocol.ts
   - Tests: kernel/src/__tests__/ContainerManager.test.ts

3. "vnc-polish" (general-purpose agent) — VNC quality and input improvements
   - Add clipboard sync using noVNC's clipboard API (RFB.clipboardPasteFrom)
   - Add dynamic resize: when window resizes, send xrandr command to container
   - Add "Take Over Desktop" button in AgentDashboard that opens VNCViewer for that agent's container
   - Files: components/os/VNCViewer.tsx, kernel/src/VNCManager.ts, components/apps/AgentDashboard.tsx
   - Tests: components/__tests__/VNCViewer.test.tsx

4. "compose-packager" (general-purpose agent) — Docker Compose packaging
   - Create production Dockerfile for kernel (multi-stage: build TS → run with node:22-slim)
   - Create production Dockerfile for UI (build Vite → serve with nginx:alpine)
   - Create docker-compose.yml with: aether-kernel, aether-ui, shared volumes
   - Kernel needs Docker socket mount to create agent containers (sibling containers pattern)
   - Add .dockerignore
   - Test: docker compose build, docker compose up, verify UI loads at localhost:4747
   - Files: NEW Dockerfile, NEW Dockerfile.ui, NEW docker-compose.yml, NEW .dockerignore

COORDINATION RULES:
- container-builder and compose-packager are independent — run in parallel
- workspace-manager depends on container-builder knowing the image name (use "aether-desktop:latest")
- vnc-polish is fully independent
- All agents should read existing code before making changes
- All agents should run relevant tests after their changes
- When all 4 are done, run full test suite: npx vitest run --project kernel

IMPORTANT CONSTRAINTS:
- Do NOT modify the auth system (v0.4.3 just fixed it)
- Do NOT add PostgreSQL yet (deferred to v0.5 Phase 2)
- Container image should be <2GB
- Docker Compose must work on Linux and macOS (Windows uses WSL2)
- Keep existing mock/fallback behavior when Docker is not available

After the team completes, update docs/TODO.md to check off completed items and commit all changes.
```

---

## What This Prompt Does

When pasted into Claude Code, it will:
1. Read the codebase to understand current state
2. Create a team of 4 parallel agents using `TeamCreate`
3. Each agent gets a focused task with clear file boundaries
4. Agents work simultaneously — container-builder and compose-packager in parallel, workspace-manager after container-builder
5. VNC polish runs independently throughout
6. Team lead coordinates, resolves conflicts, runs final tests

## Expected Output

After ~20-40 minutes of agent work:
- `Dockerfile.desktop` — Full Linux desktop image for agent containers
- `docker/entrypoint.sh` — Container startup script
- `Dockerfile` — Production kernel image
- `Dockerfile.ui` — Production UI image
- `docker-compose.yml` — One-command startup
- Updated `ContainerManager.ts` with workspace volume mounts
- Updated `VNCViewer.tsx` with clipboard + resize
- Updated `AgentDashboard.tsx` with "Take Over Desktop" button
- All existing tests still passing

## Alternative: Sequential Prompt (No Teams)

If you prefer a single-agent approach, use this shorter prompt:

```
You are working on Aether OS at C:\Users\gentl\Documents\Aether_Agent_OS.

v0.4.3 is shipped. Read docs/TODO.md for full context.

Implement the hybrid architecture foundation in this order:

1. Create Dockerfile.desktop — Ubuntu 24.04 + XFCE4 + x11vnc + Xvfb + Firefox + VS Code Server + Node.js + Python + git. Entrypoint starts display server + desktop + VNC.

2. Update kernel/src/ContainerManager.ts — mount persistent workspace volumes (~/.aether/workspaces/{name}:/home/aether). Create workspace dir on spawn.

3. Update components/os/VNCViewer.tsx — add clipboard sync (RFB.clipboardPasteFrom), dynamic resize via xrandr, improve connection status UI.

4. Add "Take Over Desktop" button in components/apps/AgentDashboard.tsx — opens VNCViewer for the selected agent's container.

5. Create docker-compose.yml + production Dockerfiles (kernel multi-stage + UI nginx) + .dockerignore.

6. Run tests, update docs/TODO.md, commit.

Do NOT modify auth, do NOT add PostgreSQL.
```

---

## Known Issues to Watch For

- **Docker socket permission:** Container-in-container requires Docker socket mount (`/var/run/docker.sock`). On Linux, the kernel container needs to be in the `docker` group.
- **noVNC npm package:** Already in dependencies (`@novnc/novnc`), excluded from Vite optimization in `vite.config.ts`.
- **VNC port allocation:** VNCManager already handles port allocation (6080+). New containers will get unique ports automatically.
- **Windows Docker Desktop:** WSL2 backend handles Linux containers. Docker socket path differs (`//var/run/docker.sock` in Git Bash).
