import { describe, it, expect } from 'vitest';
import {
  createMessageId,
  type KernelCommand,
  type KernelEvent,
  type PID,
  type Signal,
  type ProcessState,
  type AgentPhase,
  type FileType,
  type ContainerStatus,
  type NodeStatus,
  type ClusterRole,
} from '../protocol.js';
import {
  AETHER_VERSION,
  MAX_PROCESSES,
  DEFAULT_PORT,
  AETHER_ROOT,
  AUTH_TOKEN_EXPIRY,
  IPC_QUEUE_MAX_LENGTH,
  DEFAULT_AGENT_MAX_STEPS,
} from '../constants.js';

describe('Protocol', () => {
  describe('createMessageId()', () => {
    it('returns unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(createMessageId());
      }
      expect(ids.size).toBe(100);
    });

    it('returns IDs with correct msg_ prefix', () => {
      const id = createMessageId();
      expect(id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    });
  });

  describe('KernelCommand types', () => {
    it('can construct process.spawn command', () => {
      const cmd: KernelCommand = {
        type: 'process.spawn',
        id: 'test_1',
        config: { role: 'Coder', goal: 'Write code' },
      };
      expect(cmd.type).toBe('process.spawn');
    });

    it('can construct process.signal command', () => {
      const cmd: KernelCommand = {
        type: 'process.signal',
        id: 'test_2',
        pid: 1,
        signal: 'SIGTERM',
      };
      expect(cmd.type).toBe('process.signal');
    });

    it('can construct fs.read command', () => {
      const cmd: KernelCommand = { type: 'fs.read', id: 'test_3', path: '/home/agent/file.txt' };
      expect(cmd.type).toBe('fs.read');
    });

    it('can construct fs.write command', () => {
      const cmd: KernelCommand = {
        type: 'fs.write',
        id: 'test_4',
        path: '/home/agent/file.txt',
        content: 'hello',
      };
      expect(cmd.type).toBe('fs.write');
    });

    it('can construct tty.open command', () => {
      const cmd: KernelCommand = { type: 'tty.open', id: 'test_5', pid: 1, cols: 80, rows: 24 };
      expect(cmd.type).toBe('tty.open');
    });

    it('can construct ipc.send command', () => {
      const cmd: KernelCommand = {
        type: 'ipc.send',
        id: 'test_6',
        fromPid: 1,
        toPid: 2,
        channel: 'chat',
        payload: 'hello',
      };
      expect(cmd.type).toBe('ipc.send');
    });

    it('can construct auth.login command', () => {
      const cmd: KernelCommand = {
        type: 'auth.login',
        id: 'test_7',
        username: 'admin',
        password: 'pass',
      };
      expect(cmd.type).toBe('auth.login');
    });

    it('can construct snapshot.create command', () => {
      const cmd: KernelCommand = {
        type: 'snapshot.create',
        id: 'test_8',
        pid: 1,
        description: 'save state',
      };
      expect(cmd.type).toBe('snapshot.create');
    });

    it('can construct cluster.status command', () => {
      const cmd: KernelCommand = { type: 'cluster.status', id: 'test_9' };
      expect(cmd.type).toBe('cluster.status');
    });

    it('can construct kernel.status command', () => {
      const cmd: KernelCommand = { type: 'kernel.status', id: 'test_10' };
      expect(cmd.type).toBe('kernel.status');
    });

    it('can construct kernel.shutdown command', () => {
      const cmd: KernelCommand = { type: 'kernel.shutdown', id: 'test_11' };
      expect(cmd.type).toBe('kernel.shutdown');
    });

    it('can construct gpu.list command', () => {
      const cmd: KernelCommand = { type: 'gpu.list', id: 'test_12' };
      expect(cmd.type).toBe('gpu.list');
    });

    it('can construct fs.createShared command', () => {
      const cmd: KernelCommand = {
        type: 'fs.createShared',
        id: 'test_13',
        name: 'workspace',
        ownerPid: 1,
      };
      expect(cmd.type).toBe('fs.createShared');
    });
  });

  describe('KernelEvent types', () => {
    it('can construct response.ok event', () => {
      const evt: KernelEvent = { type: 'response.ok', id: 'test_1', data: { pid: 1 } };
      expect(evt.type).toBe('response.ok');
    });

    it('can construct response.error event', () => {
      const evt: KernelEvent = { type: 'response.error', id: 'test_2', error: 'Not found' };
      expect(evt.type).toBe('response.error');
    });

    it('can construct process.spawned event', () => {
      const evt: KernelEvent = {
        type: 'process.spawned',
        pid: 1,
        info: {
          pid: 1,
          ppid: 0,
          uid: 'agent_1',
          name: 'Test Agent',
          command: 'test',
          state: 'created',
          cwd: '/home/agent_1',
          env: {},
          createdAt: Date.now(),
          cpuPercent: 0,
          memoryMB: 0,
        },
      };
      expect(evt.type).toBe('process.spawned');
    });

    it('can construct agent.thought event', () => {
      const evt: KernelEvent = {
        type: 'agent.thought',
        pid: 1,
        thought: 'I should write code',
      };
      expect(evt.type).toBe('agent.thought');
    });

    it('can construct ipc.message event', () => {
      const evt: KernelEvent = {
        type: 'ipc.message',
        message: {
          id: 'msg_1',
          fromPid: 1,
          toPid: 2,
          fromUid: 'agent_1',
          toUid: 'agent_2',
          channel: 'chat',
          payload: 'hello',
          timestamp: Date.now(),
          delivered: false,
        },
      };
      expect(evt.type).toBe('ipc.message');
    });

    it('can construct kernel.ready event', () => {
      const evt: KernelEvent = { type: 'kernel.ready', version: '0.1.0', uptime: 0 };
      expect(evt.type).toBe('kernel.ready');
    });
  });

  describe('Constants', () => {
    it('AETHER_VERSION is defined', () => {
      expect(AETHER_VERSION).toBe('0.1.0');
    });

    it('MAX_PROCESSES is 64', () => {
      expect(MAX_PROCESSES).toBe(64);
    });

    it('DEFAULT_PORT is 3001', () => {
      expect(DEFAULT_PORT).toBe(3001);
    });

    it('AETHER_ROOT respects AETHER_FS_ROOT env or defaults to ~/.aether', () => {
      if (process.env.AETHER_FS_ROOT) {
        expect(AETHER_ROOT).toBe(process.env.AETHER_FS_ROOT);
      } else {
        const os = require('node:os');
        const path = require('node:path');
        expect(AETHER_ROOT).toBe(path.join(os.homedir(), '.aether'));
      }
    });

    it('AUTH_TOKEN_EXPIRY is 24 hours', () => {
      expect(AUTH_TOKEN_EXPIRY).toBe(24 * 60 * 60 * 1000);
    });

    it('IPC_QUEUE_MAX_LENGTH is 100', () => {
      expect(IPC_QUEUE_MAX_LENGTH).toBe(100);
    });

    it('DEFAULT_AGENT_MAX_STEPS is 50', () => {
      expect(DEFAULT_AGENT_MAX_STEPS).toBe(50);
    });
  });

  describe('Type assertions', () => {
    it('ProcessState values are valid', () => {
      const states: ProcessState[] = [
        'created',
        'running',
        'sleeping',
        'stopped',
        'paused',
        'zombie',
        'dead',
      ];
      expect(states).toHaveLength(7);
    });

    it('AgentPhase values are valid', () => {
      const phases: AgentPhase[] = [
        'booting',
        'thinking',
        'executing',
        'waiting',
        'observing',
        'idle',
        'completed',
        'failed',
      ];
      expect(phases).toHaveLength(8);
    });

    it('Signal values are valid', () => {
      const signals: Signal[] = [
        'SIGTERM',
        'SIGKILL',
        'SIGSTOP',
        'SIGCONT',
        'SIGINT',
        'SIGUSR1',
        'SIGUSR2',
      ];
      expect(signals).toHaveLength(7);
    });
  });
});
