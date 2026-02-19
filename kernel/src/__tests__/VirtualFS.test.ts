import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { VirtualFS } from '../VirtualFS.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import os from 'node:os';

describe('VirtualFS', () => {
  let bus: EventBus;
  let vfs: VirtualFS;
  let testRoot: string;

  beforeEach(async () => {
    bus = new EventBus();
    testRoot = path.join(os.tmpdir(), `aether-test-${crypto.randomBytes(8).toString('hex')}`);
    vfs = new VirtualFS(bus, testRoot);
    await vfs.init();
  });

  afterEach(async () => {
    await vfs.shutdown();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  describe('init()', () => {
    it('creates directory structure', async () => {
      const homeDir = path.join(testRoot, 'home');
      const tmpDir = path.join(testRoot, 'tmp');
      const etcDir = path.join(testRoot, 'etc');

      const [homeStat, tmpStat, etcStat] = await Promise.all([
        fs.stat(homeDir),
        fs.stat(tmpDir),
        fs.stat(etcDir),
      ]);

      expect(homeStat.isDirectory()).toBe(true);
      expect(tmpStat.isDirectory()).toBe(true);
      expect(etcStat.isDirectory()).toBe(true);
    });
  });

  describe('createHome()', () => {
    it('creates home directories for an agent', async () => {
      const homePath = await vfs.createHome('agent_1');
      expect(homePath).toBe('/home/agent_1');

      const desktopExists = await fs.stat(path.join(testRoot, 'home', 'agent_1', 'Desktop'));
      expect(desktopExists.isDirectory()).toBe(true);

      const docsExists = await fs.stat(path.join(testRoot, 'home', 'agent_1', 'Documents'));
      expect(docsExists.isDirectory()).toBe(true);

      const downloadsExists = await fs.stat(path.join(testRoot, 'home', 'agent_1', 'Downloads'));
      expect(downloadsExists.isDirectory()).toBe(true);

      const projectsExists = await fs.stat(path.join(testRoot, 'home', 'agent_1', 'Projects'));
      expect(projectsExists.isDirectory()).toBe(true);
    });
  });

  describe('readFile / writeFile', () => {
    it('round-trips file content', async () => {
      await vfs.createHome('agent_1');
      const filePath = '/home/agent_1/test.txt';
      const content = 'Hello, Aether!';

      await vfs.writeFile(filePath, content);
      const result = await vfs.readFile(filePath);

      expect(result.content).toBe(content);
      expect(result.size).toBe(Buffer.byteLength(content));
    });

    it('creates parent directories if needed', async () => {
      await vfs.createHome('agent_1');
      await vfs.writeFile('/home/agent_1/deep/nested/file.txt', 'deep content');
      const result = await vfs.readFile('/home/agent_1/deep/nested/file.txt');
      expect(result.content).toBe('deep content');
    });
  });

  describe('mkdir()', () => {
    it('creates directory with recursive flag', async () => {
      await vfs.mkdir('/home/agent_1/a/b/c', true);
      const stat = await fs.stat(path.join(testRoot, 'home', 'agent_1', 'a', 'b', 'c'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('rm()', () => {
    it('removes a file', async () => {
      await vfs.createHome('agent_1');
      await vfs.writeFile('/home/agent_1/delete_me.txt', 'gone');
      await vfs.rm('/home/agent_1/delete_me.txt');

      await expect(vfs.readFile('/home/agent_1/delete_me.txt')).rejects.toThrow();
    });

    it('removes directory recursively', async () => {
      await vfs.mkdir('/home/agent_1/dir_to_delete/sub', true);
      await vfs.writeFile('/home/agent_1/dir_to_delete/sub/file.txt', 'data');
      await vfs.rm('/home/agent_1/dir_to_delete', true);

      await expect(vfs.stat('/home/agent_1/dir_to_delete')).rejects.toThrow();
    });
  });

  describe('ls()', () => {
    it('returns correct FileStat entries', async () => {
      await vfs.createHome('agent_1');
      await vfs.writeFile('/home/agent_1/file1.txt', 'content1');
      await vfs.writeFile('/home/agent_1/file2.txt', 'content2');

      const entries = await vfs.ls('/home/agent_1');
      const names = entries.map((e) => e.name);

      // Home directory has Desktop, Documents, Downloads, Projects, .config, .profile, file1.txt, file2.txt
      expect(names).toContain('Desktop');
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');

      // Directories sort before files
      const firstDir = entries.findIndex((e) => e.type === 'directory');
      const firstFile = entries.findIndex((e) => e.type === 'file');
      if (firstDir !== -1 && firstFile !== -1) {
        expect(firstDir).toBeLessThan(firstFile);
      }
    });
  });

  describe('stat()', () => {
    it('returns correct metadata', async () => {
      await vfs.createHome('agent_1');
      await vfs.writeFile('/home/agent_1/info.txt', 'some data');
      const stat = await vfs.stat('/home/agent_1/info.txt');

      expect(stat.type).toBe('file');
      expect(stat.name).toBe('info.txt');
      expect(stat.size).toBeGreaterThan(0);
      expect(stat.isHidden).toBe(false);
    });

    it('identifies hidden files', async () => {
      await vfs.createHome('agent_1');
      const stat = await vfs.stat('/home/agent_1/.profile');
      expect(stat.isHidden).toBe(true);
    });
  });

  describe('mv()', () => {
    it('moves a file', async () => {
      await vfs.createHome('agent_1');
      await vfs.writeFile('/home/agent_1/old.txt', 'data');
      await vfs.mv('/home/agent_1/old.txt', '/home/agent_1/new.txt');

      const result = await vfs.readFile('/home/agent_1/new.txt');
      expect(result.content).toBe('data');
      await expect(vfs.readFile('/home/agent_1/old.txt')).rejects.toThrow();
    });
  });

  describe('cp()', () => {
    it('copies a file', async () => {
      await vfs.createHome('agent_1');
      await vfs.writeFile('/home/agent_1/source.txt', 'copy me');
      await vfs.cp('/home/agent_1/source.txt', '/home/agent_1/dest.txt');

      const source = await vfs.readFile('/home/agent_1/source.txt');
      const dest = await vfs.readFile('/home/agent_1/dest.txt');
      expect(source.content).toBe('copy me');
      expect(dest.content).toBe('copy me');
    });
  });

  describe('path traversal prevention', () => {
    it('throws on ../../etc/passwd', async () => {
      await expect(vfs.readFile('../../etc/passwd')).rejects.toThrow('Access denied');
    });

    it('throws on absolute path outside root', async () => {
      await expect(vfs.readFile('/../../etc/passwd')).rejects.toThrow();
    });
  });

  describe('shared mounts', () => {
    it('createSharedMount creates directory', async () => {
      const mount = await vfs.createSharedMount('workspace-1', 1);
      expect(mount.name).toBe('workspace-1');
      expect(mount.path).toBe('/shared/workspace-1');
      expect(mount.ownerPid).toBe(1);

      const dirStat = await fs.stat(path.join(testRoot, 'shared', 'workspace-1'));
      expect(dirStat.isDirectory()).toBe(true);
    });

    it('mountShared creates symlink', async () => {
      await vfs.createSharedMount('workspace-1', 1);
      await vfs.createHome('agent_2');
      await vfs.mountShared(2, 'workspace-1');

      const linkPath = path.join(testRoot, 'home', 'agent_2', 'shared', 'workspace-1');
      const linkStat = await fs.lstat(linkPath);
      expect(linkStat.isSymbolicLink()).toBe(true);
    });

    it('unmountShared removes symlink', async () => {
      await vfs.createSharedMount('workspace-1', 1);
      await vfs.createHome('agent_2');
      await vfs.mountShared(2, 'workspace-1');
      await vfs.unmountShared(2, 'workspace-1');

      const linkPath = path.join(testRoot, 'home', 'agent_2', 'shared', 'workspace-1');
      await expect(fs.lstat(linkPath)).rejects.toThrow();
    });

    it('rejects invalid mount names', async () => {
      await expect(vfs.createSharedMount('../evil', 1)).rejects.toThrow();
    });
  });
});
