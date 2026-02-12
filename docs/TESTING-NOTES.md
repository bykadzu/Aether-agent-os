# Testing Notes — v0.5

> Collected 2026-02-12 during live testing session. These are real bugs and gaps found by actually using the system, not theoretical issues.

---

## Setup / Connection

- [ ] **Mock mode fallback was silent** — when no auth token existed, the UI fell straight into mock mode without attempting to detect the kernel. User saw the full desktop but nothing was real. *(Fixed during this session — now pings /health to detect kernel.)*
- [ ] **401 errors on initial load** — browser tries to load favicon.ico and page root on :3001 directly, gets 401. Harmless but noisy in console.
- [ ] **"Process 1 not found" error** — kernel emits events for PID 1 (init process) but the client throws an unhandled error. Should be silently ignored or handled gracefully.
- [ ] **Playwright not installed** — BrowserApp fails with "Playwright is not available. Install with: npx playwright install chromium". Expected, but the error should be caught and shown as a friendly message in the app UI, not a console error.

## Agent ↔ Human Interaction (The Big Gap)

- [ ] **VNC is view-only** — can watch the agent work in its container but can't click, type, or interact. This is the #1 feature gap. See NEXT-MOVES.md "The Killer Feature: Agent Takeover" section.
- [ ] **No live chat with running agent** — once an agent is deployed, you can't steer it, give it feedback, or ask it to change direction mid-task. Only option is abort.
- [ ] **Can't close apps in agent's desktop** — the container's Linux desktop (XFCE) is visible but not interactive from the user's side.
- [ ] **No pause/resume** — can only abort (kill) an agent, not pause it, take over, and resume.

## Agent ↔ OS Integration

- [ ] **Agent uses container apps, not OS apps** — the Coder agent opened VS Code inside the Linux container, not the React CodeEditor app. The React apps and container apps are two separate worlds. Agent has `write_file` tool which writes to container filesystem, completely unaware of the React shell.
- [ ] **Agent has different app set than user** — the VM shows a standard Linux desktop with XFCE apps. The user's Aether dock has 15+ custom React apps. No connection between them.
- [ ] **No shared filesystem view** — files the agent creates in the container aren't visible in the OS file explorer without manual sync.

## Agent ↔ Agent Collaboration

- [ ] **Agents can't talk to each other** — no inter-agent messaging at the container level. Each agent runs in isolation. The kernel has an EventBus but containers don't subscribe to each other's events.
- [ ] **No task handoff** — one agent can't pass work to another agent or request help.

## Agent Reliability

- [ ] **GPT 5.3 Codex didn't finish its task** — was asked to make a landing page. It created the HTML file but the task completion was unclear. Need to investigate if the agent loop exited cleanly or timed out.
- [ ] **Agent success rate unknown** — no tracking of how often agents actually complete their goals vs fail/timeout/crash.

## UI / UX

- [ ] **No indication of mock vs kernel mode** — bottom bar shows "Mock" but it's easy to miss. User can think they're using the real system when they're in mock mode.
- [ ] **Login screen didn't appear when kernel was available** — *(Fixed during this session)*

---

## Priority Order (for when development resumes)

1. **Agent takeover** (pause → interact → resume) — the killer feature
2. **Live agent chat** — steer agents mid-task
3. **Agent success tracking** — know what works and what doesn't
4. **Friendlier error handling** — Playwright missing, process not found, etc.
5. **Bridge React apps ↔ container** — shared filesystem, unified app launcher
6. **Inter-agent messaging** — let agents collaborate

---

*Update this doc after each testing session. This is the real roadmap.*
