# OpenClaw Integration Proposal for Aether OS

> Researched 2026-02-13. This document proposes how Aether OS can integrate with — or import agents from — OpenClaw, the fastest-growing open-source AI agent platform (190k GitHub stars, MIT license).

---

## 1. OpenClaw Overview

### What It Is

OpenClaw (formerly Clawdbot / Moltbot) is an open-source personal AI assistant that runs locally on your machine. It connects to messaging platforms (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams) and takes action on your behalf: shell commands, browser automation, email, calendar, and file operations.

- **Repository**: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) (190k stars, 32.3k forks)
- **License**: MIT
- **Runtime**: Node.js 22+, TypeScript (ESM)
- **Package Manager**: pnpm (bun optional)
- **Architecture**: Local-first Gateway as a single control plane over WebSocket (`ws://127.0.0.1:18789`)

### Architecture

```
Messaging Channels (WhatsApp, Telegram, Slack, Discord, Signal, etc.)
        |
+---------------------------+
| Gateway (control plane)   |
| ws://127.0.0.1:18789      |
+----+----------------------+
     |-- Agent Runtime (RPC, tool streaming, block streaming)
     |-- CLI
     |-- WebChat UI
     |-- macOS / iOS / Android apps
     |-- Extensions (Teams, Matrix, Zalo)
```

The Gateway routes inbound messages to isolated agents via **bindings** (channel + account + peer -> agentId). Each agent has:
- A dedicated **workspace** (files, identity docs, local notes)
- A **state directory** (`~/.openclaw/agents/<agentId>/agent`) for auth, config
- A **session store** (`~/.openclaw/agents/<agentId>/sessions`) for chat history
- Optionally, a **Docker sandbox** for tool execution

### Key Features

| Feature | Description |
|---------|-------------|
| Local-first | Memory and data stored as Markdown files on disk |
| Multi-channel | WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix |
| Skills (plugins) | 3,000+ community-built extensions on ClawHub |
| Multi-agent routing | Route channels/accounts/peers to isolated agent workspaces |
| Docker sandboxing | Tool execution in containers with configurable isolation |
| Browser control | Chrome/Chromium via CDP with snapshots and actions |
| Canvas + A2UI | Agent-driven visual workspace |
| Voice | Wake word + talk mode (macOS/iOS/Android) via ElevenLabs |
| Cron + webhooks | Scheduled and event-driven automation |
| Tailscale integration | Remote access via Serve/Funnel |

---

## 2. Agent Definition Format

OpenClaw agents are defined via a combination of **JSON5 configuration** and **Markdown workspace files**. There is no single YAML/JSON schema for an "agent definition" -- instead, agents emerge from the intersection of config + workspace files.

### Configuration (`openclaw.json`)

Agents are declared in the `agents.list` array:

```json5
{
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      model: "anthropic/claude-opus-4-6",
      sandbox: { mode: "non-main" },
      bootstrapMaxChars: 20000,
    },
    list: [
      {
        id: "home",
        default: true,
        workspace: "~/.openclaw/workspace-home",
        agentDir: "~/.openclaw/agents/home/agent",
        model: "anthropic/claude-sonnet-4-5",
      },
      {
        id: "work",
        workspace: "~/.openclaw/workspace-work",
        agentDir: "~/.openclaw/agents/work/agent",
        model: "anthropic/claude-opus-4-6",
        sandbox: { mode: "all", scope: "agent" },
        tools: {
          allow: ["exec", "read", "sessions_list"],
          deny: ["write", "browser", "canvas"],
        },
      },
    ],
  },
  bindings: [
    { agentId: "home", match: { channel: "whatsapp", accountId: "personal" } },
    { agentId: "work", match: { channel: "slack" } },
  ],
}
```

Per-agent configurable fields:
- `id` -- Unique agent identifier
- `workspace` -- Path to workspace directory
- `agentDir` -- Path to agent state directory (auth, sessions)
- `model` -- LLM model (e.g. `anthropic/claude-opus-4-6`, `openai/gpt-4o`)
- `sandbox` -- `{ mode: "off"|"non-main"|"all", scope: "session"|"agent"|"shared" }`
- `tools` -- `{ allow: [...], deny: [...] }` for tool-level access control
- `identity` -- `{ name: "Agent Name" }`
- `groupChat` -- `{ mentionPatterns: ["@name", "@alias"] }`

### Workspace Files

Each agent's workspace directory contains identity and behavioral files:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Operating instructions -- how the agent should behave, use memory, follow rules |
| `SOUL.md` | Persona, tone, and behavioral boundaries (the agent's "personality") |
| `USER.md` | User identity and addressing conventions |
| `IDENTITY.md` | Agent name, vibe, emoji (what users see) |
| `TOOLS.md` | Local tool notes and usage conventions (informational, not functional) |
| `HEARTBEAT.md` | Lightweight checklist for periodic/cron runs |
| `BOOT.md` | Startup checklist executed on gateway restart |
| `BOOTSTRAP.md` | One-time initialization ritual for new workspaces |
| `memory/YYYY-MM-DD.md` | Daily memory logs |
| `MEMORY.md` | Curated long-term memory |
| `skills/` | Workspace-specific skill overrides |
| `canvas/` | Canvas UI files for visual interfaces |

These Markdown files are injected into the system prompt at session start. The agent "wakes up knowing who it is."

### Key Design Philosophy

- **Files, not databases**: Everything is Markdown on disk. Version-controllable, diffable, human-editable.
- **Separation of soul and identity**: SOUL.md defines internal behavior; IDENTITY.md defines external presentation.
- **Cascade resolution**: Global defaults -> agent-level config -> workspace files -> session overrides. Most specific wins.

---

## 3. Multi-Agent Communication

### Note on "Town Square"

The "Town Square" pattern (all agents communicate in a shared broadcast channel) is **not an OpenClaw concept**. OpenClaw uses **isolated session routing** with explicit agent-to-agent messaging that must be opt-in enabled. The "Town Square" pattern is more associated with frameworks like AutoGen and CrewAI where agents share a group chat context.

### OpenClaw's Actual Pattern: Isolated Routing with Explicit A2A

**Agent-to-agent messaging is disabled by default.** Enable explicitly:

```json5
{
  tools: {
    agentToAgent: {
      enabled: true,
      allow: ["agent1", "agent2"],  // Allowlist of agents that can communicate
    },
  },
}
```

Communication tools available:
- `sessions_list` -- List available sessions
- `sessions_send` -- Send a message to another session
- `sessions_history` -- Read another session's history
- `sessions_spawn` -- Spawn a new session
- `session_status` -- Check session status

Each agent maintains **isolated session state** under its own directory. There is no shared context or broadcast channel by default. This is fundamentally different from Aether OS's IPC model where agents can freely `send_message` / `check_messages` by PID.

### Binding-Based Routing

Inbound messages from channels are deterministically routed to agents via bindings with this specificity hierarchy:

1. **Peer match** (exact DM/group/channel ID) -- highest priority
2. **Guild ID** (Discord servers)
3. **Team ID** (Slack workspaces)
4. **Account ID** match for channel
5. **Channel-level match** (`accountId: "*"`)
6. **Default agent** -- fallback

---

## 4. Tool / Skill Ecosystem

### Built-in Tools

OpenClaw ships with first-class tools for:

| Category | Tools |
|----------|-------|
| **Shell** | `exec` (run commands), `read`, `write`, `edit`, `apply_patch` |
| **Browser** | CDP-based Chrome control with snapshots, actions, file uploads |
| **Sessions** | `sessions_list`, `sessions_send`, `sessions_history`, `sessions_spawn` |
| **Nodes** | Camera snap/clip, screen record, location, system notifications (macOS) |
| **Automation** | Cron scheduling, webhook triggers |
| **Canvas** | Agent-driven visual workspace (A2UI) |

### Skill Format (ClawHub)

Skills are the plugin system. A skill is a folder with a `SKILL.md` file containing YAML frontmatter + Markdown instructions:

```
~/.openclaw/workspace/skills/<skill-name>/
  SKILL.md          # Required: config + instructions
  scripts/          # Optional: executable scripts (Python, Bash, etc.)
  references/       # Optional: supplementary docs
```

**SKILL.md structure:**

```markdown
---
name: image-processor
description: Processes and transforms images using ImageMagick
user-invocable: true
disable-model-invocation: false
command-dispatch: tool
command-tool: process_image
command-arg-mode: raw
metadata: {"openclaw": {"requires": {"bins": ["convert"]}, "os": ["darwin", "linux"]}}
---

# Image Processor

Instructions for how the agent should use this skill...

## Usage
When the user asks to process an image, use the `process_image` tool with...
```

**YAML Frontmatter fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier, doubles as slash command |
| `description` | string | Determines when the model auto-triggers this skill |
| `user-invocable` | boolean | Expose as `/name` slash command (default: true) |
| `disable-model-invocation` | boolean | Exclude from auto-invocation (default: false) |
| `command-dispatch` | `"tool"` | Bypass model, invoke tool directly |
| `command-tool` | string | Tool name for command dispatch |
| `command-arg-mode` | `"raw"` | Forward unprocessed arguments |
| `metadata` | object | Gating: required bins, env vars, config paths, OS restrictions |

**Skill loading precedence:**
1. Workspace skills (`<workspace>/skills/`) -- highest priority
2. Managed skills (`~/.openclaw/skills/`)
3. Bundled skills (shipped with install) -- lowest priority

Skills follow the **AgentSkills standard format** (an open standard developed by Anthropic). Skills are snapshotted at session start and reused for the session duration.

### Tool Security

Tool policies apply **before** sandbox rules. Tools can execute in three contexts:
- **Sandbox** (Docker containers) -- default for non-main sessions
- **Host** (Gateway process) -- direct execution
- **Nodes** (paired devices) -- remote execution on iOS/Android/macOS

Sandbox modes: `"off"`, `"non-main"` (default), `"all"`. Scope: `"session"` (default), `"agent"`, `"shared"`.

---

## 5. Integration Architecture

### Goal

Allow Aether OS to **import OpenClaw agent definitions** (workspace files + config) and **run OpenClaw-compatible skills** as Aether plugins, without requiring the OpenClaw Gateway.

### Approach: Adapter Layer

Rather than embedding the OpenClaw runtime, build a **translation layer** that maps OpenClaw concepts to Aether OS primitives:

```
+--------------------------------------------------+
|  Aether OS Kernel                                 |
|  +--------------------------------------------+  |
|  | OpenClaw Adapter                            |  |
|  |  - Parses openclaw.json agent definitions   |  |
|  |  - Converts SOUL.md/AGENTS.md to prompts    |  |
|  |  - Maps OpenClaw skills to Aether plugins   |  |
|  |  - Translates tool allow/deny to Aether     |  |
|  |    permission policies                       |  |
|  +--------------------------------------------+  |
|                                                   |
|  ProcessManager  |  VirtualFS  |  PluginManager   |
+--------------------------------------------------+
```

### Import Flow

```
1. User provides path to ~/.openclaw/ directory (or uploads a workspace zip)
2. Aether reads openclaw.json → extracts agents.list[]
3. For each agent:
   a. Read workspace files (AGENTS.md, SOUL.md, IDENTITY.md, etc.)
   b. Compose into Aether AgentConfig:
      - role: derived from IDENTITY.md name or agent id
      - goal: extracted from AGENTS.md primary directive
      - model: mapped from openclaw model string to Aether provider
      - tools: mapped from OpenClaw tool allow/deny lists
      - sandbox: mapped from OpenClaw sandbox config
   c. Inject SOUL.md + AGENTS.md content as system prompt prefix
   d. Import workspace skills/ as Aether plugins
4. Agent is now launchable from Aether's Mission Control
```

### Skill-to-Plugin Conversion

```typescript
// OpenClaw SKILL.md → Aether PluginRegistryManifest
function convertSkill(skillDir: string): PluginRegistryManifest {
  const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
  const { frontmatter, body } = parseYamlFrontmatter(skillMd);

  return {
    id: `openclaw-skill-${frontmatter.name}`,
    name: frontmatter.name,
    version: '1.0.0',
    author: 'OpenClaw Community',
    description: frontmatter.description,
    category: 'tools',
    icon: 'Plug',
    tools: [{
      name: frontmatter['command-tool'] || frontmatter.name,
      description: frontmatter.description,
      parameters: {},  // Extracted from body instructions
    }],
    keywords: ['openclaw', 'imported'],
  };
}
```

### Memory Migration

OpenClaw uses dated Markdown files (`memory/YYYY-MM-DD.md`) for daily memory. Aether OS uses a structured `MemoryRecord` system with layers (episodic, semantic, procedural, social).

**Migration strategy:**
- Parse each daily memory file
- Extract individual memory entries (typically separated by headers or bullet points)
- Map to Aether `MemoryRecord` with:
  - `layer: 'episodic'` (daily logs are episodic by nature)
  - `created_at`: derived from filename date
  - `tags`: extracted from content keywords
  - `importance`: default 0.5, adjustable by content analysis

---

## 6. Concept Mapping Table

| OpenClaw Concept | Aether OS Equivalent | Notes |
|------------------|---------------------|-------|
| Gateway | Kernel (WebSocket server) | Both are single control planes over WS |
| Agent (id + workspace) | Process (PID + AgentConfig) | OpenClaw agents are long-lived; Aether processes are task-scoped |
| `openclaw.json` | `AgentConfig` + Kernel config | OpenClaw centralizes config; Aether distributes across types |
| Workspace (`~/.openclaw/workspace`) | Virtual FS (`/home/agent_N/`) | OpenClaw uses real FS; Aether uses VirtualFS |
| `AGENTS.md` | System prompt / AgentConfig.goal | OpenClaw injects as prompt; Aether passes goal to LLM |
| `SOUL.md` | No direct equivalent | Would map to a "persona" prefix in system prompt |
| `IDENTITY.md` | AgentProfile.display_name | Aether has basic profiles; OpenClaw has richer identity |
| `memory/YYYY-MM-DD.md` | MemoryRecord (episodic layer) | Aether's is structured DB; OpenClaw's is flat files |
| `MEMORY.md` | MemoryRecord (semantic layer) | Curated long-term knowledge |
| Skill (SKILL.md) | Plugin (PluginRegistryManifest) | Similar concepts, different formats |
| ClawHub (skill marketplace) | Template Marketplace | Both are community content registries |
| Bindings (channel routing) | No equivalent | Aether doesn't route from messaging channels |
| `sessions_send` (A2A) | `send_message` / IPC | Aether's is PID-based; OpenClaw's is session-based |
| Docker sandbox | ContainerManager | Both support Docker isolation |
| Sandbox modes (off/non-main/all) | SandboxConfig.type | Aether has process/container/vm; OpenClaw has off/non-main/all |
| Tool allow/deny lists | PermissionPolicy | Aether has fine-grained RBAC; OpenClaw has per-agent lists |
| Cron + webhooks | CronJob + EventTrigger | Very similar scheduling primitives |
| Browser (CDP) | BrowserManager (Playwright) | Different driver; same concept |
| Canvas (A2UI) | Desktop apps / VNC | Aether uses full desktop; OpenClaw uses embedded canvas |
| Model routing | ModelRouter | Both support multi-model configurations |
| `agents.defaults.model` | `AgentConfig.model` | Same concept |
| Node.js 22+ runtime | Node.js runtime | Compatible tech stacks |
| pnpm monorepo | npm monorepo | Minor tooling difference |

---

## 7. Implementation Roadmap

### Phase 1: Read-Only Import (2-3 weeks)

**Goal**: Import OpenClaw agent definitions into Aether OS for viewing and manual launch.

- [ ] **OpenClaw config parser** -- Parse `openclaw.json` (JSON5) and extract agent definitions
- [ ] **Workspace file reader** -- Read and display AGENTS.md, SOUL.md, IDENTITY.md, USER.md
- [ ] **Agent config mapper** -- Convert OpenClaw agent entries to `AgentConfig` objects
- [ ] **Model string mapper** -- Map `anthropic/claude-opus-4-6` to Aether's provider format
- [ ] **Import UI** -- "Import from OpenClaw" button in Mission Control that accepts a workspace path
- [ ] **Prompt composition** -- Concatenate SOUL.md + AGENTS.md + USER.md into system prompt prefix

**Deliverable**: Users can point Aether at `~/.openclaw/` and see their OpenClaw agents as launchable templates.

### Phase 2: Skill Compatibility (2-3 weeks)

**Goal**: Run OpenClaw skills as Aether plugins.

- [ ] **SKILL.md parser** -- Parse YAML frontmatter + Markdown body from skill files
- [ ] **Skill-to-plugin converter** -- Map SKILL.md to `PluginRegistryManifest`
- [ ] **Script executor** -- Run skill scripts (`scripts/` directory) as tool implementations
- [ ] **Metadata gating** -- Respect `requires.bins`, `requires.env`, `os` restrictions
- [ ] **Skill discovery** -- Scan workspace, managed, and bundled skill directories
- [ ] **ClawHub browser** -- Optional: browse and install skills from ClawHub directly

**Deliverable**: OpenClaw skills appear in Aether's plugin registry and can be assigned to agents.

### Phase 3: Memory Migration (1-2 weeks)

**Goal**: Import OpenClaw memory files into Aether's structured memory system.

- [ ] **Daily memory parser** -- Parse `memory/YYYY-MM-DD.md` files into individual entries
- [ ] **Memory mapper** -- Convert to Aether `MemoryRecord` with appropriate layer/tags
- [ ] **MEMORY.md importer** -- Import curated long-term memory as semantic records
- [ ] **Bidirectional sync** (stretch) -- Write Aether memories back to OpenClaw format

**Deliverable**: Agents imported from OpenClaw retain their memory context.

### Phase 4: Runtime Compatibility (3-4 weeks)

**Goal**: Run OpenClaw-style agents natively with full feature parity.

- [ ] **Tool name mapping** -- Map OpenClaw tool names (`exec`, `read`, `write`, `edit`, `apply_patch`) to Aether equivalents (`run_command`, `read_file`, `write_file`)
- [ ] **Sandbox mode mapping** -- Translate OpenClaw sandbox config to Aether's ContainerManager
- [ ] **A2A bridge** -- Bridge OpenClaw's `sessions_send` to Aether's IPC `send_message`
- [ ] **Identity system** -- Implement SOUL.md / IDENTITY.md as agent persona configuration
- [ ] **Bootstrap flow** -- Support BOOTSTRAP.md and BOOT.md lifecycle hooks

**Deliverable**: Full OpenClaw agent compatibility -- import and run with zero modification.

### Phase 5: Bidirectional Export (2 weeks, optional)

**Goal**: Export Aether agents as OpenClaw-compatible workspaces.

- [ ] **Config exporter** -- Generate `openclaw.json` agent entries from Aether configs
- [ ] **Workspace generator** -- Create AGENTS.md, SOUL.md from Aether agent templates
- [ ] **Plugin-to-skill converter** -- Map Aether plugins back to SKILL.md format
- [ ] **Memory exporter** -- Write Aether memories to `memory/YYYY-MM-DD.md` format

**Deliverable**: Aether agents can be exported and run in OpenClaw.

---

## 8. Risks and Open Questions

### Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **OpenClaw's rapid evolution** -- The project is moving fast (9,553 commits, frequent releases). APIs and formats may change. | High | Pin to a specific OpenClaw version. Build adapter against stable release, not `main`. |
| **Skill script execution** -- OpenClaw skills can run arbitrary scripts (Python, Bash). This is a security surface. | High | Run imported skill scripts inside Aether's Docker sandbox only. Never on host. |
| **JSON5 parsing** -- OpenClaw uses JSON5 (comments, trailing commas). Node.js doesn't natively parse JSON5. | Low | Use the `json5` npm package. |
| **AgentSkills standard** -- Skills follow an Anthropic-defined standard. This standard may evolve. | Medium | Track the AgentSkills spec separately from OpenClaw. |
| **CDP vs Playwright** -- OpenClaw uses raw CDP for browser control; Aether uses Playwright. | Medium | Abstract browser interface. Both drive Chromium under the hood. |

### Architectural Questions

1. **Long-lived vs task-scoped agents** -- OpenClaw agents persist across sessions (they "wake up" each time). Aether agents are spawned for a task and exit. Should imported OpenClaw agents become persistent Aether processes, or be launched on-demand with their identity/memory loaded?

2. **Channel routing** -- OpenClaw's killer feature is channel routing (WhatsApp/Telegram/Slack). Aether has no messaging channel integration. Should Aether add channel adapters, or treat this as out of scope?

3. **Workspace vs VirtualFS** -- OpenClaw workspaces are real directories on the host filesystem. Aether agents operate in a VirtualFS. Imported agents would need their workspace files copied into VirtualFS, potentially losing the "edit SOUL.md with your text editor" workflow.

4. **Model provider strings** -- OpenClaw uses `provider/model` format (e.g. `anthropic/claude-opus-4-6`). Aether uses provider-specific config. Need a mapping layer.

5. **Security model gap** -- OpenClaw's tool allow/deny is per-agent. Aether has fine-grained RBAC with `PermissionPolicy`. The mapping is one-directional: OpenClaw -> Aether is easy, but Aether -> OpenClaw loses granularity.

### Strategic Questions

1. **Why integrate?** OpenClaw has 190k stars and 3,000+ skills. Tapping into that ecosystem gives Aether instant access to a massive plugin library and a large community. It's the "import your Chrome extensions" play.

2. **Competition risk** -- OpenClaw is a personal AI assistant. Aether OS is an AI agent operating system. They overlap in "AI agent that runs tools" but diverge in architecture (messaging-first vs desktop-first). Integration is complementary, not competitive.

3. **Community perception** -- Being "OpenClaw compatible" is a strong positioning statement in the current market. It signals that Aether is open, interoperable, and building on standards rather than reinventing them.

4. **Alternative targets** -- If OpenClaw compatibility proves too difficult, the same adapter architecture works for:
   - **OpenAI Assistants API** -- Already partially supported via `tools.import` (v0.5 Phase 4)
   - **LangChain agents** -- Already partially supported via `tools.import`
   - **CrewAI agent definitions** -- YAML-based, simpler to parse
   - **MCP (Model Context Protocol)** -- Anthropic's emerging standard for tool integration

---

## Appendix: Quick Reference

### OpenClaw CLI Commands

```bash
# Install
npm install -g openclaw@latest
openclaw onboard --install-daemon

# Agent management
openclaw agents add <agentId>
openclaw agents list --bindings

# Messaging
openclaw message send --session <key> "message"

# Skills
openclaw skills list
openclaw skills install <name>

# Debugging
openclaw doctor        # Check config health
openclaw sandbox explain  # Show effective sandbox config
```

### OpenClaw File Paths

```
~/.openclaw/
  openclaw.json          # Main configuration
  credentials/           # OAuth tokens, API keys
  workspace/             # Default workspace
  workspace-<agentId>/   # Per-agent workspaces
  agents/<id>/agent/     # Agent state directory
  agents/<id>/sessions/  # Session transcripts
  skills/                # Managed skills
  sandboxes/             # Sandbox workspace roots
```

### Aether OS Entry Points for Integration

```
shared/src/protocol.ts     # AgentConfig, PluginRegistryManifest, PermissionPolicy
runtime/src/tools.ts       # ToolDefinition, ToolContext, createToolSet()
runtime/src/templates.ts   # AgentTemplate (import target for OpenClaw agents)
kernel/src/PluginManager.ts  # Plugin loading (import target for OpenClaw skills)
```

---

*Sources:*
- [OpenClaw GitHub Repository](https://github.com/openclaw/openclaw)
- [OpenClaw Documentation - Agent Workspace](https://docs.openclaw.ai/concepts/agent-workspace)
- [OpenClaw Documentation - Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)
- [OpenClaw Documentation - Skills](https://docs.openclaw.ai/tools/skills)
- [OpenClaw Documentation - Sandboxing](https://docs.openclaw.ai/gateway/sandboxing)
- [OpenClaw Architecture Overview (Paolo Perazzo)](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [OpenClaw Identity Architecture (MMNTM)](https://www.mmntm.net/articles/openclaw-identity-architecture)
- [Milvus Blog - Complete Guide to OpenClaw](https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md)
- [Fortune - OpenClaw Security Concerns](https://fortune.com/2026/02/12/openclaw-ai-agents-security-risks-beware/)
