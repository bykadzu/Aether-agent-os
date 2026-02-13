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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from './EventBus.js';
import {
  PID,
  SandboxConfig,
  ContainerInfo,
  ContainerStatus,
  GPUInfo,
  GPUStats,
  GPUAllocation,
  AETHER_ROOT,
  DEFAULT_CONTAINER_IMAGE,
  DEFAULT_GRAPHICAL_IMAGE,
  DEFAULT_CONTAINER_MEMORY_MB,
  DEFAULT_CONTAINER_CPU_LIMIT,
  CONTAINER_STOP_TIMEOUT,
  VNC_BASE_PORT,
  VNC_DISPLAY,
} from '@aether/shared';

export class ContainerManager {
  private containers = new Map<PID, ContainerInfo>();
  private bus: EventBus;
  private dockerAvailable: boolean = false;
  private gpuAvailable: boolean = false;
  private detectedGPUs: GPUInfo[] = [];
  private gpuAllocations = new Map<PID, GPUAllocation>();
  private nextVncOffset = 0;
  private workspacesRoot: string;

  constructor(bus: EventBus) {
    this.bus = bus;
    this.workspacesRoot = path.join(AETHER_ROOT, 'workspaces');
  }

  // ---------------------------------------------------------------------------
  // Workspace Methods
  // ---------------------------------------------------------------------------

  /**
   * Create a persistent workspace directory for an agent.
   * Returns the absolute path to the workspace.
   */
  createWorkspace(agentName: string): string {
    const workspacePath = path.join(this.workspacesRoot, agentName);
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
  }

  /**
   * List all existing workspace directory names.
   */
  listWorkspaces(): string[] {
    try {
      const entries = fs.readdirSync(this.workspacesRoot, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Remove a workspace directory. Only removes if it exists under the workspaces root.
   * Returns true if removed, false otherwise.
   */
  cleanupWorkspace(agentName: string): boolean {
    const workspacePath = path.join(this.workspacesRoot, agentName);
    // Safety: ensure the resolved path is actually under the workspaces root
    const resolved = path.resolve(workspacePath);
    const resolvedRoot = path.resolve(this.workspacesRoot);
    if (!resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot) {
      return false;
    }
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker is available on the system. Detect GPUs.
   */
  async init(): Promise<void> {
    // Detect Docker
    try {
      execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
      this.dockerAvailable = true;
      console.log('[ContainerManager] Docker is available');
    } catch {
      this.dockerAvailable = false;
      console.log('[ContainerManager] Docker not available, using process fallback');
    }

    // Detect NVIDIA GPUs
    try {
      const output = execFileSync(
        'nvidia-smi',
        [
          '--query-gpu=name,memory.total,memory.free,utilization.gpu',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 5000 },
      )
        .toString()
        .trim();

      if (output) {
        this.detectedGPUs = output.split('\n').map((line, idx) => {
          const [name, memTotal, memFree, util] = line.split(',').map((s) => s.trim());
          return {
            id: idx,
            name,
            memoryTotal: parseFloat(memTotal) || 0,
            memoryFree: parseFloat(memFree) || 0,
            utilization: parseFloat(util) || 0,
          };
        });
        this.gpuAvailable = this.detectedGPUs.length > 0;
        console.log(
          `[ContainerManager] ${this.detectedGPUs.length} GPU(s) detected: ${this.detectedGPUs.map((g) => g.name).join(', ')}`,
        );
      }
    } catch {
      this.gpuAvailable = false;
      console.log('[ContainerManager] nvidia-smi not available, GPU passthrough disabled');
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
  async create(
    pid: PID,
    hostVolumePath: string,
    sandbox?: SandboxConfig,
    internalHomePath?: string,
  ): Promise<ContainerInfo | null> {
    if (!this.dockerAvailable) {
      this.bus.emit('container.fallback', { pid, reason: 'Docker not available' });
      return null;
    }

    // Re-check Docker availability in case it went down after init
    try {
      execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    } catch {
      console.warn(
        '[ContainerManager] Docker became unavailable after init, falling back to child_process',
      );
      this.dockerAvailable = false;
      this.bus.emit('container.fallback', { pid, reason: 'Docker became unavailable' });
      return null;
    }

    const graphical = sandbox?.graphical ?? false;
    const image = sandbox?.image || (graphical ? DEFAULT_GRAPHICAL_IMAGE : DEFAULT_CONTAINER_IMAGE);
    const memoryMB = sandbox?.memoryLimitMB || DEFAULT_CONTAINER_MEMORY_MB;
    const cpuLimit = sandbox?.cpuLimit || DEFAULT_CONTAINER_CPU_LIMIT;
    const networkEnabled = sandbox?.networkAccess ?? true;
    const containerName = `aether-agent-${pid}-${Date.now()}`;

    // Determine VNC port for graphical containers
    let vncPort: number | undefined;
    if (graphical) {
      vncPort = VNC_BASE_PORT + 99 + this.nextVncOffset;
      this.nextVncOffset++;
    }

    const args: string[] = [
      'run',
      '-d',
      '--name',
      containerName,
      '--hostname',
      `agent-${pid}`,
      // Resource limits
      '--memory',
      `${memoryMB}m`,
      '--cpus',
      String(cpuLimit),
      // Mount the agent's persistent home directory (same path as VirtualFS)
      '-v',
      `${hostVolumePath}:${internalHomePath || '/home/aether'}:rw`,
      // Mount shared directory for cross-agent file exchange
      ...(() => {
        const sharedDir = path.join(AETHER_ROOT, 'shared');
        if (!fs.existsSync(sharedDir)) {
          fs.mkdirSync(sharedDir, { recursive: true });
        }
        return ['-v', `${sharedDir}:/home/agent/shared:rw`];
      })(),
      '-w',
      internalHomePath || '/home/aether',
      // Environment
      '-e',
      `AETHER_PID=${pid}`,
      '-e',
      'TERM=xterm-256color',
      '-e',
      `HOME=${internalHomePath || '/home/aether'}`,
      '-e',
      'USER=aether',
    ];

    // Graphical container: expose VNC port and set DISPLAY
    if (graphical && vncPort) {
      args.push('-e', `DISPLAY=${VNC_DISPLAY}`);
      args.push('-p', `${vncPort}:${VNC_BASE_PORT + 99}`);
    }

    // GPU passthrough
    let assignedGpuIds: number[] | undefined;
    if (sandbox?.gpu?.enabled && this.gpuAvailable) {
      const gpuAlloc = this.allocateGPUs(pid, sandbox.gpu);
      if (gpuAlloc) {
        assignedGpuIds = gpuAlloc.gpuIds;
        if (sandbox.gpu.deviceIds && sandbox.gpu.deviceIds.length > 0) {
          args.push('--gpus', `"device=${sandbox.gpu.deviceIds.join(',')}"`);
        } else if (sandbox.gpu.count) {
          args.push('--gpus', String(sandbox.gpu.count));
        } else {
          args.push('--gpus', 'all');
        }
        args.push('-e', `NVIDIA_VISIBLE_DEVICES=${assignedGpuIds.join(',')}`);
      }
    }

    // Network isolation
    if (!networkEnabled) {
      args.push('--network', 'none');
    }

    // Image and keep-alive command.
    // Desktop image has its own entrypoint that starts Xvfb/XFCE/x11vnc,
    // so we don't pass a CMD override — the entrypoint handles everything.
    const hasEntrypoint = image === DEFAULT_GRAPHICAL_IMAGE;
    if (hasEntrypoint) {
      args.push(image);
    } else {
      args.push(image, 'tail', '-f', '/dev/null');
    }

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
        vncPort,
        gpuIds: assignedGpuIds,
      };

      this.containers.set(pid, info);

      // Start Xvfb and x11vnc inside the container for graphical agents.
      // The desktop image (aether-desktop:latest) has an entrypoint that handles
      // this automatically, so we only manually start for custom graphical images.
      if (graphical && !hasEntrypoint) {
        try {
          await this.dockerExec(
            'docker',
            [
              'exec',
              '-d',
              trimmedId,
              '/bin/bash',
              '-c',
              `Xvfb ${VNC_DISPLAY} -screen 0 1920x1080x24 &`,
            ],
            10_000,
          );
          // Wait briefly for Xvfb to start
          await new Promise((r) => setTimeout(r, 500));
          await this.dockerExec(
            'docker',
            [
              'exec',
              '-d',
              trimmedId,
              '/bin/bash',
              '-c',
              `x11vnc -display ${VNC_DISPLAY} -rfbport ${VNC_BASE_PORT + 99} -nopw -forever -shared &`,
            ],
            10_000,
          );
          console.log(
            `[ContainerManager] Graphical stack started for PID ${pid} (VNC port ${vncPort})`,
          );
        } catch (err: any) {
          console.error(
            `[ContainerManager] Failed to start graphical stack for PID ${pid}:`,
            err.message,
          );
        }
      } else if (graphical && hasEntrypoint) {
        // Desktop image entrypoint needs time to start Xvfb + XFCE + x11vnc
        await new Promise((r) => setTimeout(r, 5000));
        console.log(
          `[ContainerManager] Desktop entrypoint started for PID ${pid} (VNC port ${vncPort})`,
        );
      }

      this.bus.emit('container.created', {
        pid,
        containerId: trimmedId,
        info,
      });

      this.bus.emit('container.started', {
        pid,
        containerId: trimmedId,
      });

      // Emit GPU allocation event
      if (assignedGpuIds && assignedGpuIds.length > 0) {
        this.bus.emit('gpu.allocated', { pid, gpuIds: assignedGpuIds });
      }

      return info;
    } catch (err: any) {
      console.error(`[ContainerManager] Failed to create container for PID ${pid}:`, err.message);
      // Clean up GPU allocation on failure
      if (assignedGpuIds) {
        this.gpuAllocations.delete(pid);
      }
      return null;
    }
  }

  /**
   * Execute a command inside a container. Returns stdout output.
   */
  async exec(
    pid: PID,
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    } = {},
  ): Promise<string> {
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
  spawnShell(
    pid: PID,
    options: {
      cwd?: string;
      env?: Record<string, string>;
    } = {},
  ): ChildProcess | null {
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
   * Stop and remove a container. Release GPU allocations.
   */
  async remove(pid: PID): Promise<void> {
    const info = this.containers.get(pid);
    if (!info) return;

    info.status = 'stopping' as ContainerStatus;

    try {
      await this.dockerExec(
        'docker',
        ['stop', '-t', String(CONTAINER_STOP_TIMEOUT), info.containerId],
        15_000,
      );
      this.bus.emit('container.stopped', { pid, containerId: info.containerId });
    } catch {
      // Force kill if stop fails
      try {
        await this.dockerExec('docker', ['kill', info.containerId], 5_000);
      } catch {
        /* ignore */
      }
    }

    try {
      info.status = 'removing';
      await this.dockerExec('docker', ['rm', '-f', info.containerId], 10_000);
      this.bus.emit('container.removed', { pid, containerId: info.containerId });
    } catch (err: any) {
      console.error(`[ContainerManager] Failed to remove container for PID ${pid}:`, err.message);
    }

    // Release GPU allocation
    const gpuAlloc = this.gpuAllocations.get(pid);
    if (gpuAlloc) {
      this.gpuAllocations.delete(pid);
      this.bus.emit('gpu.released', { pid, gpuIds: gpuAlloc.gpuIds });
    }

    this.containers.delete(pid);
  }

  /**
   * Resize the TTY for a containerized terminal session.
   * Sends stty resize command to the container so interactive programs redraw.
   */
  async resizeTTY(pid: PID, cols: number, rows: number): Promise<void> {
    const info = this.containers.get(pid);
    if (!info) return;
    try {
      await this.dockerExec(
        'docker',
        ['exec', info.containerId, 'stty', 'rows', String(rows), 'cols', String(cols)],
        5_000,
      );
    } catch {
      // Best-effort; older containers or non-interactive sessions may not support this
    }
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
    await Promise.all(pids.map((pid) => this.remove(pid)));
  }

  // ---------------------------------------------------------------------------
  // VNC Methods
  // ---------------------------------------------------------------------------

  /**
   * Get the host-side VNC port for a containerized graphical agent.
   */
  getVNCPort(pid: PID): number | null {
    const info = this.containers.get(pid);
    return info?.vncPort ?? null;
  }

  /**
   * Execute a command inside a graphical container with DISPLAY set.
   */
  async execGraphical(pid: PID, command: string): Promise<string> {
    const info = this.containers.get(pid);
    if (!info) {
      throw new Error(`No container for PID ${pid}`);
    }
    if (!info.vncPort) {
      throw new Error(`Container for PID ${pid} is not graphical`);
    }

    return this.dockerExec(
      'docker',
      ['exec', '-e', `DISPLAY=${VNC_DISPLAY}`, info.containerId, '/bin/bash', '-c', command],
      30_000,
    );
  }

  // ---------------------------------------------------------------------------
  // GPU Methods
  // ---------------------------------------------------------------------------

  /**
   * Whether NVIDIA GPUs are available.
   */
  isGPUAvailable(): boolean {
    return this.gpuAvailable;
  }

  /**
   * Get detected GPU list.
   */
  getGPUs(): GPUInfo[] {
    return [...this.detectedGPUs];
  }

  /**
   * Get current GPU stats by running nvidia-smi.
   */
  async getGPUStats(): Promise<GPUStats[]> {
    if (!this.gpuAvailable) return [];

    try {
      const output = await this.shellExec(
        'nvidia-smi',
        [
          '--query-gpu=name,memory.total,memory.free,utilization.gpu,temperature.gpu,power.draw',
          '--format=csv,noheader,nounits',
        ],
        5000,
      );

      return output
        .trim()
        .split('\n')
        .map((line, idx) => {
          const [name, memTotal, memFree, util, temp, power] = line.split(',').map((s) => s.trim());
          return {
            id: idx,
            name,
            memoryTotal: parseFloat(memTotal) || 0,
            memoryFree: parseFloat(memFree) || 0,
            utilization: parseFloat(util) || 0,
            temperature: parseFloat(temp) || 0,
            powerUsage: parseFloat(power) || 0,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get GPU allocation for a specific container.
   */
  getContainerGPU(pid: PID): GPUAllocation | null {
    return this.gpuAllocations.get(pid) ?? null;
  }

  /**
   * Get all current GPU allocations.
   */
  getAllGPUAllocations(): GPUAllocation[] {
    return Array.from(this.gpuAllocations.values());
  }

  /**
   * Allocate GPUs for a process. Returns null if not enough GPUs available.
   */
  private allocateGPUs(
    pid: PID,
    gpuConfig: { enabled: boolean; count?: number; deviceIds?: string[] },
  ): GPUAllocation | null {
    if (!this.gpuAvailable || !gpuConfig.enabled) return null;

    let gpuIds: number[];

    if (gpuConfig.deviceIds && gpuConfig.deviceIds.length > 0) {
      gpuIds = gpuConfig.deviceIds.map((id) => parseInt(id, 10));
    } else {
      const count = gpuConfig.count || this.detectedGPUs.length;
      const allocatedIds = new Set<number>();
      for (const alloc of this.gpuAllocations.values()) {
        for (const id of alloc.gpuIds) allocatedIds.add(id);
      }

      const available = this.detectedGPUs.filter((g) => !allocatedIds.has(g.id)).map((g) => g.id);

      if (available.length < count) {
        console.warn(
          `[ContainerManager] Not enough free GPUs: requested ${count}, available ${available.length}`,
        );
        // Fall back to sharing all GPUs
        gpuIds = this.detectedGPUs.map((g) => g.id);
      } else {
        gpuIds = available.slice(0, count);
      }
    }

    const allocation: GPUAllocation = { pid, gpuIds };
    this.gpuAllocations.set(pid, allocation);
    return allocation;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private dockerExec(cmd: string, args: string[], timeout = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
        if (error) {
          const isTimeout = (error as any).killed || (error as any).code === 'ETIMEDOUT';
          const msg = isTimeout
            ? `Docker command timed out after ${timeout}ms: ${cmd} ${args.slice(0, 3).join(' ')}`
            : stderr?.trim() || error.message;
          reject(new Error(msg));
        } else {
          resolve(stdout);
        }
      });

      // Extra safety: force kill if the child process hangs beyond timeout
      const safetyTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, timeout + 5000);
      child.on('exit', () => clearTimeout(safetyTimer));
    });
  }

  private shellExec(cmd: string, args: string[], timeout = 30_000): Promise<string> {
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
