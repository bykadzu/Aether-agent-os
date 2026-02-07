import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolSet, getToolsForAgent } from '../tools.js';
import type { ToolContext, ToolDefinition } from '../tools.js';

// Create mock kernel object that mimics the Kernel interface
function createMockKernel() {
  return {
    bus: {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      once: vi.fn(() => () => {}),
      off: vi.fn(),
      wait: vi.fn(),
    },
    fs: {
      readFile: vi.fn(async (path: string) => ({ content: `content of ${path}`, size: 100 })),
      writeFile: vi.fn(async () => {}),
      ls: vi.fn(async () => [
        { path: '/home/agent_1/file.txt', name: 'file.txt', type: 'file', size: 100, mode: {}, uid: 'agent_1', createdAt: 0, modifiedAt: 0, isHidden: false },
      ]),
      mkdir: vi.fn(async () => {}),
      rm: vi.fn(async () => {}),
      stat: vi.fn(async () => ({ type: 'file', size: 100 })),
      mv: vi.fn(async () => {}),
      cp: vi.fn(async () => {}),
      createSharedMount: vi.fn(async (name: string, pid: number) => ({
        name,
        path: `/shared/${name}`,
        ownerPid: pid,
        mountedBy: [],
      })),
      mountShared: vi.fn(async () => {}),
      listSharedMounts: vi.fn(async () => []),
    },
    processes: {
      setState: vi.fn(),
      exit: vi.fn(),
      listRunningAgents: vi.fn(() => [
        { pid: 2, uid: 'agent_2', name: 'Researcher Agent', role: 'Researcher', state: 'running', agentPhase: 'thinking' },
      ]),
      sendMessage: vi.fn(() => ({
        id: 'msg_1',
        fromPid: 1,
        toPid: 2,
        fromUid: 'agent_1',
        toUid: 'agent_2',
        channel: 'chat',
        payload: 'hello',
        timestamp: Date.now(),
        delivered: false,
      })),
      drainMessages: vi.fn(() => []),
    },
    containers: {
      isDockerAvailable: vi.fn(() => false),
      get: vi.fn(() => null),
      exec: vi.fn(async () => 'command output'),
    },
    pty: {
      getByPid: vi.fn(() => [{ id: 'tty_1_123' }]),
      exec: vi.fn(async () => 'shell output'),
    },
    plugins: {
      getPlugins: vi.fn(() => []),
    },
  };
}

describe('Tools', () => {
  let tools: ToolDefinition[];
  let mockKernel: ReturnType<typeof createMockKernel>;
  let ctx: ToolContext;

  beforeEach(() => {
    tools = createToolSet();
    mockKernel = createMockKernel();
    ctx = {
      kernel: mockKernel as any,
      pid: 1,
      uid: 'agent_1',
      cwd: '/home/agent_1',
    };
  });

  it('createToolSet returns all expected tools', () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_files');
    expect(names).toContain('mkdir');
    expect(names).toContain('run_command');
    expect(names).toContain('browse_web');
    expect(names).toContain('send_message');
    expect(names).toContain('check_messages');
    expect(names).toContain('list_agents');
    expect(names).toContain('create_shared_workspace');
    expect(names).toContain('mount_workspace');
    expect(names).toContain('list_workspaces');
    expect(names).toContain('think');
    expect(names).toContain('complete');
  });

  describe('read_file', () => {
    it('delegates to VirtualFS.readFile', async () => {
      const tool = tools.find((t) => t.name === 'read_file')!;
      const result = await tool.execute({ path: '/home/agent_1/test.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('content of');
      expect(mockKernel.fs.readFile).toHaveBeenCalled();
    });

    it('returns string output', async () => {
      const tool = tools.find((t) => t.name === 'read_file')!;
      const result = await tool.execute({ path: '/home/agent_1/test.txt' }, ctx);
      expect(typeof result.output).toBe('string');
    });
  });

  describe('write_file', () => {
    it('creates the file and emits agent.file_created', async () => {
      const tool = tools.find((t) => t.name === 'write_file')!;
      const result = await tool.execute(
        { path: '/home/agent_1/new.txt', content: 'hello world' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(mockKernel.fs.writeFile).toHaveBeenCalled();
      expect(mockKernel.bus.emit).toHaveBeenCalledWith(
        'agent.file_created',
        expect.objectContaining({ pid: 1 }),
      );
    });
  });

  describe('run_command', () => {
    it('executes via PTY.exec', async () => {
      const tool = tools.find((t) => t.name === 'run_command')!;
      const result = await tool.execute({ command: 'ls -la' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('shell output');
    });
  });

  describe('browse_web', () => {
    it('fetches a URL (mock fetch)', async () => {
      // Mock global fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => ({
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body>Hello World</body></html>',
      })) as any;

      try {
        const tool = tools.find((t) => t.name === 'browse_web')!;
        const result = await tool.execute({ url: 'https://example.com' }, ctx);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Hello World');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('IPC tools', () => {
    it('send_message delegates correctly', async () => {
      const tool = tools.find((t) => t.name === 'send_message')!;
      const result = await tool.execute({ pid: 2, message: 'hello' }, ctx);

      expect(result.success).toBe(true);
      expect(mockKernel.processes.sendMessage).toHaveBeenCalledWith(1, 2, 'default', 'hello');
    });

    it('check_messages delegates correctly', async () => {
      const tool = tools.find((t) => t.name === 'check_messages')!;
      const result = await tool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(mockKernel.processes.drainMessages).toHaveBeenCalledWith(1);
    });

    it('list_agents delegates correctly', async () => {
      const tool = tools.find((t) => t.name === 'list_agents')!;
      const result = await tool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(mockKernel.processes.listRunningAgents).toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('returns completion signal', async () => {
      const tool = tools.find((t) => t.name === 'complete')!;
      const result = await tool.execute({ summary: 'All done' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('All done');
      expect(mockKernel.processes.setState).toHaveBeenCalledWith(1, 'zombie', 'completed');
    });
  });

  describe('getToolsForAgent()', () => {
    it('returns base tools when no plugin manager', () => {
      const tools = getToolsForAgent(1);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('read_file');
    });

    it('merges plugin tools with built-in tools', () => {
      const mockPluginManager = {
        getPlugins: vi.fn(() => [
          {
            manifest: {
              name: 'test-plugin',
              version: '1.0.0',
              description: 'test',
              tools: [
                { name: 'plugin_tool', description: 'test', parameters: {}, handler: 'handler.js' },
              ],
            },
            dir: '/tmp/test',
            handlers: new Map([['plugin_tool', async () => 'plugin result']]),
          },
        ]),
      };

      const tools = getToolsForAgent(1, mockPluginManager as any);
      const names = tools.map((t) => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('plugin_tool');
    });
  });
});
