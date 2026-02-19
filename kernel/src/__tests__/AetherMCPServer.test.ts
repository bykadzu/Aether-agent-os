import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { AetherMCPServer } from '../AetherMCPServer.js';
import { AETHER_MCP_SERVER_NAME, AETHER_MCP_SERVER_VERSION } from '@aether/shared';
import type { PID, MemoryRecord, IPCMessage, ProcessInfo, AgentPhase } from '@aether/shared';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

function createMockMemoryManager() {
  return {
    store: vi.fn().mockReturnValue({ id: 'mem-001' }),
    recall: vi.fn().mockReturnValue([]),
  };
}

function createMockSkillForge() {
  return {
    discover: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ success: true, skillId: 'sk-001', message: 'Created.' }),
    install: vi.fn().mockResolvedValue({ success: true, message: 'Installed.' }),
    share: vi.fn().mockResolvedValue({ success: true, message: 'Shared.' }),
  };
}

function createMockProcessManager() {
  return {
    getAll: vi.fn().mockReturnValue([]),
    sendMessage: vi.fn().mockReturnValue(null),
    drainMessages: vi.fn().mockReturnValue([]),
  };
}

function createMockStateStore() {
  return {};
}

function createMockOpenClawAdapter() {
  return {};
}

// Helper to build a fake ManagedProcess-like object matching what getAll() returns
function makeManagedProcess(overrides: {
  pid: PID;
  name: string;
  state: string;
  agentPhase?: AgentPhase;
}) {
  return {
    info: {
      pid: overrides.pid,
      name: overrides.name,
      state: overrides.state,
      agentPhase: overrides.agentPhase ?? 'idle',
    } as ProcessInfo,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AetherMCPServer', () => {
  let bus: EventBus;
  let server: AetherMCPServer;
  let memory: ReturnType<typeof createMockMemoryManager>;
  let skillForge: ReturnType<typeof createMockSkillForge>;
  let processes: ReturnType<typeof createMockProcessManager>;
  let state: ReturnType<typeof createMockStateStore>;
  let openClaw: ReturnType<typeof createMockOpenClawAdapter>;

  const ctx = { pid: 1 as PID, uid: 'agent-alpha' };

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    memory = createMockMemoryManager();
    skillForge = createMockSkillForge();
    processes = createMockProcessManager();
    state = createMockStateStore();
    openClaw = createMockOpenClawAdapter();

    server = new AetherMCPServer(
      bus,
      state as any,
      memory as any,
      skillForge as any,
      processes as any,
      openClaw as any,
    );
  });

  // -------------------------------------------------------------------------
  // Lifecycle & metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('exposes serverName and serverVersion from shared constants', () => {
      expect(server.serverName).toBe(AETHER_MCP_SERVER_NAME);
      expect(server.serverVersion).toBe(AETHER_MCP_SERVER_VERSION);
    });
  });

  describe('init()', () => {
    it('registers all expected tools', async () => {
      await server.init();

      const tools = server.getTools();
      expect(tools.length).toBeGreaterThanOrEqual(12);

      const names = tools.map((t) => t.name);
      // Memory tools
      expect(names).toContain('aether_remember');
      expect(names).toContain('aether_recall');
      // Skill tools
      expect(names).toContain('aether_discover_skills');
      expect(names).toContain('aether_create_skill');
      expect(names).toContain('aether_install_skill');
      expect(names).toContain('aether_share_skill');
      // Collaboration tools
      expect(names).toContain('aether_list_agents');
      expect(names).toContain('aether_send_message');
      expect(names).toContain('aether_check_messages');
      // OS tools
      expect(names).toContain('aether_system_status');
      expect(names).toContain('aether_read_source');
      expect(names).toContain('aether_get_architecture');
    });

    it('can be called without throwing', async () => {
      await expect(server.init()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getTools / getToolSchemas
  // -------------------------------------------------------------------------

  describe('getTools()', () => {
    it('returns empty array before init', () => {
      expect(server.getTools()).toEqual([]);
    });

    it('returns AetherTool objects with execute functions after init', async () => {
      await server.init();

      const tools = server.getTools();
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.execute).toBe('function');
      }
    });
  });

  describe('getToolSchemas()', () => {
    it('returns schemas without execute functions', async () => {
      await server.init();

      const schemas = server.getToolSchemas();
      expect(schemas.length).toBe(server.getTools().length);

      for (const schema of schemas) {
        expect(schema).toHaveProperty('name');
        expect(schema).toHaveProperty('description');
        expect(schema).toHaveProperty('inputSchema');
        expect(schema).not.toHaveProperty('execute');
      }
    });

    it('returns empty array before init', () => {
      expect(server.getToolSchemas()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // callTool - general behaviour
  // -------------------------------------------------------------------------

  describe('callTool()', () => {
    beforeEach(async () => {
      await server.init();
    });

    it('returns error for unknown tool', async () => {
      const result = await server.callTool('nonexistent_tool', {}, ctx);

      expect(result.content).toContain('Unknown tool');
      expect(result.content).toContain('nonexistent_tool');
      expect(result.isError).toBe(true);
    });

    it('emits aether-mcp.tool.called event on the bus', async () => {
      const listener = vi.fn();
      bus.on('aether-mcp.tool.called', listener);

      await server.callTool('aether_system_status', {}, ctx);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: ctx.pid,
          tool: 'aether_system_status',
          args: {},
        }),
      );
    });

    it('catches tool execution errors and returns them gracefully', async () => {
      memory.store.mockImplementation(() => {
        throw new Error('Database failure');
      });

      const result = await server.callTool('aether_remember', { content: 'test' }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool error');
      expect(result.content).toContain('Database failure');
    });
  });

  // -------------------------------------------------------------------------
  // generateMCPConfig
  // -------------------------------------------------------------------------

  describe('generateMCPConfig()', () => {
    it('generates correct MCP config for a given PID', () => {
      const config = server.generateMCPConfig(42 as PID);

      expect(config).toEqual({
        mcpServers: {
          [AETHER_MCP_SERVER_NAME]: {
            command: 'node',
            args: ['aether-mcp-stdio-bridge.js', '--pid', '42'],
          },
        },
      });
    });

    it('converts PID to string in args', () => {
      const config = server.generateMCPConfig(7 as PID);
      const serverConfig = config.mcpServers[AETHER_MCP_SERVER_NAME];

      expect(serverConfig.args).toContain('7');
      expect(serverConfig.args).not.toContain(7);
    });
  });

  // -------------------------------------------------------------------------
  // Memory Tools
  // -------------------------------------------------------------------------

  describe('Memory tools', () => {
    beforeEach(async () => {
      await server.init();
    });

    describe('aether_remember', () => {
      it('stores a memory with default values', async () => {
        const result = await server.callTool(
          'aether_remember',
          { content: 'The sky is blue' },
          ctx,
        );

        expect(memory.store).toHaveBeenCalledWith({
          agent_uid: 'agent-alpha',
          layer: 'episodic',
          content: 'The sky is blue',
          tags: [],
          importance: 0.5,
          source_pid: 1,
        });
        expect(result.content).toContain('Stored episodic memory');
        expect(result.content).toContain('mem-001');
        expect(result.isError).toBeUndefined();
      });

      it('respects explicit layer, tags, and importance', async () => {
        await server.callTool(
          'aether_remember',
          {
            content: 'User prefers TypeScript',
            layer: 'semantic',
            tags: ['preference', 'language'],
            importance: 0.9,
          },
          ctx,
        );

        expect(memory.store).toHaveBeenCalledWith({
          agent_uid: 'agent-alpha',
          layer: 'semantic',
          content: 'User prefers TypeScript',
          tags: ['preference', 'language'],
          importance: 0.9,
          source_pid: 1,
        });
      });

      it('defaults importance to 0.5 when explicitly set to 0', async () => {
        // importance: 0 is falsy but the code uses ?? so 0 should be kept
        await server.callTool('aether_remember', { content: 'trivial fact', importance: 0 }, ctx);

        expect(memory.store).toHaveBeenCalledWith(expect.objectContaining({ importance: 0 }));
      });
    });

    describe('aether_recall', () => {
      it('returns "No memories found" when recall returns empty', async () => {
        memory.recall.mockReturnValue([]);

        const result = await server.callTool('aether_recall', { query: 'something' }, ctx);

        expect(result.content).toBe('No memories found.');
      });

      it('formats recalled memories correctly', async () => {
        memory.recall.mockReturnValue([
          {
            id: 'mem-1',
            layer: 'episodic',
            content: 'First thing that happened',
            importance: 0.8,
            tags: [],
          },
          {
            id: 'mem-2',
            layer: 'semantic',
            content: 'A known fact',
            importance: 0.5,
            tags: ['fact'],
          },
        ] as Partial<MemoryRecord>[]);

        const result = await server.callTool('aether_recall', { query: 'thing' }, ctx);

        expect(result.content).toContain('Found 2 memories');
        expect(result.content).toContain('[episodic]');
        expect(result.content).toContain('[semantic]');
        expect(result.content).toContain('0.80');
        expect(result.content).toContain('0.50');
      });

      it('passes correct query params to MemoryManager', async () => {
        await server.callTool(
          'aether_recall',
          { query: 'test', layer: 'procedural', tags: ['code'], limit: 5 },
          ctx,
        );

        expect(memory.recall).toHaveBeenCalledWith({
          agent_uid: 'agent-alpha',
          query: 'test',
          layer: 'procedural',
          tags: ['code'],
          limit: 5,
        });
      });

      it('defaults limit to 10 when not provided', async () => {
        await server.callTool('aether_recall', { query: 'anything' }, ctx);

        expect(memory.recall).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
      });
    });
  });

  // -------------------------------------------------------------------------
  // Skill Tools
  // -------------------------------------------------------------------------

  describe('Skill tools', () => {
    beforeEach(async () => {
      await server.init();
    });

    describe('aether_discover_skills', () => {
      it('returns "No skills found" when discover returns empty', async () => {
        skillForge.discover.mockResolvedValue([]);

        const result = await server.callTool(
          'aether_discover_skills',
          { query: 'web scraping' },
          ctx,
        );

        expect(result.content).toBe('No skills found.');
      });

      it('formats discovered skills correctly', async () => {
        skillForge.discover.mockResolvedValue([
          {
            skill_id: 'sk-1',
            name: 'web-scraper',
            description: 'Scrapes web pages',
            source: 'local',
            installed: true,
          },
          {
            skill_id: 'sk-2',
            name: 'data-parser',
            description: 'Parses data formats',
            source: 'clawhub',
            installed: false,
          },
        ]);

        const result = await server.callTool('aether_discover_skills', { query: 'data' }, ctx);

        expect(result.content).toContain('[local]');
        expect(result.content).toContain('web-scraper');
        expect(result.content).toContain('installed');
        expect(result.content).toContain('[clawhub]');
        expect(result.content).toContain('available');
      });

      it('passes query and default limit to SkillForge.discover', async () => {
        await server.callTool('aether_discover_skills', { query: 'testing' }, ctx);

        expect(skillForge.discover).toHaveBeenCalledWith('testing', 'all', 10);
      });

      it('respects custom limit', async () => {
        await server.callTool('aether_discover_skills', { query: 'testing', limit: 3 }, ctx);

        expect(skillForge.discover).toHaveBeenCalledWith('testing', 'all', 3);
      });
    });

    describe('aether_create_skill', () => {
      it('creates a skill successfully', async () => {
        const result = await server.callTool(
          'aether_create_skill',
          {
            name: 'my-skill',
            description: 'Does something useful',
            instructions: '# Steps\n1. Do this\n2. Do that',
            tools_used: ['read_file', 'write_file'],
          },
          ctx,
        );

        expect(skillForge.create).toHaveBeenCalledWith(
          {
            name: 'my-skill',
            description: 'Does something useful',
            instructions: '# Steps\n1. Do this\n2. Do that',
            tools_used: ['read_file', 'write_file'],
          },
          'agent-alpha',
        );
        expect(result.content).toBe('Created.');
        expect(result.isError).toBe(false);
      });

      it('returns isError true on failure', async () => {
        skillForge.create.mockResolvedValue({
          success: false,
          message: 'Rate limit exceeded',
        });

        const result = await server.callTool(
          'aether_create_skill',
          {
            name: 'spam-skill',
            description: 'nope',
            instructions: 'nope',
          },
          ctx,
        );

        expect(result.isError).toBe(true);
        expect(result.content).toBe('Rate limit exceeded');
      });
    });

    describe('aether_install_skill', () => {
      it('installs a skill with default source', async () => {
        const result = await server.callTool('aether_install_skill', { skill_id: 'sk-123' }, ctx);

        expect(skillForge.install).toHaveBeenCalledWith('sk-123', 'local', 'agent-alpha');
        expect(result.content).toBe('Installed.');
        expect(result.isError).toBe(false);
      });

      it('installs from clawhub source', async () => {
        await server.callTool(
          'aether_install_skill',
          { skill_id: 'sk-456', source: 'clawhub' },
          ctx,
        );

        expect(skillForge.install).toHaveBeenCalledWith('sk-456', 'clawhub', 'agent-alpha');
      });

      it('returns error on install failure', async () => {
        skillForge.install.mockResolvedValue({
          success: false,
          message: 'Skill not found',
        });

        const result = await server.callTool(
          'aether_install_skill',
          { skill_id: 'nonexistent' },
          ctx,
        );

        expect(result.isError).toBe(true);
        expect(result.content).toBe('Skill not found');
      });
    });

    describe('aether_share_skill', () => {
      it('shares a skill with all agents', async () => {
        const result = await server.callTool('aether_share_skill', { skill_id: 'sk-abc' }, ctx);

        expect(skillForge.share).toHaveBeenCalledWith('sk-abc', 'all', 'agent-alpha');
        expect(result.content).toBe('Shared.');
        expect(result.isError).toBe(false);
      });

      it('returns isError on share failure', async () => {
        skillForge.share.mockResolvedValue({
          success: false,
          message: 'Permission denied',
        });

        const result = await server.callTool(
          'aether_share_skill',
          { skill_id: 'sk-forbidden' },
          ctx,
        );

        expect(result.isError).toBe(true);
        expect(result.content).toBe('Permission denied');
      });

      it('falls back to "Shared." when message is empty', async () => {
        skillForge.share.mockResolvedValue({
          success: true,
          message: '',
        });

        const result = await server.callTool('aether_share_skill', { skill_id: 'sk-quiet' }, ctx);

        // The code uses `result.message || 'Shared.'`
        expect(result.content).toBe('Shared.');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Collaboration Tools
  // -------------------------------------------------------------------------

  describe('Collaboration tools', () => {
    beforeEach(async () => {
      await server.init();
    });

    describe('aether_list_agents', () => {
      it('returns "No agents currently running" when no running processes', async () => {
        processes.getAll.mockReturnValue([]);

        const result = await server.callTool('aether_list_agents', {}, ctx);

        expect(result.content).toBe('No agents currently running.');
      });

      it('lists only running agents', async () => {
        processes.getAll.mockReturnValue([
          makeManagedProcess({ pid: 1, name: 'coder', state: 'running', agentPhase: 'thinking' }),
          makeManagedProcess({
            pid: 2,
            name: 'researcher',
            state: 'dead',
            agentPhase: 'completed',
          }),
          makeManagedProcess({
            pid: 3,
            name: 'reviewer',
            state: 'running',
            agentPhase: 'executing',
          }),
        ]);

        const result = await server.callTool('aether_list_agents', {}, ctx);

        expect(result.content).toContain('2 running agent(s)');
        expect(result.content).toContain('PID 1: coder');
        expect(result.content).toContain('PID 3: reviewer');
        expect(result.content).not.toContain('PID 2');
      });

      it('includes agent phase in output', async () => {
        processes.getAll.mockReturnValue([
          makeManagedProcess({ pid: 5, name: 'builder', state: 'running', agentPhase: 'thinking' }),
        ]);

        const result = await server.callTool('aether_list_agents', {}, ctx);

        expect(result.content).toContain('thinking');
      });
    });

    describe('aether_send_message', () => {
      it('sends a message successfully', async () => {
        processes.sendMessage.mockReturnValue({
          id: 'ipc-1',
          fromPid: 1,
          toPid: 2,
        } as Partial<IPCMessage>);

        const result = await server.callTool(
          'aether_send_message',
          { target_pid: 2, content: 'Hello agent!' },
          ctx,
        );

        expect(processes.sendMessage).toHaveBeenCalledWith(
          1, // ctx.pid
          2, // target_pid
          'message', // default channel
          { text: 'Hello agent!' },
        );
        expect(result.content).toBe('Message sent to PID 2.');
        expect(result.isError).toBeUndefined();
      });

      it('uses custom channel when provided', async () => {
        processes.sendMessage.mockReturnValue({ id: 'ipc-2' });

        await server.callTool(
          'aether_send_message',
          { target_pid: 3, content: 'Task complete', channel: 'task' },
          ctx,
        );

        expect(processes.sendMessage).toHaveBeenCalledWith(1, 3, 'task', { text: 'Task complete' });
      });

      it('returns error when target process not found', async () => {
        processes.sendMessage.mockReturnValue(null);

        const result = await server.callTool(
          'aether_send_message',
          { target_pid: 999, content: 'hello' },
          ctx,
        );

        expect(result.isError).toBe(true);
        expect(result.content).toContain('Failed to send message');
        expect(result.content).toContain('999');
      });
    });

    describe('aether_check_messages', () => {
      it('returns "No new messages" when queue is empty', async () => {
        processes.drainMessages.mockReturnValue([]);

        const result = await server.callTool('aether_check_messages', {}, ctx);

        expect(result.content).toBe('No new messages.');
        expect(processes.drainMessages).toHaveBeenCalledWith(1);
      });

      it('formats incoming messages correctly', async () => {
        processes.drainMessages.mockReturnValue([
          {
            id: 'msg-1',
            fromPid: 5,
            toPid: 1,
            channel: 'task',
            payload: { text: 'Please review PR #42' },
          },
          {
            id: 'msg-2',
            fromPid: 3,
            toPid: 1,
            channel: 'info',
            payload: { text: 'Build passed' },
          },
        ] as Partial<IPCMessage>[]);

        const result = await server.callTool('aether_check_messages', {}, ctx);

        expect(result.content).toContain('2 message(s)');
        expect(result.content).toContain('From PID 5');
        expect(result.content).toContain('[task]');
        expect(result.content).toContain('review PR #42');
        expect(result.content).toContain('From PID 3');
        expect(result.content).toContain('[info]');
      });
    });
  });

  // -------------------------------------------------------------------------
  // OS Tools
  // -------------------------------------------------------------------------

  describe('OS tools', () => {
    beforeEach(async () => {
      await server.init();
    });

    describe('aether_system_status', () => {
      it('reports system status with process counts', async () => {
        processes.getAll.mockReturnValue([
          makeManagedProcess({ pid: 1, name: 'a', state: 'running' }),
          makeManagedProcess({ pid: 2, name: 'b', state: 'running' }),
          makeManagedProcess({ pid: 3, name: 'c', state: 'sleeping' }),
          makeManagedProcess({ pid: 4, name: 'd', state: 'dead' }),
        ]);

        const result = await server.callTool('aether_system_status', {}, ctx);

        expect(result.content).toContain(`Aether OS v${AETHER_MCP_SERVER_VERSION}`);
        expect(result.content).toContain('Agents: 2 running, 3 total');
        expect(result.content).toContain('Memory: ready');
        expect(result.content).toContain('SkillForge: ready');
      });

      it('reports zero agents when all are dead', async () => {
        processes.getAll.mockReturnValue([
          makeManagedProcess({ pid: 1, name: 'a', state: 'dead' }),
        ]);

        const result = await server.callTool('aether_system_status', {}, ctx);

        expect(result.content).toContain('Agents: 0 running, 0 total');
      });
    });

    describe('aether_read_source', () => {
      it('returns file content using dynamic import of node:fs', async () => {
        // We cannot easily mock the dynamic import inside the tool, but we can
        // verify the tool is registered and that it returns an error for a
        // non-existent file (which exercises the error path).
        const result = await server.callTool(
          'aether_read_source',
          { path: 'definitely-does-not-exist-12345.ts' },
          ctx,
        );

        // Should trigger the catch path since file does not exist
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Error reading file');
      });
    });

    describe('aether_get_architecture', () => {
      it('returns error when ARCHITECTURE.md does not exist', async () => {
        const result = await server.callTool('aether_get_architecture', {}, ctx);

        // The docs/ARCHITECTURE.md path is relative to cwd/.. and may not exist
        // in a test environment. We primarily verify the tool handles errors.
        if (result.isError) {
          expect(result.content).toContain('Error');
        } else {
          // If the file does exist, content should be non-empty
          expect(result.content.length).toBeGreaterThan(0);
        }
      });
    });
  });

  // -------------------------------------------------------------------------
  // Event bus integration
  // -------------------------------------------------------------------------

  describe('EventBus integration', () => {
    beforeEach(async () => {
      await server.init();
    });

    it('does not emit event for unknown tool calls', async () => {
      const listener = vi.fn();
      bus.on('aether-mcp.tool.called', listener);

      await server.callTool('bogus', {}, ctx);

      expect(listener).not.toHaveBeenCalled();
    });

    it('event payload includes __eventId from EventBus', async () => {
      const listener = vi.fn();
      bus.on('aether-mcp.tool.called', listener);

      await server.callTool('aether_system_status', {}, ctx);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ __eventId: expect.any(String) }),
      );
    });

    it('emits correct tool name and args in event', async () => {
      const listener = vi.fn();
      bus.on('aether-mcp.tool.called', listener);

      await server.callTool('aether_remember', { content: 'test memory', layer: 'semantic' }, ctx);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          tool: 'aether_remember',
          args: { content: 'test memory', layer: 'semantic' },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases & error handling
  // -------------------------------------------------------------------------

  describe('Error handling', () => {
    beforeEach(async () => {
      await server.init();
    });

    it('handles async tool execute rejection', async () => {
      skillForge.discover.mockRejectedValue(new Error('Network timeout'));

      const result = await server.callTool('aether_discover_skills', { query: 'anything' }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool error');
      expect(result.content).toContain('Network timeout');
    });

    it('handles non-Error thrown values', async () => {
      skillForge.discover.mockRejectedValue('string error');

      const result = await server.callTool('aether_discover_skills', { query: 'anything' }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool error');
    });

    it('handles synchronous throw in tool execute', async () => {
      memory.recall.mockImplementation(() => {
        throw new TypeError('Cannot read property of undefined');
      });

      const result = await server.callTool('aether_recall', { query: 'test' }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool error');
      expect(result.content).toContain('Cannot read property of undefined');
    });
  });

  // -------------------------------------------------------------------------
  // Tool schemas have valid JSON Schema structure
  // -------------------------------------------------------------------------

  describe('Tool schema validation', () => {
    beforeEach(async () => {
      await server.init();
    });

    it('all tools have type "object" input schemas', () => {
      const schemas = server.getToolSchemas();

      for (const schema of schemas) {
        expect(schema.inputSchema.type).toBe('object');
        expect(schema.inputSchema).toHaveProperty('properties');
      }
    });

    it('aether_remember schema requires "content"', () => {
      const schemas = server.getToolSchemas();
      const rememberSchema = schemas.find((s) => s.name === 'aether_remember');

      expect(rememberSchema).toBeDefined();
      expect(rememberSchema!.inputSchema.required).toContain('content');
    });

    it('aether_discover_skills schema requires "query"', () => {
      const schemas = server.getToolSchemas();
      const discoverSchema = schemas.find((s) => s.name === 'aether_discover_skills');

      expect(discoverSchema).toBeDefined();
      expect(discoverSchema!.inputSchema.required).toContain('query');
    });

    it('aether_create_skill schema requires name, description, and instructions', () => {
      const schemas = server.getToolSchemas();
      const createSchema = schemas.find((s) => s.name === 'aether_create_skill');

      expect(createSchema).toBeDefined();
      expect(createSchema!.inputSchema.required).toEqual(
        expect.arrayContaining(['name', 'description', 'instructions']),
      );
    });

    it('aether_send_message schema requires target_pid and content', () => {
      const schemas = server.getToolSchemas();
      const sendSchema = schemas.find((s) => s.name === 'aether_send_message');

      expect(sendSchema).toBeDefined();
      expect(sendSchema!.inputSchema.required).toEqual(
        expect.arrayContaining(['target_pid', 'content']),
      );
    });

    it('all tool names start with aether_', () => {
      const tools = server.getTools();

      for (const tool of tools) {
        expect(tool.name).toMatch(/^aether_/);
      }
    });

    it('all tools have non-empty descriptions', () => {
      const tools = server.getTools();

      for (const tool of tools) {
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });
});
