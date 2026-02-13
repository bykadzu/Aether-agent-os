# Implementation Plan: MCP Protocol Support + OpenClaw Skill Adapter

> Date: 2026-02-13
> Status: Draft
> Authors: Architecture Team
> Depends on: Aether OS v0.5 (current)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Feature 1: MCP Protocol Support](#2-feature-1-mcp-protocol-support)
   - [Architecture Decision Records](#21-architecture-decision-records)
   - [Type Definitions](#22-type-definitions)
   - [File-by-File Implementation](#23-file-by-file-implementation)
   - [Agent Tool Integration](#24-agent-tool-integration)
   - [Configuration & Discovery](#25-configuration--discovery)
   - [Protocol & UI Commands](#26-protocol--ui-commands)
3. [Feature 2: OpenClaw Skill Adapter (Phase 1)](#3-feature-2-openclaw-skill-adapter-phase-1)
   - [Architecture Decision Records](#31-architecture-decision-records)
   - [Type Definitions](#32-type-definitions)
   - [File-by-File Implementation](#33-file-by-file-implementation)
   - [UI Component](#34-ui-component)
4. [Dependencies to Install](#4-dependencies-to-install)
5. [Implementation Order](#5-implementation-order)
6. [Risk Assessment](#6-risk-assessment)
7. [Testing Strategy](#7-testing-strategy)
8. [Appendix: MCP Protocol Reference](#8-appendix-mcp-protocol-reference)

---

## 1. Executive Summary

This plan covers two complementary features that extend Aether OS's tool and plugin ecosystem:

**MCP Protocol Support** adds a client subsystem to the kernel that connects to any MCP-compliant tool server. MCP (Model Context Protocol) is the industry standard backed by the Linux Foundation and adopted by OpenAI, Google, Microsoft, and Anthropic. Adding MCP client support means Aether OS agents get access to thousands of external tools (filesystem servers, database connectors, API bridges, etc.) without writing Aether-specific adapter code.

**OpenClaw Skill Adapter (Phase 1)** implements read-only import of OpenClaw SKILL.md files. OpenClaw (190k GitHub stars) has 3,000+ community skills on ClawHub. This adapter parses SKILL.md frontmatter and body, maps them to Aether's `PluginRegistryManifest` format, validates dependencies, and provides a UI for browsing and importing skills.

Both features follow the existing extension patterns documented in `docs/EXTENSION-GUIDE.md`: new kernel subsystem, shared protocol types, EventBus integration, StateStore persistence, and command/event handling in `Kernel.ts`.

---

## 2. Feature 1: MCP Protocol Support

### 2.1 Architecture Decision Records

**ADR-1: MCP Client, Not Server (for now)**

- **Decision**: Implement MCP *client* only. Aether OS will consume external MCP tool servers. We will NOT expose Aether's 32 built-in tools as an MCP server yet.
- **Rationale**: The immediate value is access to the MCP tool ecosystem (thousands of servers). Exposing Aether tools as an MCP server is lower priority because Aether agents already have direct access to those tools. Server mode can be added later as a separate subsystem.
- **Implication**: The `MCPManager` subsystem only needs client-side MCP protocol handling.

**ADR-2: Use the Official `@modelcontextprotocol/sdk` Package**

- **Decision**: Use Anthropic's official `@modelcontextprotocol/sdk` TypeScript SDK rather than implementing the MCP protocol from scratch.
- **Rationale**: The SDK handles JSON-RPC 2.0 framing, stdio/SSE transports, capability negotiation, and schema validation. Reimplementing this is ~2000 lines of protocol code with no upside. The SDK is MIT-licensed and maintained by the Linux Foundation MCP working group.
- **Implication**: Adds one npm dependency. The SDK is TypeScript-native and works in Node.js 18+.

**ADR-3: MCP Tools Are Mapped to ToolDefinition at Runtime**

- **Decision**: When an MCP server connects, its tools are discovered via `tools/list` and mapped to Aether's `ToolDefinition` interface on-the-fly. MCP tool calls are proxied through the MCP client. They appear alongside built-in tools in the agent's tool list.
- **Rationale**: This is the simplest integration path. The alternative (converting MCP tools to Aether plugins) would require generating `handler.js` files dynamically, which adds complexity without benefit. Since MCP tools already have schemas (JSON Schema `inputSchema`), they map directly to `TOOL_SCHEMAS`.
- **Implication**: MCP tools are transient -- they exist only while the MCP server connection is alive. They are not persisted to SQLite (the MCP server config is persisted, not the tool definitions).

**ADR-4: Per-Server Connection, Not Global Pool**

- **Decision**: Each MCP server connection is managed independently. An agent can access tools from multiple MCP servers simultaneously.
- **Rationale**: MCP servers have different lifecycle requirements (some are long-lived daemons, some are spawned per-session via stdio). Managing them individually keeps the failure domain isolated.
- **Implication**: The `MCPManager` maintains a `Map<serverId, MCPClientSession>` of active connections.

**ADR-5: Stdio and SSE Transport Support**

- **Decision**: Support both stdio (spawn a local process) and SSE (connect to HTTP endpoint) transports from day one.
- **Rationale**: Stdio is the most common transport for local MCP servers (filesystem, git, shell tools). SSE is used for remote/networked MCP servers. These are the two transports specified by the MCP standard. WebSocket transport is being developed in the MCP spec but not yet finalized.
- **Implication**: The `MCPServerConfig` type needs a `transport` discriminator field.

### 2.2 Type Definitions

These types will be added to `shared/src/protocol.ts`:

```typescript
// ---------------------------------------------------------------------------
// MCP Types (v0.6)
// ---------------------------------------------------------------------------

/** Transport type for connecting to an MCP server */
export type MCPTransportType = 'stdio' | 'sse';

/** Configuration for an MCP server connection */
export interface MCPServerConfig {
  /** Unique identifier for this server config */
  id: string;
  /** Human-readable name */
  name: string;
  /** Transport type */
  transport: MCPTransportType;
  /** For stdio: command to spawn (e.g. 'npx', 'python') */
  command?: string;
  /** For stdio: arguments to the command */
  args?: string[];
  /** For stdio: environment variables to set */
  env?: Record<string, string>;
  /** For SSE: HTTP endpoint URL */
  url?: string;
  /** For SSE: additional headers (e.g. auth tokens) */
  headers?: Record<string, string>;
  /** Whether to auto-connect on kernel boot */
  autoConnect: boolean;
  /** Whether this server is enabled */
  enabled: boolean;
  /** Optional: restrict which agents can use this server's tools */
  allowedAgentRoles?: string[];
  /** Tags for categorization */
  tags?: string[];
}

/** Runtime info about a connected MCP server */
export interface MCPServerInfo {
  id: string;
  name: string;
  transport: MCPTransportType;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** Server capabilities reported during initialization */
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  /** Number of tools currently available from this server */
  toolCount: number;
  /** Server version string */
  serverVersion?: string;
  /** Error message if status is 'error' */
  lastError?: string;
  /** Connection timestamp */
  connectedAt?: number;
}

/** An MCP tool as exposed to Aether agents */
export interface MCPToolInfo {
  /** Tool name (prefixed with server id: "mcp__{serverId}__{toolName}") */
  name: string;
  /** Original MCP tool name (without prefix) */
  mcpName: string;
  /** Server this tool belongs to */
  serverId: string;
  /** Tool description */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: Record<string, any>;
}
```

### 2.3 File-by-File Implementation

#### File: `kernel/src/MCPManager.ts` (NEW) -- Complexity: L

The core MCP client subsystem. This is the largest new file.

```typescript
/**
 * Aether Kernel - MCP Manager (v0.6)
 *
 * Manages connections to MCP (Model Context Protocol) tool servers.
 * Each MCP server exposes tools that agents can invoke. The MCPManager
 * handles:
 *   - Server lifecycle (connect, disconnect, reconnect)
 *   - Tool discovery (tools/list)
 *   - Tool invocation (tools/call) proxied from agent tool calls
 *   - Mapping MCP tool schemas to Aether ToolDefinition format
 *
 * Uses the official @modelcontextprotocol/sdk for protocol handling.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import type { MCPServerConfig, MCPServerInfo, MCPToolInfo } from '@aether/shared';

interface MCPConnection {
  config: MCPServerConfig;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  tools: MCPToolInfo[];
  info: MCPServerInfo;
}

export class MCPManager {
  private bus: EventBus;
  private state: StateStore;
  private connections: Map<string, MCPConnection> = new Map();

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  async init(): Promise<void> {
    // 1. Ensure the mcp_servers table exists in StateStore
    this.state.ensureMCPServersTable();

    // 2. Load persisted server configs
    const configs = this.state.getAllMCPServers();

    // 3. Auto-connect to servers marked with autoConnect: true
    for (const config of configs) {
      if (config.autoConnect && config.enabled) {
        try {
          await this.connect(config);
        } catch (err: any) {
          console.error(`[MCPManager] Auto-connect failed for ${config.name}: ${err.message}`);
        }
      }
    }
  }

  async connect(config: MCPServerConfig): Promise<MCPServerInfo> {
    // ... create transport, initialize client, discover tools
  }

  async disconnect(serverId: string): Promise<void> {
    // ... gracefully close transport, remove from connections map
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    // ... proxy tool call to MCP server via client.callTool()
  }

  getTools(serverId?: string): MCPToolInfo[] {
    // ... return tools from one or all connected servers
  }

  getAllServers(): MCPServerInfo[] {
    // ... return info for all configured servers
  }

  // ... additional methods for add/remove/update server config

  async shutdown(): Promise<void> {
    // ... disconnect all servers
  }
}
```

**Implementation details:**

1. **`connect(config)`**: Creates the appropriate transport based on `config.transport`:
   - **stdio**: `new StdioClientTransport({ command: config.command, args: config.args, env: config.env })`
   - **sse**: `new SSEClientTransport(new URL(config.url), { headers: config.headers })`

   Then creates a `Client` instance, calls `client.connect(transport)`, and discovers tools via `client.listTools()`. Each discovered tool is mapped to an `MCPToolInfo` with a namespaced name: `mcp__{serverId}__{toolName}`.

2. **`callTool(serverId, toolName, args)`**: Looks up the connection, calls `client.callTool({ name: toolName, arguments: args })`, and returns the result. MCP tool results are arrays of content blocks (text, image, resource). We serialize them to a string for the agent observation.

3. **`getTools(serverId?)`**: Returns the cached tool list. If `serverId` is provided, returns only that server's tools. Otherwise returns tools from all connected servers.

4. **Reconnection**: If a stdio transport exits unexpectedly, emit a `mcp.server.disconnected` event. A `reconnectInterval` timer (30s) attempts to re-establish connections. Max 3 reconnect attempts before marking the server as `error`.

5. **Tool name prefixing**: MCP tools are prefixed to avoid collisions with Aether's built-in tools and across servers. Format: `mcp__{serverId}__{toolName}`. The double-underscore delimiter is unambiguous because MCP tool names use single underscores. Example: `mcp__filesystem__read_file`.

---

#### File: `kernel/src/StateStore.ts` (MODIFY) -- Complexity: S

Add persistence for MCP server configurations.

**Changes:**

1. Add `CREATE TABLE` for `mcp_servers`:

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  config TEXT NOT NULL,       -- Full MCPServerConfig as JSON
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_connect INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

2. Add prepared statements:

```typescript
// In stmts type declaration:
insertMCPServer: Database.Statement;
getMCPServer: Database.Statement;
getAllMCPServers: Database.Statement;
updateMCPServer: Database.Statement;
deleteMCPServer: Database.Statement;
```

3. Add public methods:

```typescript
ensureMCPServersTable(): void;
insertMCPServer(server: { id: string; name: string; transport: string; config: string; enabled: number; auto_connect: number; created_at: number; updated_at: number }): void;
getMCPServer(id: string): any;
getAllMCPServers(): any[];
updateMCPServer(id: string, config: string, updated_at: number): void;
deleteMCPServer(id: string): void;
```

---

#### File: `kernel/src/Kernel.ts` (MODIFY) -- Complexity: M

Wire MCPManager into the kernel as the 27th subsystem.

**Changes:**

1. Import: `import { MCPManager } from './MCPManager.js';`
2. Add property: `readonly mcp: MCPManager;`
3. Constructor: `this.mcp = new MCPManager(this.bus, this.state);`
4. Boot: `await this.mcp.init();` (after ToolCompatLayer init, because MCPManager may reference imported tools)
5. Shutdown: `await this.mcp.shutdown();` (before ToolCompatLayer shutdown)
6. Add command handlers for `mcp.connect`, `mcp.disconnect`, `mcp.list`, `mcp.addServer`, `mcp.removeServer`, `mcp.listTools`, `mcp.callTool`
7. Update boot banner: add MCPManager to the right-side subsystem list

---

#### File: `shared/src/protocol.ts` (MODIFY) -- Complexity: M

Add MCP types (from section 2.2 above) and protocol commands/events.

**New commands** (add to `KernelCommand` union):

```typescript
// MCP commands (v0.6)
| { type: 'mcp.addServer'; id: string; config: MCPServerConfig }
| { type: 'mcp.removeServer'; id: string; serverId: string }
| { type: 'mcp.updateServer'; id: string; serverId: string; updates: Partial<MCPServerConfig> }
| { type: 'mcp.connect'; id: string; serverId: string }
| { type: 'mcp.disconnect'; id: string; serverId: string }
| { type: 'mcp.listServers'; id: string }
| { type: 'mcp.listTools'; id: string; serverId?: string }
| { type: 'mcp.callTool'; id: string; serverId: string; toolName: string; args: Record<string, any> }
```

**New events** (add to `KernelEventBase` union):

```typescript
// MCP events (v0.6)
| { type: 'mcp.server.added'; server: MCPServerInfo }
| { type: 'mcp.server.removed'; serverId: string }
| { type: 'mcp.server.connected'; server: MCPServerInfo }
| { type: 'mcp.server.disconnected'; serverId: string; reason?: string }
| { type: 'mcp.server.error'; serverId: string; error: string }
| { type: 'mcp.tools.discovered'; serverId: string; tools: MCPToolInfo[] }
| { type: 'mcp.servers.list'; servers: MCPServerInfo[] }
| { type: 'mcp.tools.list'; tools: MCPToolInfo[] }
```

---

### 2.4 Agent Tool Integration

#### File: `runtime/src/tools.ts` (MODIFY) -- Complexity: M

The key integration point. MCP tools need to appear in the agent's tool list alongside built-in tools.

**Changes to `getToolsForAgent()`:**

```typescript
export function getToolsForAgent(
  pid: PID,
  pluginManager?: PluginManager,
  mcpManager?: MCPManager,    // NEW parameter
): ToolDefinition[] {
  const baseTools = createToolSet();

  // ... existing plugin tool loading ...

  // MCP tools: create ToolDefinition wrappers for each MCP tool
  const mcpTools: ToolDefinition[] = [];
  if (mcpManager) {
    const allMCPTools = mcpManager.getTools();
    for (const mcpTool of allMCPTools) {
      mcpTools.push({
        name: mcpTool.name,  // e.g. "mcp__filesystem__read_file"
        description: `[MCP: ${mcpTool.serverId}] ${mcpTool.description}`,
        requiresApproval: false,
        execute: async (args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> => {
          try {
            const result = await mcpManager.callTool(
              mcpTool.serverId,
              mcpTool.mcpName,
              args,
            );
            // MCP results are content blocks; serialize to string
            const output = serializeMCPResult(result);
            return { success: true, output };
          } catch (err: any) {
            return { success: false, output: `MCP tool error: ${err.message}` };
          }
        },
      });
    }
  }

  return [...baseTools, ...pluginTools, ...mcpTools];
}
```

**Add `TOOL_SCHEMAS` entries for MCP tools dynamically:**

MCP tools already carry JSON Schema via `inputSchema`. The `getToolSchemasForAgent()` function (new) will merge `TOOL_SCHEMAS` with MCP tool schemas:

```typescript
export function getToolSchemasForAgent(
  pid: PID,
  mcpManager?: MCPManager,
): Record<string, { type: string; properties: Record<string, any>; required?: string[] }> {
  const schemas = { ...TOOL_SCHEMAS };

  if (mcpManager) {
    for (const mcpTool of mcpManager.getTools()) {
      schemas[mcpTool.name] = {
        type: 'object',
        properties: mcpTool.inputSchema?.properties || {},
        required: mcpTool.inputSchema?.required,
      };
    }
  }

  return schemas;
}
```

#### File: `runtime/src/AgentLoop.ts` (MODIFY) -- Complexity: S

Pass the `mcpManager` reference to `getToolsForAgent()` and `getToolSchemasForAgent()`.

**Changes:**

1. Where `getToolsForAgent(pid, pluginManager)` is called, change to `getToolsForAgent(pid, pluginManager, kernel.mcp)`.
2. Where `TOOL_SCHEMAS` is referenced for building the LLM tool list, use `getToolSchemasForAgent(pid, kernel.mcp)` instead.

---

### 2.5 Configuration & Discovery

#### Configuration File: `~/.aether/etc/mcp-servers.json`

For convenience, users can define MCP servers in a JSON file that the MCPManager loads on init (in addition to SQLite-persisted configs).

```json
{
  "servers": [
    {
      "id": "filesystem",
      "name": "Filesystem Server",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"],
      "autoConnect": true,
      "enabled": true
    },
    {
      "id": "github",
      "name": "GitHub Server",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" },
      "autoConnect": true,
      "enabled": true
    },
    {
      "id": "remote-db",
      "name": "Remote Database Server",
      "transport": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ${MCP_DB_TOKEN}" },
      "autoConnect": false,
      "enabled": true
    }
  ]
}
```

Environment variable interpolation (`${VAR_NAME}`) is resolved at connection time.

#### Auto-Discovery

The MCPManager will check for a `~/.aether/etc/mcp-servers.json` file at init. If found, any servers defined there that are not already in the SQLite table will be inserted. This allows users to version-control their MCP server configuration and have it auto-loaded.

---

### 2.6 Protocol & UI Commands

#### File: `server/src/routes/v1.ts` (MODIFY) -- Complexity: S

Add REST API endpoints:

```
GET    /api/v1/mcp/servers          -- List all MCP server configs + status
POST   /api/v1/mcp/servers          -- Add a new MCP server config
DELETE /api/v1/mcp/servers/:id      -- Remove an MCP server config
POST   /api/v1/mcp/servers/:id/connect    -- Connect to an MCP server
POST   /api/v1/mcp/servers/:id/disconnect -- Disconnect from an MCP server
GET    /api/v1/mcp/tools            -- List all available MCP tools
GET    /api/v1/mcp/tools/:serverId  -- List tools from a specific server
```

#### UI: `components/apps/SettingsApp.tsx` (MODIFY) -- Complexity: M

Add an "MCP Servers" tab in the Settings app, alongside existing Integrations, Webhooks, etc. This tab shows:

- List of configured MCP servers with connection status (green dot = connected, red = error, gray = disconnected)
- "Add Server" button that opens a modal with fields for name, transport type, command/url, env vars
- Connect/Disconnect toggle per server
- Expand a server to see its discovered tools

---

## 3. Feature 2: OpenClaw Skill Adapter (Phase 1)

### 3.1 Architecture Decision Records

**ADR-5: Read-Only Import (No Execution)**

- **Decision**: Phase 1 is read-only. We parse SKILL.md files and create `PluginRegistryManifest` entries from them. We do NOT execute OpenClaw skill scripts.
- **Rationale**: OpenClaw skills can contain arbitrary shell scripts. Executing them requires either Docker sandboxing or a trust model we have not designed yet. Importing the metadata and instructions (which get injected into the agent's system prompt) provides most of the value without the security risk. Script execution is Phase 2.
- **Implication**: The converted plugins will have tool definitions with descriptions (from SKILL.md body) but no `execute` handler. They serve as prompt-injected instructions for the agent.

**ADR-6: Parse SKILL.md Ourselves (No External YAML Parser)**

- **Decision**: Use the `gray-matter` npm package for YAML frontmatter extraction. This is a single-purpose, well-tested package (34M weekly downloads) that splits Markdown files into frontmatter (parsed as YAML) and body (raw Markdown string).
- **Rationale**: The existing `SkillManager` has a custom lightweight YAML parser, but OpenClaw frontmatter uses features it does not support (inline JSON in the `metadata` field, multi-line strings). `gray-matter` handles all YAML features correctly and is a standard Markdown-with-frontmatter parser.
- **Implication**: Adds one npm dependency (`gray-matter`). It has zero sub-dependencies.

**ADR-7: Map to PluginRegistryManifest, Not SkillDefinition**

- **Decision**: OpenClaw skills are mapped to `PluginRegistryManifest` (the plugin registry format), not `SkillDefinition` (the YAML skill format).
- **Rationale**: `PluginRegistryManifest` is the richer type -- it supports categories, icons, tools with parameter schemas, keywords, and settings. `SkillDefinition` is designed for step-based pipelines with input/output schemas, which does not match OpenClaw's model (OpenClaw skills are instruction sets, not execution pipelines). The plugin registry is also visible in the marketplace UI.
- **Implication**: Imported OpenClaw skills appear in the Plugin Registry Manager alongside native Aether plugins. They are tagged with `source: 'openclaw'` for filtering.

**ADR-8: Dependency Validation Is Best-Effort**

- **Decision**: When importing a skill with `metadata.openclaw.requires.bins` (required binaries like `convert`, `ffmpeg`, etc.), we check if the binary exists in the system PATH using `which` / `where`. If not found, we import the skill anyway but mark it with a warning. We do NOT block import.
- **Rationale**: The binary might exist inside a Docker container that the agent will use. Blocking import based on host-level binary detection would produce false negatives. The dependency check is informational, not a gate.
- **Implication**: The `OpenClawImportResult` type includes a `warnings: string[]` field.

### 3.2 Type Definitions

These types will be added to `shared/src/protocol.ts`:

```typescript
// ---------------------------------------------------------------------------
// OpenClaw Adapter Types (v0.6)
// ---------------------------------------------------------------------------

/** Parsed OpenClaw SKILL.md frontmatter */
export interface OpenClawSkillFrontmatter {
  name: string;
  description: string;
  'user-invocable'?: boolean;
  'disable-model-invocation'?: boolean;
  'command-dispatch'?: 'tool';
  'command-tool'?: string;
  'command-arg-mode'?: 'raw';
  metadata?: {
    openclaw?: {
      requires?: {
        bins?: string[];
        env?: string[];
        config?: string[];
      };
      os?: string[];
    };
  };
}

/** Result of importing an OpenClaw skill */
export interface OpenClawImportResult {
  /** The generated PluginRegistryManifest */
  manifest: PluginRegistryManifest;
  /** Original SKILL.md body (Markdown instructions) */
  instructions: string;
  /** Warnings (missing binaries, unsupported OS, etc.) */
  warnings: string[];
  /** Whether all dependencies are satisfied */
  dependenciesMet: boolean;
  /** Source path of the imported skill */
  sourcePath: string;
}

/** Batch import result */
export interface OpenClawBatchImportResult {
  imported: OpenClawImportResult[];
  failed: Array<{ path: string; error: string }>;
  totalScanned: number;
}
```

### 3.3 File-by-File Implementation

#### File: `kernel/src/OpenClawAdapter.ts` (NEW) -- Complexity: L

The core adapter that parses SKILL.md files and produces `PluginRegistryManifest` entries.

```typescript
/**
 * Aether Kernel - OpenClaw Skill Adapter (v0.6)
 *
 * Phase 1: Read-only import of OpenClaw SKILL.md files.
 *
 * OpenClaw skills are defined as Markdown files with YAML frontmatter:
 *   ---
 *   name: image-processor
 *   description: Processes images using ImageMagick
 *   metadata: {"openclaw": {"requires": {"bins": ["convert"]}}}
 *   ---
 *   # Image Processor
 *   Instructions for how the agent should use this skill...
 *
 * This adapter:
 *   1. Parses SKILL.md files (YAML frontmatter + Markdown body)
 *   2. Maps frontmatter to PluginRegistryManifest
 *   3. Validates dependencies (required bins, env vars, OS)
 *   4. Stores imported skills in the plugin registry
 *   5. Injects skill instructions into agent system prompts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import { PluginRegistryManager } from './PluginRegistryManager.js';
import type {
  PluginRegistryManifest,
  OpenClawSkillFrontmatter,
  OpenClawImportResult,
  OpenClawBatchImportResult,
} from '@aether/shared';

export class OpenClawAdapter {
  private bus: EventBus;
  private state: StateStore;
  private pluginRegistry: PluginRegistryManager;
  private importedSkills: Map<string, OpenClawImportResult> = new Map();

  constructor(bus: EventBus, state: StateStore, pluginRegistry: PluginRegistryManager) {
    this.bus = bus;
    this.state = state;
    this.pluginRegistry = pluginRegistry;
  }

  async init(): Promise<void> {
    this.state.ensureOpenClawImportsTable();
    // Load previously imported skill metadata from SQLite
    const rows = this.state.getAllOpenClawImports();
    for (const row of rows) {
      try {
        this.importedSkills.set(row.skill_id, JSON.parse(row.import_data));
      } catch { /* skip corrupted rows */ }
    }
  }

  /**
   * Import a single SKILL.md file.
   */
  async importSkill(skillMdPath: string): Promise<OpenClawImportResult> {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);
    const fm = frontmatter as OpenClawSkillFrontmatter;

    // Validate required fields
    if (!fm.name) {
      throw new Error(`SKILL.md missing required "name" field: ${skillMdPath}`);
    }

    // Check dependencies
    const warnings: string[] = [];
    let dependenciesMet = true;

    // Check required binaries
    if (fm.metadata?.openclaw?.requires?.bins) {
      for (const bin of fm.metadata.openclaw.requires.bins) {
        if (!this.isBinaryAvailable(bin)) {
          warnings.push(`Required binary not found in PATH: ${bin}`);
          dependenciesMet = false;
        }
      }
    }

    // Check required environment variables
    if (fm.metadata?.openclaw?.requires?.env) {
      for (const envVar of fm.metadata.openclaw.requires.env) {
        if (!process.env[envVar]) {
          warnings.push(`Required environment variable not set: ${envVar}`);
          dependenciesMet = false;
        }
      }
    }

    // Check OS compatibility
    if (fm.metadata?.openclaw?.os) {
      const currentOs = process.platform === 'win32' ? 'windows' :
                        process.platform === 'darwin' ? 'darwin' : 'linux';
      if (!fm.metadata.openclaw.os.includes(currentOs)) {
        warnings.push(`Skill requires OS: ${fm.metadata.openclaw.os.join(', ')} (current: ${currentOs})`);
      }
    }

    // Build PluginRegistryManifest
    const manifest: PluginRegistryManifest = {
      id: `openclaw-skill-${fm.name}`,
      name: fm.name,
      version: '1.0.0',
      author: 'OpenClaw Community',
      description: fm.description || `OpenClaw skill: ${fm.name}`,
      category: 'tools',
      icon: 'Plug',
      tools: this.extractTools(fm, body),
      keywords: ['openclaw', 'imported', ...(fm.metadata?.openclaw?.os || [])],
    };

    const result: OpenClawImportResult = {
      manifest,
      instructions: body.trim(),
      warnings,
      dependenciesMet,
      sourcePath: skillMdPath,
    };

    // Register in the plugin registry
    try {
      this.pluginRegistry.install(manifest, 'local', 'openclaw-importer');
    } catch (err: any) {
      // If already installed, update instead
      if (err.message?.includes('already')) {
        // Skip -- already imported
      } else {
        throw err;
      }
    }

    // Persist the import metadata
    this.importedSkills.set(manifest.id, result);
    this.state.upsertOpenClawImport({
      skill_id: manifest.id,
      name: fm.name,
      source_path: skillMdPath,
      instructions: body.trim(),
      warnings: JSON.stringify(warnings),
      dependencies_met: dependenciesMet ? 1 : 0,
      import_data: JSON.stringify(result),
      imported_at: Date.now(),
    });

    this.bus.emit('openclaw.skill.imported', {
      skillId: manifest.id,
      name: fm.name,
      warnings,
      dependenciesMet,
    });

    return result;
  }

  /**
   * Scan a directory for SKILL.md files and import all of them.
   * Follows OpenClaw convention: each skill is a subdirectory with SKILL.md.
   */
  async importDirectory(dirPath: string): Promise<OpenClawBatchImportResult> {
    const result: OpenClawBatchImportResult = {
      imported: [],
      failed: [],
      totalScanned: 0,
    };

    if (!fs.existsSync(dirPath)) {
      return result;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      result.totalScanned++;

      try {
        const imported = await this.importSkill(skillMdPath);
        result.imported.push(imported);
      } catch (err: any) {
        result.failed.push({ path: skillMdPath, error: err.message });
      }
    }

    this.bus.emit('openclaw.batch.imported', {
      imported: result.imported.length,
      failed: result.failed.length,
      totalScanned: result.totalScanned,
    });

    return result;
  }

  /**
   * Get the instructions (Markdown body) for an imported skill.
   * These are injected into the agent's system prompt when the skill is active.
   */
  getInstructions(skillId: string): string | undefined {
    return this.importedSkills.get(skillId)?.instructions;
  }

  /**
   * List all imported OpenClaw skills.
   */
  listImported(): OpenClawImportResult[] {
    return Array.from(this.importedSkills.values());
  }

  /**
   * Remove an imported skill.
   */
  removeImport(skillId: string): boolean {
    const existed = this.importedSkills.delete(skillId);
    if (existed) {
      this.state.deleteOpenClawImport(skillId);
      try {
        this.pluginRegistry.uninstall(skillId);
      } catch { /* ignore if already removed */ }
    }
    return existed;
  }

  shutdown(): void {
    this.importedSkills.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract tool definitions from the SKILL.md frontmatter and body.
   */
  private extractTools(
    fm: OpenClawSkillFrontmatter,
    body: string,
  ): PluginRegistryManifest['tools'] {
    const tools: PluginRegistryManifest['tools'] = [];

    if (fm['command-dispatch'] === 'tool' && fm['command-tool']) {
      // Skill defines a specific tool to dispatch to
      tools.push({
        name: fm['command-tool'],
        description: fm.description || `Execute the ${fm.name} skill`,
        parameters: {},
      });
    } else {
      // Skill is instruction-based (injected into prompt)
      // Create a virtual tool that represents "invoke this skill"
      tools.push({
        name: fm.name,
        description: fm.description || `Use the ${fm.name} skill`,
        parameters: {},
      });
    }

    return tools;
  }

  /**
   * Check if a binary is available in the system PATH.
   */
  private isBinaryAvailable(name: string): boolean {
    try {
      const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
      const { execSync } = require('node:child_process');
      execSync(cmd, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
```

---

#### File: `kernel/src/StateStore.ts` (MODIFY) -- Complexity: S

Add persistence for OpenClaw imports.

**Changes:**

1. Add `CREATE TABLE`:

```sql
CREATE TABLE IF NOT EXISTS openclaw_imports (
  skill_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  instructions TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  dependencies_met INTEGER NOT NULL DEFAULT 1,
  import_data TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);
```

2. Add prepared statements and public methods (same pattern as MCP servers above):

```typescript
ensureOpenClawImportsTable(): void;
upsertOpenClawImport(record: {...}): void;
getAllOpenClawImports(): any[];
getOpenClawImport(skillId: string): any;
deleteOpenClawImport(skillId: string): void;
```

---

#### File: `kernel/src/Kernel.ts` (MODIFY) -- Complexity: M

Wire OpenClawAdapter into the kernel as the 28th subsystem.

**Changes:**

1. Import: `import { OpenClawAdapter } from './OpenClawAdapter.js';`
2. Add property: `readonly openClaw: OpenClawAdapter;`
3. Constructor: `this.openClaw = new OpenClawAdapter(this.bus, this.state, this.pluginRegistry);`
4. Boot: `await this.openClaw.init();` (after PluginRegistryManager init)
5. Shutdown: `this.openClaw.shutdown();`
6. Add command handlers:
   - `openclaw.importSkill` -- import a single SKILL.md
   - `openclaw.importDirectory` -- batch import from a skills directory
   - `openclaw.listImported` -- list all imported OpenClaw skills
   - `openclaw.removeImport` -- remove an imported skill
   - `openclaw.getInstructions` -- get the Markdown instructions for a skill

---

#### File: `shared/src/protocol.ts` (MODIFY) -- Complexity: S

Add OpenClaw types (from section 3.2) and protocol commands/events.

**New commands:**

```typescript
// OpenClaw Adapter commands (v0.6)
| { type: 'openclaw.importSkill'; id: string; path: string }
| { type: 'openclaw.importDirectory'; id: string; dirPath: string }
| { type: 'openclaw.listImported'; id: string }
| { type: 'openclaw.removeImport'; id: string; skillId: string }
| { type: 'openclaw.getInstructions'; id: string; skillId: string }
```

**New events:**

```typescript
// OpenClaw Adapter events (v0.6)
| { type: 'openclaw.skill.imported'; skillId: string; name: string; warnings: string[]; dependenciesMet: boolean }
| { type: 'openclaw.batch.imported'; imported: number; failed: number; totalScanned: number }
| { type: 'openclaw.import.list'; imports: OpenClawImportResult[] }
| { type: 'openclaw.import.removed'; skillId: string }
```

---

### 3.4 UI Component

#### File: `components/apps/OpenClawImporter.tsx` (NEW) -- Complexity: M

A modal dialog or dedicated panel for importing OpenClaw skills. This can be accessed from:
- The Plugin Registry / App Store page (button: "Import from OpenClaw")
- The Settings app under a new "OpenClaw" tab

**Component structure:**

```
+--------------------------------------------------+
|  Import OpenClaw Skills                     [X]  |
+--------------------------------------------------+
|                                                   |
|  Path: [~/.openclaw/workspace/skills     ] [Scan] |
|                                                   |
|  Discovered Skills:                               |
|  +----------------------------------------------+ |
|  | [x] image-processor                          | |
|  |     Processes images using ImageMagick        | |
|  |     Deps: convert (found), ffmpeg (MISSING)   | |
|  +----------------------------------------------+ |
|  | [x] web-scraper                               | |
|  |     Scrapes web pages with Puppeteer           | |
|  |     Deps: all met                              | |
|  +----------------------------------------------+ |
|  | [ ] macos-calendar                            | |
|  |     macOS Calendar integration                 | |
|  |     Warning: Requires macOS (current: linux)   | |
|  +----------------------------------------------+ |
|                                                   |
|  [Import Selected (2)]              [Import All]  |
+--------------------------------------------------+
```

**Implementation:**

1. User enters a path (or uses a file picker if the OS supports it)
2. Clicking "Scan" sends `openclaw.importDirectory` with `dryRun: true` to list available skills without importing
3. Skills are displayed with their dependency status
4. User selects which skills to import
5. Clicking "Import Selected" sends individual `openclaw.importSkill` commands
6. Imported skills appear in the Plugin Registry with an "openclaw" badge

---

## 4. Dependencies to Install

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `@modelcontextprotocol/sdk` | `^1.x` | Official MCP TypeScript SDK (client, stdio/SSE transports) | ~150KB |
| `gray-matter` | `^4.x` | YAML frontmatter parser for Markdown files | ~25KB |

**Install command:**

```bash
npm install @modelcontextprotocol/sdk gray-matter
npm install -D @types/gray-matter    # if needed for types
```

Both packages are MIT-licensed with zero or minimal sub-dependencies.

---

## 5. Implementation Order

The work is organized into 4 sprints. Each sprint produces a testable, deployable increment.

### Sprint 1: MCP Foundation (3-4 days)

**Goal**: MCP server connections work. Tools are discovered. No agent integration yet.

| # | File | Task | Complexity | Est |
|---|------|------|------------|-----|
| 1 | `shared/src/protocol.ts` | Add MCP types and protocol commands/events | M | 2h |
| 2 | `kernel/src/StateStore.ts` | Add `mcp_servers` table, statements, methods | S | 1h |
| 3 | `kernel/src/MCPManager.ts` | Core subsystem: connect, disconnect, tool discovery | L | 8h |
| 4 | `kernel/src/Kernel.ts` | Wire MCPManager, add command handlers | M | 3h |
| 5 | `kernel/src/__tests__/MCPManager.test.ts` | Unit tests with mocked MCP SDK | M | 3h |

**Sprint 1 deliverable**: `mcp.addServer`, `mcp.connect`, `mcp.listTools` commands work via WebSocket.

### Sprint 2: MCP Agent Integration (2-3 days)

**Goal**: Agents can use MCP tools. Full end-to-end: add server, connect, agent calls MCP tool.

| # | File | Task | Complexity | Est |
|---|------|------|------------|-----|
| 6 | `runtime/src/tools.ts` | Add MCP tool wrapping in `getToolsForAgent()`, schema merging | M | 4h |
| 7 | `runtime/src/AgentLoop.ts` | Pass `kernel.mcp` to tool functions | S | 1h |
| 8 | `server/src/routes/v1.ts` | Add REST endpoints for MCP operations | S | 2h |
| 9 | `components/apps/SettingsApp.tsx` | Add MCP Servers tab to Settings UI | M | 4h |
| 10 | `kernel/src/__tests__/mcp-integration.test.ts` | Integration test: agent + MCP tool | M | 3h |

**Sprint 2 deliverable**: An agent can be spawned with MCP filesystem server tools and use them to read/write files through MCP.

### Sprint 3: OpenClaw Adapter (3-4 days)

**Goal**: Users can import OpenClaw SKILL.md files into Aether's plugin registry.

| # | File | Task | Complexity | Est |
|---|------|------|------------|-----|
| 11 | `shared/src/protocol.ts` | Add OpenClaw types and protocol commands/events | S | 1h |
| 12 | `kernel/src/StateStore.ts` | Add `openclaw_imports` table, statements, methods | S | 1h |
| 13 | `kernel/src/OpenClawAdapter.ts` | Core adapter: parse SKILL.md, map to manifest, validate deps | L | 6h |
| 14 | `kernel/src/Kernel.ts` | Wire OpenClawAdapter, add command handlers | M | 2h |
| 15 | `kernel/src/__tests__/OpenClawAdapter.test.ts` | Unit tests with sample SKILL.md fixtures | M | 3h |

**Sprint 3 deliverable**: `openclaw.importSkill` and `openclaw.importDirectory` work via WebSocket. Imported skills appear in the plugin registry.

### Sprint 4: OpenClaw UI + Polish (2-3 days)

**Goal**: UI for importing OpenClaw skills. Both features polished and documented.

| # | File | Task | Complexity | Est |
|---|------|------|------------|-----|
| 16 | `components/apps/OpenClawImporter.tsx` | Import dialog component | M | 4h |
| 17 | `server/src/routes/v1.ts` | Add REST endpoints for OpenClaw operations | S | 1h |
| 18 | `shared/src/constants.ts` | Add MCP-related constants (timeouts, retry counts) | S | 0.5h |
| 19 | `docs/ARCHITECTURE.md` | Update with new subsystems | S | 1h |
| 20 | End-to-end testing | Full flow: MCP + OpenClaw with real servers | L | 4h |

**Sprint 4 deliverable**: Complete MCP + OpenClaw feature set, documented and tested.

### Total Estimated Effort

| Feature | New Files | Modified Files | Est. Hours |
|---------|-----------|---------------|------------|
| MCP Protocol Support | 2 (+tests) | 5 | 28-34h |
| OpenClaw Skill Adapter | 2 (+tests) | 4 | 18-22h |
| **Total** | **4 (+tests)** | **7** (some overlap) | **46-56h** |

---

## 6. Risk Assessment

### High Risk

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **MCP SDK breaking changes** | MCP is pre-1.0 and the spec is evolving. SDK API may change between versions. | Medium | Pin to a specific SDK version. Add an abstraction layer between our `MCPManager` and the SDK so we can swap SDK versions without changing the subsystem API. Run CI tests against a known-good MCP server (the filesystem server). |
| **Stdio transport process management** | MCP stdio servers are child processes. If Aether crashes, zombie processes may remain. On Windows, `node-pty` behavior differs from Unix. | Medium | Use `child_process.spawn()` with `detached: false` and handle `SIGTERM`/`SIGKILL` on shutdown. Add a process reaper on kernel boot that checks for orphaned MCP server processes. Test on Windows explicitly. |
| **Agent tool list becomes too large** | With multiple MCP servers, an agent might have 100+ tools. LLMs degrade with too many tools. | Medium | Implement tool filtering: allow `AgentConfig.tools` to include/exclude MCP tools by server or by name pattern. Add a `maxToolsPerAgent` config (default: 50). Prioritize built-in tools, then MCP tools sorted by relevance to the agent's role. |

### Medium Risk

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **OpenClaw SKILL.md format changes** | OpenClaw is moving fast (190k stars, frequent releases). The SKILL.md frontmatter schema may evolve. | Medium | Our parser uses `gray-matter` which is format-agnostic. We access frontmatter fields with optional chaining. Unknown fields are ignored, not rejected. Pin our test fixtures to a specific OpenClaw version. |
| **MCP tool timeout/hang** | An MCP tool call could hang indefinitely if the server is unresponsive. | Low | Add a per-call timeout (default: 30s, configurable per server) to `callTool()`. If the timeout fires, return an error to the agent and optionally restart the connection. |
| **Gray-matter YAML parsing edge cases** | Some SKILL.md files may use YAML features that `gray-matter` handles differently than OpenClaw's parser. | Low | Test with a corpus of real ClawHub skills. The `metadata` field (which contains JSON) is the most likely edge case -- `gray-matter` parses it correctly as a YAML mapping, but if it is written as a JSON string, we need to `JSON.parse()` it. |

### Low Risk

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **MCP SSE transport behind proxy** | SSE connections may fail behind corporate proxies or load balancers that buffer responses. | Low | Document this as a known limitation. Recommend stdio transport for local servers. SSE is primarily for remote servers where the network path is controlled. |
| **Plugin ID collision** | An OpenClaw skill named `read_file` could collide with Aether's built-in `read_file` tool. | Low | Prefix all OpenClaw-imported plugin IDs with `openclaw-skill-`. The `extractTools()` method preserves the original tool name but it only matters for prompt injection (Phase 1 is read-only). |
| **Memory usage from many MCP connections** | Each stdio MCP server is a separate child process consuming memory. | Low | Document recommended limits (e.g., max 10 concurrent MCP servers). Add server count to the Prometheus metrics exporter. |

---

## 7. Testing Strategy

### Unit Tests

| Test File | What It Tests | Fixtures |
|-----------|--------------|----------|
| `kernel/src/__tests__/MCPManager.test.ts` | Connection lifecycle, tool discovery, tool invocation, reconnection, error handling | Mocked `@modelcontextprotocol/sdk` Client |
| `kernel/src/__tests__/OpenClawAdapter.test.ts` | SKILL.md parsing, frontmatter extraction, manifest mapping, dependency checking, batch import | Sample SKILL.md files in `__tests__/fixtures/openclaw/` |

### Integration Tests

| Test | Description |
|------|-------------|
| MCP end-to-end | Start a real MCP filesystem server via stdio, connect, list tools, call `read_file`, verify result. Requires `@modelcontextprotocol/server-filesystem` installed. |
| OpenClaw end-to-end | Point at a directory of real OpenClaw skills (downloaded from ClawHub), import all, verify they appear in the plugin registry with correct metadata. |
| Agent + MCP | Spawn an agent, connect an MCP server, verify the agent's tool list includes MCP tools, invoke one via the agent loop, verify the observation. |

### Test Fixtures

Create `kernel/src/__tests__/fixtures/openclaw/` with sample SKILL.md files:

```
fixtures/openclaw/
  image-processor/
    SKILL.md     # Has requires.bins: ["convert"]
  web-scraper/
    SKILL.md     # Has command-dispatch: tool
  macos-only/
    SKILL.md     # Has os: ["darwin"]
  minimal/
    SKILL.md     # Only name and description
```

---

## 8. Appendix: MCP Protocol Reference

### MCP Message Flow (Client-Side)

```
Aether (Client)                    MCP Server
     |                                  |
     |--- initialize ------------------>|
     |<-- initialize (capabilities) ----|
     |                                  |
     |--- initialized ----------------->|
     |                                  |
     |--- tools/list ------------------>|
     |<-- tools/list (tool[]) ----------|
     |                                  |
     |--- tools/call (name, args) ----->|
     |<-- tools/call (content[]) -------|
     |                                  |
     |--- [ping] ---------------------->|  (keepalive)
     |<-- [pong] -----------------------|
     |                                  |
     |--- close ----------------------->|
```

### MCP Tool Schema Mapping

| MCP Field | Aether Equivalent | Notes |
|-----------|------------------|-------|
| `name` | `ToolDefinition.name` | Prefixed with `mcp__{serverId}__` |
| `description` | `ToolDefinition.description` | Prefixed with `[MCP: serverId]` |
| `inputSchema` | `TOOL_SCHEMAS[name]` | Direct JSON Schema passthrough |
| `inputSchema.properties` | `TOOL_SCHEMAS[name].properties` | Exact mapping |
| `inputSchema.required` | `TOOL_SCHEMAS[name].required` | Exact mapping |

### MCP Result Serialization

MCP tool results are arrays of content blocks:

```typescript
interface MCPToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; text?: string } }
  >;
  isError?: boolean;
}
```

Our serialization for agent observations:

```typescript
function serializeMCPResult(result: MCPToolResult): string {
  if (result.isError) {
    const errorText = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    return `Error: ${errorText}`;
  }

  return result.content.map(block => {
    switch (block.type) {
      case 'text':
        return block.text;
      case 'image':
        return `[Image: ${block.mimeType}, ${block.data.length} bytes base64]`;
      case 'resource':
        return block.resource.text || `[Resource: ${block.resource.uri}]`;
      default:
        return '[Unknown content type]';
    }
  }).join('\n');
}
```

### OpenClaw SKILL.md Full Field Reference

| Frontmatter Field | Type | Required | Description |
|-------------------|------|----------|-------------|
| `name` | string | Yes | Skill identifier, doubles as slash command |
| `description` | string | No | When model should auto-trigger this skill |
| `user-invocable` | boolean | No | Expose as `/name` slash command (default: true) |
| `disable-model-invocation` | boolean | No | Prevent auto-invocation (default: false) |
| `command-dispatch` | `"tool"` | No | Bypass model, invoke tool directly |
| `command-tool` | string | No | Tool name for command dispatch |
| `command-arg-mode` | `"raw"` | No | Forward unprocessed arguments |
| `metadata` | object | No | Dependency gating (bins, env, os) |

---

*This plan is ready for implementation. Start with Sprint 1 (MCP Foundation) to establish the infrastructure, then proceed sequentially through Sprints 2-4.*
