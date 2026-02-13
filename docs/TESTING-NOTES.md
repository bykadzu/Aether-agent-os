# Testing Notes — v0.5

> Collected 2026-02-12 during live testing session. These are real bugs and gaps found by actually using the system, not theoretical issues.

---

## Setup / Connection

- [x] **Mock mode fallback was silent** — when no auth token existed, the UI fell straight into mock mode without attempting to detect the kernel. *(Fixed — now pings /health to detect kernel.)*
- [ ] **401 errors on initial load** — browser tries to load favicon.ico and page root on :3001 directly, gets 401. Harmless but noisy in console.
- [x] **"Process 1 not found" error** — kernel emits events for PID 1 (init process) but the client threw an unhandled error. *(Fixed — early-return guards in App.tsx silently ignore unknown PIDs.)*
- [x] **Playwright not installed** — BrowserApp showed a raw console error. *(Fixed — friendly "Browser Unavailable" UI panel with retry button.)*

## Agent ↔ Human Interaction (The Big Gap)

- [x] **VNC is view-only** — could watch but not interact. *(Fixed — VNC switches to interactive mode when agent is paused. viewOnly prop toggled on RFB instance.)*
- [x] **No live chat with running agent** — once an agent is deployed, you can't steer it, give it feedback, or ask it to change direction mid-task. Only option is abort. *(Fixed — chat panel in VirtualDesktop, POST /api/v1/agents/:pid/message endpoint, message queue in ProcessManager, AgentLoop drains messages each tick.)*
- [x] **Can't close apps in agent's desktop** — container desktop was not interactive. *(Fixed — when agent is paused, human has full mouse/keyboard control via VNC.)*
- [x] **No pause/resume** — could only abort agents. *(Fixed — pause/resume protocol added to ProcessManager, REST endpoints, EventBus events, and agent loop checks for paused state.)*

## Agent ↔ OS Integration

- [ ] **Agent uses container apps, not OS apps** — the Coder agent opened VS Code inside the Linux container, not the React CodeEditor app. The React apps and container apps are two separate worlds. Agent has `write_file` tool which writes to container filesystem, completely unaware of the React shell.
- [ ] **Agent has different app set than user** — the VM shows a standard Linux desktop with XFCE apps. The user's Aether dock has 15+ custom React apps. No connection between them.
- [x] **No shared filesystem view** — files the agent creates in the container aren't visible in the OS file explorer without manual sync. *(Fixed — containers mount ~/.aether/shared at /home/agent/shared, VirtualFS watches for changes, FileExplorer shows Shared directory with auto-refresh.)*

## Agent ↔ Agent Collaboration

- [ ] **Agents can't talk to each other** — no inter-agent messaging at the container level. Each agent runs in isolation. The kernel has an EventBus but containers don't subscribe to each other's events.
- [ ] **No task handoff** — one agent can't pass work to another agent or request help.

## Agent Reliability

- [ ] **GPT 5.3 Codex didn't finish its task** — was asked to make a landing page. It created the HTML file but the task completion was unclear. Need to investigate if the agent loop exited cleanly or timed out.
- [ ] **Agent success rate unknown** — no tracking of how often agents actually complete their goals vs fail/timeout/crash.
- [x] **Tool output truncated too aggressively** — agent history capped tool output at 1000 chars, losing important context. *(Fixed — increased to 4000 chars.)*

## UI / UX

- [x] **No indication of mock vs kernel mode** — bottom bar showed "Mock" but it was easy to miss. *(Fixed — prominent amber "Mock Mode" badge with pulsing dot.)*
- [x] **Login screen didn't appear when kernel was available** — *(Fixed — /health ping detects kernel on fresh load.)*

---

## Fixed This Session: 11/16

## Remaining Open Issues: 5

---

## Priority Order (for when development resumes)

1. ~~**Agent takeover** (pause → interact → resume)~~ — **Done!** Phase 1 shipped.
2. ~~**Live agent chat** — steer agents mid-task~~ — **Done!** Phase 2 shipped.
3. **Agent success tracking** — know what works and what doesn't
4. ~~**Bridge React apps ↔ container** — shared filesystem, unified app launcher~~ — **Partial!** Shared filesystem done, unified app launcher still open.
5. **Inter-agent messaging** — let agents collaborate
6. **401 console noise** — minor, but clean up for polish

---

*Update this doc after each testing session. This is the real roadmap.*
