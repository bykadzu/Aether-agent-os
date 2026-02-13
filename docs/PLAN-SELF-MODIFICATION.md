# Implementation Plan: Agent Self-Modification System

> Date: 2026-02-13
> Status: Draft
> Authors: Architecture Team
> Depends on: Aether OS v0.6 (MCP + OpenClaw)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision Records](#2-architecture-decision-records)
3. [Phase 1: Self-Modification Tools](#3-phase-1-self-modification-tools-sprint-1)
4. [Phase 2: Skill Generation & Discovery](#4-phase-2-skill-generation--discovery-sprint-2)
5. [Phase 3: Reflection-to-Skill Pipeline](#5-phase-3-reflection-to-skill-pipeline-sprint-3)
6. [Phase 4: Multi-Agent Skill Sharing](#6-phase-4-multi-agent-skill-sharing-sprint-4)
7. [Safety & Guardrails](#7-safety--guardrails)
8. [Implementation Order](#8-implementation-order)
9. [Risk Assessment](#9-risk-assessment)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Executive Summary

This plan adds **agent self-modification** to Aether OS — the ability for agents to discover, create, install, compose, and share skills at runtime. This is the natural next step after v0.6 (MCP + OpenClaw), which gave us the infrastructure to import external skills. Now we let *agents themselves* drive that process.

**What changes:**

- Agents get 6 new tools: `discover_skills`, `install_skill`, `create_skill`, `compose_skills`, `connect_mcp_server`, `update_profile`
- A new kernel subsystem `SkillForge` manages runtime skill creation, validation, sandboxed testing, and versioning
- The reflection system is enhanced to automatically propose skills from successful task patterns
- Agents can share learned skills with other agents via the existing IPC + memory system
- A graduated safety system (permission manifests + risk scoring + approval gates) prevents unsafe self-modification

**What stays the same:**

- No model fine-tuning — everything is prompt-based and in-context (like Voyager)
- Existing tool surface is unchanged (32 built-in + MCP + OpenClaw skills)
- Docker sandbox is the trust boundary — untrusted skills run inside containers
- RBAC governs which agents can self-modify

**Inspiration sources:**

- **OpenClaw**: SKILL.md format, permission manifests, ClawHub discovery, hot-reload
- **Voyager** (NVIDIA): Skill library with embedding-based retrieval, iterative refinement, self-verification
- **BabyAGI**: Reflection-to-learning pipeline, function database that builds itself
- **Google ADK**: Before-tool callbacks, layered defense, control plane separation

---

## 2. Architecture Decision Records

### ADR-1: Prompt-Based Self-Modification Only (No Weight Updates)

- **Decision**: All self-modification happens through tool use and context injection. Agents modify their *available tools* and *system prompt context*, never model weights.
- **Rationale**: Aether uses API-based LLMs (Gemini, OpenAI, Anthropic). Weight updates are impossible. More importantly, prompt-based modification is transparent, auditable, and reversible. Voyager proved this approach works — it outperformed fine-tuned baselines.
- **Implication**: Skills are code + instructions, stored as files, injected into prompts at runtime.

### ADR-2: Skills Are SKILL.md Files (OpenClaw Format)

- **Decision**: Agent-generated skills follow the OpenClaw SKILL.md format (YAML frontmatter + Markdown body). We do NOT invent a new format.
- **Rationale**: We already have the OpenClaw adapter from v0.6. Reusing the format means agent-created skills are compatible with ClawHub's 5,700+ community skills. One format, one pipeline.
- **Implication**: `SkillForge` generates SKILL.md files. The existing `OpenClawAdapter.importSkill()` pipeline handles registration.

### ADR-3: SkillForge as a New Kernel Subsystem (#29)

- **Decision**: Create a new `SkillForge` kernel subsystem that manages the full lifecycle of agent-created skills: generation → validation → sandbox test → registration → versioning → rollback.
- **Rationale**: Self-modification needs a dedicated control plane that is deterministic (not LLM-driven). The SkillForge validates structure, scores risk, enforces approval gates, and manages versions. Putting this in the kernel means it's trusted code that governs untrusted agent output.
- **Implication**: New file `kernel/src/SkillForge.ts`, registered as subsystem #29 in `Kernel.ts`.

### ADR-4: Graduated Safety with Permission Manifests

- **Decision**: Every agent-created skill must include a permission manifest in its YAML frontmatter. The SkillForge scores risk (Minimal/Low/Moderate/High/Critical) and enforces one of four modes: `allow`, `warn`, `prompt`, `deny`.
- **Rationale**: OpenClaw's permission manifest system is battle-tested across 5,700+ skills. Adopting it gives us a proven safety framework. The graduated approach means development is permissive (allow/warn) while production can be strict (prompt/deny).
- **Implication**: Risk scoring algorithm in SkillForge. Default enforcement mode configurable per-agent via RBAC.

### ADR-5: Sandbox-First Execution for New Skills

- **Decision**: Newly created skills are tested inside a Docker container before being registered. The skill must pass its own acceptance criteria (defined in the SKILL.md) to be persisted.
- **Rationale**: Voyager's self-verification loop proved that testing before persisting prevents skill library pollution. Our ContainerManager already provides Docker isolation with GPU passthrough.
- **Implication**: SkillForge calls ContainerManager to spin up a test container, runs the skill, evaluates output, then decides whether to persist.

---

## 3. Phase 1: Self-Modification Tools (Sprint 1)

### Overview

Add 6 new agent tools that expose kernel capabilities for self-modification. These are the handles agents use to modify their own skill set.

### 3.1 New Tool: `discover_skills`

**File**: `runtime/src/tools.ts` (add to tool definitions)

```typescript
{
  name: 'discover_skills',
  description: 'Search for available skills from local library, ClawHub, and MCP Registry. Returns matching skills with descriptions and installation status.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language description of needed capability' },
      source: { type: 'string', enum: ['local', 'clawhub', 'mcp', 'all'], description: 'Where to search (default: all)' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
    },
    required: ['query'],
  },
}
```

**Implementation**: Calls `kernel.skillForge.discover(query, source, limit)` which:
1. Searches local `PluginRegistry` by name/description/keywords
2. Searches ClawHub API (`GET https://clawhub.openclaw.ai/api/v1/skills/search?q=...`)
3. Searches connected MCP servers' tool lists
4. Ranks results by semantic similarity to query (using LLM embedding or fuzzy match)

### 3.2 New Tool: `install_skill`

```typescript
{
  name: 'install_skill',
  description: 'Install a skill from ClawHub or a SKILL.md path. The skill is validated, dependency-checked, and registered.',
  parameters: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'ClawHub skill ID (e.g. "web-scraper") or local SKILL.md path' },
      source: { type: 'string', enum: ['clawhub', 'local'], description: 'Installation source' },
    },
    required: ['skill_id'],
  },
}
```

**Implementation**: Calls `kernel.skillForge.install(skillId, source)` which:
1. Fetches SKILL.md from ClawHub or reads local path
2. Validates YAML frontmatter structure
3. Checks dependencies (bins, env vars, OS)
4. Scores permission risk
5. If risk ≤ agent's allowed threshold → auto-install via `OpenClawAdapter.importSkill()`
6. If risk > threshold → emit `skillforge.approval_required` event, pause for human approval

### 3.3 New Tool: `create_skill`

```typescript
{
  name: 'create_skill',
  description: 'Create a new skill by generating a SKILL.md file. The skill is validated, sandbox-tested, and registered if it passes.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill identifier (lowercase, hyphens)' },
      description: { type: 'string', description: 'What the skill does' },
      instructions: { type: 'string', description: 'Markdown instructions for how to use the skill' },
      tools_used: { type: 'array', items: { type: 'string' }, description: 'Which existing tools this skill uses' },
      test_input: { type: 'string', description: 'Example input to verify the skill works' },
      test_expected: { type: 'string', description: 'Expected output pattern (substring or regex)' },
    },
    required: ['name', 'description', 'instructions'],
  },
}
```

**Implementation**: Calls `kernel.skillForge.create(params)` which:
1. Generates a SKILL.md file from the parameters (template-based)
2. Validates structure and assigns permission manifest
3. If `test_input` provided → runs skill in sandbox container, checks output against `test_expected`
4. If test passes → imports via OpenClawAdapter
5. Stores creation metadata in StateStore (who created, when, test results)
6. Emits `skillforge.skill.created` event

### 3.4 New Tool: `compose_skills`

```typescript
{
  name: 'compose_skills',
  description: 'Combine multiple existing skills into a new composite skill. The new skill chains the listed skills in sequence.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'New composite skill name' },
      description: { type: 'string', description: 'What the composed skill does' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            skill_id: { type: 'string' },
            input_mapping: { type: 'string', description: 'How to map previous output to this step input' },
          },
        },
        description: 'Ordered list of skills to chain',
      },
    },
    required: ['name', 'description', 'steps'],
  },
}
```

**Implementation**: Generates a SKILL.md whose instructions describe the multi-step workflow, referencing each sub-skill. The LLM orchestrates execution via prompt-driven composition (OpenClaw pattern).

### 3.5 New Tool: `connect_mcp_server`

```typescript
{
  name: 'connect_mcp_server',
  description: 'Connect to a new MCP tool server to gain access to its tools.',
  parameters: {
    type: 'object',
    properties: {
      server_id: { type: 'string', description: 'Unique identifier for this server' },
      transport: { type: 'string', enum: ['stdio', 'sse'], description: 'Connection transport' },
      command: { type: 'string', description: 'For stdio: command to launch the server' },
      args: { type: 'array', items: { type: 'string' }, description: 'For stdio: command arguments' },
      url: { type: 'string', description: 'For SSE: server URL' },
    },
    required: ['server_id', 'transport'],
  },
}
```

**Implementation**: Calls `kernel.mcpManager.addServer(config)` then `kernel.mcpManager.connect(serverId)`. The discovered tools become available to the agent in subsequent steps.

### 3.6 New Tool: `update_profile`

```typescript
{
  name: 'update_profile',
  description: 'Update your own agent profile — expertise tags, preferred tools, and working style notes.',
  parameters: {
    type: 'object',
    properties: {
      add_expertise: { type: 'array', items: { type: 'string' }, description: 'Expertise tags to add' },
      remove_expertise: { type: 'array', items: { type: 'string' }, description: 'Expertise tags to remove' },
      notes: { type: 'string', description: 'Free-form notes about working style or preferences' },
    },
  },
}
```

**Implementation**: Calls `kernel.memoryManager.updateProfile()` with the provided updates. The profile feeds into the system prompt on next task.

### 3.7 File Changes Summary (Sprint 1)

| File | Change |
|---|---|
| `runtime/src/tools.ts` | Add 6 new tool definitions + handlers |
| `kernel/src/SkillForge.ts` | **NEW** — Core subsystem (discover, install, create, compose, validate, test) |
| `kernel/src/Kernel.ts` | Register SkillForge as subsystem #29 |
| `shared/src/protocol.ts` | Add SkillForge commands + events |
| `shared/src/constants.ts` | Add SkillForge constants (limits, timeouts, risk thresholds) |

---

## 4. Phase 2: Skill Generation & Discovery (Sprint 2)

### Overview

Make skill discovery intelligent (embedding-based search) and skill generation robust (iterative refinement with self-verification).

### 4.1 Embedding-Based Skill Retrieval

**File**: `kernel/src/SkillForge.ts` (add method)

When an agent calls `discover_skills`, instead of naive text search:
1. Embed the query using the agent's LLM provider (`embed(query)`)
2. Compare against pre-computed embeddings of all registered skill descriptions
3. Return top-K by cosine similarity
4. Fall back to FTS5 search if embeddings unavailable

**Storage**: Add `skill_embeddings` table to StateStore with columns `(skill_id, embedding BLOB, updated_at)`. Embeddings are computed on skill import and cached.

### 4.2 Iterative Skill Refinement (Voyager Pattern)

When `create_skill` sandbox test fails:
1. Capture error output
2. Feed error + original skill definition back to LLM as a "fix this skill" prompt
3. LLM generates refined SKILL.md
4. Re-test in sandbox
5. Repeat up to 3 times (configurable `SKILLFORGE_MAX_RETRIES`)
6. If still failing → store as draft, notify agent of failure

This is the Voyager self-verification loop adapted for Aether.

### 4.3 ClawHub Integration

**File**: `kernel/src/SkillForge.ts` (add ClawHub client)

```typescript
interface ClawHubClient {
  search(query: string, limit: number): Promise<ClawHubSkillInfo[]>;
  fetch(skillId: string): Promise<string>; // Returns SKILL.md content
  getPopular(category?: string, limit?: number): Promise<ClawHubSkillInfo[]>;
}
```

HTTP client that talks to ClawHub's public API. Results are cached for 1 hour in StateStore.

### 4.4 File Changes Summary (Sprint 2)

| File | Change |
|---|---|
| `kernel/src/SkillForge.ts` | Add embedding search, iterative refinement, ClawHub client |
| `kernel/src/StateStore.ts` | Add `skill_embeddings` table |
| `runtime/src/AgentLoop.ts` | Inject relevant skills into system prompt based on goal similarity |
| `shared/src/constants.ts` | Add `SKILLFORGE_MAX_RETRIES`, `CLAWHUB_CACHE_TTL` |

---

## 5. Phase 3: Reflection-to-Skill Pipeline (Sprint 3)

### Overview

The most powerful self-modification: when an agent completes a task successfully, the reflection system analyzes whether the solution pattern is reusable and automatically proposes it as a new skill.

### 5.1 Enhanced Reflection Prompt

**File**: `runtime/src/reflection.ts`

Extend the reflection prompt to include:

```
After your self-assessment, also answer:
- "reusable_pattern": Was there a reusable procedure you followed that could help with similar tasks in the future? If yes, describe it as a step-by-step skill.
- "skill_suggestion": If a reusable pattern exists, provide:
  - "name": skill identifier
  - "description": one-line description
  - "instructions": step-by-step markdown instructions
  - "tools_used": list of tools involved
```

### 5.2 Auto-Skill Proposal

**File**: `runtime/src/reflection.ts` (add post-reflection hook)

After parsing the reflection response:
1. If `reusable_pattern` is non-null and `quality_rating >= 4`:
   - Call `kernel.skillForge.propose(skillSuggestion, agentUid)`
   - SkillForge stores the proposal in a `skill_proposals` table
   - Emits `skillforge.skill.proposed` event
2. The proposal can be:
   - **Auto-approved** if the agent has `self_modify: auto` permission
   - **Queued for review** if the agent has `self_modify: review` permission
   - **Discarded** if the agent has `self_modify: deny` permission

### 5.3 Procedural Memory Integration

When a skill is created from reflection:
1. Store in `procedural` memory layer with high importance (0.9)
2. Tag with the task category and tools used
3. On future tasks, `recall(layer='procedural')` surfaces relevant skills
4. The agent sees "You previously created a skill for this type of task" in its context

### 5.4 File Changes Summary (Sprint 3)

| File | Change |
|---|---|
| `runtime/src/reflection.ts` | Enhanced prompt, auto-skill proposal hook |
| `kernel/src/SkillForge.ts` | Add `propose()`, `approve()`, `reject()` methods, `skill_proposals` table |
| `kernel/src/StateStore.ts` | Add `skill_proposals` table |
| `shared/src/protocol.ts` | Add proposal events |

---

## 6. Phase 4: Multi-Agent Skill Sharing (Sprint 4)

### Overview

Agents that learn skills should be able to share them with other agents. This enables collective intelligence — one agent's discovery benefits the entire fleet.

### 6.1 Skill Sharing via IPC

**New tool**: `share_skill`

```typescript
{
  name: 'share_skill',
  description: 'Share a skill you created with another agent or make it available to all agents.',
  parameters: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'The skill to share' },
      target: { type: 'string', enum: ['all', 'agent'], description: 'Share with all agents or a specific one' },
      agent_pid: { type: 'number', description: 'Target agent PID (if target=agent)' },
    },
    required: ['skill_id', 'target'],
  },
}
```

**Implementation**:
- `target: 'all'` → Move skill from agent's private scope to shared plugin registry
- `target: 'agent'` → Send skill content via IPC `send_message(pid, 'skill_share', skillContent)`

### 6.2 Collective Skill Library

Skills registered globally (shared by any agent) live in the plugin registry with `source: 'agent-created'` and `sharedBy: agentUid`. Other agents discover them through `discover_skills(source='local')`.

A reputation system tracks skill usage:
- Each time an agent uses a shared skill successfully, increment `usage_count`
- Reflection quality ratings for tasks using shared skills feed into `avg_quality`
- Low-quality skills (avg_quality < 2.0 after 5+ uses) are auto-flagged for review

### 6.3 Agent Spawning with Custom Skills

**New tool**: `spawn_agent`

```typescript
{
  name: 'spawn_agent',
  description: 'Create a child agent with a specific role, goal, and skill set.',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'Agent role (e.g. "researcher", "coder")' },
      goal: { type: 'string', description: 'The task for the child agent' },
      skills: { type: 'array', items: { type: 'string' }, description: 'Skill IDs to pre-load' },
      model: { type: 'string', description: 'LLM model override (optional)' },
    },
    required: ['role', 'goal'],
  },
}
```

**Implementation**: Calls `kernel.processManager.spawn()` with a config that includes pre-loaded skills. The child agent starts with those skills injected into its system prompt.

### 6.4 File Changes Summary (Sprint 4)

| File | Change |
|---|---|
| `runtime/src/tools.ts` | Add `share_skill`, `spawn_agent` tools |
| `kernel/src/SkillForge.ts` | Add sharing, reputation tracking, spawn-with-skills |
| `kernel/src/PluginRegistryManager.ts` | Add `source` and `sharedBy` fields, reputation columns |
| `kernel/src/ProcessManager.ts` | Support `skills` in spawn config |
| `shared/src/protocol.ts` | Add sharing events |

---

## 7. Safety & Guardrails

### 7.1 Permission Manifest (Required for All Agent-Created Skills)

Every SKILL.md generated by an agent must include:

```yaml
metadata:
  openclaw:
    permissions:
      version: 1
      declared_purpose: "What this skill does"
      filesystem:
        - "read:./data"        # Read from data directory
        - "write:./output"     # Write to output directory
      network:
        - "api.example.com"    # Allowed domains
      env:
        - "API_KEY"            # Required env vars
      exec:
        - "node"               # Allowed executables
      sensitive_data:
        credentials: false
```

### 7.2 Risk Scoring Algorithm

| Category | Score |
|---|---|
| No permissions declared | Minimal (0) |
| Read-only filesystem | Low (1) |
| Write filesystem | Moderate (2) |
| Network access | Moderate (2) |
| Shell execution | High (3) |
| Credentials access | High (3) |
| Multiple high-risk categories | Critical (4) |

Total risk = max(individual scores). Enforcement mode is per-agent via RBAC:

| RBAC Permission | Allowed Risk Level | Behavior Above Threshold |
|---|---|---|
| `self_modify: auto` | ≤ Moderate | Auto-approve; prompt for High+ |
| `self_modify: review` | ≤ Low | Queue all Moderate+ for human review |
| `self_modify: deny` | None | Block all skill creation |

### 7.3 Sandbox Testing

Before any agent-created skill is registered:
1. SkillForge spins up a Docker container (via ContainerManager)
2. Installs the skill in the container's skill directory
3. Runs the skill's test case (if provided)
4. Captures stdout/stderr and exit code
5. If test passes → register in main system
6. If test fails → return error to agent for refinement
7. Container is destroyed after testing (ephemeral)

### 7.4 Audit Trail

All self-modification actions are logged via `AuditLogger`:
- `skillforge.skill.created` — who created, what permissions, risk score
- `skillforge.skill.installed` — source, dependency check results
- `skillforge.skill.shared` — who shared, with whom
- `skillforge.skill.removed` — who removed, reason
- `skillforge.approval.requested` — skill pending human review
- `skillforge.approval.granted` / `skillforge.approval.denied`

### 7.5 Rollback

SkillForge versions every skill modification:
- `skill_versions` table: `(skill_id, version, content, created_at, created_by)`
- `rollback(skillId, version)` restores a previous version
- `removeSkill(skillId)` soft-deletes (sets `deleted_at`, retains history)

---

## 8. Implementation Order

### Sprint 1: Self-Modification Tools (Tasks 1–5)

| # | Task | File(s) | Est. Lines |
|---|---|---|---|
| 1 | Create `SkillForge.ts` skeleton — constructor, init, discover, install, create, compose, validate | `kernel/src/SkillForge.ts` | ~400 |
| 2 | Add SkillForge to kernel boot sequence | `kernel/src/Kernel.ts` | ~15 |
| 3 | Add 6 new tools to agent runtime | `runtime/src/tools.ts` | ~200 |
| 4 | Add SkillForge protocol types and events | `shared/src/protocol.ts` | ~60 |
| 5 | Add SkillForge constants | `shared/src/constants.ts` | ~20 |

### Sprint 2: Intelligent Discovery & Refinement (Tasks 6–9)

| # | Task | File(s) | Est. Lines |
|---|---|---|---|
| 6 | Add `skill_embeddings` table + embedding computation | `kernel/src/StateStore.ts`, `kernel/src/SkillForge.ts` | ~120 |
| 7 | Implement iterative refinement loop (Voyager pattern) | `kernel/src/SkillForge.ts` | ~100 |
| 8 | Add ClawHub HTTP client | `kernel/src/SkillForge.ts` | ~80 |
| 9 | Inject relevant skills into agent system prompt | `runtime/src/AgentLoop.ts` | ~40 |

### Sprint 3: Reflection Pipeline (Tasks 10–13)

| # | Task | File(s) | Est. Lines |
|---|---|---|---|
| 10 | Extend reflection prompt with skill suggestion | `runtime/src/reflection.ts` | ~40 |
| 11 | Add auto-proposal hook (reflection → SkillForge) | `runtime/src/reflection.ts` | ~60 |
| 12 | Add `skill_proposals` table + approve/reject | `kernel/src/SkillForge.ts`, `kernel/src/StateStore.ts` | ~100 |
| 13 | Wire procedural memory for created skills | `kernel/src/MemoryManager.ts` | ~30 |

### Sprint 4: Sharing & Spawning (Tasks 14–17)

| # | Task | File(s) | Est. Lines |
|---|---|---|---|
| 14 | Add `share_skill` tool + sharing logic | `runtime/src/tools.ts`, `kernel/src/SkillForge.ts` | ~80 |
| 15 | Add reputation tracking (usage count, avg quality) | `kernel/src/PluginRegistryManager.ts` | ~60 |
| 16 | Add `spawn_agent` tool with pre-loaded skills | `runtime/src/tools.ts`, `kernel/src/ProcessManager.ts` | ~80 |
| 17 | Update ARCHITECTURE.md, add SkillForge to docs | `docs/ARCHITECTURE.md` | ~60 |

**Total: ~1,545 lines across 4 sprints**

---

## 9. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Agents create malicious skills | High | Permission manifests + risk scoring + sandbox testing + approval gates |
| Skill library pollution (low-quality skills) | Medium | Self-verification loop + reputation tracking + auto-flag low-quality |
| Infinite skill creation loop | Medium | Rate limit: max 5 skills per agent per hour (configurable) |
| Prompt injection via skill instructions | High | Skill instructions are sanitized; content filter strips system-prompt overrides |
| Resource exhaustion from sandbox testing | Low | Container timeout (30s), max 1 concurrent test container per agent |
| ClawHub API rate limits | Low | Cache responses for 1 hour, exponential backoff on 429s |

---

## 10. Testing Strategy

### Unit Tests

- `SkillForge.test.ts` — SKILL.md generation, validation, risk scoring, versioning
- Permission manifest parsing and risk calculation
- Iterative refinement retry logic (mock LLM responses)

### Integration Tests

- End-to-end: agent calls `create_skill` → SkillForge validates → sandbox tests → registers → agent uses new skill
- Discovery: agent calls `discover_skills` → results include local + ClawHub + MCP
- Sharing: agent A creates skill → shares with agent B → agent B discovers and uses it

### Safety Tests

- Skill with `exec: ['rm']` gets Critical risk score → blocked by default
- Skill exceeding permission threshold triggers approval event
- Rollback restores previous skill version correctly
- Rate limiting blocks excessive skill creation

---

## Appendix: Data Flow

```
                    ┌─────────────────────────────┐
                    │       AGENT RUNTIME          │
                    │                              │
                    │  discover_skills ──┐         │
                    │  install_skill ────┤         │
                    │  create_skill ─────┤         │
                    │  compose_skills ───┤         │
                    │  share_skill ──────┤         │
                    │  spawn_agent ──────┤         │
                    │  update_profile ───┤         │
                    └───────────────────┼─────────┘
                                        │
                                        ▼
                    ┌─────────────────────────────┐
                    │      SKILLFORGE (#29)         │
                    │                              │
                    │  ┌──────────┐  ┌──────────┐  │
                    │  │ Validate │→ │ Risk     │  │
                    │  │ SKILL.md │  │ Score    │  │
                    │  └──────────┘  └────┬─────┘  │
                    │                     │        │
                    │          ┌──────────┼────┐   │
                    │          │   ≤ threshold │   │
                    │          ▼               ▼   │
                    │  ┌────────────┐  ┌─────────┐ │
                    │  │ Sandbox    │  │ Approval│ │
                    │  │ Test       │  │ Queue   │ │
                    │  └──────┬─────┘  └─────────┘ │
                    │         │ pass                │
                    │         ▼                     │
                    │  ┌────────────┐               │
                    │  │ Register   │               │
                    │  │ (OpenClaw) │               │
                    │  └──────┬─────┘               │
                    │         │                     │
                    │         ▼                     │
                    │  ┌────────────┐               │
                    │  │ Version    │               │
                    │  │ Store      │               │
                    │  └────────────┘               │
                    └─────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              PluginRegistry  StateStore  MemoryManager
              (registration)  (versions)  (procedural)
```
