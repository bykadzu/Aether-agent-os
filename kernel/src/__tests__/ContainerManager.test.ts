import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../EventBus.js';
import { ContainerManager } from '../ContainerManager.js';

// Mock child_process so Docker detection doesn't run real commands
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    throw new Error('not available');
  }),
  spawn: vi.fn(),
}));

// Mock fs so workspace methods don't touch real filesystem
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    rmSync: vi.fn(),
  };
});

describe('ContainerManager', () => {
  let bus: EventBus;
  let cm: ContainerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    cm = new ContainerManager(bus);
  });

  describe('createWorkspace()', () => {
    it('creates workspace directory and returns path', () => {
      const result = cm.createWorkspace('test-agent');

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('workspaces', 'test-agent')),
        { recursive: true },
      );
      expect(result).toContain(path.join('workspaces', 'test-agent'));
    });

    it('creates workspace for agent names with special characters', () => {
      const result = cm.createWorkspace('coder-1');

      expect(fs.mkdirSync).toHaveBeenCalledOnce();
      expect(result).toContain('coder-1');
    });
  });

  describe('listWorkspaces()', () => {
    it('returns workspace directory names', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'agent-alpha', isDirectory: () => true, isFile: () => false } as any,
        { name: 'agent-beta', isDirectory: () => true, isFile: () => false } as any,
      ]);

      const result = cm.listWorkspaces();

      expect(result).toEqual(['agent-alpha', 'agent-beta']);
    });

    it('filters out non-directory entries', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'agent-alpha', isDirectory: () => true, isFile: () => false } as any,
        { name: 'some-file.txt', isDirectory: () => false, isFile: () => true } as any,
      ]);

      const result = cm.listWorkspaces();

      expect(result).toEqual(['agent-alpha']);
    });

    it('returns empty array when workspaces dir does not exist', () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = cm.listWorkspaces();

      expect(result).toEqual([]);
    });
  });

  describe('cleanupWorkspace()', () => {
    it('removes workspace directory and returns true', () => {
      const result = cm.cleanupWorkspace('old-agent');

      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('workspaces', 'old-agent')),
        { recursive: true, force: true },
      );
      expect(result).toBe(true);
    });

    it('returns false on fs error', () => {
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = cm.cleanupWorkspace('nonexistent');

      expect(result).toBe(false);
    });

    it('rejects path traversal attempts', () => {
      const result = cm.cleanupWorkspace('../../../etc');

      // Should not call rmSync for paths that escape workspaces root
      // The resolved path would escape the workspaces directory
      expect(result).toBe(false);
    });
  });

  describe('create()', () => {
    it('returns null when Docker is not available', async () => {
      // Docker is unavailable by default (execFileSync throws in mock)
      await cm.init();

      const result = await cm.create(1, '/some/path');

      expect(result).toBeNull();
    });

    it('uses correct volume mount path format in docker args', async () => {
      // Make Docker appear available
      const { execFileSync, execFile } = await import('node:child_process');
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        if (cb) cb(null, 'abc123containerid', '');
        return { kill: vi.fn(), on: vi.fn() } as any;
      });

      await cm.init();

      const workspacePath = '/home/user/.aether/workspaces/test-agent';
      await cm.create(1, workspacePath, {
        type: 'container',
        networkAccess: false,
      });

      // Verify execFile was called with the correct volume mount
      const execFileCalls = vi.mocked(execFile).mock.calls;
      const dockerRunCall = execFileCalls.find(
        (call: any[]) => call[0] === 'docker' && call[1]?.[0] === 'run',
      );

      expect(dockerRunCall).toBeDefined();
      const args = dockerRunCall![1] as string[];

      // Find the volume mount argument
      const vIdx = args.indexOf('-v');
      expect(vIdx).toBeGreaterThan(-1);
      const volumeArg = args[vIdx + 1];
      expect(volumeArg).toBe(`${workspacePath}:/home/aether:rw`);

      // Verify working directory
      const wIdx = args.indexOf('-w');
      expect(wIdx).toBeGreaterThan(-1);
      expect(args[wIdx + 1]).toBe('/home/aether');

      // Verify USER env
      expect(args).toContain('USER=aether');
      expect(args).toContain('HOME=/home/aether');
    });
  });

  describe('init()', () => {
    it('detects Docker unavailable gracefully', async () => {
      const { execFileSync } = await import('node:child_process');
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('not available');
      });

      await cm.init();

      expect(cm.isDockerAvailable()).toBe(false);
    });

    it('detects Docker available when execFileSync succeeds', async () => {
      const { execFileSync } = await import('node:child_process');
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));

      await cm.init();

      expect(cm.isDockerAvailable()).toBe(true);
    });
  });

  describe('remove()', () => {
    it('does NOT delete workspace directory on container removal (persistence)', async () => {
      // After removing a container, workspaces should survive
      const { execFileSync, execFile } = await import('node:child_process');
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
      vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        if (cb) cb(null, 'abc123', '');
        return { kill: vi.fn(), on: vi.fn() } as any;
      });

      await cm.init();

      const workspacePath = '/workspaces/test-agent';
      await cm.create(1, workspacePath);
      await cm.remove(1);

      // rmSync should NOT have been called for workspace cleanup
      // (rmSync mock calls are only from cleanupWorkspace, not remove)
      const rmCalls = vi.mocked(fs.rmSync).mock.calls;
      const workspaceRmCall = rmCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('test-agent'),
      );
      expect(workspaceRmCall).toBeUndefined();
    });
  });
});
