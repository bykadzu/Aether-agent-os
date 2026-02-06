/**
 * Aether Kernel - Virtual File System
 *
 * A real filesystem backed by the host OS's filesystem, but virtualized
 * with per-agent isolation. Each agent gets their own home directory,
 * and all paths are resolved relative to the Aether root.
 *
 * Structure:
 *   /home/<agent_id>/    - Agent home directories (real files on disk)
 *   /tmp/                - Shared temporary space
 *   /proc/               - Virtual: process information (generated on read)
 *   /etc/                - System configuration
 *
 * Security: path traversal prevention, per-agent access control.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { EventBus } from './EventBus.js';
import { FileStat, FileType, FileMode, AETHER_ROOT } from '@aether/shared';

const DEFAULT_MODE: FileMode = {
  owner: { read: true, write: true, execute: false },
  group: { read: true, write: false, execute: false },
  other: { read: true, write: false, execute: false },
};

export class VirtualFS {
  private root: string;
  private bus: EventBus;
  private watchers = new Map<string, ReturnType<typeof fsSync.watch>>();

  constructor(bus: EventBus, root?: string) {
    this.bus = bus;
    this.root = root || AETHER_ROOT;
  }

  /**
   * Initialize the filesystem - create base directories.
   */
  async init(): Promise<void> {
    const dirs = [
      this.root,
      path.join(this.root, 'home'),
      path.join(this.root, 'tmp'),
      path.join(this.root, 'etc'),
      path.join(this.root, 'var', 'log'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Write a basic /etc/hostname
    const hostnamePath = path.join(this.root, 'etc', 'hostname');
    try {
      await fs.access(hostnamePath);
    } catch {
      await fs.writeFile(hostnamePath, 'aether\n');
    }

    this.bus.emit('fs.initialized', { root: this.root });
  }

  /**
   * Create a home directory for an agent.
   */
  async createHome(uid: string): Promise<string> {
    const homePath = path.join(this.root, 'home', uid);
    const dirs = [
      homePath,
      path.join(homePath, 'Desktop'),
      path.join(homePath, 'Documents'),
      path.join(homePath, 'Downloads'),
      path.join(homePath, 'Projects'),
      path.join(homePath, '.config'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Create a basic .profile
    const profilePath = path.join(homePath, '.profile');
    try {
      await fs.access(profilePath);
    } catch {
      await fs.writeFile(profilePath, [
        `# Aether OS Agent Profile`,
        `export HOME="${path.posix.join('/home', uid)}"`,
        `export USER="${uid}"`,
        `export PS1="\\u@aether:\\w\\$ "`,
        '',
      ].join('\n'));
    }

    return `/home/${uid}`;
  }

  // -----------------------------------------------------------------------
  // Path Resolution & Security
  // -----------------------------------------------------------------------

  /**
   * Resolve a virtual path to a real filesystem path.
   * Prevents path traversal attacks.
   */
  private resolvePath(virtualPath: string): string {
    // Normalize and resolve the path
    const normalized = path.posix.normalize(virtualPath);

    // Map to real filesystem
    const realPath = path.join(this.root, normalized);

    // Security: ensure the resolved path is within our root
    const resolved = path.resolve(realPath);
    const resolvedRoot = path.resolve(this.root);
    if (!resolved.startsWith(resolvedRoot)) {
      throw new Error(`Access denied: path traversal detected (${virtualPath})`);
    }

    return resolved;
  }

  /**
   * Convert a real path back to a virtual path.
   */
  private toVirtualPath(realPath: string): string {
    const resolved = path.resolve(realPath);
    const resolvedRoot = path.resolve(this.root);
    return '/' + path.relative(resolvedRoot, resolved).split(path.sep).join('/');
  }

  // -----------------------------------------------------------------------
  // File Operations
  // -----------------------------------------------------------------------

  /**
   * Read a file's contents.
   */
  async readFile(virtualPath: string): Promise<{ content: string; size: number }> {
    const realPath = this.resolvePath(virtualPath);
    const content = await fs.readFile(realPath, 'utf-8');
    return { content, size: Buffer.byteLength(content) };
  }

  /**
   * Write content to a file (creates if doesn't exist).
   */
  async writeFile(virtualPath: string, content: string): Promise<void> {
    const realPath = this.resolvePath(virtualPath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(realPath), { recursive: true });
    await fs.writeFile(realPath, content, 'utf-8');

    this.bus.emit('fs.changed', {
      path: virtualPath,
      changeType: 'modify',
    });
  }

  /**
   * Create a directory.
   */
  async mkdir(virtualPath: string, recursive = false): Promise<void> {
    const realPath = this.resolvePath(virtualPath);
    await fs.mkdir(realPath, { recursive });

    this.bus.emit('fs.changed', {
      path: virtualPath,
      changeType: 'create',
    });
  }

  /**
   * Remove a file or directory.
   */
  async rm(virtualPath: string, recursive = false): Promise<void> {
    const realPath = this.resolvePath(virtualPath);
    await fs.rm(realPath, { recursive, force: true });

    this.bus.emit('fs.changed', {
      path: virtualPath,
      changeType: 'delete',
    });
  }

  /**
   * List directory contents.
   */
  async ls(virtualPath: string): Promise<FileStat[]> {
    const realPath = this.resolvePath(virtualPath);
    const entries = await fs.readdir(realPath, { withFileTypes: true });

    const stats: FileStat[] = [];
    for (const entry of entries) {
      const entryRealPath = path.join(realPath, entry.name);
      try {
        const stat = await fs.stat(entryRealPath);
        stats.push({
          path: path.posix.join(virtualPath, entry.name),
          name: entry.name,
          type: this.getFileType(entry),
          size: stat.size,
          mode: DEFAULT_MODE,
          uid: 'root', // TODO: track per-file ownership
          createdAt: stat.birthtimeMs,
          modifiedAt: stat.mtimeMs,
          isHidden: entry.name.startsWith('.'),
        });
      } catch {
        // Skip files we can't stat (e.g., broken symlinks)
      }
    }

    return stats.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get file/directory stats.
   */
  async stat(virtualPath: string): Promise<FileStat> {
    const realPath = this.resolvePath(virtualPath);
    const stat = await fs.stat(realPath);
    const name = path.basename(virtualPath) || '/';

    return {
      path: virtualPath,
      name,
      type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
      size: stat.size,
      mode: DEFAULT_MODE,
      uid: 'root',
      createdAt: stat.birthtimeMs,
      modifiedAt: stat.mtimeMs,
      isHidden: name.startsWith('.'),
    };
  }

  /**
   * Move/rename a file or directory.
   */
  async mv(from: string, to: string): Promise<void> {
    const realFrom = this.resolvePath(from);
    const realTo = this.resolvePath(to);
    await fs.mkdir(path.dirname(realTo), { recursive: true });
    await fs.rename(realFrom, realTo);

    this.bus.emit('fs.changed', { path: from, changeType: 'delete' });
    this.bus.emit('fs.changed', { path: to, changeType: 'create' });
  }

  /**
   * Copy a file or directory.
   */
  async cp(from: string, to: string): Promise<void> {
    const realFrom = this.resolvePath(from);
    const realTo = this.resolvePath(to);
    await fs.mkdir(path.dirname(realTo), { recursive: true });
    await fs.cp(realFrom, realTo, { recursive: true });

    this.bus.emit('fs.changed', { path: to, changeType: 'create' });
  }

  /**
   * Check if a path exists.
   */
  async exists(virtualPath: string): Promise<boolean> {
    try {
      const realPath = this.resolvePath(virtualPath);
      await fs.access(realPath);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // File Watching
  // -----------------------------------------------------------------------

  /**
   * Watch a path for changes.
   */
  watch(virtualPath: string): void {
    if (this.watchers.has(virtualPath)) return;

    try {
      const realPath = this.resolvePath(virtualPath);
      const watcher = fsSync.watch(realPath, { recursive: true }, (eventType, filename) => {
        if (filename) {
          this.bus.emit('fs.changed', {
            path: path.posix.join(virtualPath, filename),
            changeType: eventType === 'rename' ? 'create' : 'modify',
          });
        }
      });
      this.watchers.set(virtualPath, watcher);
    } catch (err) {
      // Path doesn't exist yet - that's ok
    }
  }

  /**
   * Stop watching a path.
   */
  unwatch(virtualPath: string): void {
    const watcher = this.watchers.get(virtualPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(virtualPath);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getFileType(entry: { isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean }): FileType {
    if (entry.isDirectory()) return 'directory';
    if (entry.isSymbolicLink()) return 'symlink';
    return 'file';
  }

  /**
   * Get the real root path (for sandbox mounting).
   */
  getRealRoot(): string {
    return this.root;
  }

  /**
   * Cleanup all watchers.
   */
  async shutdown(): Promise<void> {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
