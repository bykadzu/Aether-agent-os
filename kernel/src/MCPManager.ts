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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_CALL_TIMEOUT_MS = 30_000;
const MCP_MAX_RECONNECT_ATTEMPTS = 3;
const MCP_RECONNECT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MCPConnection {
  config: MCPServerConfig;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  tools: MCPToolInfo[];
  info: MCPServerInfo;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Result serialization
// ---------------------------------------------------------------------------

function serializeMCPResult(result: any): string {
  if (!result) return '';

  if (result.isError) {
    const errorText = (result.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    return `Error: ${errorText || 'Unknown MCP error'}`;
  }

  if (!Array.isArray(result.content)) {
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  return result.content
    .map((block: any) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'image':
          return `[Image: ${block.mimeType}, ${(block.data || '').length} bytes base64]`;
        case 'resource':
          return block.resource?.text || `[Resource: ${block.resource?.uri}]`;
        default:
          return '[Unknown content type]';
      }
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// MCPManager
// ---------------------------------------------------------------------------

export class MCPManager {
  private bus: EventBus;
  private state: StateStore;
  private connections: Map<string, MCPConnection> = new Map();

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    // Load persisted server configs and auto-connect
    const rows = this.state.getAllMCPServers();
    for (const row of rows) {
      try {
        const config: MCPServerConfig = JSON.parse(row.config);
        if (config.autoConnect && config.enabled) {
          try {
            await this.connect(config);
          } catch (err: any) {
            console.error(`[MCPManager] Auto-connect failed for ${config.name}: ${err.message}`);
          }
        }
      } catch {
        /* skip corrupted rows */
      }
    }
  }

  async shutdown(): Promise<void> {
    // Disconnect all servers
    const ids = [...this.connections.keys()];
    for (const id of ids) {
      try {
        await this.disconnect(id);
      } catch {
        /* best effort */
      }
    }
    this.connections.clear();
  }

  // -------------------------------------------------------------------------
  // Server config management
  // -------------------------------------------------------------------------

  addServer(config: MCPServerConfig): MCPServerInfo {
    const now = Date.now();

    // Persist
    this.state.insertMCPServer({
      id: config.id,
      name: config.name,
      transport: config.transport,
      config: JSON.stringify(config),
      enabled: config.enabled ? 1 : 0,
      auto_connect: config.autoConnect ? 1 : 0,
      created_at: now,
      updated_at: now,
    });

    const info: MCPServerInfo = {
      id: config.id,
      name: config.name,
      transport: config.transport,
      status: 'disconnected',
      toolCount: 0,
    };

    this.bus.emit('mcp.server.added', { server: info });
    return info;
  }

  removeServer(serverId: string): void {
    // Disconnect first if connected
    const conn = this.connections.get(serverId);
    if (conn) {
      this.disconnect(serverId).catch(() => {});
    }

    this.state.deleteMCPServer(serverId);
    this.bus.emit('mcp.server.removed', { serverId });
  }

  updateServer(serverId: string, updates: Partial<MCPServerConfig>): void {
    const row = this.state.getMCPServer(serverId);
    if (!row) throw new Error(`MCP server not found: ${serverId}`);

    const existing: MCPServerConfig = JSON.parse(row.config);
    const updated = { ...existing, ...updates, id: serverId };

    this.state.updateMCPServer({
      id: serverId,
      config: JSON.stringify(updated),
      enabled: updated.enabled ? 1 : 0,
      auto_connect: updated.autoConnect ? 1 : 0,
      updated_at: Date.now(),
    });
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  async connect(config: MCPServerConfig): Promise<MCPServerInfo> {
    // If already connected, disconnect first
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    const info: MCPServerInfo = {
      id: config.id,
      name: config.name,
      transport: config.transport,
      status: 'connecting',
      toolCount: 0,
    };

    // Create transport
    let transport: StdioClientTransport | SSEClientTransport;

    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error(`MCP stdio server ${config.name} missing "command" field`);
      }

      // Resolve environment variables
      const resolvedEnv: Record<string, string> = {};
      if (config.env) {
        for (const [key, val] of Object.entries(config.env)) {
          resolvedEnv[key] = val.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
        }
      }

      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...resolvedEnv } as Record<string, string>,
      });
    } else if (config.transport === 'sse') {
      if (!config.url) {
        throw new Error(`MCP SSE server ${config.name} missing "url" field`);
      }

      // Resolve headers
      const resolvedHeaders: Record<string, string> = {};
      if (config.headers) {
        for (const [key, val] of Object.entries(config.headers)) {
          resolvedHeaders[key] = val.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
        }
      }

      transport = new SSEClientTransport(new URL(config.url), {
        requestInit: {
          headers: resolvedHeaders,
        },
      } as any);
    } else {
      throw new Error(`Unsupported MCP transport: ${config.transport}`);
    }

    // Create client
    const client = new Client({ name: 'aether-kernel', version: '0.6.0' }, { capabilities: {} });

    try {
      await client.connect(transport);

      info.status = 'connected';
      info.connectedAt = Date.now();

      // Discover tools
      const toolsResult = await client.listTools();
      const tools: MCPToolInfo[] = (toolsResult.tools || []).map((t: any) => ({
        name: `mcp__${config.id}__${t.name}`,
        mcpName: t.name,
        serverId: config.id,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
      }));

      info.toolCount = tools.length;

      // Get server capabilities
      const serverCapabilities = (client as any).getServerCapabilities?.() || {};
      info.capabilities = {
        tools: !!serverCapabilities.tools,
        resources: !!serverCapabilities.resources,
        prompts: !!serverCapabilities.prompts,
      };

      const connection: MCPConnection = {
        config,
        client,
        transport,
        tools,
        info,
        reconnectAttempts: 0,
      };

      this.connections.set(config.id, connection);

      this.bus.emit('mcp.server.connected', { server: info });
      this.bus.emit('mcp.tools.discovered', { serverId: config.id, tools });

      console.log(
        `[MCPManager] Connected to ${config.name} (${config.transport}): ${tools.length} tools`,
      );

      return info;
    } catch (err: any) {
      info.status = 'error';
      info.lastError = err.message;
      this.bus.emit('mcp.server.error', { serverId: config.id, error: err.message });
      throw err;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    // Clear reconnect timer
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }

    try {
      await conn.client.close();
    } catch {
      /* best effort */
    }

    conn.info.status = 'disconnected';
    this.connections.delete(serverId);

    this.bus.emit('mcp.server.disconnected', { serverId });

    console.log(`[MCPManager] Disconnected from ${conn.config.name}`);
  }

  // -------------------------------------------------------------------------
  // Tool operations
  // -------------------------------------------------------------------------

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn) {
      throw new Error(`MCP server not connected: ${serverId}`);
    }
    if (conn.info.status !== 'connected') {
      throw new Error(`MCP server ${serverId} is ${conn.info.status}, cannot call tool`);
    }

    // Call with timeout
    const result = await Promise.race([
      conn.client.callTool({ name: toolName, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`MCP tool call timed out after ${MCP_CALL_TIMEOUT_MS}ms`)),
          MCP_CALL_TIMEOUT_MS,
        ),
      ),
    ]);

    return serializeMCPResult(result);
  }

  getTools(serverId?: string): MCPToolInfo[] {
    if (serverId) {
      const conn = this.connections.get(serverId);
      return conn ? conn.tools : [];
    }

    // Return tools from all connected servers
    const allTools: MCPToolInfo[] = [];
    for (const conn of this.connections.values()) {
      if (conn.info.status === 'connected') {
        allTools.push(...conn.tools);
      }
    }
    return allTools;
  }

  getServerInfo(serverId: string): MCPServerInfo | undefined {
    return this.connections.get(serverId)?.info;
  }

  getAllServers(): MCPServerInfo[] {
    // Combine connected + persisted-but-disconnected
    const serverMap = new Map<string, MCPServerInfo>();

    // Add persisted configs first (as disconnected)
    const rows = this.state.getAllMCPServers();
    for (const row of rows) {
      try {
        const config: MCPServerConfig = JSON.parse(row.config);
        serverMap.set(config.id, {
          id: config.id,
          name: config.name,
          transport: config.transport,
          status: 'disconnected',
          toolCount: 0,
        });
      } catch {
        /* skip */
      }
    }

    // Overlay connected servers
    for (const conn of this.connections.values()) {
      serverMap.set(conn.config.id, conn.info);
    }

    return Array.from(serverMap.values());
  }

  getServerConfig(serverId: string): MCPServerConfig | undefined {
    const row = this.state.getMCPServer(serverId);
    if (!row) return undefined;
    try {
      return JSON.parse(row.config);
    } catch {
      return undefined;
    }
  }

  isConnected(serverId: string): boolean {
    const conn = this.connections.get(serverId);
    return conn?.info.status === 'connected';
  }
}
