# Aether OS — What Now?

> Written 2026-02-11, updated 2026-02-13 (post-v0.8 External Agent Runtime Integration). This is not a coding roadmap — it's a thinking document about strategic direction.

---

## Where We Are

Aether OS is a working AI agent operating system with 30 kernel subsystems, 20+ desktop apps, and runs on Windows/macOS/Linux.

As of v0.8, the strategic direction has shifted. Rather than competing with OpenClaw and Claude Code by building a custom agent loop, **Aether OS now positions itself as an agent OS platform that hosts external runtimes.** The kernel exposes its 30 subsystems (memory, skills, collaboration, audit, metrics, etc.) as MCP tools that external agents can call. OpenClaw and Claude Code run as real OS subprocesses managed by the kernel.

Key v0.8 additions:
- **AetherMCPServer** — exposes kernel capabilities as MCP tools for external agent runtimes
- **AgentSubprocess** — manages the lifecycle of external agent processes (spawn, stop, pause, resume, stdin injection, output streaming)
- **AgentRuntime type** — agents can now be spawned with `runtime: 'builtin' | 'claude-code' | 'openclaw'`
- The builtin `AgentLoop` remains as a fallback for simple tasks or when external runtimes aren't installed

**Current state in one sentence:** Aether OS is no longer just an agent runtime — it's an agent operating system that hosts the best runtimes available.

---

## Runtime Integration Roadmap

The full plan is in `PLAN-AGENT-RUNTIME-INTEGRATION.md`. Here's the phase summary:

### Phase 1: MCP Server Foundation -- DONE (v0.8)

AetherMCPServer exposes kernel subsystems as MCP tools. AgentSubprocess manages external process lifecycle. Agents can be spawned with `runtime: 'claude-code'` or `runtime: 'openclaw'`. Config files (CLAUDE.md, .openclaw/INSTRUCTIONS.md) are auto-generated. stdout/stderr piped through EventBus for live UI streaming.

### Phase 2: Full MCP stdio Bridge -- NEXT

Wire the AetherMCPServer as an actual stdio MCP transport so that Claude Code and OpenClaw can **call** aether_* tools during execution (memory recall, skill discovery, IPC, etc.). Phase 1 writes the config files; Phase 2 makes the tools actually callable in real time.

### Phase 3: OpenClaw Computer Use Integration

OpenClaw's full computer use (screen interaction, browser, terminal) running inside Aether's graphical containers (Xvfb + x11vnc). The agent gets a real desktop and Aether's brain.

### Phase 4: Agent Takeover UX Redesign

Replace the current AgentVM with a real terminal/VNC viewer showing the actual agent's output. Pause/resume with message injection. Take Over button that hands control to the user.

### Phase 5: Self-Modification via Repo Access

Agents can read Aether OS source code, propose patches (on feature branches), run the test suite, and create PRs. Human approval required before merge. The OS evolves through the agents it runs.

### The End State

Agents running inside Aether OS get the best coding/computer-use runtimes available (Claude Code, OpenClaw) plus Aether's persistent memory, skill system, multi-agent collaboration, and desktop UI. The builtin AgentLoop is deprecated for serious work but remains as a lightweight fallback.

---

## Immediate Priorities (This Week)

### 1. Test It Yourself — Seriously

Not "does it compile" testing. Sit down and use it like a user:

- Spawn 3-4 agents with different goals. Do they actually complete their tasks?
- Try the PWA on your phone. Can you see Mission Control and kill an agent?
- Open the app in a second browser tab. Does the WebSocket dedup work?
- Try registering a second user account. Does RBAC actually restrict anything?
- Leave an agent running for 30+ minutes. Does context compaction kick in?
- Try the LangChain tool import via the REST API. Does it round-trip?

**Write down everything that breaks.** That list is your real v0.6 roadmap, not any feature doc.

### 2. Get It Running on a Second Machine

Before sharing with anyone, prove it works somewhere other than your dev machine:

- Fresh clone on a different Windows machine (or WSL, or a friend's Mac)
- Follow only the README instructions — no tribal knowledge
- Time how long setup takes. If it's over 10 minutes, that's a problem.
- Note every place where you had to "just know" something

### 3. Set Up a Shareable Environment

For your coder friend and dad, you have options:

**Option A: They run it locally**
- Simplest. They clone, `npm install`, add API key, `npm run dev`
- Pro: No infra to maintain. They can hack on it.
- Con: They need Node.js, an API key, and patience

**Option B: You host it on a VPS**
- Spin up a cheap VPS (Hetzner, DigitalOcean, etc.), run it with Docker Compose
- Give them a URL + login credentials
- Pro: Zero setup for them. They just open a browser.
- Con: You pay for hosting + API costs. Their agents use your API key.

**Option C: Hybrid**
- You host the kernel + UI on a VPS
- They bring their own API key (add a Settings field for this)
- Pro: Low setup for them, you don't eat API costs
- Con: Need to build the "user provides own key" flow

For 2 testers, **Option A is fine.** They're devs. For more testers or non-devs, you'd want Option B or C.

---

## What to Tell Your Testers

Don't just say "try it and tell me what you think." That gets you "it's cool!" which is useless. Give them specific missions:

**For your coder friend:**
- "Spawn a coding agent and have it build a simple Python script. Did it succeed? Where did it get stuck?"
- "Try the browser — go to a real website. Does it render? Can you click things?"
- "Open the code editor and edit a file. Does save work?"
- "What would you change about the UI?"

**For your dad:**
- "Can you figure out how to deploy an agent without me explaining?"
- "What's confusing? What labels don't make sense?"
- "Try the chat — ask it to do something. Was the response useful?"
- "Would you use this for anything? What?"

**Collect feedback as:**
1. What confused you?
2. What broke?
3. What would you actually use this for?
4. What's missing that would make you use it regularly?

---

## Open Source Considerations

### What to Open Source

The whole thing, honestly. The value isn't in the code — it's in the architecture and the execution speed. Nobody else has this combination (containerized agent desktops + web control plane + VNC takeover + multi-LLM). Making it open source:

- Gets you contributors who fix bugs you don't have time for
- Gets you credibility ("look at this working system, not a pitch deck")
- Gets you feedback from people who actually try to deploy it
- Doesn't risk much — anyone serious about competing would build their own anyway

### What to Keep Private (if anything)

- Your `.env` file (API keys, obviously)
- Any proprietary agent templates you build for your own use
- Your deployment config (if you host a public instance)

### Licensing

- **MIT** is the default for maximum adoption. Anyone can use it, modify it, sell it.
- **AGPL** if you want to force competitors to open-source their modifications (but this scares enterprise users)
- **Apache 2.0** is a middle ground — permissive but with patent protection

MIT is probably right for this stage. You want adoption, not protection.

### Before Going Public

- [ ] Remove any hardcoded paths or personal references
- [ ] Make sure `.env.example` has all required variables documented
- [ ] Add a LICENSE file
- [ ] Clean up the git history if there's anything sensitive (API keys that were accidentally committed, etc.)
- [ ] The README is already decent — just verify it works for a cold start

---

## Product Direction — The Platform Play

With v0.8, the strategic direction has crystallized. Aether OS is not competing with Claude Code or OpenClaw -- it's the **operating system layer beneath them**. The three paths from the original doc are still valid, but the value proposition is now clearer:

### What Aether OS Is

An agent operating system that:
- **Hosts** external runtimes (Claude Code, OpenClaw) as managed subprocesses
- **Augments** those runtimes with persistent memory, skills, multi-agent collaboration, and audit trails via MCP tools
- **Orchestrates** multiple agents working together (IPC, shared workspaces, delegation)
- **Provides** a desktop UI for observing, controlling, and taking over agents

### What Aether OS Is NOT

- Not another agent loop (stop building a worse AgentLoop.ts)
- Not a chat UI wrapper around an LLM
- Not a no-code agent builder

### The Path Forward

1. **Personal workstation first** — you use it daily with Claude Code as the runtime
2. **Validate with testers** — the agent takeover UX is the killer demo
3. **Open platform later** — once the MCP bridge is solid, others can build on it

The key insight from v0.8: Aether's 30 kernel subsystems are the real product. The agent runtime is a commodity -- let OpenClaw and Claude Code compete on that. Aether competes on what happens around the agent: memory across sessions, skill accumulation, multi-agent coordination, and the desktop control plane.

---

## Deployment for Real Use

When you're ready to host it (for yourself or others):

### Cheapest: Single VPS

- Hetzner CX31 (~$8/mo) or DigitalOcean $12/mo droplet
- Ubuntu, Docker Compose, nginx reverse proxy with Let's Encrypt
- Good enough for 1-5 users, 10-20 concurrent agents
- The TLS + MFA features you just built make this production-viable

### Better: Container Service

- Fly.io, Railway, or Render
- Deploy the Docker Compose stack
- Auto-TLS, easier scaling
- $15-30/mo depending on usage

### Full Production: Kubernetes

- The Helm chart you built is ready
- But don't do this until you have a real reason (10+ users, SLA requirements)
- Kubernetes is expensive in time, money, and complexity

### API Costs

This is the real cost, not hosting:
- Gemini 3 Flash: ~$0.01-0.05 per agent run
- GPT-5: ~$0.10-0.50 per agent run
- Claude Opus 4: ~$0.20-1.00 per agent run

For personal use, budget ~$20-50/mo in API costs. For a shared instance with active users, could be $100+/mo. The ResourceGovernor quotas you built help control this.

---

## The Killer Feature: Agent Takeover

With v0.8's AgentSubprocess, the agent takeover flow is now architecturally possible:

1. **Pause agent** — `AgentSubprocess.pause(pid)` sends SIGSTOP, freezing the real subprocess
2. **Interactive VNC / Terminal** — user gets direct access to the agent's terminal or graphical desktop
3. **Inject message** — `AgentSubprocess.sendInput(pid, text)` writes to stdin
4. **Resume agent** — `AgentSubprocess.resume(pid)` sends SIGCONT, agent continues from current state

This turns "watch an agent work" into "work alongside an agent." That's the demo. That's the pitch. That separates Aether from every other agent platform that gives you either a chat box or a black box.

**Status:** VNC proxy functional, desktop containers work (XFCE4 + Firefox), agents have self-knowledge (CODEBASE.md), and the subprocess lifecycle management is in place. What's remaining is the Phase 4 UX work (replacing the simulated AgentVM with a real terminal/VNC viewer).

---

## Things That Would Make the Biggest Difference

Ranked by impact:

1. **Phase 2 MCP stdio bridge** — make aether_* tools actually callable from Claude Code/OpenClaw in real time
2. **Agent takeover UX** — pause, interact, resume with real terminal/VNC (Phase 4)
3. **Fix whatever breaks during testing** — real bugs trump new features
4. **Agent success rate** — with Claude Code/OpenClaw as runtimes, success rate should jump significantly vs the builtin loop
5. **One-command setup script** — `./setup.sh` or `setup.bat` that handles everything
6. **Better error messages** — when something fails, tell the user what went wrong and how to fix it
7. **A "getting started" walkthrough** — first 5 minutes after login, guided experience

---

## What NOT to Do Right Now

- Don't invest more in the builtin AgentLoop. External runtimes are the future.
- Don't optimize performance. It's fast enough for 5 users.
- Don't build an Electron wrapper. PWA works fine.
- Don't migrate to PostgreSQL. SQLite is fine at this scale.
- Don't build a landing page or marketing site. The README is your landing page.
- Don't skip straight to Phase 5 (self-modification). Get Phase 2 (MCP bridge) solid first.

**The work that matters now: complete the MCP stdio bridge (Phase 2) so agents can actually use Aether's memory, skills, and collaboration tools in real time.**

---

*Revisit this doc after completing Phase 2 (MCP stdio bridge) and after testing Claude Code as a runtime. Update it with what you learned.*
