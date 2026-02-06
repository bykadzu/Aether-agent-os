/**
 * Aether Kernel
 *
 * The core of Aether OS. Coordinates all subsystems:
 * - ProcessManager: lifecycle of agent processes
 * - VirtualFS: sandboxed filesystem per agent
 * - PTYManager: terminal sessions
 * - ContainerManager: Docker container sandboxing
 * - StateStore: SQLite persistence for history and metrics
 * - EventBus: inter-component communication
 *
 * The kernel processes commands from the UI (via the server's WebSocket
 * handler) and emits events back. It's the single source of truth for
 * all system state.
 *
 * Design note: The kernel is intentionally not aware of the transport
 * layer (WebSocket, HTTP). It takes commands and emits events through
 * the EventBus. The server layer handles transport.
 */

import { EventBus } from './EventBus.js';
import { ProcessManager } from './ProcessManager.js';
import { VirtualFS } from './VirtualFS.js';
import { PTYManager } from './PTYManager.js';
import { ContainerManager } from './ContainerManager.js';
import { VNCManager } from './VNCManager.js';
import { PluginManager } from './PluginManager.js';
import { SnapshotManager } from './SnapshotManager.js';
import { StateStore } from './StateStore.js';
import {
  KernelCommand,
  KernelEvent,
  AETHER_VERSION,
  ProcessInfo,
} from '@aether/shared';

export class Kernel {
  readonly version = AETHER_VERSION;
  readonly bus: EventBus;
  readonly processes: ProcessManager;
  readonly fs: VirtualFS;
  readonly pty: PTYManager;
  readonly containers: ContainerManager;
  readonly vnc: VNCManager;
  readonly plugins: PluginManager;
  readonly snapshots: SnapshotManager;
  readonly state: StateStore;

  private startTime: number;
  private running = false;

  constructor(options: { fsRoot?: string; dbPath?: string } = {}) {
    this.bus = new EventBus();
    this.processes = new ProcessManager(this.bus);
    this.fs = new VirtualFS(this.bus, options.fsRoot);
    this.containers = new ContainerManager(this.bus);
    this.vnc = new VNCManager(this.bus);
    this.pty = new PTYManager(this.bus);
    this.plugins = new PluginManager(this.bus, options.fsRoot);
    this.state = new StateStore(this.bus, options.dbPath);
    this.snapshots = new SnapshotManager(this.bus, this.processes, this.state, options.fsRoot);
    this.startTime = Date.now();
  }

  /**
   * Boot the kernel. Initialize all subsystems.
   */
  async boot(): Promise<void> {
    if (this.running) return;

    console.log(`[Kernel] Aether OS v${this.version} booting...`);

    // Initialize filesystem
    await this.fs.init();
    console.log('[Kernel] Filesystem initialized');

    // Initialize container manager (detects Docker + GPU availability)
    await this.containers.init();
    console.log(`[Kernel] Container manager initialized (Docker: ${this.containers.isDockerAvailable() ? 'available' : 'unavailable, using process fallback'})`);
    console.log(`[Kernel] GPU: ${this.containers.isGPUAvailable() ? `${this.containers.getGPUs().length} GPU(s) detected` : 'not available'}`);

    // VNC manager is initialized (starts proxies on demand)
    console.log('[Kernel] VNC manager initialized');

    // Wire container manager into PTY manager
    this.pty.setContainerManager(this.containers);

    // Initialize snapshot manager
    await this.snapshots.init();
    console.log('[Kernel] Snapshot manager initialized');

    console.log('[Kernel] State store initialized (SQLite)');

    this.running = true;
    this.startTime = Date.now();

    this.bus.emit('kernel.ready', {
      version: this.version,
      uptime: 0,
    });

    console.log('[Kernel] Boot complete');
  }

  /**
   * Handle a command from the UI.
   * Returns events to send back.
   */
  async handleCommand(cmd: KernelCommand): Promise<KernelEvent[]> {
    const events: KernelEvent[] = [];

    try {
      switch (cmd.type) {
        // ----- Process Commands -----
        case 'process.spawn': {
          const proc = this.processes.spawn(cmd.config);
          const pid = proc.info.pid;

          // Create home directory for the agent
          await this.fs.createHome(proc.info.uid);

          // If sandbox type is 'container' and Docker is available, create container
          const sandbox = cmd.config.sandbox;
          let vncWsPort: number | undefined;
          if (sandbox?.type === 'container' && this.containers.isDockerAvailable()) {
            const hostVolume = this.fs.getRealRoot() + proc.info.cwd;
            const containerInfo = await this.containers.create(pid, hostVolume, sandbox);
            if (containerInfo) {
              proc.info.containerId = containerInfo.containerId;
              proc.info.containerStatus = 'running';

              // Start VNC proxy for graphical containers
              if (sandbox.graphical && containerInfo.vncPort) {
                try {
                  const proxy = await this.vnc.startProxy(pid, containerInfo.vncPort);
                  vncWsPort = proxy.wsPort;
                } catch (err: any) {
                  console.error(`[Kernel] Failed to start VNC proxy for PID ${pid}:`, err.message);
                }
              }
            }
          }

          // Open a terminal for the agent
          const tty = this.pty.open(pid, {
            cwd: this.fs.getRealRoot() + proc.info.cwd,
            env: proc.info.env,
          });
          proc.info.ttyId = tty.id;

          // Mark as running
          this.processes.setState(pid, 'running', 'booting');

          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { pid, ttyId: tty.id, containerId: proc.info.containerId, vncWsPort },
          });
          events.push({
            type: 'process.spawned',
            pid,
            info: { ...proc.info },
          });
          break;
        }

        case 'process.signal': {
          const success = this.processes.signal(cmd.pid, cmd.signal);

          // If killing a process, also clean up its container and VNC proxy
          if (success && (cmd.signal === 'SIGTERM' || cmd.signal === 'SIGKILL')) {
            this.vnc.stopProxy(cmd.pid);
            this.containers.remove(cmd.pid).catch(() => {});
          }

          events.push({
            type: success ? 'response.ok' : 'response.error',
            id: cmd.id,
            ...(success ? {} : { error: `Process ${cmd.pid} not found` }),
          } as KernelEvent);
          break;
        }

        case 'process.list': {
          const processes = this.processes.getActive().map(p => ({ ...p.info }));
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: processes,
          });
          events.push({
            type: 'process.list',
            processes,
          });
          break;
        }

        case 'process.info': {
          const proc = this.processes.get(cmd.pid);
          if (proc) {
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { ...proc.info },
            });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `Process ${cmd.pid} not found`,
            });
          }
          break;
        }

        case 'process.approve': {
          const proc = this.processes.get(cmd.pid);
          if (proc && proc.info.agentPhase === 'waiting') {
            this.processes.setState(cmd.pid, 'running', 'executing');
            this.bus.emit('agent.approved', { pid: cmd.pid });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not in waiting state',
            });
          }
          break;
        }

        case 'process.reject': {
          const proc = this.processes.get(cmd.pid);
          if (proc && proc.info.agentPhase === 'waiting') {
            this.processes.setState(cmd.pid, 'running', 'thinking');
            this.bus.emit('agent.rejected', { pid: cmd.pid, reason: cmd.reason });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not in waiting state',
            });
          }
          break;
        }

        // ----- Filesystem Commands -----
        case 'fs.read': {
          const result = await this.fs.readFile(cmd.path);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: result,
          });
          break;
        }

        case 'fs.write': {
          await this.fs.writeFile(cmd.path, cmd.content);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.mkdir': {
          await this.fs.mkdir(cmd.path, cmd.recursive);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.rm': {
          await this.fs.rm(cmd.path, cmd.recursive);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.ls': {
          const entries = await this.fs.ls(cmd.path);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: entries,
          });
          events.push({
            type: 'fs.list',
            path: cmd.path,
            entries,
          });
          break;
        }

        case 'fs.stat': {
          const stat = await this.fs.stat(cmd.path);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: stat,
          });
          break;
        }

        case 'fs.mv': {
          await this.fs.mv(cmd.from, cmd.to);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.cp': {
          await this.fs.cp(cmd.from, cmd.to);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.watch': {
          this.fs.watch(cmd.path);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.unwatch': {
          this.fs.unwatch(cmd.path);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- Terminal Commands -----
        case 'tty.open': {
          const proc = this.processes.get(cmd.pid);
          if (!proc) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `Process ${cmd.pid} not found`,
            });
            break;
          }
          const tty = this.pty.open(cmd.pid, {
            cwd: this.fs.getRealRoot() + proc.info.cwd,
            env: proc.info.env,
            cols: cmd.cols,
            rows: cmd.rows,
          });
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { ttyId: tty.id },
          });
          events.push({
            type: 'tty.opened',
            ttyId: tty.id,
            pid: cmd.pid,
          });
          break;
        }

        case 'tty.input': {
          this.pty.write(cmd.ttyId, cmd.data);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'tty.resize': {
          this.pty.resize(cmd.ttyId, cmd.cols, cmd.rows);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'tty.close': {
          this.pty.close(cmd.ttyId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- IPC Commands -----
        case 'ipc.send': {
          const message = this.processes.sendMessage(cmd.fromPid, cmd.toPid, cmd.channel, cmd.payload);
          if (message) {
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { messageId: message.id },
            });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Failed to send IPC message: source or target process not found',
            });
          }
          break;
        }

        case 'ipc.list_agents': {
          const agents = this.processes.listRunningAgents();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: agents,
          });
          break;
        }

        // ----- Plugin Commands -----
        case 'plugins.list': {
          const pluginInfos = this.plugins.getPluginInfos(cmd.pid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: pluginInfos,
          });
          events.push({
            type: 'plugins.list',
            pid: cmd.pid,
            plugins: pluginInfos,
          } as KernelEvent);
          break;
        }

        // ----- Snapshot Commands -----
        case 'snapshot.create': {
          const snapshot = await this.snapshots.createSnapshot(cmd.pid, cmd.description);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: snapshot,
          });
          events.push({
            type: 'snapshot.created',
            snapshot,
          } as KernelEvent);
          break;
        }

        case 'snapshot.list': {
          const snapshots = await this.snapshots.listSnapshots(cmd.pid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: snapshots,
          });
          events.push({
            type: 'snapshot.list',
            snapshots,
          } as KernelEvent);
          break;
        }

        case 'snapshot.restore': {
          const newPid = await this.snapshots.restoreSnapshot(cmd.snapshotId);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { newPid },
          });
          events.push({
            type: 'snapshot.restored',
            snapshotId: cmd.snapshotId,
            newPid,
          } as KernelEvent);
          break;
        }

        case 'snapshot.delete': {
          await this.snapshots.deleteSnapshot(cmd.snapshotId);
          events.push({
            type: 'response.ok',
            id: cmd.id,
          });
          events.push({
            type: 'snapshot.deleted',
            snapshotId: cmd.snapshotId,
          } as KernelEvent);
          break;
        }

        // ----- Shared Filesystem Commands -----
        case 'fs.createShared': {
          const mount = await this.fs.createSharedMount(cmd.name, cmd.ownerPid);
          this.state.recordSharedMount({
            name: cmd.name,
            path: mount.path,
            ownerPid: cmd.ownerPid,
            createdAt: Date.now(),
          });
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: mount,
          });
          events.push({
            type: 'fs.sharedCreated',
            mount,
          } as KernelEvent);
          break;
        }

        case 'fs.mountShared': {
          await this.fs.mountShared(cmd.pid, cmd.name, cmd.mountPoint);
          const proc = this.processes.get(cmd.pid);
          const mountPoint = cmd.mountPoint || `shared/${cmd.name}`;
          if (proc) {
            this.state.addMountMember(cmd.name, cmd.pid, mountPoint);
          }
          events.push({
            type: 'response.ok',
            id: cmd.id,
          });
          events.push({
            type: 'fs.sharedMounted',
            pid: cmd.pid,
            name: cmd.name,
          } as KernelEvent);
          break;
        }

        case 'fs.unmountShared': {
          await this.fs.unmountShared(cmd.pid, cmd.name);
          this.state.removeMountMember(cmd.name, cmd.pid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
          });
          events.push({
            type: 'fs.sharedUnmounted',
            pid: cmd.pid,
            name: cmd.name,
          } as KernelEvent);
          break;
        }

        case 'fs.listShared': {
          const mounts = await this.fs.listSharedMounts();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: mounts,
          });
          events.push({
            type: 'fs.sharedList',
            mounts,
          } as KernelEvent);
          break;
        }

        // ----- VNC Commands -----
        case 'vnc.info': {
          const vncPort = this.containers.getVNCPort(cmd.pid);
          if (vncPort) {
            const proxyInfo = this.vnc.getProxyInfo(cmd.pid);
            if (proxyInfo) {
              events.push({
                type: 'response.ok',
                id: cmd.id,
                data: { pid: cmd.pid, wsPort: proxyInfo.wsPort, display: ':99' },
              });
              events.push({
                type: 'vnc.info',
                pid: cmd.pid,
                wsPort: proxyInfo.wsPort,
                display: ':99',
              } as KernelEvent);
            } else {
              events.push({
                type: 'response.error',
                id: cmd.id,
                error: `VNC proxy not running for PID ${cmd.pid}`,
              });
            }
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `No VNC available for PID ${cmd.pid} (not a graphical agent)`,
            });
          }
          break;
        }

        case 'vnc.exec': {
          try {
            const output = await this.containers.execGraphical(cmd.pid, cmd.command);
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { output },
            });
          } catch (err: any) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: err.message,
            });
          }
          break;
        }

        // ----- GPU Commands -----
        case 'gpu.list': {
          const gpus = this.containers.getGPUs();
          const allocations = this.containers.getAllGPUAllocations();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { gpus, allocations },
          });
          events.push({
            type: 'gpu.list',
            gpus,
          } as KernelEvent);
          break;
        }

        case 'gpu.stats': {
          const stats = await this.containers.getGPUStats();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { stats },
          });
          events.push({
            type: 'gpu.stats',
            stats,
          } as KernelEvent);
          break;
        }

        // ----- System Commands -----
        case 'kernel.status': {
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: {
              version: this.version,
              uptime: Date.now() - this.startTime,
              processes: this.processes.getCounts(),
              docker: this.containers.isDockerAvailable(),
              containers: this.containers.getAll().length,
              gpu: this.containers.isGPUAvailable(),
              gpuCount: this.containers.getGPUs().length,
            },
          });
          break;
        }

        case 'kernel.shutdown': {
          await this.shutdown();
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        default:
          events.push({
            type: 'response.error',
            id: (cmd as any).id || 'unknown',
            error: `Unknown command type: ${(cmd as any).type}`,
          });
      }
    } catch (err) {
      events.push({
        type: 'response.error',
        id: (cmd as any).id || 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return events;
  }

  /**
   * Get kernel uptime in milliseconds.
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Shutdown the kernel. Clean up all resources.
   */
  async shutdown(): Promise<void> {
    if (!this.running) return;
    console.log('[Kernel] Shutting down...');

    this.running = false;

    // Record final metrics before shutdown
    try {
      const counts = this.processes.getCounts();
      this.state.recordMetric({
        timestamp: Date.now(),
        processCount: counts.running + counts.sleeping + counts.created,
        cpuPercent: 0,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        containerCount: this.containers.getAll().length,
      });
    } catch { /* ignore metric errors during shutdown */ }

    await this.vnc.shutdown();
    await this.pty.shutdown();
    await this.containers.shutdown();
    await this.processes.shutdown();
    await this.fs.shutdown();
    this.state.close();
    this.bus.off();

    console.log('[Kernel] Shutdown complete');
  }
}
