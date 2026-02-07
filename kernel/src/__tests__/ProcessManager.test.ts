import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { ProcessManager } from '../ProcessManager.js';
import type { AgentConfig } from '@aether/shared';

describe('ProcessManager', () => {
  let bus: EventBus;
  let pm: ProcessManager;

  const testConfig: AgentConfig = {
    role: 'Coder',
    goal: 'Write tests',
  };

  beforeEach(() => {
    bus = new EventBus();
    pm = new ProcessManager(bus);
  });

  describe('spawn()', () => {
    it('allocates sequential PIDs', () => {
      const p1 = pm.spawn(testConfig);
      const p2 = pm.spawn(testConfig);
      const p3 = pm.spawn(testConfig);

      expect(p1.info.pid).toBe(1);
      expect(p2.info.pid).toBe(2);
      expect(p3.info.pid).toBe(3);
    });

    it('creates ProcessInfo correctly', () => {
      const proc = pm.spawn(testConfig, 0, 'user_123');

      expect(proc.info.ppid).toBe(0);
      expect(proc.info.uid).toBe('agent_1');
      expect(proc.info.ownerUid).toBe('user_123');
      expect(proc.info.name).toBe('Coder Agent');
      expect(proc.info.state).toBe('created');
      expect(proc.info.agentPhase).toBe('booting');
      expect(proc.info.cwd).toBe('/home/agent_1');
      expect(proc.info.env.AETHER_ROLE).toBe('Coder');
      expect(proc.info.env.AETHER_GOAL).toBe('Write tests');
      expect(proc.agentConfig).toEqual(testConfig);
      expect(proc.messageQueue).toEqual([]);
    });

    it('emits process.spawned event', () => {
      const handler = vi.fn();
      bus.on('process.spawned', handler);
      pm.spawn(testConfig);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].pid).toBe(1);
    });

    it('rejects when MAX_PROCESSES (64) reached', () => {
      // Fill up the process table with non-dead processes
      for (let i = 0; i < 64; i++) {
        const proc = pm.spawn(testConfig);
        pm.setState(proc.info.pid, 'running');
      }
      expect(() => pm.spawn(testConfig)).toThrow('Process table full');
    });

    it('defaults ownerUid to root when not provided', () => {
      const proc = pm.spawn(testConfig);
      expect(proc.info.ownerUid).toBe('root');
    });
  });

  describe('signal()', () => {
    it('SIGTERM transitions running to zombie and emits exit', () => {
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running');

      const exitHandler = vi.fn();
      bus.on('process.exit', exitHandler);

      const result = pm.signal(proc.info.pid, 'SIGTERM');
      expect(result).toBe(true);
      expect(proc.info.state).toBe('zombie');
      expect(exitHandler).toHaveBeenCalledWith(
        expect.objectContaining({ pid: proc.info.pid, code: 143, signal: 'SIGTERM' }),
      );
    });

    it('SIGKILL immediately kills', () => {
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running');

      const exitHandler = vi.fn();
      bus.on('process.exit', exitHandler);

      const result = pm.signal(proc.info.pid, 'SIGKILL');
      expect(result).toBe(true);
      expect(proc.info.state).toBe('zombie');
      expect(exitHandler).toHaveBeenCalledWith(
        expect.objectContaining({ pid: proc.info.pid, code: 137, signal: 'SIGKILL' }),
      );
    });

    it('SIGSTOP transitions running to stopped', () => {
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running');

      const result = pm.signal(proc.info.pid, 'SIGSTOP');
      expect(result).toBe(true);
      expect(proc.info.state).toBe('stopped');
    });

    it('SIGCONT resumes a stopped process', () => {
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running');
      pm.signal(proc.info.pid, 'SIGSTOP');
      expect(proc.info.state).toBe('stopped');

      const result = pm.signal(proc.info.pid, 'SIGCONT');
      expect(result).toBe(true);
      expect(proc.info.state).toBe('running');
    });

    it('returns false for dead processes', () => {
      const proc = pm.spawn(testConfig);
      pm.reap(proc.info.pid);
      expect(proc.info.state).toBe('dead');

      const result = pm.signal(proc.info.pid, 'SIGTERM');
      expect(result).toBe(false);
    });

    it('returns false for unknown PID', () => {
      const result = pm.signal(999, 'SIGTERM');
      expect(result).toBe(false);
    });
  });

  describe('setState()', () => {
    it('updates both ProcessState and AgentPhase', () => {
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running', 'thinking');

      expect(proc.info.state).toBe('running');
      expect(proc.info.agentPhase).toBe('thinking');
    });

    it('emits process.stateChange event', () => {
      const handler = vi.fn();
      bus.on('process.stateChange', handler);
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running', 'executing');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: proc.info.pid,
          state: 'running',
          previousState: 'created',
          agentPhase: 'executing',
        }),
      );
    });
  });

  describe('reap()', () => {
    it('transitions to dead and clears IPC queue', () => {
      const proc = pm.spawn(testConfig);
      pm.setState(proc.info.pid, 'running');
      // Add a fake message
      proc.messageQueue.push({
        id: 'msg_1',
        fromPid: 2,
        toPid: proc.info.pid,
        fromUid: 'agent_2',
        toUid: proc.info.uid,
        channel: 'test',
        payload: 'hello',
        timestamp: Date.now(),
        delivered: false,
      });

      pm.reap(proc.info.pid);
      expect(proc.info.state).toBe('dead');
      expect(proc.messageQueue).toEqual([]);
    });

    it('emits process.reaped event', () => {
      const handler = vi.fn();
      bus.on('process.reaped', handler);
      const proc = pm.spawn(testConfig);
      pm.reap(proc.info.pid);

      expect(handler).toHaveBeenCalledWith({ pid: proc.info.pid });
    });
  });

  describe('IPC', () => {
    it('sendMessage delivers to target process queue', () => {
      const p1 = pm.spawn(testConfig);
      const p2 = pm.spawn(testConfig);
      pm.setState(p1.info.pid, 'running');
      pm.setState(p2.info.pid, 'running');

      const msg = pm.sendMessage(p1.info.pid, p2.info.pid, 'chat', 'Hello!');
      expect(msg).not.toBeNull();
      expect(msg!.fromPid).toBe(p1.info.pid);
      expect(msg!.toPid).toBe(p2.info.pid);
      expect(msg!.channel).toBe('chat');
      expect(msg!.payload).toBe('Hello!');
      expect(p2.messageQueue).toHaveLength(1);
    });

    it('drainMessages empties queue and marks delivered', () => {
      const p1 = pm.spawn(testConfig);
      const p2 = pm.spawn(testConfig);
      pm.setState(p1.info.pid, 'running');
      pm.setState(p2.info.pid, 'running');

      pm.sendMessage(p1.info.pid, p2.info.pid, 'chat', 'msg1');
      pm.sendMessage(p1.info.pid, p2.info.pid, 'chat', 'msg2');

      const messages = pm.drainMessages(p2.info.pid);
      expect(messages).toHaveLength(2);
      expect(messages[0].delivered).toBe(true);
      expect(messages[1].delivered).toBe(true);
      expect(p2.messageQueue).toHaveLength(0);
    });

    it('returns null when source or target is dead', () => {
      const p1 = pm.spawn(testConfig);
      pm.setState(p1.info.pid, 'running');
      const result = pm.sendMessage(p1.info.pid, 999, 'chat', 'Hello');
      expect(result).toBeNull();
    });
  });

  describe('getCounts()', () => {
    it('returns correct tallies per state', () => {
      const p1 = pm.spawn(testConfig);
      const p2 = pm.spawn(testConfig);
      const p3 = pm.spawn(testConfig);

      pm.setState(p1.info.pid, 'running');
      pm.setState(p2.info.pid, 'running');
      pm.setState(p3.info.pid, 'stopped');

      const counts = pm.getCounts();
      expect(counts.running).toBe(2);
      expect(counts.stopped).toBe(1);
      expect(counts.created).toBe(0);
    });
  });

  describe('isOwner()', () => {
    it('returns true for process owner', () => {
      const proc = pm.spawn(testConfig, 0, 'user_1');
      expect(pm.isOwner(proc.info.pid, 'user_1')).toBe(true);
    });

    it('returns false for non-owner', () => {
      const proc = pm.spawn(testConfig, 0, 'user_1');
      expect(pm.isOwner(proc.info.pid, 'user_2')).toBe(false);
    });

    it('respects admin bypass', () => {
      const proc = pm.spawn(testConfig, 0, 'user_1');
      expect(pm.isOwner(proc.info.pid, 'user_2', true)).toBe(true);
    });

    it('returns true when ownerUid is undefined (root access)', () => {
      const proc = pm.spawn(testConfig, 0, 'user_1');
      expect(pm.isOwner(proc.info.pid, undefined)).toBe(true);
    });
  });

  describe('getActiveByOwner()', () => {
    it('filters correctly for users vs admins', () => {
      pm.spawn(testConfig, 0, 'user_1');
      pm.spawn(testConfig, 0, 'user_2');
      pm.spawn(testConfig, 0, 'user_1');

      const user1Procs = pm.getActiveByOwner('user_1');
      expect(user1Procs).toHaveLength(2);

      const adminProcs = pm.getActiveByOwner('admin_user', true);
      expect(adminProcs).toHaveLength(3);
    });
  });
});
