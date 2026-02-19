import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventBus } from '../EventBus.js';
import { AgentSubprocess } from '../AgentSubprocess.js';
import type { AgentConfig } from '@aether/shared';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Create a fake ChildProcess that extends EventEmitter for on/once/emit
function createMockChild(overrides: { pid?: number } = {}) {
  const child = new EventEmitter() as any;
  child.pid = overrides.pid ?? 12345;
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

let mockChild: ReturnType<typeof createMockChild>;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    role: 'Coder',
    goal: 'Write unit tests',
    runtime: 'claude-code',
    ...overrides,
  };
}

const mockMcpServer = {} as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentSubprocess', () => {
  let bus: EventBus;
  let sub: AgentSubprocess;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = createMockChild();
    bus = new EventBus();
    sub = new AgentSubprocess(bus, mockMcpServer);
  });

  // -----------------------------------------------------------------------
  // start()
  // -----------------------------------------------------------------------

  describe('start()', () => {
    it('spawns a process and returns SubprocessInfo', async () => {
      const info = await sub.start(1, makeConfig(), '/tmp/work');

      expect(info.pid).toBe(1);
      expect(info.osPid).toBe(12345);
      expect(info.runtime).toBe('claude-code');
      expect(info.outputBuffer).toBe('');
      expect(info.errorBuffer).toBe('');
      expect(info.startedAt).toBeGreaterThan(0);
    });

    it('creates workDir if it does not exist', async () => {
      const fs = await import('node:fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await sub.start(1, makeConfig(), '/tmp/work');

      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/work', { recursive: true });
    });

    it('skips creating workDir if it already exists', async () => {
      const fs = await import('node:fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await sub.start(1, makeConfig(), '/tmp/work');

      // mkdirSync should not be called for the workDir (it may still be called
      // for config subdirs like .openclaw, but not for the main workDir itself)
      const mkdirCalls = vi.mocked(fs.mkdirSync).mock.calls;
      const workDirCall = mkdirCalls.find((c) => c[0] === '/tmp/work');
      expect(workDirCall).toBeUndefined();
    });

    it('emits subprocess.started event', async () => {
      const handler = vi.fn();
      bus.on('subprocess.started', handler);

      await sub.start(1, makeConfig(), '/tmp/work');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          runtime: 'claude-code',
          processId: 12345,
        }),
      );
    });

    it('registers the subprocess in the internal map', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');

      expect(sub.isRunning(1)).toBe(true);
      expect(sub.get(1)).toBeDefined();
    });

    it('captures stdout data into outputBuffer and emits events', async () => {
      const outputHandler = vi.fn();
      const logHandler = vi.fn();
      bus.on('subprocess.output', outputHandler);
      bus.on('agent.log', logHandler);

      await sub.start(1, makeConfig(), '/tmp/work');

      // Simulate stdout data
      mockChild.stdout.emit('data', Buffer.from('hello world'));

      expect(sub.getOutput(1)?.stdout).toBe('hello world');
      expect(outputHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          stream: 'stdout',
          data: 'hello world',
        }),
      );
      expect(logHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          type: 'observation',
          message: 'hello world',
        }),
      );
    });

    it('captures stderr data into errorBuffer', async () => {
      const handler = vi.fn();
      bus.on('subprocess.output', handler);

      await sub.start(1, makeConfig(), '/tmp/work');

      mockChild.stderr.emit('data', Buffer.from('error msg'));

      expect(sub.getOutput(1)?.stderr).toBe('error msg');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          stream: 'stderr',
          data: 'error msg',
        }),
      );
    });

    it('truncates outputBuffer to SUBPROCESS_OUTPUT_MAX_BUFFER', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');

      // Emit data larger than the buffer limit (100_000 chars)
      const bigChunk = 'x'.repeat(60_000);
      mockChild.stdout.emit('data', Buffer.from(bigChunk));
      mockChild.stdout.emit('data', Buffer.from(bigChunk));

      const output = sub.getOutput(1);
      expect(output!.stdout.length).toBeLessThanOrEqual(100_000);
    });

    it('emits subprocess.exited and cleans up on process exit', async () => {
      const handler = vi.fn();
      bus.on('subprocess.exited', handler);

      await sub.start(1, makeConfig(), '/tmp/work');
      expect(sub.isRunning(1)).toBe(true);

      // Simulate process exit
      mockChild.emit('exit', 0, null);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          code: 0,
          signal: null,
        }),
      );
      expect(sub.isRunning(1)).toBe(false);
    });

    it('emits subprocess.output on spawn error', async () => {
      const handler = vi.fn();
      bus.on('subprocess.output', handler);

      await sub.start(1, makeConfig(), '/tmp/work');

      mockChild.emit('error', new Error('spawn ENOENT'));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          stream: 'stderr',
          data: 'Process error: spawn ENOENT',
        }),
      );
    });

    it('writes CLAUDE.md config for claude-code runtime', async () => {
      const fs = await import('node:fs');

      await sub.start(1, makeConfig({ runtime: 'claude-code' }), '/tmp/work');

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const claudeMdCall = writeFileCalls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('CLAUDE.md'),
      );
      expect(claudeMdCall).toBeDefined();
      expect(claudeMdCall![1]).toContain('Role: Coder');
      expect(claudeMdCall![1]).toContain('Goal: Write unit tests');
    });

    it('writes .mcp.json config for claude-code runtime', async () => {
      const fs = await import('node:fs');

      await sub.start(1, makeConfig({ runtime: 'claude-code' }), '/tmp/work');

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const mcpCall = writeFileCalls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('.mcp.json'),
      );
      expect(mcpCall).toBeDefined();
      const mcpConfig = JSON.parse(mcpCall![1] as string);
      expect(mcpConfig.mcpServers['aether-os']).toBeDefined();
    });

    it('writes INSTRUCTIONS.md for openclaw runtime', async () => {
      const fs = await import('node:fs');

      await sub.start(
        2,
        makeConfig({ runtime: 'openclaw', role: 'Researcher', goal: 'Find info' }),
        '/tmp/work2',
      );

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const instructionsCall = writeFileCalls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSTRUCTIONS.md'),
      );
      expect(instructionsCall).toBeDefined();
      expect(instructionsCall![1]).toContain('Role: Researcher');
    });

    it('writes SKILLS.md when skills are provided', async () => {
      const fs = await import('node:fs');

      await sub.start(1, makeConfig({ skills: ['web-search', 'code-review'] }), '/tmp/work');

      const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const skillsCall = writeFileCalls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('SKILLS.md'),
      );
      expect(skillsCall).toBeDefined();
      expect(skillsCall![1]).toContain('web-search');
      expect(skillsCall![1]).toContain('code-review');
    });
  });

  // -----------------------------------------------------------------------
  // stop()
  // -----------------------------------------------------------------------

  describe('stop()', () => {
    it('sends SIGTERM to the process', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');

      const stopPromise = sub.stop(1);
      // Simulate the process exiting after SIGTERM
      mockChild.emit('exit', 0, 'SIGTERM');
      await stopPromise;

      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('resolves immediately if PID not found', async () => {
      // Should not throw
      await sub.stop(999);
    });

    it('resolves if SIGTERM kill throws (process already dead)', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');
      mockChild.kill.mockImplementation(() => {
        throw new Error('process already dead');
      });

      // Should resolve without throwing
      await sub.stop(1);
    });
  });

  // -----------------------------------------------------------------------
  // pause() / resume()
  // -----------------------------------------------------------------------

  describe('pause()', () => {
    it('does nothing for unknown PID', () => {
      // Should not throw
      sub.pause(999);
    });

    it('calls kill on the process (SIGSTOP on non-win32)', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');
      const originalPlatform = process.platform;

      // Can't easily mock process.platform, but we can verify kill is called
      // or not called depending on platform. On win32 (current), SIGSTOP
      // is skipped, which is correct behavior.
      sub.pause(1);

      if (process.platform !== 'win32') {
        expect(mockChild.kill).toHaveBeenCalledWith('SIGSTOP');
      } else {
        // On Windows, SIGSTOP is not sent
        expect(mockChild.kill).not.toHaveBeenCalled();
      }
    });
  });

  describe('resume()', () => {
    it('does nothing for unknown PID', () => {
      sub.resume(999);
    });

    it('handles resume on running subprocess', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');
      sub.resume(1);

      if (process.platform !== 'win32') {
        expect(mockChild.kill).toHaveBeenCalledWith('SIGCONT');
      }
    });
  });

  // -----------------------------------------------------------------------
  // sendInput()
  // -----------------------------------------------------------------------

  describe('sendInput()', () => {
    it('writes to stdin of the subprocess', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');

      sub.sendInput(1, 'hello agent');

      expect(mockChild.stdin.write).toHaveBeenCalledWith('hello agent\n');
    });

    it('does nothing for unknown PID', () => {
      // Should not throw
      sub.sendInput(999, 'test');
    });
  });

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  describe('getOutput()', () => {
    it('returns null for unknown PID', () => {
      expect(sub.getOutput(999)).toBeNull();
    });

    it('returns stdout and stderr buffers', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');

      mockChild.stdout.emit('data', Buffer.from('out'));
      mockChild.stderr.emit('data', Buffer.from('err'));

      const output = sub.getOutput(1);
      expect(output).toEqual({ stdout: 'out', stderr: 'err' });
    });
  });

  describe('isRunning()', () => {
    it('returns false for unknown PID', () => {
      expect(sub.isRunning(999)).toBe(false);
    });

    it('returns true for running subprocess', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');
      expect(sub.isRunning(1)).toBe(true);
    });
  });

  describe('get()', () => {
    it('returns undefined for unknown PID', () => {
      expect(sub.get(999)).toBeUndefined();
    });

    it('returns SubprocessInfo for running subprocess', async () => {
      await sub.start(1, makeConfig(), '/tmp/work');
      const info = sub.get(1);
      expect(info).toBeDefined();
      expect(info!.pid).toBe(1);
    });
  });

  describe('getAll()', () => {
    it('returns empty array when no subprocesses', () => {
      expect(sub.getAll()).toEqual([]);
    });

    it('returns all running subprocesses', async () => {
      // Start two subprocesses (need separate mock children)
      await sub.start(1, makeConfig(), '/tmp/work1');

      // Create a new mock child for the second subprocess
      mockChild = createMockChild({ pid: 67890 });
      await sub.start(2, makeConfig(), '/tmp/work2');

      const all = sub.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.pid).sort()).toEqual([1, 2]);
    });
  });

  // -----------------------------------------------------------------------
  // stopAll()
  // -----------------------------------------------------------------------

  describe('stopAll()', () => {
    it('stops all running subprocesses', async () => {
      await sub.start(1, makeConfig(), '/tmp/work1');
      const child1 = mockChild;

      mockChild = createMockChild({ pid: 67890 });
      await sub.start(2, makeConfig(), '/tmp/work2');
      const child2 = mockChild;

      const stopPromise = sub.stopAll();

      // Simulate both processes exiting
      child1.emit('exit', 0, 'SIGTERM');
      child2.emit('exit', 0, 'SIGTERM');

      await stopPromise;

      expect(child1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(child2.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('resolves when no subprocesses are running', async () => {
      await sub.stopAll();
      // Should resolve without error
    });
  });

  // -----------------------------------------------------------------------
  // buildCommand (tested indirectly through start)
  // -----------------------------------------------------------------------

  describe('buildCommand (via start)', () => {
    it('uses claude command for claude-code runtime', async () => {
      const cp = await import('node:child_process');

      await sub.start(1, makeConfig({ runtime: 'claude-code' }), '/tmp/work');

      const spawnCall = vi.mocked(cp.spawn).mock.calls[0];
      // On non-win32, command should be 'claude' or contain it
      // On win32, it may be resolved to node.exe + cli.js
      const cmdStr = String(spawnCall[0]);
      expect(cmdStr).toMatch(/claude|node/);
    });

    it('uses openclaw command for openclaw runtime', async () => {
      const cp = await import('node:child_process');

      await sub.start(1, makeConfig({ runtime: 'openclaw' }), '/tmp/work');

      const spawnCall = vi.mocked(cp.spawn).mock.calls[0];
      const cmdStr = String(spawnCall[0]);
      // On win32 with shell:true, the command string includes 'openclaw'
      // On other platforms, command is 'openclaw' directly
      expect(cmdStr).toContain('openclaw');
    });

    it('falls back to echo for builtin runtime', async () => {
      const cp = await import('node:child_process');

      await sub.start(1, makeConfig({ runtime: 'builtin' }), '/tmp/work');

      const spawnCall = vi.mocked(cp.spawn).mock.calls[0];
      const cmdStr = String(spawnCall[0]);
      expect(cmdStr).toContain('echo');
    });

    it('sets AETHER_PID, AETHER_ROLE, AETHER_GOAL env vars', async () => {
      const cp = await import('node:child_process');

      await sub.start(42, makeConfig({ role: 'TestRole', goal: 'TestGoal' }), '/tmp/work');

      const spawnOpts = vi.mocked(cp.spawn).mock.calls[0][2] as any;
      expect(spawnOpts.env.AETHER_PID).toBe('42');
      expect(spawnOpts.env.AETHER_ROLE).toBe('TestRole');
      expect(spawnOpts.env.AETHER_GOAL).toBe('TestGoal');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles process with pid 0 (undefined)', async () => {
      mockChild = createMockChild({ pid: undefined as any });
      mockChild.pid = undefined;

      const info = await sub.start(1, makeConfig(), '/tmp/work');
      expect(info.osPid).toBe(0);
    });

    it('handles null exit code and signal', async () => {
      const handler = vi.fn();
      bus.on('subprocess.exited', handler);

      await sub.start(1, makeConfig(), '/tmp/work');
      mockChild.emit('exit', null, null);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1,
          code: null,
          signal: null,
        }),
      );
    });

    it('handles config without runtime (defaults to builtin)', async () => {
      const config: AgentConfig = { role: 'Test', goal: 'Test' };
      const info = await sub.start(1, config, '/tmp/work');
      expect(info.runtime).toBe('builtin');
    });
  });
});
