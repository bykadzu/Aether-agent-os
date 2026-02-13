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
- [x] **Agent success rate unknown** — *(Fixed — agent.completed event with outcome/steps/duration, Prometheus metrics aether_agent_completions_total and aether_agent_duration_seconds, success rate % in dashboard top bar.)*
- [x] **Tool output truncated too aggressively** — *(Fixed — increased to 4000 chars.)*

## UI / UX

- [x] **No indication of mock vs kernel mode** — *(Fixed — prominent amber "Mock Mode" badge.)*
- [x] **Login screen didn't appear when kernel was available** — *(Fixed — /health ping.)*
- [x] **Pause button only in list view** — Grid view (the default) had no pause/resume buttons. *(Fixed — added Pause/Resume buttons to grid card view.)*

## Container / Environment (NEW — found during testing)

- [x] **First run_command executes on HOST, not container** — *(Fixed — containers are now pre-created at spawn time in Kernel.ts, not lazily on first run_command. Removed lazy creation from tools.ts.)*
- [x] **Docker containers had no network** — networkAccess defaulted to false, containers had only loopback interface. *(Fixed — default changed to true.)*
- [x] **Docker image has no Python** — *(Fixed — created Dockerfile.agent with Python 3.12, Node.js 22, pip, git, curl, vim, build-essential, and common pip packages pre-installed. Updated DEFAULT_CONTAINER_IMAGE to aether-agent:latest.)*
- [x] **30-second command timeout kills long-running processes** — *(Fixed — DEFAULT_COMMAND_TIMEOUT increased to 120s, MAX_COMMAND_TIMEOUT increased to 600s. Agents can also pass per-command timeout via args.)*
- [x] **browse_web is nearly useless without Playwright** — *(Fixed — HTTP fallback now extracts structured content: title, meta description, headings, links, and clean body text. screenshot_page/click_element/type_text return helpful guidance when Playwright is unavailable instead of cryptic errors.)*
- [x] **Agent writes files in wrong location** — *(Fixed — system prompt now explicitly tells agents to save deliverables to /home/agent/shared/, with examples using shared paths. Home directory is designated for scratch/temp files only.)*

---

## Fixed This Session: 19/22

## Remaining Open Issues: 3

---

## Priority Order

1. ~~**Fix container startup**~~ DONE — containers pre-created at spawn
2. ~~**Custom Docker image**~~ DONE — Dockerfile.agent with Python, Node.js, pip, common packages
3. ~~**Configurable command timeout**~~ DONE — 120s default, 600s max, per-command override
4. ~~**Agent success tracking**~~ DONE — agent.completed event, Prometheus metrics, dashboard success rate
5. ~~**Better browse_web fallback**~~ DONE — structured HTML extraction, helpful error messages for Playwright-only tools
6. ~~**Agent file location guidance**~~ DONE — system prompt updated for /home/agent/shared/
7. **Inter-agent messaging** — let agents collaborate at container level
8. **No task handoff** — one agent can't pass work to another
9. **401 console noise** — minor polish

---

*Update this doc after each testing session. This is the real roadmap.*
