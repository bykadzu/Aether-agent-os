# Testing Notes — v0.5

> Collected 2026-02-12 during live testing session. These are real bugs and gaps found by actually using the system, not theoretical issues.

---

## Setup / Connection

- [x] **Mock mode fallback was silent** — *(Fixed — now pings /health to detect kernel.)*
- [ ] **401 errors on initial load** — browser tries to load favicon.ico and page root on :3001 directly, gets 401. Harmless but noisy in console.
- [x] **"Process 1 not found" error** — *(Fixed — early-return guards in App.tsx silently ignore unknown PIDs.)*
- [x] **Playwright not installed** — *(Fixed — friendly "Browser Unavailable" UI panel with retry button.)*

## Agent ↔ Human Interaction

- [x] **VNC is view-only** — *(Fixed — VNC switches to interactive when agent is paused.)*
- [x] **No live chat with running agent** — *(Fixed — chat panel, message endpoint, ProcessManager queue.)*
- [x] **Can't close apps in agent's desktop** — *(Fixed — full VNC control when paused.)*
- [x] **No pause/resume** — *(Fixed — pause/resume protocol, REST endpoints, UI buttons in grid+list views.)*

## Agent ↔ OS Integration

- [ ] **Agent uses container apps, not OS apps** — the Coder agent opened VS Code inside the Linux container, not the React CodeEditor app. Two separate worlds.
- [ ] **Agent has different app set than user** — the VM shows XFCE apps, user's dock has 15+ React apps. No connection.
- [x] **No shared filesystem view** — *(Fixed — containers mount ~/.aether/shared, FileExplorer shows Shared directory.)*

## Agent ↔ Agent Collaboration

- [ ] **Agents can't talk to each other** — no inter-agent messaging at the container level.
- [ ] **No task handoff** — one agent can't pass work to another.

## Agent Reliability

- [ ] **GPT 5.3 Codex didn't finish its task** — created the file but completion was unclear.
- [ ] **Agent success rate unknown** — no tracking of completion vs failure.
- [x] **Tool output truncated too aggressively** — *(Fixed — increased to 4000 chars.)*

## UI / UX

- [x] **No indication of mock vs kernel mode** — *(Fixed — prominent amber "Mock Mode" badge.)*
- [x] **Login screen didn't appear when kernel was available** — *(Fixed — /health ping.)*
- [x] **Pause button only in list view** — Grid view (the default) had no pause/resume buttons. *(Fixed — added Pause/Resume buttons to grid card view.)*

## Container / Environment (NEW — found during testing)

- [ ] **First run_command executes on HOST, not container** — lazy container creation means the first command runs via Windows child_process (shows Windows pip paths), then subsequent commands go to Docker. The agent gets confused by mixed environments. Need to either pre-create containers at agent spawn, or queue the first command until the container is ready.
- [x] **Docker containers had no network** — networkAccess defaulted to false, containers had only loopback interface. *(Fixed — default changed to true.)*
- [ ] **Docker image has no Python** — the base Ubuntu image has no Python, pip, or dev tools pre-installed. Every agent wastes 15+ steps installing Python before it can do real work. Need a custom Docker image with Python, Node.js, pip, common tools pre-installed.
- [ ] **30-second command timeout kills long-running processes** — starting a web server (`python3 app.py`) always "times out" because the server doesn't exit. Agents need to learn to background processes (`&`), or the timeout should be configurable per-command.
- [ ] **browse_web is nearly useless without Playwright** — falls back to HTTP fetch which returns raw HTML. type_text, click_element, screenshot_page all fail. Google search redirects don't resolve. Agent wastes many steps trying to make browsing work.
- [ ] **Agent writes files in wrong location** — some files go to /home/agent/shared/ (correct), some to /home/agent_1/ (agent home). No clear guidance in system prompt about where to save work.

---

## Fixed This Session: 13/22

## Remaining Open Issues: 9

---

## Priority Order

1. **Fix container startup** — pre-create container at spawn, not lazily on first run_command
2. **Custom Docker image** — Python, Node.js, pip, curl, git pre-installed
3. **Agent success tracking** — completions table, dashboard stats
4. **Inter-agent messaging** — let agents collaborate
5. **Better browse_web fallback** — or install Playwright in container image
6. **Configurable command timeout** — or teach agents to background long processes
7. **401 console noise** — minor polish

---

*Update this doc after each testing session. This is the real roadmap.*
