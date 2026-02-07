# Aether OS v0.3 — Agent Intelligence & Autonomy

**Use this prompt to begin v0.3 development.**

---

## Prompt

```
You are working on Aether OS, an AI-native operating system. TypeScript monorepo:
- shared/ (types, protocol) → kernel/ (backend) → runtime/ (agent loop) → server/ (HTTP+WS) → components/ (React UI)

WHAT'S DONE:
- v0.1: Full kernel (12 subsystems), agent runtime, 16+ desktop apps, multi-LLM, 304+ tests
- v0.2: Playwright browser, Monaco editor, system monitor, music player, PDF viewer,
  theme system, agent browser tools, raw file serving — all complete

CURRENT ARCHITECTURE (read these files first):
- kernel/src/Kernel.ts — 12 subsystems, handleCommand() switch
- shared/src/protocol.ts — ~50 command/event discriminated unions
- runtime/src/AgentLoop.ts — think-act-observe loop, in-memory history only
- runtime/src/tools.ts — 19 built-in tools
- kernel/src/StateStore.ts — SQLite persistence (better-sqlite3, WAL mode)

THE PROBLEM: Agents currently forget everything between sessions. An agent that
debugged your API yesterday starts from scratch today. The agent loop has no
planning, no reflection, no learning. This is the single biggest blocker to
genuine autonomy.

YOUR TASK: Implement v0.3 in waves. Reference docs/ROADMAP-v0.3.md for the full
vision and docs/ROADMAP-v0.3-execution.md for the execution plan.

═══════════════════════════════════════════════════════════════════════
WAVE 1 — Memory & Scheduling Foundation (do these first, in parallel)
═══════════════════════════════════════════════════════════════════════

1. MemoryManager kernel subsystem (kernel/src/MemoryManager.ts)

   New kernel subsystem following existing pattern (constructor takes EventBus,
   init()/shutdown() lifecycle). Add to Kernel.ts alongside other subsystems.

   SQLite tables (add to StateStore.ts schema):

   ```sql
   CREATE TABLE IF NOT EXISTS agent_memories (
     id TEXT PRIMARY KEY,           -- uuid
     agent_uid TEXT NOT NULL,       -- which agent owns this
     layer TEXT NOT NULL,           -- 'episodic' | 'semantic' | 'procedural' | 'social'
     content TEXT NOT NULL,         -- the memory content
     tags TEXT,                     -- JSON array of tags
     importance REAL DEFAULT 0.5,   -- 0.0 to 1.0 (reinforced on access)
     access_count INTEGER DEFAULT 0,
     created_at INTEGER NOT NULL,
     last_accessed INTEGER NOT NULL,
     expires_at INTEGER,            -- null = never expires
     source_pid INTEGER,            -- PID that created this memory
     related_memories TEXT           -- JSON array of related memory IDs
   );

   CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_uid);
   CREATE INDEX IF NOT EXISTS idx_memories_layer ON agent_memories(agent_uid, layer);
   CREATE INDEX IF NOT EXISTS idx_memories_importance ON agent_memories(importance DESC);

   -- Full-text search index for memory retrieval
   CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(
     content, tags,
     content='agent_memories',
     content_rowid='rowid'
   );
   ```

   MemoryManager API:
   - store(agentUid, layer, content, tags?, importance?) → memoryId
   - recall(agentUid, query, options?: { layer?, limit?, minImportance? }) → Memory[]
   - forget(memoryId) → void
   - share(memoryId, targetAgentUid) → void  (copies memory to another agent)
   - getProfile(agentUid) → { totalMemories, byLayer, topTags, oldestMemory }
   - consolidate(agentUid) → void  (merge similar, decay old, prune expired)
   - getMemoriesForContext(agentUid, currentGoal, limit?) → Memory[]
     Uses FTS5 MATCH for text search, ranked by importance × recency

   Protocol additions (shared/src/protocol.ts):
   - Commands: memory.store, memory.recall, memory.forget, memory.share,
     memory.profile, memory.consolidate, memory.list
   - Events: memory.stored, memory.recalled, memory.forgotten, memory.shared

   Wire into Kernel.handleCommand() with new cases.

2. CronManager kernel subsystem (kernel/src/CronManager.ts)

   Enables scheduled and event-triggered agent spawning.

   SQLite table (add to StateStore.ts):
   ```sql
   CREATE TABLE IF NOT EXISTS cron_jobs (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     cron_expression TEXT NOT NULL,  -- '*/5 * * * *' (5-field cron)
     agent_config TEXT NOT NULL,     -- JSON AgentConfig to spawn
     enabled INTEGER DEFAULT 1,
     owner_uid TEXT,
     last_run INTEGER,
     next_run INTEGER,
     run_count INTEGER DEFAULT 0,
     created_at INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS event_triggers (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     event_pattern TEXT NOT NULL,    -- kernel event type to match
     filter TEXT,                    -- JSON conditions on event data
     agent_config TEXT NOT NULL,     -- JSON AgentConfig to spawn
     enabled INTEGER DEFAULT 1,
     owner_uid TEXT,
     cooldown_ms INTEGER DEFAULT 60000,
     last_triggered INTEGER,
     created_at INTEGER NOT NULL
   );
   ```

   CronManager API:
   - createJob(name, cronExpr, agentConfig, ownerUid?) → jobId
   - deleteJob(jobId) → void
   - enableJob/disableJob(jobId) → void
   - listJobs(ownerUid?) → CronJob[]
   - createTrigger(name, eventPattern, agentConfig, filter?, cooldown?) → triggerId
   - deleteTrigger(triggerId) → void
   - listTriggers(ownerUid?) → EventTrigger[]
   - tick() — called every 60s, checks cron expressions, spawns agents

   Implementation: Parse cron expressions manually (simple 5-field: min hour dom month dow).
   Don't add a cron parsing library — it's straightforward to implement.
   The tick() method runs on setInterval(60000). On each tick, iterate enabled jobs,
   check if next_run <= now, spawn the agent via kernel.processes.spawn(), update last_run.

   Event triggers: Subscribe to kernel EventBus. When an event matches event_pattern,
   check cooldown, spawn the configured agent.

   Protocol additions:
   - Commands: cron.create, cron.delete, cron.enable, cron.disable, cron.list,
     trigger.create, trigger.delete, trigger.list
   - Events: cron.created, cron.fired, trigger.created, trigger.fired

3. Memory-aware agent loop (runtime/src/AgentLoop.ts modifications)

   Modify the existing agent loop to use memory:

   a) On agent startup (before main loop):
      - Load relevant memories: kernel.memory.getMemoriesForContext(uid, config.goal)
      - Inject into system prompt: "## Your Memories\n" + formatted memories
      - If the agent has worked on similar goals before, include those episodic memories

   b) During the loop (after each observation):
      - Auto-store important observations as episodic memory
      - Heuristic: if the observation contains an error/fix, file creation, or
        command result, store it with appropriate tags

   c) On agent completion (after 'complete' tool):
      - Run automatic journaling: store a summary of what was done, what worked,
        what the agent would do differently
      - Store as 'episodic' memory with tags derived from the goal

   d) Add memory tools to the agent tool set (see #4 below)

4. Memory tools for agents (runtime/src/tools.ts additions)

   Add these tools to the createToolSet() function:

   ```typescript
   remember: {
     name: 'remember',
     description: 'Store a memory for future sessions. Use for important learnings, preferences, or facts.',
     execute: async (args: { content: string; tags?: string[]; layer?: string }, ctx) => {
       const id = await ctx.kernel.memory.store(ctx.uid, args.layer || 'semantic', args.content, args.tags);
       return { success: true, output: `Memory stored: ${id}` };
     }
   }

   recall: {
     name: 'recall',
     description: 'Search your memories for relevant past experiences or knowledge.',
     execute: async (args: { query: string; limit?: number }, ctx) => {
       const memories = await ctx.kernel.memory.recall(ctx.uid, args.query, { limit: args.limit || 5 });
       return { success: true, output: memories.map(m => `[${m.layer}] ${m.content}`).join('\n') };
     }
   }

   forget: {
     name: 'forget',
     description: 'Remove a specific memory that is no longer relevant.',
     execute: async (args: { memoryId: string }, ctx) => {
       await ctx.kernel.memory.forget(args.memoryId);
       return { success: true, output: 'Memory removed.' };
     }
   }
   ```

═══════════════════════════════════════════════════════════════════════
WAVE 2 — Intelligence Layer (after Wave 1 is working)
═══════════════════════════════════════════════════════════════════════

5. Self-Reflection system (runtime/src/reflection.ts — new file)

   After the agent calls 'complete', before the process exits:

   a) Run a reflection prompt through the same LLM provider:
      "Reflect on your work. Rate your output 1-5. What went well? What would
       you do differently? What did you learn?"

   b) Parse the reflection into structured data:
      ```typescript
      interface Reflection {
        qualityRating: number;     // 1-5
        summary: string;
        lessonsLearned: string[];
        strategiesUsed: string[];
        improvements: string[];
      }
      ```

   c) Store reflection as a 'procedural' memory with high importance (0.8)

   d) Emit a new event: agent.reflection { pid, reflection }

   e) Log it to StateStore via a new agent_reflections table:
      ```sql
      CREATE TABLE IF NOT EXISTS agent_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pid INTEGER NOT NULL,
        agent_uid TEXT NOT NULL,
        quality_rating INTEGER NOT NULL,
        summary TEXT NOT NULL,
        lessons TEXT NOT NULL,       -- JSON array
        strategies TEXT NOT NULL,    -- JSON array
        improvements TEXT NOT NULL,  -- JSON array
        timestamp INTEGER NOT NULL
      );
      ```

6. Goal Decomposition & Planning (runtime/src/planner.ts — new file)

   When an agent receives a complex goal, it can create a structured plan:

   a) New tool: create_plan
      - Takes: { goal: string, context?: string }
      - Agent sends the goal to LLM with a planning prompt
      - Returns a hierarchical task tree (PlanNode[])

   b) Plan data structures:
      ```typescript
      interface PlanNode {
        id: string;
        title: string;
        description: string;
        status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
        children: PlanNode[];
        estimatedSteps: number;
        actualSteps?: number;
        result?: string;
      }

      interface AgentPlan {
        id: string;
        pid: PID;
        agentUid: string;
        goal: string;
        rootNodes: PlanNode[];
        status: 'active' | 'completed' | 'failed' | 'abandoned';
        createdAt: number;
        completedAt?: number;
      }
      ```

   c) New tools: update_plan_node (mark status), get_plan (retrieve current plan)

   d) Store plans in StateStore:
      ```sql
      CREATE TABLE IF NOT EXISTS agent_plans (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        agent_uid TEXT NOT NULL,
        goal TEXT NOT NULL,
        plan_tree TEXT NOT NULL,    -- JSON PlanNode tree
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      ```

   e) Plan-aware agent loop: If agent has an active plan, include current plan
      state in the system prompt context

   f) Protocol: plan.created, plan.updated, plan.completed events for UI updates

7. Feedback system (new tables + server endpoint + tools)

   a) SQLite table:
      ```sql
      CREATE TABLE IF NOT EXISTS agent_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pid INTEGER NOT NULL,
        agent_uid TEXT NOT NULL,
        step INTEGER NOT NULL,
        rating INTEGER NOT NULL,     -- -1 (bad) or 1 (good)
        comment TEXT,
        action_tool TEXT,
        action_args TEXT,
        user_id TEXT,
        timestamp INTEGER NOT NULL
      );
      ```

   b) Server endpoint: POST /api/feedback { pid, step, rating, comment }

   c) Agent can query its feedback: get_feedback tool
      - Returns recent feedback for this agent
      - Useful for adapting behavior based on user preferences

   d) EventBus event: agent.feedback { pid, step, rating }

═══════════════════════════════════════════════════════════════════════
WAVE 3 — UI Components (after Wave 2 is working)
═══════════════════════════════════════════════════════════════════════

8. Memory Inspector App (components/apps/MemoryInspectorApp.tsx)

   New app (add to AppID enum, Dock, App.tsx routing):
   - Icon: Brain from lucide-react
   - Layout: sidebar (agent list) + main panel (memory browser)
   - Agent selector: dropdown of all known agent UIDs
   - Memory list: filterable by layer (episodic/semantic/procedural/social)
   - Search bar: full-text search via memory.recall
   - Memory cards: show content, tags, importance bar, access count, age
   - Edit/delete individual memories
   - Memory stats header: total count, by layer, storage size
   - Dual-mode: kernel connected → real data, disconnected → mock data

9. Plan Viewer (enhance AgentVM app — components/apps/AgentVM.tsx)

   Don't create a new app — integrate into existing AgentVM:
   - Add a "Plan" tab alongside the existing log timeline
   - Tree view of current plan (collapsible nodes)
   - Node status indicators (pending=gray, active=blue, done=green, failed=red)
   - Click a node to see its details and sub-tasks
   - Auto-scrolls to the currently active node
   - Plan progress bar in the agent header

10. Feedback UI (enhance AgentVM app — components/apps/AgentVM.tsx)

    In the existing agent log timeline:
    - Add thumbs-up / thumbs-down buttons on each action entry
    - Clicking sends POST /api/feedback
    - Show existing feedback as colored border (green=good, red=bad)
    - Optional comment field on negative feedback

11. Cron/Trigger Manager (components/apps/SettingsApp.tsx enhancement)

    Add a new tab to SettingsApp:
    - "Automation" tab
    - List of cron jobs with enable/disable toggles
    - "New Cron Job" form: name, schedule (cron expression with human-readable preview),
      agent role, goal, tools
    - List of event triggers with enable/disable
    - "New Trigger" form: name, event type (dropdown of kernel events), conditions,
      agent config, cooldown
    - Recent automation history (last 20 firings)

═══════════════════════════════════════════════════════════════════════
WAVE 4 — Advanced (if time permits)
═══════════════════════════════════════════════════════════════════════

12. Agent Profiles & Specialization (kernel/src/MemoryManager.ts extension)

    Add a profiles table:
    ```sql
    CREATE TABLE IF NOT EXISTS agent_profiles (
      agent_uid TEXT PRIMARY KEY,
      display_name TEXT,
      working_style TEXT DEFAULT 'balanced', -- 'meticulous' | 'balanced' | 'fast'
      communication_style TEXT DEFAULT 'concise',
      risk_tolerance REAL DEFAULT 0.5,
      expertise TEXT,                        -- JSON { domain: confidence }
      preferences TEXT,                      -- JSON learned preferences
      total_tasks INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    ```

    - Auto-update after each task (increment total_tasks, recalculate success_rate)
    - Inject profile summary into agent system prompt
    - Profile editor in MemoryInspectorApp

13. Collaboration Protocols (runtime/src/collaboration.ts — new file)

    Structured multi-agent patterns using existing IPC:

    a) Code Review protocol:
       - Agent A finishes code → sends review_request to Agent B
       - Agent B reads files, sends review_feedback with inline comments
       - Agent A addresses feedback

    b) Task Handoff protocol:
       - Agent A completes phase 1 → writes handoff document to shared workspace
       - Spawns Agent B with goal = "Continue from handoff at shared/handoff.md"

    c) Standup protocol:
       - CronManager triggers standup broadcast every N hours
       - Each active agent summarizes its current status

    Implementation: Define message schemas in shared/src/protocol.ts,
    add collaboration tools (request_review, send_handoff, broadcast_status).

14. Vision Capability (runtime/src/tools.ts additions)

    New tool: analyze_image
    - Takes: { image_path: string } or { screenshot: true } or { url: string }
    - Gets image data (from FS, BrowserManager screenshot, or URL)
    - Sends to multimodal LLM (Claude, GPT-4V, or Gemini) via vision API
    - Returns text description/analysis

    Requires: Update LLMProvider interface to support image inputs
    - Add sendWithImage(messages, imageBase64, mimeType) to LLMProvider
    - Implement in at least one provider (GeminiProvider has native vision)

RULES:
- Run tests after each wave: npx vitest run
- Don't break existing 304+ tests — only add to them
- Add tests for each new subsystem in appropriate __tests__/ directories
- Component tests need `// @vitest-environment jsdom` at top of file
- Follow the existing pattern: Kernel constructor → subsystem init → protocol types → handleCommand cases
- The MemoryManager MUST work without external dependencies (no ChromaDB, no sentence-transformers)
  Use SQLite FTS5 for search. Vector embeddings can come in v0.3.1.
- Use `--legacy-peer-deps` for npm install
- Update docs/TODO.md, docs/FEATURES.md, docs/NEXT_STEPS.md when features complete
- Commit each feature separately with descriptive messages, then push

IMPORTANT IMPLEMENTATION NOTES:
- MemoryManager is the foundation — Wave 2 and 3 all depend on it
- CronManager can be developed independently of MemoryManager
- The agent loop changes (Wave 1 #3) depend on MemoryManager being done
- Keep FTS5 approach simple — don't over-engineer ranking algorithms
- The reflection system (#5) depends on memory (stores reflections as memories)
- Planning (#6) is independent of memory but benefits from it
- For profiles (#12), start with the schema and auto-update; don't add LLM-based personality yet
```

---

## Architecture Diagram

```
                    ┌─────────────────────────────────┐
                    │         Agent Loop (v0.3)         │
                    │                                   │
                    │  ┌─────────┐  ┌──────────────┐   │
                    │  │ Planner │  │  Reflection   │   │
                    │  │         │  │   Engine      │   │
                    │  └────┬────┘  └──────┬───────┘   │
                    │       │              │            │
                    │  ┌────▼──────────────▼───────┐   │
                    │  │   Memory-Aware Loop        │   │
                    │  │   (load → think → act →    │   │
                    │  │    observe → store)         │   │
                    │  └─────────────┬──────────────┘   │
                    └────────────────┼──────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                     Kernel                         │
           │                                                    │
           │  ┌──────────────┐  ┌──────────────┐               │
           │  │ MemoryManager│  │ CronManager  │               │
           │  │              │  │              │               │
           │  │ • store()    │  │ • cron jobs  │               │
           │  │ • recall()   │  │ • triggers   │               │
           │  │ • forget()   │  │ • tick()     │               │
           │  │ • share()    │  │              │               │
           │  │ • consolidate│  │              │               │
           │  └──────┬───────┘  └──────┬───────┘               │
           │         │                 │                        │
           │  ┌──────▼─────────────────▼───────┐               │
           │  │         StateStore (SQLite)      │               │
           │  │                                  │               │
           │  │  agent_memories + FTS5 index     │               │
           │  │  agent_reflections               │               │
           │  │  agent_plans                     │               │
           │  │  agent_profiles                  │               │
           │  │  agent_feedback                  │               │
           │  │  cron_jobs                       │               │
           │  │  event_triggers                  │               │
           │  └──────────────────────────────────┘               │
           └────────────────────────────────────────────────────┘
```

## Dependency Graph

```
Wave 1 (parallel where marked):
  1. MemoryManager ─────────┐
  2. CronManager (parallel) │ (independent)
  3. Memory-aware loop ─────┤ (depends on #1)
  4. Memory tools ──────────┘ (depends on #1)

Wave 2 (after Wave 1):
  5. Reflection ──── depends on #1 (memory), #3 (loop integration)
  6. Planning ────── independent, but benefits from #1
  7. Feedback ────── independent

Wave 3 (after Wave 2):
  8. Memory Inspector App ── depends on #1
  9. Plan Viewer ──────────── depends on #6
  10. Feedback UI ──────────── depends on #7
  11. Cron Manager UI ─────── depends on #2

Wave 4 (after Wave 3):
  12. Profiles ──── depends on #1, #5
  13. Collaboration ── depends on #6, existing IPC
  14. Vision ──── independent
```

## Suggested Agent Parallelization

If using multiple agents:

- **Agent 1 (Kernel):** MemoryManager (#1) + CronManager (#2) + protocol types + StateStore schema
- **Agent 2 (Runtime):** Memory-aware loop (#3) + memory tools (#4) + reflection (#5) + planning (#6)
- **Agent 3 (Server+UI):** Feedback endpoint (#7) + Memory Inspector (#8) + Plan Viewer (#9) + Feedback UI (#10) + Cron UI (#11)
- **Agent 4 (Advanced):** Profiles (#12) + Collaboration (#13) + Vision (#14)

Agents 1 and 2 have a dependency (Agent 2 needs MemoryManager), so Agent 1 should start first.
Agent 3 depends on Agents 1 and 2. Agent 4 depends on all previous.

## Success Criteria (from ROADMAP-v0.3.md)

- [ ] Agents remember context across sessions (spawn → kill → re-spawn → it remembers)
- [ ] Agents create and follow multi-step plans visible in the UI
- [ ] Agents reflect on their work and store lessons learned
- [ ] Agent collaboration uses structured protocols
- [ ] Agents can be triggered by events (file change, schedule, other agent completion)
- [ ] User feedback (thumbs up/down) is collected and influences agent behavior
- [ ] Agent profiles are visible and editable in the UI
- [ ] Memory inspector shows searchable agent memories
