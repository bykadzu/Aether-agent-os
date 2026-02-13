/**
 * MCPManager Tests (v0.6)
 *
 * Tests for the MCP (Model Context Protocol) client subsystem.
 * Uses mocked @modelcontextprotocol/sdk Client to test:
 *   - Server config CRUD (add, remove, update, list)
 *   - Connection lifecycle (connect, disconnect)
 *   - Tool discovery
 *   - Tool invocation
 *   - Error handling
 *   - StateStore persistence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { MCPManager } from '../MCPManager.js';

// ---------------------------------------------------------------------------
// Mock the MCP SDK — must be before any import that transitively loads it
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
// Fixtures
// ---------------------------------------------------------------------------

function stdioConfig() {
  return {
    id: 'test-fs',
    name: 'Test Filesystem Server',
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    autoConnect: false,
    enabled: true,
  };
}

function sseConfig() {
  return {
    id: 'remote-db',
    name: 'Remote DB Server',
    transport: 'sse' as const,
    url: 'https://mcp.example.com/sse',
    headers: { Authorization: 'Bearer test-token' },
    autoConnect: false,
    enabled: true,
  };
}

const mockToolsResponse = {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPManager', () => {
  let bus: EventBus;
  let state: ReturnType<typeof createMockStateStore>;
  let mcp: MCPManager;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    state = createMockStateStore();
    mcp = new MCPManager(bus, state as any);

    // Default mock behavior
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue(mockToolsResponse);
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello from MCP' }],
    });
  });

  // -----------------------------------------------------------------------
  // Server config CRUD
  // -----------------------------------------------------------------------

  describe('addServer', () => {
    it('persists server config to StateStore', () => {
      const config = stdioConfig();
      const info = mcp.addServer(config);

      expect(state.insertMCPServer).toHaveBeenCalledOnce();
      expect(state.insertMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-fs',
          name: 'Test Filesystem Server',
          transport: 'stdio',
        }),
      );
      expect(info.id).toBe('test-fs');
      expect(info.status).toBe('disconnected');
    });

    it('emits mcp.server.added event', () => {
      const events: any[] = [];
      bus.on('mcp.server.added', (data: any) => events.push(data));

      mcp.addServer(stdioConfig());

      expect(events).toHaveLength(1);
      expect(events[0].server.id).toBe('test-fs');
    });
  });

  describe('removeServer', () => {
    it('deletes server from StateStore', () => {
      mcp.addServer(stdioConfig());
      mcp.removeServer('test-fs');

      expect(state.deleteMCPServer).toHaveBeenCalledWith('test-fs');
    });

    it('emits mcp.server.removed event', () => {
      const events: any[] = [];
      bus.on('mcp.server.removed', (data: any) => events.push(data));

      mcp.addServer(stdioConfig());
      mcp.removeServer('test-fs');

      expect(events).toHaveLength(1);
      expect(events[0].serverId).toBe('test-fs');
    });
  });

  describe('updateServer', () => {
    it('updates server config in StateStore', () => {
      const config = stdioConfig();
      state._servers.set(config.id, {
        id: config.id,
        config: JSON.stringify(config),
      });

      mcp.updateServer('test-fs', { name: 'Renamed Server' });

      expect(state.updateMCPServer).toHaveBeenCalledOnce();
      const call = state.updateMCPServer.mock.calls[0][0];
      const updatedConfig = JSON.parse(call.config);
      expect(updatedConfig.name).toBe('Renamed Server');
    });

    it('throws if server not found', () => {
      expect(() => mcp.updateServer('nonexistent', { name: 'X' })).toThrow('MCP server not found');
    });
  });

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  describe('connect', () => {
    it('connects to a stdio server and discovers tools', async () => {
      const config = stdioConfig();
      const info = await mcp.connect(config);

      expect(mockConnect).toHaveBeenCalledOnce();
      expect(mockListTools).toHaveBeenCalledOnce();
      expect(info.status).toBe('connected');
      expect(info.toolCount).toBe(2);
    });

    it('connects to an SSE server', async () => {
      const config = sseConfig();
      const info = await mcp.connect(config);

      expect(info.status).toBe('connected');
      expect(info.transport).toBe('sse');
    });

    it('emits mcp.server.connected and mcp.tools.discovered events', async () => {
      const connectedEvents: any[] = [];
      const toolEvents: any[] = [];
      bus.on('mcp.server.connected', (d: any) => connectedEvents.push(d));
      bus.on('mcp.tools.discovered', (d: any) => toolEvents.push(d));

      await mcp.connect(stdioConfig());

      expect(connectedEvents).toHaveLength(1);
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].tools).toHaveLength(2);
    });

    it('prefixes tool names with mcp__{serverId}__', async () => {
      await mcp.connect(stdioConfig());
      const tools = mcp.getTools('test-fs');

      expect(tools[0].name).toBe('mcp__test-fs__read_file');
      expect(tools[0].mcpName).toBe('read_file');
      expect(tools[1].name).toBe('mcp__test-fs__write_file');
    });

    it('throws on missing command for stdio', async () => {
      const config = { ...stdioConfig(), command: undefined };
      await expect(mcp.connect(config as any)).rejects.toThrow('missing "command" field');
    });

    it('throws on missing url for SSE', async () => {
      const config = { ...sseConfig(), url: undefined };
      await expect(mcp.connect(config as any)).rejects.toThrow('missing "url" field');
    });

    it('emits error event on connection failure', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const errors: any[] = [];
      bus.on('mcp.server.error', (d: any) => errors.push(d));

      await expect(mcp.connect(stdioConfig())).rejects.toThrow('Connection refused');
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe('Connection refused');
    });

    it('disconnects existing connection before reconnecting', async () => {
      await mcp.connect(stdioConfig());
      expect(mcp.isConnected('test-fs')).toBe(true);

      // Reconnect
      await mcp.connect(stdioConfig());
      expect(mockClose).toHaveBeenCalledOnce(); // disconnect was called
    });
  });

  describe('disconnect', () => {
    it('closes the client and removes from connections', async () => {
      await mcp.connect(stdioConfig());
      expect(mcp.isConnected('test-fs')).toBe(true);

      await mcp.disconnect('test-fs');
      expect(mockClose).toHaveBeenCalled();
      expect(mcp.isConnected('test-fs')).toBe(false);
    });

    it('emits mcp.server.disconnected event', async () => {
      const events: any[] = [];
      bus.on('mcp.server.disconnected', (d: any) => events.push(d));

      await mcp.connect(stdioConfig());
      await mcp.disconnect('test-fs');

      expect(events).toHaveLength(1);
      expect(events[0].serverId).toBe('test-fs');
    });

    it('is a no-op for unknown server', async () => {
      await mcp.disconnect('nonexistent'); // should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Tool operations
  // -----------------------------------------------------------------------

  describe('getTools', () => {
    it('returns tools for a specific server', async () => {
      await mcp.connect(stdioConfig());
      const tools = mcp.getTools('test-fs');

      expect(tools).toHaveLength(2);
      expect(tools[0].serverId).toBe('test-fs');
    });

    it('returns tools from all connected servers', async () => {
      // Connect two servers
      await mcp.connect(stdioConfig());
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'query', description: 'Run SQL query', inputSchema: {} }],
      });
      await mcp.connect(sseConfig());

      const allTools = mcp.getTools();
      expect(allTools.length).toBeGreaterThanOrEqual(3);
    });

    it('returns empty array for unknown server', () => {
      expect(mcp.getTools('nonexistent')).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('proxies a tool call to the MCP server', async () => {
      await mcp.connect(stdioConfig());

      const result = await mcp.callTool('test-fs', 'read_file', { path: '/tmp/test.txt' });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'read_file',
        arguments: { path: '/tmp/test.txt' },
      });
      expect(result).toBe('Hello from MCP');
    });

    it('serializes error results', async () => {
      mockCallTool.mockResolvedValueOnce({
        isError: true,
        content: [{ type: 'text', text: 'File not found' }],
      });

      await mcp.connect(stdioConfig());
      const result = await mcp.callTool('test-fs', 'read_file', { path: '/nope' });

      expect(result).toContain('Error: File not found');
    });

    it('throws if server is not connected', async () => {
      await expect(mcp.callTool('nonexistent', 'read_file', {})).rejects.toThrow(
        'MCP server not connected',
      );
    });

    it('times out after MCP_CALL_TIMEOUT_MS', async () => {
      mockCallTool.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 60_000)));

      await mcp.connect(stdioConfig());

      await expect(mcp.callTool('test-fs', 'read_file', { path: '/slow' })).rejects.toThrow(
        'timed out',
      );
    }, 35_000);
  });

  // -----------------------------------------------------------------------
  // getAllServers
  // -----------------------------------------------------------------------

  describe('getAllServers', () => {
    it('combines persisted and connected servers', async () => {
      // Add two servers to state
      state._servers.set('fs1', {
        id: 'fs1',
        config: JSON.stringify({ id: 'fs1', name: 'FS1', transport: 'stdio' }),
      });
      state._servers.set('fs2', {
        id: 'fs2',
        config: JSON.stringify({ id: 'fs2', name: 'FS2', transport: 'stdio' }),
      });

      // Connect one
      await mcp.connect({ ...stdioConfig(), id: 'fs1', name: 'FS1' });

      const servers = mcp.getAllServers();
      expect(servers).toHaveLength(2);

      const connected = servers.find((s) => s.id === 'fs1');
      const disconnected = servers.find((s) => s.id === 'fs2');
      expect(connected?.status).toBe('connected');
      expect(disconnected?.status).toBe('disconnected');
    });
  });

  // -----------------------------------------------------------------------
  // Init & Shutdown
  // -----------------------------------------------------------------------

  describe('init', () => {
    it('auto-connects servers marked with autoConnect', async () => {
      const config = { ...stdioConfig(), autoConnect: true };
      state._servers.set(config.id, {
        id: config.id,
        config: JSON.stringify(config),
      });

      await mcp.init();

      expect(mockConnect).toHaveBeenCalledOnce();
      expect(mcp.isConnected('test-fs')).toBe(true);
    });

    it('skips disabled servers', async () => {
      const config = { ...stdioConfig(), autoConnect: true, enabled: false };
      state._servers.set(config.id, {
        id: config.id,
        config: JSON.stringify(config),
      });

      await mcp.init();

      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('handles auto-connect failures gracefully', async () => {
      mockConnect.mockRejectedValue(new Error('fail'));
      const config = { ...stdioConfig(), autoConnect: true };
      state._servers.set(config.id, {
        id: config.id,
        config: JSON.stringify(config),
      });

      // Should not throw
      await mcp.init();
      expect(mcp.isConnected('test-fs')).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('disconnects all servers', async () => {
      await mcp.connect(stdioConfig());
      await mcp.connect(sseConfig());

      await mcp.shutdown();

      expect(mockClose).toHaveBeenCalledTimes(2);
      expect(mcp.getTools()).toEqual([]);
    });
  });
});
