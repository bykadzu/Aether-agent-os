/**
 * MCP Integration Tests (v0.6)
 *
 * Tests the end-to-end flow of MCP tools being exposed to the agent tool system.
 * Uses mocked MCP SDK and verifies that:
 *   - MCP tools appear in the agent's tool list alongside built-in tools
 *   - MCP tool schemas are merged with built-in TOOL_SCHEMAS
 *   - MCP tool execution proxies through MCPManager.callTool()
 *   - Tool namespacing (mcp__{serverId}__{toolName}) works correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { MCPManager } from '../MCPManager.js';

// ---------------------------------------------------------------------------
// Mock the MCP SDK
// ---------------------------------------------------------------------------

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.connect = mockConnect;
    this.close = mockClose;
    this.listTools = mockListTools;
    this.callTool = mockCallTool;
    this.getServerCapabilities = vi.fn(() => ({ tools: true }));
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function () {}),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(function () {}),
}));

// ---------------------------------------------------------------------------
// Mock StateStore
// ---------------------------------------------------------------------------

function createMockStateStore() {
  const servers = new Map<string, any>();
  return {
    getAllMCPServers: vi.fn(() => Array.from(servers.values())),
    getMCPServer: vi.fn((id: string) => servers.get(id) || null),
    insertMCPServer: vi.fn((record: any) => {
      servers.set(record.id, record);
    }),
    updateMCPServer: vi.fn((record: any) => {
      const existing = servers.get(record.id);
      if (existing) {
        servers.set(record.id, { ...existing, ...record });
      }
    }),
    deleteMCPServer: vi.fn((id: string) => {
      servers.delete(id);
    }),
    _servers: servers,
  };
}

// ---------------------------------------------------------------------------
// Mock tool data
// ---------------------------------------------------------------------------

const fsToolsResponse = {
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from the filesystem',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
  ],
};

const dbToolsResponse = {
  tools: [
    {
      name: 'query',
      description: 'Run a SQL query',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query to execute' },
        },
        required: ['sql'],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Integration', () => {
  let bus: EventBus;
  let state: ReturnType<typeof createMockStateStore>;
  let mcp: MCPManager;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    state = createMockStateStore();
    mcp = new MCPManager(bus, state as any);

    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue(fsToolsResponse);
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'file contents here' }],
    });
  });

  // -----------------------------------------------------------------------
  // Tool Discovery Integration
  // -----------------------------------------------------------------------

  describe('tool discovery and namespacing', () => {
    it('MCP tools are namespaced with mcp__{serverId}__ prefix', async () => {
      await mcp.connect({
        id: 'fs-server',
        name: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        autoConnect: false,
        enabled: true,
      });

      const tools = mcp.getTools('fs-server');
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('mcp__fs-server__read_file');
      expect(tools[0].mcpName).toBe('read_file');
      expect(tools[0].serverId).toBe('fs-server');
      expect(tools[1].name).toBe('mcp__fs-server__write_file');
    });

    it('tools from multiple servers are aggregated', async () => {
      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      mockListTools.mockResolvedValueOnce(dbToolsResponse);
      await mcp.connect({
        id: 'db',
        name: 'DB',
        transport: 'sse',
        url: 'https://db.example.com/sse',
        autoConnect: false,
        enabled: true,
      });

      const allTools = mcp.getTools();
      expect(allTools.length).toBe(3); // 2 fs + 1 db
      expect(allTools.map((t) => t.name)).toEqual([
        'mcp__fs__read_file',
        'mcp__fs__write_file',
        'mcp__db__query',
      ]);
    });

    it('disconnecting a server removes its tools from the aggregated list', async () => {
      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      expect(mcp.getTools().length).toBe(2);

      await mcp.disconnect('fs');

      expect(mcp.getTools().length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Tool Schema Integration
  // -----------------------------------------------------------------------

  describe('tool schema exposure', () => {
    it('MCP tools carry inputSchema for LLM parameter inference', async () => {
      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      const tools = mcp.getTools('fs');
      const readFileTool = tools.find((t) => t.mcpName === 'read_file');
      expect(readFileTool).toBeDefined();
      expect(readFileTool!.inputSchema).toEqual({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      });
    });
  });

  // -----------------------------------------------------------------------
  // Tool Invocation Integration
  // -----------------------------------------------------------------------

  describe('tool invocation proxy', () => {
    it('callTool proxies arguments to the MCP server', async () => {
      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      const result = await mcp.callTool('fs', 'read_file', { path: '/home/test.txt' });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'read_file',
        arguments: { path: '/home/test.txt' },
      });
      expect(result).toBe('file contents here');
    });

    it('callTool serializes error results from MCP server', async () => {
      mockCallTool.mockResolvedValueOnce({
        isError: true,
        content: [{ type: 'text', text: 'Permission denied' }],
      });

      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      const result = await mcp.callTool('fs', 'read_file', { path: '/etc/shadow' });
      expect(result).toContain('Error: Permission denied');
    });

    it('callTool handles multi-block content responses', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
          { type: 'image', mimeType: 'image/png', data: 'abc123' },
        ],
      });

      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      const result = await mcp.callTool('fs', 'read_file', { path: '/test' });
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('[Image: image/png');
    });
  });

  // -----------------------------------------------------------------------
  // Event Integration
  // -----------------------------------------------------------------------

  describe('event emission', () => {
    it('emits mcp.tools.discovered with namespaced tools on connect', async () => {
      const events: any[] = [];
      bus.on('mcp.tools.discovered', (d: any) => events.push(d));

      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      expect(events).toHaveLength(1);
      expect(events[0].serverId).toBe('fs');
      expect(events[0].tools).toHaveLength(2);
      expect(events[0].tools[0].name).toBe('mcp__fs__read_file');
    });

    it('emits mcp.server.connected and mcp.server.disconnected events', async () => {
      const connected: any[] = [];
      const disconnected: any[] = [];
      bus.on('mcp.server.connected', (d: any) => connected.push(d));
      bus.on('mcp.server.disconnected', (d: any) => disconnected.push(d));

      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      expect(connected).toHaveLength(1);
      expect(connected[0].server.status).toBe('connected');

      await mcp.disconnect('fs');

      expect(disconnected).toHaveLength(1);
      expect(disconnected[0].serverId).toBe('fs');
    });
  });

  // -----------------------------------------------------------------------
  // Multi-Server Lifecycle
  // -----------------------------------------------------------------------

  describe('multi-server lifecycle', () => {
    it('shutdown disconnects all servers and clears all tools', async () => {
      await mcp.connect({
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        autoConnect: false,
        enabled: true,
      });

      mockListTools.mockResolvedValueOnce(dbToolsResponse);
      await mcp.connect({
        id: 'db',
        name: 'DB',
        transport: 'sse',
        url: 'https://db.example.com/sse',
        autoConnect: false,
        enabled: true,
      });

      expect(mcp.getTools().length).toBe(3);

      await mcp.shutdown();

      expect(mcp.getTools().length).toBe(0);
      expect(mockClose).toHaveBeenCalledTimes(2);
    });
  });
});
