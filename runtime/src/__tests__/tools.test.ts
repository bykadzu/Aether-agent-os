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
    browser: {
      isAvailable: vi.fn().mockReturnValue(true),
      createSession: vi.fn().mockResolvedValue(undefined),
      navigateTo: vi
        .fn()
        .mockResolvedValue({ url: 'https://example.com', title: 'Example', isLoading: false }),
      getDOMSnapshot: vi.fn().mockResolvedValue({
        url: 'https://example.com',
        title: 'Example',
        elements: [
          { tag: 'h1', text: 'Example Domain' },
          { tag: 'p', text: 'This domain is for use in illustrative examples.' },
        ],
      }),
      getScreenshot: vi.fn().mockResolvedValue('base64screenshotdata'),
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      keyPress: vi.fn().mockResolvedValue(undefined),
      getPageInfo: vi
        .fn()
        .mockResolvedValue({ url: 'https://example.com', title: 'Example', isLoading: false }),
      destroySession: vi.fn().mockResolvedValue(undefined),
    },
    fs: {
      readFile: vi.fn(async (path: string) => ({ content: `content of ${path}`, size: 100 })),
      writeFile: vi.fn(async () => {}),
      ls: vi.fn(async () => [
        {
          path: '/home/agent_1/file.txt',
          name: 'file.txt',
          type: 'file',
          size: 100,
          mode: {},
          uid: 'agent_1',
          createdAt: 0,
          modifiedAt: 0,
          isHidden: false,
        },
      ]),
      mkdir: vi.fn(async () => {}),
      rm: vi.fn(async () => {}),
      stat: vi.fn(async () => ({
        path: '/home/agent_1/test.txt',
        name: 'test.txt',
        type: 'file',
        size: 100,
        uid: 'agent_1',
        createdAt: 1700000000000,
        modifiedAt: 1700001000000,
        isHidden: false,
        mode: {
          owner: { read: true, write: true, execute: false },
          group: { read: true, write: false, execute: false },
          other: { read: true, write: false, execute: false },
        },
      })),
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
        {
          pid: 2,
          uid: 'agent_2',
          name: 'Researcher Agent',
          role: 'Researcher',
          state: 'running',
          agentPhase: 'thinking',
        },
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

function createContext(kernel: any): ToolContext {
  return {
    kernel,
    pid: 1,
    uid: 'agent_1',
    cwd: '/home/agent_1',
  };
}

describe('Tools', () => {
  let tools: ToolDefinition[];
  let mockKernel: ReturnType<typeof createMockKernel>;
  let ctx: ToolContext;

  beforeEach(() => {
    vi.restoreAllMocks();
    tools = createToolSet();
    mockKernel = createMockKernel();
    ctx = createContext(mockKernel);
  });

  it('createToolSet returns all expected tools', () => {
    const names = tools.map((t) => t.name);
    // Original tools
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
    // New file tools
    expect(names).toContain('rm');
    expect(names).toContain('stat');
    expect(names).toContain('mv');
    expect(names).toContain('cp');
    // New browser tools
    expect(names).toContain('screenshot_page');
    expect(names).toContain('click_element');
    expect(names).toContain('type_text');
  });

  // -------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------
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

  describe('rm', () => {
    it('removes a file via VirtualFS.rm', async () => {
      const tool = tools.find((t) => t.name === 'rm')!;
      const result = await tool.execute({ path: '/home/agent_1/old.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Removed');
      expect(result.output).toContain('/home/agent_1/old.txt');
      expect(mockKernel.fs.rm).toHaveBeenCalledWith('/home/agent_1/old.txt');
    });

    it('resolves relative paths against cwd', async () => {
      const tool = tools.find((t) => t.name === 'rm')!;
      await tool.execute({ path: 'subdir/file.txt' }, ctx);

      expect(mockKernel.fs.rm).toHaveBeenCalledWith('/home/agent_1/subdir/file.txt');
    });

    it('returns error on failure', async () => {
      mockKernel.fs.rm.mockRejectedValueOnce(new Error('Permission denied'));
      const tool = tools.find((t) => t.name === 'rm')!;
      const result = await tool.execute({ path: '/etc/passwd' }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Permission denied');
    });
  });

  describe('stat', () => {
    it('returns file metadata', async () => {
      const tool = tools.find((t) => t.name === 'stat')!;
      const result = await tool.execute({ path: '/home/agent_1/test.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Path:');
      expect(result.output).toContain('Name: test.txt');
      expect(result.output).toContain('Type: file');
      expect(result.output).toContain('Size:');
      expect(result.output).toContain('Created:');
      expect(result.output).toContain('Modified:');
      expect(mockKernel.fs.stat).toHaveBeenCalledWith('/home/agent_1/test.txt');
    });

    it('returns error when file not found', async () => {
      mockKernel.fs.stat.mockRejectedValueOnce(new Error('ENOENT: no such file'));
      const tool = tools.find((t) => t.name === 'stat')!;
      const result = await tool.execute({ path: '/nonexistent' }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('ENOENT');
    });
  });

  describe('mv', () => {
    it('moves a file via VirtualFS.mv', async () => {
      const tool = tools.find((t) => t.name === 'mv')!;
      const result = await tool.execute(
        { source: '/home/agent_1/a.txt', destination: '/home/agent_1/b.txt' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('Moved');
      expect(result.output).toContain('/home/agent_1/a.txt');
      expect(result.output).toContain('/home/agent_1/b.txt');
      expect(mockKernel.fs.mv).toHaveBeenCalledWith('/home/agent_1/a.txt', '/home/agent_1/b.txt');
    });

    it('resolves relative paths for both source and destination', async () => {
      const tool = tools.find((t) => t.name === 'mv')!;
      await tool.execute({ source: 'a.txt', destination: 'subdir/b.txt' }, ctx);

      expect(mockKernel.fs.mv).toHaveBeenCalledWith(
        '/home/agent_1/a.txt',
        '/home/agent_1/subdir/b.txt',
      );
    });

    it('returns error on failure', async () => {
      mockKernel.fs.mv.mockRejectedValueOnce(new Error('Source not found'));
      const tool = tools.find((t) => t.name === 'mv')!;
      const result = await tool.execute({ source: '/missing', destination: '/dest' }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Source not found');
    });
  });

  describe('cp', () => {
    it('copies a file via VirtualFS.cp', async () => {
      const tool = tools.find((t) => t.name === 'cp')!;
      const result = await tool.execute(
        { source: '/home/agent_1/a.txt', destination: '/home/agent_1/a_copy.txt' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('Copied');
      expect(result.output).toContain('/home/agent_1/a.txt');
      expect(result.output).toContain('/home/agent_1/a_copy.txt');
      expect(mockKernel.fs.cp).toHaveBeenCalledWith(
        '/home/agent_1/a.txt',
        '/home/agent_1/a_copy.txt',
      );
    });

    it('resolves relative paths for both source and destination', async () => {
      const tool = tools.find((t) => t.name === 'cp')!;
      await tool.execute({ source: 'original.txt', destination: 'backup/original.txt' }, ctx);

      expect(mockKernel.fs.cp).toHaveBeenCalledWith(
        '/home/agent_1/original.txt',
        '/home/agent_1/backup/original.txt',
      );
    });

    it('returns error on failure', async () => {
      mockKernel.fs.cp.mockRejectedValueOnce(new Error('Disk full'));
      const tool = tools.find((t) => t.name === 'cp')!;
      const result = await tool.execute(
        { source: '/home/agent_1/big.bin', destination: '/home/agent_1/big_copy.bin' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain('Disk full');
    });
  });

  // -------------------------------------------------------------------
  // Shell Execution
  // -------------------------------------------------------------------
  describe('run_command', () => {
    it('routes through Docker container when available', async () => {
      mockKernel.containers.isDockerAvailable.mockReturnValue(true);
      mockKernel.containers.get.mockReturnValue({
        containerId: 'abc123',
        pid: 1,
        image: 'ubuntu:22.04',
        status: 'running',
      });
      mockKernel.containers.exec.mockResolvedValue('docker output');

      const tool = tools.find((t) => t.name === 'run_command')!;
      const result = await tool.execute({ command: 'ls -la' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('docker output');
      expect(mockKernel.containers.exec).toHaveBeenCalledWith(1, 'ls -la');
    });

    it('falls back to child_process when Docker is unavailable', async () => {
      mockKernel.containers.isDockerAvailable.mockReturnValue(false);
      // Add processes.get mock for the child_process fallback path
      (mockKernel.processes as any).get = vi.fn(() => ({
        info: { cwd: '/tmp', env: {} },
      }));
      (mockKernel.fs as any).getRealRoot = vi.fn(() => '/mock/root');

      const tool = tools.find((t) => t.name === 'run_command')!;
      // This will attempt child_process.exec which may fail in test env,
      // but the important thing is it does NOT call containers.exec
      await tool.execute({ command: 'echo test' }, ctx);

      expect(mockKernel.containers.exec).not.toHaveBeenCalled();
    });

    it('returns error for missing command argument', async () => {
      const tool = tools.find((t) => t.name === 'run_command')!;
      const result = await tool.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('"command" argument is required');
    });

    it('lazy-creates sandbox container when Docker is available but no container exists', async () => {
      mockKernel.containers.isDockerAvailable.mockReturnValue(true);
      // First call returns null (no container), second call returns the new one
      mockKernel.containers.get.mockReturnValueOnce(undefined).mockReturnValueOnce({
        containerId: 'new123',
        pid: 1,
        image: 'ubuntu:22.04',
        status: 'running',
      });
      (mockKernel.containers as any).create = vi.fn().mockResolvedValue({
        containerId: 'new123',
        pid: 1,
      });
      mockKernel.containers.exec.mockResolvedValue('sandbox output');
      (mockKernel.processes as any).get = vi.fn(() => ({
        info: { cwd: '/home/agent_1', env: {} },
      }));
      (mockKernel.fs as any).getRealRoot = vi.fn(() => '/mock/root');

      const tool = tools.find((t) => t.name === 'run_command')!;
      const result = await tool.execute({ command: 'whoami' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('sandbox output');
      expect((mockKernel.containers as any).create).toHaveBeenCalledWith(
        1,
        expect.stringContaining('/mock/root'),
      );
    });
  });

  // -------------------------------------------------------------------
  // Web Browsing - browse_web with BrowserManager
  // -------------------------------------------------------------------
  describe('browse_web', () => {
    it('uses BrowserManager when available', async () => {
      const tool = tools.find((t) => t.name === 'browse_web')!;
      const result = await tool.execute({ url: 'https://example.com' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Page: Example');
      expect(result.output).toContain('URL: https://example.com');
      expect(result.output).toContain('Example Domain');
      expect(result.output).toContain('This domain is for use in illustrative examples.');

      // Verify browser APIs were called
      expect(mockKernel.browser.createSession).toHaveBeenCalledWith('browser_1', {
        width: 1280,
        height: 720,
      });
      expect(mockKernel.browser.navigateTo).toHaveBeenCalledWith(
        'browser_1',
        'https://example.com',
      );
      expect(mockKernel.browser.getDOMSnapshot).toHaveBeenCalledWith('browser_1');
    });

    it('emits agent.browsing events when using BrowserManager', async () => {
      const tool = tools.find((t) => t.name === 'browse_web')!;
      await tool.execute({ url: 'https://example.com' }, ctx);

      // First emit: initial browsing event
      expect(mockKernel.bus.emit).toHaveBeenCalledWith('agent.browsing', {
        pid: 1,
        url: 'https://example.com',
      });

      // Second emit: browsing result with summary
      expect(mockKernel.bus.emit).toHaveBeenCalledWith('agent.browsing', {
        pid: 1,
        url: 'https://example.com',
        summary: expect.any(String),
      });
    });

    it('handles createSession failure gracefully (session already exists)', async () => {
      mockKernel.browser.createSession.mockRejectedValueOnce(new Error('Session already exists'));

      const tool = tools.find((t) => t.name === 'browse_web')!;
      const result = await tool.execute({ url: 'https://example.com' }, ctx);

      // Should still succeed since we catch createSession errors
      expect(result.success).toBe(true);
      expect(result.output).toContain('Page: Example');
    });

    it('falls back to HTTP fetch when BrowserManager is unavailable', async () => {
      mockKernel.browser.isAvailable.mockReturnValue(false);

      // Mock global fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => ({
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body><h1>Fetched Page</h1><p>Content via fetch</p></body></html>',
      })) as any;

      try {
        const tool = tools.find((t) => t.name === 'browse_web')!;
        const result = await tool.execute({ url: 'https://example.com' }, ctx);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Fetched Page');
        expect(result.output).toContain('Content via fetch');
        // Should NOT have called browser APIs (except isAvailable)
        expect(mockKernel.browser.createSession).not.toHaveBeenCalled();
        expect(mockKernel.browser.navigateTo).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('falls back to HTTP fetch when browser property is undefined', async () => {
      const kernelNoBrowser = createMockKernel();
      (kernelNoBrowser as any).browser = undefined;
      const ctxNoBrowser = createContext(kernelNoBrowser);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => ({
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body>Fallback content</body></html>',
      })) as any;

      try {
        const tool = tools.find((t) => t.name === 'browse_web')!;
        const result = await tool.execute({ url: 'https://example.com' }, ctxNoBrowser);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Fallback content');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns error on navigation failure', async () => {
      mockKernel.browser.navigateTo.mockRejectedValueOnce(new Error('Navigation timeout'));

      const tool = tools.find((t) => t.name === 'browse_web')!;
      const result = await tool.execute({ url: 'https://unreachable.test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Failed to browse');
      expect(result.output).toContain('Navigation timeout');
    });

    it('truncates text content to 4000 characters', async () => {
      const longText = 'A'.repeat(5000);
      mockKernel.browser.getDOMSnapshot.mockResolvedValueOnce({
        url: 'https://example.com',
        title: 'Long Page',
        elements: [{ tag: 'p', text: longText }],
      });
      mockKernel.browser.navigateTo.mockResolvedValueOnce({
        url: 'https://example.com',
        title: 'Long Page',
        isLoading: false,
      });

      const tool = tools.find((t) => t.name === 'browse_web')!;
      const result = await tool.execute({ url: 'https://example.com' }, ctx);

      expect(result.success).toBe(true);
      // The text part after "Page: ...\nURL: ...\n\n" should be <= 4000
      const lines = result.output.split('\n');
      const textPart = lines.slice(3).join('\n');
      expect(textPart.length).toBeLessThanOrEqual(4000);
    });
  });

  // -------------------------------------------------------------------
  // screenshot_page
  // -------------------------------------------------------------------
  describe('screenshot_page', () => {
    it('takes a screenshot of the current page', async () => {
      const tool = tools.find((t) => t.name === 'screenshot_page')!;
      const result = await tool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('base64screenshotdata');
      expect(result.artifacts).toEqual([{ type: 'image/png', content: 'base64screenshotdata' }]);
      expect(mockKernel.browser.getScreenshot).toHaveBeenCalledWith('browser_1');
    });

    it('navigates to URL before taking screenshot when url is provided', async () => {
      const tool = tools.find((t) => t.name === 'screenshot_page')!;
      const result = await tool.execute({ url: 'https://example.com/page' }, ctx);

      expect(result.success).toBe(true);
      expect(mockKernel.browser.navigateTo).toHaveBeenCalledWith(
        'browser_1',
        'https://example.com/page',
      );
      expect(mockKernel.browser.getScreenshot).toHaveBeenCalledWith('browser_1');
    });

    it('does not navigate when no url is provided', async () => {
      const tool = tools.find((t) => t.name === 'screenshot_page')!;
      await tool.execute({}, ctx);

      expect(mockKernel.browser.navigateTo).not.toHaveBeenCalled();
      expect(mockKernel.browser.getScreenshot).toHaveBeenCalled();
    });

    it('returns error when browser is not available', async () => {
      mockKernel.browser.isAvailable.mockReturnValue(false);

      const tool = tools.find((t) => t.name === 'screenshot_page')!;
      const result = await tool.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Screenshot failed');
      expect(result.output).toContain('Browser not available');
    });

    it('creates a browser session with correct session ID', async () => {
      const tool = tools.find((t) => t.name === 'screenshot_page')!;
      await tool.execute({}, ctx);

      expect(mockKernel.browser.createSession).toHaveBeenCalledWith('browser_1', {
        width: 1280,
        height: 720,
      });
    });

    it('handles screenshot failure gracefully', async () => {
      mockKernel.browser.getScreenshot.mockRejectedValueOnce(new Error('Page crashed'));

      const tool = tools.find((t) => t.name === 'screenshot_page')!;
      const result = await tool.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Screenshot failed');
      expect(result.output).toContain('Page crashed');
    });
  });

  // -------------------------------------------------------------------
  // click_element
  // -------------------------------------------------------------------
  describe('click_element', () => {
    it('clicks at specified coordinates with default left button', async () => {
      const tool = tools.find((t) => t.name === 'click_element')!;
      const result = await tool.execute({ x: 100, y: 200 }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Clicked at (100, 200)');
      expect(result.output).toContain('left button');
      expect(mockKernel.browser.click).toHaveBeenCalledWith('browser_1', 100, 200, 'left');
    });

    it('supports right-click', async () => {
      const tool = tools.find((t) => t.name === 'click_element')!;
      const result = await tool.execute({ x: 50, y: 75, button: 'right' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('right button');
      expect(mockKernel.browser.click).toHaveBeenCalledWith('browser_1', 50, 75, 'right');
    });

    it('returns page info after click', async () => {
      const tool = tools.find((t) => t.name === 'click_element')!;
      const result = await tool.execute({ x: 100, y: 200 }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Page: Example');
      expect(result.output).toContain('https://example.com');
    });

    it('returns error when browser is not available', async () => {
      mockKernel.browser.isAvailable.mockReturnValue(false);

      const tool = tools.find((t) => t.name === 'click_element')!;
      const result = await tool.execute({ x: 100, y: 200 }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Click failed');
      expect(result.output).toContain('Browser not available');
    });

    it('handles click failure gracefully', async () => {
      mockKernel.browser.click.mockRejectedValueOnce(new Error('Element not interactable'));

      const tool = tools.find((t) => t.name === 'click_element')!;
      const result = await tool.execute({ x: 100, y: 200 }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Click failed');
      expect(result.output).toContain('Element not interactable');
    });
  });

  // -------------------------------------------------------------------
  // type_text
  // -------------------------------------------------------------------
  describe('type_text', () => {
    it('types text into the focused element', async () => {
      const tool = tools.find((t) => t.name === 'type_text')!;
      const result = await tool.execute({ text: 'Hello World' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Typed: Hello World');
      expect(mockKernel.browser.type).toHaveBeenCalledWith('browser_1', 'Hello World');
    });

    it('uses keyPress when key argument is provided', async () => {
      const tool = tools.find((t) => t.name === 'type_text')!;
      const result = await tool.execute({ key: 'Enter' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Pressed key: Enter');
      expect(mockKernel.browser.keyPress).toHaveBeenCalledWith('browser_1', 'Enter');
      // Should NOT have called type
      expect(mockKernel.browser.type).not.toHaveBeenCalled();
    });

    it('prefers key over text when both are provided', async () => {
      const tool = tools.find((t) => t.name === 'type_text')!;
      const result = await tool.execute({ text: 'ignored', key: 'Tab' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Pressed key: Tab');
      expect(mockKernel.browser.keyPress).toHaveBeenCalledWith('browser_1', 'Tab');
      expect(mockKernel.browser.type).not.toHaveBeenCalled();
    });

    it('returns error when browser is not available', async () => {
      mockKernel.browser.isAvailable.mockReturnValue(false);

      const tool = tools.find((t) => t.name === 'type_text')!;
      const result = await tool.execute({ text: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Type failed');
      expect(result.output).toContain('Browser not available');
    });

    it('handles type failure gracefully', async () => {
      mockKernel.browser.type.mockRejectedValueOnce(new Error('No focused element'));

      const tool = tools.find((t) => t.name === 'type_text')!;
      const result = await tool.execute({ text: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Type failed');
      expect(result.output).toContain('No focused element');
    });

    it('creates session with correct ID based on PID', async () => {
      const ctx2 = createContext(mockKernel);
      ctx2.pid = 42;

      const tool = tools.find((t) => t.name === 'type_text')!;
      await tool.execute({ text: 'test' }, ctx2);

      expect(mockKernel.browser.createSession).toHaveBeenCalledWith('browser_42', {
        width: 1280,
        height: 720,
      });
    });
  });

  // -------------------------------------------------------------------
  // IPC tools
  // -------------------------------------------------------------------
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

  // -------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------
  describe('complete', () => {
    it('returns completion signal', async () => {
      const tool = tools.find((t) => t.name === 'complete')!;
      const result = await tool.execute({ summary: 'All done' }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('All done');
      expect(mockKernel.processes.setState).toHaveBeenCalledWith(1, 'zombie', 'completed');
    });
  });

  // -------------------------------------------------------------------
  // getToolsForAgent
  // -------------------------------------------------------------------
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
