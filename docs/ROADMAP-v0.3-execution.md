# Aether OS v0.3 Execution Plan

**Theme:** Agent Intelligence & Autonomy — from "LLM with tools" to "agents that learn, remember, plan, and improve"

**Depends on:** v0.2 complete (all 14+ apps working, 304+ tests passing)

**Estimated scope:** 14 features across 4 waves

---

## Strategic Priority Order

The execution order is driven by two principles:

1. **Memory first** — Cross-session memory is the foundation for everything else (reflection stores memories, planning benefits from recall, profiles track experience, collaboration shares context). Without memory, all other v0.3 features operate in a vacuum.

2. **DGX OS insight: thin kernel, smart containers** — Following NVIDIA's pattern of a thin OS layer with containerized intelligence, our memory system uses SQLite (already in kernel) with FTS5 rather than adding external vector DB dependencies. Keep the kernel thin; intelligence lives in the agent runtime.

## Wave 1: Foundation — Memory & Scheduling

**Goal:** Agents persist knowledge across sessions. System can auto-spawn agents on schedule.

| # | Feature | Files | Est. Lines | Depends On |
|---|---------|-------|------------|------------|
| 1 | MemoryManager subsystem | kernel/src/MemoryManager.ts, StateStore.ts, protocol.ts, Kernel.ts | ~500 | Nothing |
| 2 | CronManager subsystem | kernel/src/CronManager.ts, StateStore.ts, protocol.ts, Kernel.ts | ~400 | Nothing |
| 3 | Memory-aware agent loop | runtime/src/AgentLoop.ts | ~100 (mods) | #1 |
| 4 | Memory agent tools | runtime/src/tools.ts | ~80 | #1 |

**Parallelism:** #1 and #2 can run in parallel. #3 and #4 wait for #1.

**Validation:**
- Test: Create agent → store memories → kill agent → respawn with same UID → agent recalls previous memories
- Test: Create cron job → wait for tick → verify agent was spawned
- Test: Create event trigger → emit matching event → verify agent was spawned
- All existing 304+ tests still pass

### Implementation Details

**MemoryManager key decisions:**
- Use SQLite FTS5 for text search (no external dependencies)
- Memory importance decays: `effective_importance = importance * (0.99 ^ days_since_access)`
- Consolidation runs on explicit call, not background timer (keep it simple for v0.3.0)
- Memory IDs are UUIDs generated with `crypto.randomUUID()`
- Maximum 1000 memories per agent per layer (configurable)
- The `recall()` method ranks by: FTS5 relevance score × importance × recency

**CronManager key decisions:**
- Simple 5-field cron parser (min hour dom month dow) — no library dependency
- tick() runs on 60-second setInterval
- Event triggers listen on kernel EventBus with event.type matching
- Cooldown prevents trigger spam (default 60s)
- Jobs store full AgentConfig as JSON — including role, goal, tools, model

---

## Wave 2: Intelligence Layer — Reflection, Planning, Feedback

**Goal:** Agents evaluate their own work, break down complex tasks, and learn from user feedback.

| # | Feature | Files | Est. Lines | Depends On |
|---|---------|-------|------------|------------|
| 5 | Self-Reflection system | runtime/src/reflection.ts (new), AgentLoop.ts, StateStore.ts | ~300 | #1, #3 |
| 6 | Goal Decomposition & Planning | runtime/src/planner.ts (new), tools.ts, StateStore.ts, protocol.ts | ~400 | Independent |
| 7 | Feedback system | server/src/index.ts, StateStore.ts, protocol.ts | ~200 | Independent |

**Parallelism:** #5 depends on memory. #6 and #7 are independent of each other and can run in parallel.

**Validation:**
- Test: Agent completes task → reflection stored as procedural memory → reflection has quality rating
- Test: Agent creates plan → plan has hierarchical nodes → agent updates node status during execution
- Test: POST /api/feedback → rating stored → agent can query its feedback
- All previous tests still pass

### Implementation Details

**Reflection key decisions:**
- Reflection runs after `complete` tool, before process exit (new hook in AgentLoop)
- Uses the same LLM provider as the main agent loop
- Reflection prompt is hardcoded (not configurable) — keeps it simple
- Quality rating is parsed from LLM response (1-5 scale with justification)
- Stored as procedural memory with importance=0.8 and tags=['reflection', 'post-task']

**Planning key decisions:**
- Plans are JSON trees stored in a single `plan_tree` TEXT column
- Agent creates plan explicitly via `create_plan` tool (not automatic)
- Plan nodes have estimated steps (agent guesses) and actual steps (tracked)
- Plan state is injected into system prompt as markdown checklist
- Re-planning: agent can call `create_plan` again to replace the current plan

**Feedback key decisions:**
- Binary rating only (thumbs up/down = +1/-1) — no complex scoring
- Feedback is per-action (identified by PID + step number)
- Optional text comment for negative feedback
- GET /api/feedback/:pid returns all feedback for a process
- Agent tool `get_feedback` queries own historical feedback across sessions

---

## Wave 3: UI Components

**Goal:** Users can browse agent memories, see plans, give feedback, and manage automations.

| # | Feature | Files | Est. Lines | Depends On |
|---|---------|-------|------------|------------|
| 8 | Memory Inspector App | components/apps/MemoryInspectorApp.tsx, types.ts, Dock.tsx, App.tsx | ~600 | #1 |
| 9 | Plan Viewer (AgentVM tab) | components/apps/AgentVM.tsx (enhance) | ~200 | #6 |
| 10 | Feedback UI (AgentVM enhance) | components/apps/AgentVM.tsx (enhance) | ~100 | #7 |
| 11 | Automation Manager (Settings tab) | components/apps/SettingsApp.tsx (enhance) | ~300 | #2 |

**Parallelism:** All four can run in parallel (different files/components).

**Validation:**
- Test: Memory Inspector renders, shows agent list, displays memories, search works
- Test: Plan tab appears in AgentVM, shows tree nodes with status colors
- Test: Feedback buttons appear on action entries, clicking sends request
- Test: Automation tab shows cron jobs, can create/delete, shows triggers
- All previous tests still pass

### UI Details

**Memory Inspector:**
- New AppID: MEMORY_INSPECTOR
- Dock icon: Brain (lucide-react)
- Left sidebar: agent UID list (from memory.profile for each known agent)
- Top bar: layer filter tabs (All | Episodic | Semantic | Procedural | Social) + search input
- Memory cards: content preview, importance bar, tags as pills, access count, relative time
- Click card → expand with full content + edit/delete buttons
- Stats header: "142 memories, 23 episodic, 89 semantic, 18 procedural, 12 social"
- Mock data when kernel disconnected

**Plan Viewer (in AgentVM):**
- New tab in AgentVM alongside existing log timeline: "Plan"
- Collapsible tree view using recursive component (like CodeEditor file tree)
- Status icons: pending (circle), active (spinner), completed (checkmark), failed (x), skipped (dash)
- Progress bar: completed_nodes / total_nodes
- Plan header: goal text, status badge, creation time

---

## Wave 4: Advanced Features

**Goal:** Agent personality, multi-agent collaboration, and vision.

| # | Feature | Files | Est. Lines | Depends On |
|---|---------|-------|------------|------------|
| 12 | Agent Profiles | kernel/src/MemoryManager.ts, StateStore.ts, AgentLoop.ts, MemoryInspectorApp.tsx | ~300 | #1, #5 |
| 13 | Collaboration Protocols | runtime/src/collaboration.ts (new), tools.ts, protocol.ts | ~400 | #6, IPC |
| 14 | Vision Capability | runtime/src/tools.ts, llm/LLMProvider.ts, llm/GeminiProvider.ts | ~250 | Independent |

**Parallelism:** All three can run in parallel.

**Validation:**
- Test: Agent completes tasks → profile auto-updates (total_tasks, success_rate, expertise)
- Test: Agent A sends review_request → Agent B receives → sends review_feedback
- Test: analyze_image tool sends screenshot to vision LLM → returns description

---

## File Change Summary

### New Files (9)
| File | Wave | Purpose |
|------|------|---------|
| kernel/src/MemoryManager.ts | 1 | Memory subsystem |
| kernel/src/CronManager.ts | 1 | Scheduling subsystem |
| kernel/src/__tests__/MemoryManager.test.ts | 1 | Memory tests |
| kernel/src/__tests__/CronManager.test.ts | 1 | Cron tests |
| runtime/src/reflection.ts | 2 | Reflection engine |
| runtime/src/planner.ts | 2 | Planning engine |
| runtime/src/__tests__/reflection.test.ts | 2 | Reflection tests |
| runtime/src/__tests__/planner.test.ts | 2 | Planning tests |
| components/apps/MemoryInspectorApp.tsx | 3 | Memory browser UI |

### Modified Files (12)
| File | Wave | Changes |
|------|------|---------|
| kernel/src/Kernel.ts | 1 | Add MemoryManager + CronManager subsystems, handleCommand cases |
| kernel/src/StateStore.ts | 1-2 | New tables: agent_memories, cron_jobs, event_triggers, agent_reflections, agent_plans, agent_feedback, agent_profiles |
| shared/src/protocol.ts | 1-2 | New command/event types for memory, cron, trigger, plan, feedback |
| runtime/src/AgentLoop.ts | 1-2 | Memory loading, auto-journaling, reflection hook, plan context |
| runtime/src/tools.ts | 1-2 | remember, recall, forget, create_plan, update_plan, get_feedback, analyze_image tools |
| server/src/index.ts | 2 | POST /api/feedback, GET /api/feedback/:pid endpoints |
| types.ts | 3 | MEMORY_INSPECTOR AppID |
| components/os/Dock.tsx | 3 | Memory Inspector dock entry |
| App.tsx | 3 | Memory Inspector routing |
| components/apps/AgentVM.tsx | 3 | Plan tab, feedback buttons |
| components/apps/SettingsApp.tsx | 3 | Automation management tab |
| runtime/src/llm/LLMProvider.ts | 4 | Vision support in interface |

### Test Files (new)
| File | Tests |
|------|-------|
| kernel/src/__tests__/MemoryManager.test.ts | store, recall (FTS5), forget, share, consolidate, decay, limits |
| kernel/src/__tests__/CronManager.test.ts | create job, tick, fire, event trigger, cooldown, enable/disable |
| runtime/src/__tests__/reflection.test.ts | reflection prompt, parse response, store as memory |
| runtime/src/__tests__/planner.test.ts | create plan, update nodes, plan-aware prompts |
| components/apps/__tests__/MemoryInspectorApp.test.tsx | render, agent list, memory cards, search, filter, edit, delete |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| FTS5 not available in better-sqlite3 | FTS5 is compiled into better-sqlite3 by default — verify in test |
| Memory table grows unbounded | Consolidation + 1000-per-layer limit + expiration |
| Reflection LLM call adds latency | Async — don't block process exit. Fire-and-forget with timeout |
| Cron timer drift | Use next_run timestamps, not interval counting |
| Complex plan trees break UI | Max depth of 3 levels in plan tree rendering |
| FTS5 ranking is basic | Good enough for v0.3.0; vector embeddings planned for v0.3.1 |

---

## DGX OS Alignment Notes

From RESEARCH-dgx-os.md, key architectural parallels:

1. **Thin kernel + smart runtime** — Like DGX OS where the OS is thin (Ubuntu + drivers) and intelligence lives in NGC containers, Aether's kernel stays thin. MemoryManager and CronManager are lightweight SQLite wrappers. The intelligence (reflection, planning, profiles) lives in the runtime layer.

2. **Container-first isolation** — Memory isolation follows the same pattern as filesystem isolation. Each agent's memories are namespaced by `agent_uid`. Shared memories require explicit `share()` calls, like shared filesystem mounts require explicit `fs.mountShared`.

3. **GPU-aware future** — When running on DGX Spark, the v0.3.1 vector embedding path could use local GPU inference (via NVIDIA NIM containers) for embedding generation instead of cloud APIs.

4. **Cluster-ready design** — Memory tables use `agent_uid` (not PID) as the primary key, so memories persist across respawns and are portable across cluster nodes.
