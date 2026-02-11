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
import { FileStat, FileType, FileMode, SharedMountInfo, PID, AETHER_ROOT } from '@aether/shared';

const DEFAULT_MODE: FileMode = {
  owner: { read: true, write: true, execute: false },
  group: { read: true, write: false, execute: false },
  other: { read: true, write: false, execute: false },
};

export class VirtualFS {
  private root: string;
  private bus: EventBus;
  private watchers = new Map<string, ReturnType<typeof fsSync.watch>>();
  /** Tracks shared mounts: name → { realPath, ownerPid, mountedBy: Map<pid, mountPoint> } */
  private sharedMounts = new Map<
    string,
    { realPath: string; ownerPid: PID; mountedBy: Map<PID, string> }
  >();

  constructor(bus: EventBus, root?: string) {
    this.bus = bus;
    this.root = root || AETHER_ROOT;
  }

  /** Maps virtual paths to the owning user uid for access control */
  private fileOwners = new Map<string, string>();

  /**
   * Initialize the filesystem - create base directories.
   */
  async init(): Promise<void> {
    const dirs = [
      this.root,
      path.join(this.root, 'home'),
      path.join(this.root, 'tmp'),
      path.join(this.root, 'tmp', 'aether', 'users'),
      path.join(this.root, 'etc'),
      path.join(this.root, 'var', 'log'),
      path.join(this.root, 'shared'),
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
      await fs.writeFile(
        profilePath,
        [
          `# Aether OS Agent Profile`,
          `export HOME="${path.posix.join('/home', uid)}"`,
          `export USER="${uid}"`,
          `export PS1="\\u@aether:\\w\\$ "`,
          '',
        ].join('\n'),
      );
    }

    return `/home/${uid}`;
  }

  /**
   * Create a per-user directory for user-scoped data.
   */
  async createUserDir(userId: string): Promise<string> {
    const userDir = path.join(this.root, 'tmp', 'aether', 'users', userId);
    await fs.mkdir(userDir, { recursive: true });
    return `/tmp/aether/users/${userId}`;
  }

  /**
   * Associate a file with a user for ownership tracking.
   */
  setFileOwner(virtualPath: string, ownerUid: string): void {
    this.fileOwners.set(virtualPath, ownerUid);
  }

  /**
   * Get the owner of a file path.
   */
  getFileOwner(virtualPath: string): string {
    return this.fileOwners.get(virtualPath) || 'root';
  }

  /**
   * Check if a user has access to a path.
   * Users can access their own home, shared mounts, /tmp, /etc. Admin has full access.
   */
  checkAccess(virtualPath: string, userId?: string, isAdmin = false): boolean {
    if (!userId || isAdmin) return true;

    const normalized = path.posix.normalize(virtualPath);

    // Everyone can access /tmp, /etc, /shared
    if (
      normalized.startsWith('/tmp/') ||
      normalized.startsWith('/etc/') ||
      normalized.startsWith('/shared/')
    ) {
      return true;
    }

    // Users can access their own user dir
    if (
      normalized.startsWith(`/tmp/aether/users/${userId}/`) ||
      normalized === `/tmp/aether/users/${userId}`
    ) {
      return true;
    }

    // Users can access agent home dirs they own (agents spawned by them)
    // This is checked at a higher level via process ownership
    // Allow /home/ access generally since agents need it
    if (normalized.startsWith('/home/')) {
      return true;
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // Path Resolution & Security
  // -----------------------------------------------------------------------

  /**
   * Resolve a virtual path to a real filesystem path.
   * Prevents path traversal attacks, including through symlinks.
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

    // If the path exists and might be a symlink, also check the real path
    try {
      const realResolved = fsSync.realpathSync(resolved);
      if (!realResolved.startsWith(resolvedRoot)) {
        throw new Error(`Access denied: symlink target outside aether root (${virtualPath})`);
      }
    } catch (err: any) {
      // ENOENT is fine - the path doesn't exist yet
      if (err.code !== 'ENOENT') {
        // Re-throw access denied errors
        if (err.message?.includes('Access denied')) throw err;
      }
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
    try {
      const content = await fs.readFile(realPath, 'utf-8');
      return { content, size: Buffer.byteLength(content) };
    } catch (err: any) {
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied: cannot read ${virtualPath}`);
      }
      throw err;
    }
  }

  /**
   * Read a file as a raw Buffer (for binary files like images, audio, video).
   */
  async readFileRaw(virtualPath: string): Promise<Buffer> {
    const realPath = this.resolvePath(virtualPath);
    try {
      return await fs.readFile(realPath);
    } catch (err: any) {
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied: cannot read ${virtualPath}`);
      }
      throw err;
    }
  }

  /**
   * Create a readable stream for a file (for streaming large binary files).
   * Supports optional start/end byte offsets for Range requests.
   */
  createReadStream(
    virtualPath: string,
    options?: { start?: number; end?: number },
  ): fsSync.ReadStream {
    const realPath = this.resolvePath(virtualPath);
    return fsSync.createReadStream(realPath, options);
  }

  /**
   * Write content to a file (creates if doesn't exist).
   */
  async writeFile(virtualPath: string, content: string, ownerUid?: string): Promise<void> {
    const realPath = this.resolvePath(virtualPath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(realPath), { recursive: true });

    // Atomic write: write to temp file then rename (safe on crash)
    const tmpPath = realPath + `.aether-tmp-${Date.now()}`;
    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, realPath);
    } catch (err: any) {
      // Clean up temp file on error
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      if (err.code === 'ENOSPC') {
        throw new Error(`Disk full: cannot write to ${virtualPath}`);
      }
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied: cannot write to ${virtualPath}`);
      }
      throw err;
    }

    // Track file ownership
    if (ownerUid) {
      this.setFileOwner(virtualPath, ownerUid);
    }

    this.bus.emit('fs.changed', {
      path: virtualPath,
      changeType: 'modify',
    });
  }

  /**
   * Write binary content to a file (for uploads).
   */
  async writeFileBinary(virtualPath: string, content: Buffer, ownerUid?: string): Promise<void> {
    const realPath = this.resolvePath(virtualPath);

    await fs.mkdir(path.dirname(realPath), { recursive: true });

    const tmpPath = realPath + `.aether-tmp-${Date.now()}`;
    try {
      await fs.writeFile(tmpPath, content);
      await fs.rename(tmpPath, realPath);
    } catch (err: any) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      if (err.code === 'ENOSPC') throw new Error(`Disk full: cannot write to ${virtualPath}`);
      if (err.code === 'EACCES')
        throw new Error(`Permission denied: cannot write to ${virtualPath}`);
      throw err;
    }

    if (ownerUid) {
      this.setFileOwner(virtualPath, ownerUid);
    }

    this.bus.emit('fs.changed', { path: virtualPath, changeType: 'modify' });
  }

  /**
   * Create a directory.
   */
  async mkdir(virtualPath: string, recursive = false): Promise<void> {
    const realPath = this.resolvePath(virtualPath);
    try {
      await fs.mkdir(realPath, { recursive });
    } catch (err: any) {
      if (err.code === 'ENOSPC') {
        throw new Error(`Disk full: cannot create directory ${virtualPath}`);
      }
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied: cannot create directory ${virtualPath}`);
      }
      throw err;
    }

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
          uid: this.getFileOwner(path.posix.join(virtualPath, entry.name)),
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
      uid: this.getFileOwner(virtualPath),
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
  // Shared Mounts
  // -----------------------------------------------------------------------

  /**
   * Create a shared directory that multiple agents can access.
   */
  async createSharedMount(name: string, ownerPid: PID): Promise<SharedMountInfo> {
    // Validate name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('Shared mount name must be alphanumeric (hyphens and underscores allowed)');
    }

    const sharedDir = path.join(this.root, 'shared', name);
    await fs.mkdir(sharedDir, { recursive: true });

    const mount = {
      realPath: sharedDir,
      ownerPid,
      mountedBy: new Map<PID, string>(),
    };
    this.sharedMounts.set(name, mount);

    this.bus.emit('fs.sharedCreated', {
      mount: {
        name,
        path: `/shared/${name}`,
        ownerPid,
        mountedBy: [],
      },
    });

    return {
      name,
      path: `/shared/${name}`,
      ownerPid,
      mountedBy: [],
    };
  }

  /**
   * Mount a shared directory into an agent's home.
   * Creates a symlink at ~/shared/{name} (or custom mountPoint).
   */
  async mountShared(pid: PID, name: string, mountPoint?: string): Promise<void> {
    const mount = this.sharedMounts.get(name);
    if (!mount) {
      // Try to find the directory on disk even if not in memory
      const sharedDir = path.join(this.root, 'shared', name);
      try {
        await fs.access(sharedDir);
      } catch {
        throw new Error(`Shared mount "${name}" does not exist`);
      }
      // Recreate in-memory record
      this.sharedMounts.set(name, {
        realPath: sharedDir,
        ownerPid: 0,
        mountedBy: new Map(),
      });
    }

    const sharedDir = path.join(this.root, 'shared', name);
    const agentUid = `agent_${pid}`;
    const homeDir = path.join(this.root, 'home', agentUid);
    const relativeMountPoint = mountPoint || `shared/${name}`;
    const linkPath = path.join(homeDir, relativeMountPoint);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(linkPath), { recursive: true });

    // Verify the link path stays within the aether root
    const resolvedLink = path.resolve(linkPath);
    const resolvedRoot = path.resolve(this.root);
    if (!resolvedLink.startsWith(resolvedRoot)) {
      throw new Error('Access denied: mount point path traversal detected');
    }

    // Remove existing symlink if present
    try {
      const existingStat = await fs.lstat(linkPath);
      if (existingStat.isSymbolicLink()) {
        await fs.unlink(linkPath);
      }
    } catch {
      /* doesn't exist yet */
    }

    // Create symlink
    await fs.symlink(sharedDir, linkPath);

    // Track the mount
    const mountRecord = this.sharedMounts.get(name);
    if (mountRecord) {
      mountRecord.mountedBy.set(pid, relativeMountPoint);
    }
  }

  /**
   * Unmount a shared directory from an agent's home.
   */
  async unmountShared(pid: PID, name: string): Promise<void> {
    const mount = this.sharedMounts.get(name);
    if (!mount) return;

    const mountPoint = mount.mountedBy.get(pid);
    if (!mountPoint) return;

    const agentUid = `agent_${pid}`;
    const linkPath = path.join(this.root, 'home', agentUid, mountPoint);

    try {
      const stat = await fs.lstat(linkPath);
      if (stat.isSymbolicLink()) {
        await fs.unlink(linkPath);
      }
    } catch {
      /* link doesn't exist */
    }

    mount.mountedBy.delete(pid);
  }

  /**
   * List all shared mounts and which agents have them mounted.
   */
  async listSharedMounts(): Promise<SharedMountInfo[]> {
    const result: SharedMountInfo[] = [];

    // Also scan the shared directory for mounts not in memory
    const sharedRoot = path.join(this.root, 'shared');
    try {
      const entries = await fs.readdir(sharedRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!this.sharedMounts.has(entry.name)) {
            this.sharedMounts.set(entry.name, {
              realPath: path.join(sharedRoot, entry.name),
              ownerPid: 0,
              mountedBy: new Map(),
            });
          }
        }
      }
    } catch {
      /* shared dir may not exist yet */
    }

    for (const [name, mount] of this.sharedMounts) {
      result.push({
        name,
        path: `/shared/${name}`,
        ownerPid: mount.ownerPid,
        mountedBy: Array.from(mount.mountedBy.keys()),
      });
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Remove an agent's home directory.
   * Safety: only removes paths under /home/ and validates the uid format.
   */
  async removeHome(uid: string): Promise<boolean> {
    // Safety: validate uid format (agent_N)
    if (!/^agent_\d+$/.test(uid)) {
      console.warn(`[VirtualFS] Refusing to remove home for invalid uid: ${uid}`);
      return false;
    }

    const homePath = path.join(this.root, 'home', uid);
    const resolvedHome = path.resolve(homePath);
    const resolvedRoot = path.resolve(this.root);

    // Safety: ensure the path is within our root/home
    if (!resolvedHome.startsWith(path.join(resolvedRoot, 'home'))) {
      console.warn(`[VirtualFS] Refusing to remove path outside /home: ${resolvedHome}`);
      return false;
    }

    try {
      await fs.rm(homePath, { recursive: true, force: true });
      this.bus.emit('fs.changed', { path: `/home/${uid}`, changeType: 'delete' });
      return true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error(`[VirtualFS] Failed to remove home for ${uid}:`, err.message);
      }
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getFileType(entry: {
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isFile(): boolean;
  }): FileType {
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
