# Aether OS v0.3 — Agent Intelligence & Autonomy

**Theme:** Agents that learn, remember, plan, reflect, and get better over time. Move from "LLM with tools" to "genuine autonomous agents."

**Status:** ✅ Complete (merged to main via PRs #31 and #32)

**Depends on:** v0.2 (Real Apps — agents need real tools to be genuinely intelligent)

---

## 1. Long-Term Memory

Currently agents forget everything between sessions. An agent that worked on a codebase yesterday starts from zero today. This is the single biggest blocker to genuine autonomy.

### 1.1 Memory Architecture

```
Agent Memory
├── Working Memory (current context window — already exists)
├── Episodic Memory (what happened — event log with embeddings)
├── Semantic Memory (what I know — facts, learnings, preferences)
├── Procedural Memory (how I do things — reusable plans/recipes)
└── Social Memory (who I know — other agents, their capabilities, past interactions)
```

### 1.2 Implementation

| Task | Details |
|------|---------|
| **Vector store** | Embed agent experiences using sentence-transformers (local) or OpenAI embeddings. Store in SQLite with `sqlite-vss` or a dedicated vector DB (ChromaDB, Qdrant) |
| **Automatic journaling** | After each task, agent writes a summary: what it did, what worked, what failed, what it learned |
| **Memory retrieval** | Before each thinking step, retrieve top-K relevant memories via cosine similarity |
| **Memory consolidation** | Background process: merge similar memories, prune outdated ones, strengthen frequently-accessed ones |
| **Cross-session continuity** | When an agent is re-spawned, load its memory profile. "Hey, I worked on this repo before. Last time I fixed the auth module." |
| **Memory inspector** | UI panel showing an agent's memory — searchable, editable, deletable |
| **Forgetting curve** | Memories decay over time unless reinforced. Prevents memory bloat |
| **Shared memories** | Team memories — learnings that one agent discovers become available to teammates |

### 1.3 Memory-Aware Tools

| Tool | Purpose |
|------|---------|
| `remember(content, tags)` | Agent explicitly stores a memory |
| `recall(query, limit)` | Agent searches its own memories |
| `forget(memory_id)` | Agent removes a memory |
| `share_memory(memory_id, target_agent)` | Share a specific memory with another agent |

---

## 2. Goal Decomposition & Planning

Agents shouldn't just react to instructions — they should break down complex goals into sub-goals, plan execution order, and adapt when things go wrong.

### 2.1 Hierarchical Task Network

```
Goal: "Build a REST API for the users table"
├── Sub-goal: Understand the schema
│   ├── Task: Read the database schema file
│   └── Task: Identify relevant tables and relationships
├── Sub-goal: Design the API
│   ├── Task: Define endpoints (CRUD)
│   ├── Task: Define request/response schemas
│   └── Task: Write design doc (share with reviewer agent)
├── Sub-goal: Implement
│   ├── Task: Set up Express/Fastify project
│   ├── Task: Implement each endpoint
│   ├── Task: Add input validation
│   └── Task: Add error handling
├── Sub-goal: Test
│   ├── Task: Write unit tests
│   ├── Task: Write integration tests
│   └── Task: Run tests and fix failures
└── Sub-goal: Review & Ship
    ├── Task: Self-review the code
    ├── Task: Request review from reviewer agent
    └── Task: Address feedback
```

### 2.2 Implementation

| Task | Details |
|------|---------|
| **Plan tool** | `create_plan(goal)` → agent generates a hierarchical task tree |
| **Plan execution engine** | Tracks plan progress, handles task dependencies, re-plans on failure |
| **Plan UI** | Visual tree view showing plan status — pending, in-progress, completed, failed, re-planned |
| **Adaptive re-planning** | When a sub-goal fails, agent re-evaluates and generates an alternative approach |
| **Plan templates** | Reusable plan structures for common goals (build API, fix bug, write docs, etc.) |
| **Estimated effort** | Agent predicts how many steps each sub-goal will take (improves with experience) |

---

## 3. Self-Reflection & Metacognition

Agents that think about their own thinking. After completing a task, they evaluate their performance and adjust their approach.

### 3.1 Reflection Loop

```
1. Complete task
2. Self-evaluate: Did I achieve the goal? How efficiently? What went wrong?
3. Extract lessons: What should I do differently next time?
4. Store in procedural memory
5. Update confidence scores for different task types
```

### 3.2 Implementation

| Task | Details |
|------|---------|
| **Post-task reflection prompt** | After `complete` tool, agent runs a reflection pass |
| **Quality self-assessment** | Agent rates its own output (1-5) with justification |
| **Strategy journal** | "For Python projects, I should check for virtual environments first" — stored and retrieved for similar future tasks |
| **Confidence calibration** | Track predicted vs actual outcomes. Agent learns what it's good at and what it struggles with |
| **Improvement suggestions** | Agent suggests what tools/capabilities it wishes it had |
| **Reflection UI** | Timeline shows reflection entries alongside actions |

---

## 4. Multi-Modal Perception

Agents that can see, hear, and process multiple types of input.

### 4.1 Vision

| Task | Details |
|------|---------|
| **Screenshot analysis** | Agent sees its own VNC desktop and reasons about what's on screen |
| **Browser visual understanding** | Agent looks at the rendered web page, not just the DOM text |
| **Image understanding** | Analyze diagrams, charts, UI mockups, error screenshots |
| **Video understanding** | Process video frame-by-frame for monitoring/analysis tasks |
| **Screen OCR** | Extract text from any visual source |

### 4.2 Audio

| Task | Details |
|------|---------|
| **Speech-to-text** | Whisper (local) or cloud STT — agents can listen |
| **Text-to-speech** | Agents can speak their thoughts aloud (useful for presentations, pair programming) |
| **Audio analysis** | Detect errors in audio files, transcribe meetings |
| **Voice commands** | User talks to agents instead of typing |

### 4.3 Structured Data

| Task | Details |
|------|---------|
| **Table/CSV understanding** | Agent reasons about tabular data natively |
| **Chart interpretation** | Agent can read and describe charts |
| **Code understanding** | AST-aware analysis, not just text pattern matching |

---

## 5. Personality & Specialization

Agents develop distinct working styles based on their template and experience.

### 5.1 Agent Profiles

| Task | Details |
|------|---------|
| **Working style** | Some agents are meticulous (check everything twice), others are fast (move quickly, fix later) |
| **Communication style** | Verbose vs concise, formal vs casual, asks questions vs makes assumptions |
| **Risk tolerance** | Cautious agents ask for approval more often; bold agents act first |
| **Expertise domains** | Agent builds confidence scores per domain (Python: 0.9, Rust: 0.3, DevOps: 0.7) |
| **Preference learning** | Agent learns user preferences over time ("you always want tests," "you prefer functional style") |

### 5.2 Implementation

| Task | Details |
|------|---------|
| **Profile schema** | JSON profile stored in agent memory, evolves over time |
| **Profile editor** | UI to view and tweak an agent's personality parameters |
| **Template inheritance** | Start from a template, customize through experience |
| **Profile sharing** | Export/import agent profiles (share your best coder config with others) |

---

## 6. Agent Collaboration Protocols

Move from simple IPC messages to structured collaboration patterns.

### 6.1 Team Dynamics

| Pattern | Description |
|---------|-------------|
| **Pair programming** | Two agents work on the same file — one writes, one reviews in real-time |
| **Code review** | Coder submits a diff, reviewer agent reads it and leaves inline comments |
| **Standup** | Periodic status broadcast — each agent summarizes what it's doing and what's blocked |
| **Handoff** | Agent A finishes phase 1, writes a handoff document, Agent B picks up phase 2 |
| **Debate** | Two agents argue opposite sides of a design decision, a third decides |
| **Teaching** | Expert agent teaches a novice agent by working through a problem together |

### 6.2 Structured Messages

```typescript
interface AgentMessage {
  type: 'task_request' | 'task_result' | 'status_update' | 'review_request' |
        'review_feedback' | 'question' | 'answer' | 'handoff' | 'escalation';
  from: string;       // agent UID
  to: string;         // agent UID or 'broadcast'
  thread: string;     // conversation thread ID
  priority: 'low' | 'normal' | 'high' | 'urgent';
  payload: unknown;   // type-specific data
  requires_response: boolean;
  deadline?: number;  // timestamp
}
```

### 6.3 Orchestration Engine

| Task | Details |
|------|---------|
| **Workflow DSL** | YAML/JSON format for defining multi-agent workflows |
| **Visual workflow builder** | Drag-and-drop UI for composing agent pipelines |
| **Automatic orchestration** | Give a high-level goal → system decomposes it and assigns agents |
| **Progress tracking** | Dashboard showing workflow progress across all agents |
| **Bottleneck detection** | Identify which agent is the slowest, suggest parallelization |
| **Error recovery** | If an agent fails mid-workflow, reassign or retry automatically |

---

## 7. Proactive Behavior

Agents that don't just wait for instructions — they notice things and act.

### 7.1 Event-Driven Agents

| Trigger | Action |
|---------|--------|
| **File changed in watched directory** | Agent reviews the change, runs tests, flags issues |
| **New email arrives** | Agent triages, categorizes, drafts response |
| **Scheduled time** | Agent runs daily reports, cleanup tasks, backups |
| **Another agent completed a task** | Dependent agent picks up automatically |
| **Error detected in logs** | SysAdmin agent investigates and proposes a fix |
| **PR merged on GitHub** | Agent deploys to staging, runs smoke tests |

### 7.2 Implementation

| Task | Details |
|------|---------|
| **Event subscription** | Agents subscribe to kernel events (file:changed, process:exited, schedule:tick) |
| **Trigger rules** | Configurable rules: "when X happens, wake agent Y with context Z" |
| **Cron-style scheduling** | Agents can have scheduled tasks (daily standup, weekly report) |
| **Idle behavior** | When no tasks are assigned, agent can explore, learn, organize, or enter low-power mode |

---

## 8. Learning & Adaptation

### 8.1 Feedback Loops

| Task | Details |
|------|---------|
| **User feedback** | Thumbs up/down on agent actions, stored as training signal |
| **Outcome tracking** | Did the agent's code pass tests? Did the PR get merged? Track success rates |
| **Strategy evolution** | Agent tries different approaches, tracks which work best for which contexts |
| **Tool usage optimization** | Agent learns which tools are most effective for which tasks |
| **Prompt self-tuning** | Agent refines its own system prompt based on what produces better results |

### 8.2 Implementation

| Task | Details |
|------|---------|
| **Feedback UI** | Simple thumbs up/down on each agent action in the timeline |
| **Success metrics DB** | Track task completion rate, average steps, error rate per agent |
| **A/B strategy testing** | Agent occasionally tries a different approach and compares outcomes |
| **Capability assessment** | Periodic self-test: agent attempts standard benchmarks, calibrates confidence |

---

## Success Criteria for v0.3

- [x] Agents remember context across sessions (deploy agent, kill it, re-deploy — it remembers) ✅ MemoryManager with FTS5 + memory-aware agent loop
- [x] Agents create and follow multi-step plans visible in the UI ✅ Planner + Plan Viewer tab in AgentVM
- [x] Agents reflect on their work and store lessons learned ✅ Reflection system stores procedural memories
- [x] At least one multi-modal capability works (vision or audio) ✅ Vision via all 4 LLM providers
- [x] Agent collaboration follows structured protocols (not just raw string messages) ✅ Collaboration protocols with 8 message types
- [x] Agents can be triggered by events (file change, schedule, other agent completion) ✅ CronManager + event triggers
- [x] User feedback (thumbs up/down) is collected and influences agent behavior ✅ Feedback system + UI + agent tool
- [x] Agent profiles are visible and editable in the UI ✅ ProfileCard in Memory Inspector
- [x] Memory inspector shows searchable agent memories ✅ MemoryInspectorApp with search, filters, agent list
- [ ] Workflow builder exists for multi-agent orchestration — Deferred to v0.4
