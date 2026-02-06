/**
 * Aether Kernel - Container Manager
 *
 * Manages Docker containers for sandboxed agent execution. Each agent
 * process gets its own container with:
 * - Mounted volume from VirtualFS (the agent's home dir)
 * - Configurable network isolation
 * - Resource limits (memory, CPU)
 *
 * Falls back to child_process when Docker is unavailable.
 */

import { execFile, execFileSync, ChildProcess, spawn } from 'node:child_process';
import { EventBus } from './EventBus.js';
import {
  PID,
  SandboxConfig,
  ContainerInfo,
  ContainerStatus,
  DEFAULT_CONTAINER_IMAGE,
  DEFAULT_CONTAINER_MEMORY_MB,
  DEFAULT_CONTAINER_CPU_LIMIT,
  CONTAINER_STOP_TIMEOUT,
} from '@aether/shared';

export class ContainerManager {
  private containers = new Map<PID, ContainerInfo>();
  private bus: EventBus;
  private dockerAvailable: boolean = false;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Check if Docker is available on the system.
   */
  async init(): Promise<void> {
    try {
      execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
      this.dockerAvailable = true;
      console.log('[ContainerManager] Docker is available');
    } catch {
      this.dockerAvailable = false;
      console.log('[ContainerManager] Docker not available, using process fallback');
    }
  }

  /**
   * Whether Docker is available for container creation.
   */
  isDockerAvailable(): boolean {
    return this.dockerAvailable;
  }

  /**
   * Create and start a container for an agent process.
   */
  async create(pid: PID, hostVolumePath: string, sandbox?: SandboxConfig): Promise<ContainerInfo | null> {
    if (!this.dockerAvailable) return null;

    const image = sandbox?.image || DEFAULT_CONTAINER_IMAGE;
    const memoryMB = sandbox?.memoryLimitMB || DEFAULT_CONTAINER_MEMORY_MB;
    const cpuLimit = sandbox?.cpuLimit || DEFAULT_CONTAINER_CPU_LIMIT;
    const networkEnabled = sandbox?.networkAccess ?? false;
    const containerName = `aether-agent-${pid}-${Date.now()}`;

    const args: string[] = [
      'run', '-d',
      '--name', containerName,
      '--hostname', `agent-${pid}`,
      // Resource limits
      '--memory', `${memoryMB}m`,
      '--cpus', String(cpuLimit),
      // Mount the agent's home directory
      '-v', `${hostVolumePath}:/home/agent:rw`,
      '-w', '/home/agent',
      // Environment
      '-e', `AETHER_PID=${pid}`,
      '-e', 'TERM=xterm-256color',
      '-e', 'HOME=/home/agent',
      '-e', 'USER=agent',
    ];

    // Network isolation
    if (!networkEnabled) {
      args.push('--network', 'none');
    }

    // Image and keep-alive command
    args.push(image, 'tail', '-f', '/dev/null');

    try {
      const containerId = await this.dockerExec('docker', args);
      const trimmedId = containerId.trim().substring(0, 12);

      const info: ContainerInfo = {
        containerId: trimmedId,
        pid,
        image,
        status: 'running',
        mountedVolume: hostVolumePath,
        networkEnabled,
        memoryLimitMB: memoryMB,
        cpuLimit,
        createdAt: Date.now(),
      };

      this.containers.set(pid, info);

      this.bus.emit('container.created', {
        pid,
        containerId: trimmedId,
        info,
      });

      this.bus.emit('container.started', {
        pid,
        containerId: trimmedId,
      });

      return info;
    } catch (err: any) {
      console.error(`[ContainerManager] Failed to create container for PID ${pid}:`, err.message);
      return null;
    }
  }

  /**
   * Execute a command inside a container. Returns stdout output.
   */
  async exec(pid: PID, command: string, options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  } = {}): Promise<string> {
    const info = this.containers.get(pid);
    if (!info) {
      throw new Error(`No container for PID ${pid}`);
    }

    const args: string[] = ['exec'];

    // Working directory inside container
    if (options.cwd) {
      args.push('-w', options.cwd);
    }

    // Environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(info.containerId, '/bin/bash', '-c', command);

    const timeout = options.timeout || 30_000;
    return this.dockerExec('docker', args, timeout);
  }

  /**
   * Spawn an interactive shell session inside a container.
   * Returns the ChildProcess for stdin/stdout piping.
   */
  spawnShell(pid: PID, options: {
    cwd?: string;
    env?: Record<string, string>;
  } = {}): ChildProcess | null {
    const info = this.containers.get(pid);
    if (!info) return null;

    const args: string[] = ['exec', '-i'];

    if (options.cwd) {
      args.push('-w', options.cwd);
    }

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(info.containerId, '/bin/bash', '--login');

    return spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Stop and remove a container.
   */
  async remove(pid: PID): Promise<void> {
    const info = this.containers.get(pid);
    if (!info) return;

    info.status = 'stopping' as ContainerStatus;

    try {
      await this.dockerExec('docker', ['stop', '-t', String(CONTAINER_STOP_TIMEOUT), info.containerId], 15_000);
      this.bus.emit('container.stopped', { pid, containerId: info.containerId });
    } catch {
      // Force kill if stop fails
      try {
        await this.dockerExec('docker', ['kill', info.containerId], 5_000);
      } catch { /* ignore */ }
    }

    try {
      info.status = 'removing';
      await this.dockerExec('docker', ['rm', '-f', info.containerId], 10_000);
      this.bus.emit('container.removed', { pid, containerId: info.containerId });
    } catch (err: any) {
      console.error(`[ContainerManager] Failed to remove container for PID ${pid}:`, err.message);
    }

    this.containers.delete(pid);
  }

  /**
   * Get container info for a process.
   */
  get(pid: PID): ContainerInfo | undefined {
    return this.containers.get(pid);
  }

  /**
   * Get all running containers.
   */
  getAll(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * Shutdown: stop and remove all containers.
   */
  async shutdown(): Promise<void> {
    const pids = Array.from(this.containers.keys());
    await Promise.all(pids.map(pid => this.remove(pid)));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private dockerExec(cmd: string, args: string[], timeout = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
