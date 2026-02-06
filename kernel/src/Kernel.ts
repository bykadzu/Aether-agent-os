/**
 * Aether Kernel
 *
 * The core of Aether OS. Coordinates all subsystems:
 * - ProcessManager: lifecycle of agent processes
 * - VirtualFS: sandboxed filesystem per agent
 * - PTYManager: terminal sessions
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

  private startTime: number;
  private running = false;

  constructor(options: { fsRoot?: string } = {}) {
    this.bus = new EventBus();
    this.processes = new ProcessManager(this.bus);
    this.fs = new VirtualFS(this.bus, options.fsRoot);
    this.pty = new PTYManager(this.bus);
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
            data: { pid, ttyId: tty.id },
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

        // ----- System Commands -----
        case 'kernel.status': {
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: {
              version: this.version,
              uptime: Date.now() - this.startTime,
              processes: this.processes.getCounts(),
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
    await this.pty.shutdown();
    await this.processes.shutdown();
    await this.fs.shutdown();
    this.bus.off();

    console.log('[Kernel] Shutdown complete');
  }
}
