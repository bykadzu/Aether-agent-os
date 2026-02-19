import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventBus } from '../EventBus.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock node-pty (native module that may not be available in test)
vi.mock('node-pty', () => {
  const NodeEventEmitter = require('node:events').EventEmitter;
  return {
    spawn: vi.fn(() => {
      const pty = new NodeEventEmitter() as any;
      pty.write = vi.fn();
      pty.resize = vi.fn();
      pty.kill = vi.fn();
      pty.onData = vi.fn((cb: (data: string) => void) => {
        pty._onDataCb = cb;
        return { dispose: vi.fn() };
      });
      pty.onExit = vi.fn((cb: (e: { exitCode: number; signal: number }) => void) => {
        pty._onExitCb = cb;
        return { dispose: vi.fn() };
      });
      return pty;
    }),
  };
});

// Mock node:fs so mkdirSync doesn't touch the real filesystem
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock ContainerManager. */
function createMockContainerManager() {
  return {
    spawnShell: vi.fn(() => null), // returns null = no container
    exec: vi.fn(),
    resizeTTY: vi.fn(),
  };
}

/**
 * Build a fake ChildProcess-like object that ContainerManager.spawnShell can
 * return when a container IS available.
 */
function createMockChildProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { writable: true, write: vi.fn() };
  proc.kill = vi.fn();
  proc.killed = false;
  return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PTYManager', () => {
  let bus: EventBus;
  let PTYManager: typeof import('../PTYManager.js').PTYManager;
  let ptyMod: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    bus = new EventBus();

    // Import after mocks are installed so they take effect
    const mod = await import('../PTYManager.js');
    PTYManager = mod.PTYManager;
    ptyMod = await import('node-pty');
  });

  // -----------------------------------------------------------------------
  // 1. open() without container
  // -----------------------------------------------------------------------
  describe('open() without container', () => {
    it('creates a local PTY session and emits tty.opened', () => {
      const mgr = new PTYManager(bus);
      const events: any[] = [];
      bus.on('tty.opened', (e: any) => events.push(e));

      const session = mgr.open(42);

      // Session properties
      expect(session.id).toMatch(/^tty_42_/);
      expect(session.pid).toBe(42);
      expect(session.containerized).toBe(false);
      expect(session.ptyProcess).toBeTruthy();
      expect(session.process).toBeNull();

      // node-pty.spawn was called
      expect(ptyMod.spawn).toHaveBeenCalledOnce();

      // tty.opened event emitted with correct payload
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ ttyId: session.id, pid: 42 }));
    });
  });

  // -----------------------------------------------------------------------
  // 2. open() with container
  // -----------------------------------------------------------------------
  describe('open() with container', () => {
    it('creates a container session when containerManager.spawnShell returns a process', () => {
      const mockCM = createMockContainerManager();
      const childProc = createMockChildProcess();
      mockCM.spawnShell.mockReturnValue(childProc);

      const mgr = new PTYManager(bus, mockCM as any);
      const events: any[] = [];
      bus.on('tty.opened', (e: any) => events.push(e));

      const session = mgr.open(7);

      expect(session.containerized).toBe(true);
      expect(session.process).toBe(childProc);
      expect(session.ptyProcess).toBeNull();
      expect(session.pid).toBe(7);

      // node-pty.spawn should NOT have been called
      expect(ptyMod.spawn).not.toHaveBeenCalled();

      // tty.opened emitted
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ ttyId: session.id, pid: 7 }));
    });
  });

  // -----------------------------------------------------------------------
  // 3. write() - local PTY
  // -----------------------------------------------------------------------
  describe('write()', () => {
    it('writes to local PTY process', () => {
      const mgr = new PTYManager(bus);
      const session = mgr.open(1);

      const result = mgr.write(session.id, 'ls -la\n');

      expect(result).toBe(true);
      expect(session.ptyProcess!.write).toHaveBeenCalledWith('ls -la\n');
    });

    it('writes to container stdin', () => {
      const mockCM = createMockContainerManager();
      const childProc = createMockChildProcess();
      mockCM.spawnShell.mockReturnValue(childProc);

      const mgr = new PTYManager(bus, mockCM as any);
      const session = mgr.open(2);

      const result = mgr.write(session.id, 'echo hello\n');

      expect(result).toBe(true);
      expect(childProc.stdin.write).toHaveBeenCalledWith('echo hello\n');
    });

    // -------------------------------------------------------------------
    // 4. write() returns false for unknown ttyId
    // -------------------------------------------------------------------
    it('returns false for unknown ttyId', () => {
      const mgr = new PTYManager(bus);

      const result = mgr.write('tty_nonexistent', 'data');

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 5. resize() - local session
  // -----------------------------------------------------------------------
  describe('resize()', () => {
    it('calls ptyProcess.resize for local sessions', () => {
      const mgr = new PTYManager(bus);
      const session = mgr.open(10);

      const result = mgr.resize(session.id, 200, 50);

      expect(result).toBe(true);
      expect(session.ptyProcess!.resize).toHaveBeenCalledWith(200, 50);
    });

    // -------------------------------------------------------------------
    // 6. resize() returns false for unknown ttyId
    // -------------------------------------------------------------------
    it('returns false for unknown ttyId', () => {
      const mgr = new PTYManager(bus);

      const result = mgr.resize('tty_nope', 80, 24);

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 7. close() - local PTY
  // -----------------------------------------------------------------------
  describe('close()', () => {
    it('kills local PTY process and removes session', () => {
      const mgr = new PTYManager(bus);
      const session = mgr.open(20);
      const ttyId = session.id;

      mgr.close(ttyId);

      expect(session.ptyProcess!.kill).toHaveBeenCalledOnce();
      expect(mgr.get(ttyId)).toBeUndefined();
    });

    // -------------------------------------------------------------------
    // 8. close() - container process
    // -------------------------------------------------------------------
    it('kills container process with SIGTERM', () => {
      const mockCM = createMockContainerManager();
      const childProc = createMockChildProcess();
      mockCM.spawnShell.mockReturnValue(childProc);

      const mgr = new PTYManager(bus, mockCM as any);
      const session = mgr.open(21);
      const ttyId = session.id;

      mgr.close(ttyId);

      expect(childProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mgr.get(ttyId)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 9. get()
  // -----------------------------------------------------------------------
  describe('get()', () => {
    it('returns a session by ID', () => {
      const mgr = new PTYManager(bus);
      const session = mgr.open(30);

      expect(mgr.get(session.id)).toBe(session);
    });

    it('returns undefined for unknown ID', () => {
      const mgr = new PTYManager(bus);

      expect(mgr.get('tty_unknown')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 10. getByPid()
  // -----------------------------------------------------------------------
  describe('getByPid()', () => {
    it('returns all sessions for a given PID', () => {
      const mgr = new PTYManager(bus);
      const s1 = mgr.open(50);
      const s2 = mgr.open(50);
      mgr.open(99); // different PID

      const sessions = mgr.getByPid(50);

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
    });

    it('returns empty array when no sessions exist for PID', () => {
      const mgr = new PTYManager(bus);

      expect(mgr.getByPid(999)).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 11. shutdown()
  // -----------------------------------------------------------------------
  describe('shutdown()', () => {
    it('closes all sessions', async () => {
      const mgr = new PTYManager(bus);
      const s1 = mgr.open(60);
      const s2 = mgr.open(61);

      await mgr.shutdown();

      expect(s1.ptyProcess!.kill).toHaveBeenCalledOnce();
      expect(s2.ptyProcess!.kill).toHaveBeenCalledOnce();
      expect(mgr.get(s1.id)).toBeUndefined();
      expect(mgr.get(s2.id)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 12. setContainerManager()
  // -----------------------------------------------------------------------
  describe('setContainerManager()', () => {
    it('sets the container manager so subsequent open() uses it', () => {
      const mgr = new PTYManager(bus);
      const mockCM = createMockContainerManager();
      const childProc = createMockChildProcess();
      mockCM.spawnShell.mockReturnValue(childProc);

      // Before setting CM, open() should use local PTY
      const localSession = mgr.open(70);
      expect(localSession.containerized).toBe(false);

      // Set the container manager
      mgr.setContainerManager(mockCM as any);

      // Now open() should try the container path
      const containerSession = mgr.open(71);
      expect(containerSession.containerized).toBe(true);
      expect(mockCM.spawnShell).toHaveBeenCalledTimes(1);
    });
  });
});
