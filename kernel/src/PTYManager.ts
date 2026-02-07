/**
 * Aether Kernel - PTY Manager
 *
 * Manages pseudo-terminal sessions for agent processes. Each agent can
 * have a terminal that connects to a real shell.
 *
 * Supports two modes:
 * - Docker mode: terminal sessions run inside containers via ContainerManager
 *   (uses child_process since docker exec handles its own PTY)
 * - Process mode: uses node-pty for proper pseudo-terminal support
 *   (SIGWINCH, job control, interactive programs)
 *
 * The PTY output is streamed over the event bus and forwarded to the UI
 * via WebSocket.
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as pty from 'node-pty';
import { EventBus } from './EventBus.js';
import { ContainerManager } from './ContainerManager.js';
import { PID, DEFAULT_TTY_COLS, DEFAULT_TTY_ROWS } from '@aether/shared';

/**
 * A local PTY session backed by node-pty.
 */
export interface LocalPTYSession {
  id: string;
  pid: PID;
  ptyProcess: pty.IPty;
  process: null;
  cols: number;
  rows: number;
  cwd: string;
  createdAt: number;
  containerized: false;
}

/**
 * A container PTY session backed by child_process (docker exec).
 */
export interface ContainerPTYSession {
  id: string;
  pid: PID;
  ptyProcess: null;
  process: ChildProcess;
  cols: number;
  rows: number;
  cwd: string;
  createdAt: number;
  containerized: true;
}

export type PTYSession = LocalPTYSession | ContainerPTYSession;

export class PTYManager {
  private sessions = new Map<string, PTYSession>();
  private bus: EventBus;
  private containerManager?: ContainerManager;

  constructor(bus: EventBus, containerManager?: ContainerManager) {
    this.bus = bus;
    this.containerManager = containerManager;
  }

  /**
   * Set the container manager (called during kernel boot after ContainerManager init).
   */
  setContainerManager(cm: ContainerManager): void {
    this.containerManager = cm;
  }

  /**
   * Open a new terminal session for a process.
   * Uses Docker container shell if a container exists for the process,
   * otherwise uses node-pty for a real pseudo-terminal.
   */
  open(pid: PID, options: {
    cwd?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    shell?: string;
  } = {}): PTYSession {
    const id = `tty_${pid}_${Date.now()}`;
    const cols = options.cols || DEFAULT_TTY_COLS;
    const rows = options.rows || DEFAULT_TTY_ROWS;
    const cwd = options.cwd || '/tmp';
    const shell = options.shell || '/bin/bash';

    // Try to use container shell if ContainerManager has a container for this PID
    if (this.containerManager) {
      const containerProc = this.containerManager.spawnShell(pid, {
        cwd: '/home/agent',
        env: options.env,
      });
      if (containerProc) {
        return this.setupContainerSession(id, pid, containerProc, cols, rows, cwd);
      }
    }

    // Use node-pty for local shell
    try {
      return this.setupLocalSession(id, pid, shell, cwd, cols, rows, options.env);
    } catch (err: any) {
      console.error(`[PTYManager] Failed to spawn PTY for PID ${pid}:`, err.message);
      this.bus.emit('tty.error', {
        ttyId: id,
        pid,
        error: `Failed to open terminal: ${err.message}`,
      });
      throw new Error(`PTY spawn failed for PID ${pid}: ${err.message}`);
    }
  }

  /**
   * Set up a local PTY session using node-pty.
   * Provides proper SIGWINCH, job control, and interactive program support.
   */
  private setupLocalSession(
    id: string,
    pid: PID,
    shell: string,
    cwd: string,
    cols: number,
    rows: number,
    env?: Record<string, string>,
  ): LocalPTYSession {
    const ptyProcess = pty.spawn(shell, ['--login'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        PS1: '\\u@aether:\\w\\$ ',
      } as { [key: string]: string },
    });

    const session: LocalPTYSession = {
      id,
      pid,
      ptyProcess,
      process: null,
      cols,
      rows,
      cwd,
      createdAt: Date.now(),
      containerized: false,
    };

    // node-pty emits a single merged data stream (stdout+stderr)
    ptyProcess.onData((data: string) => {
      this.bus.emit('tty.output', {
        ttyId: id,
        pid,
        data,
      });
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      this.bus.emit('tty.closed', { ttyId: id, pid, code: exitCode, signal });
      this.sessions.delete(id);
    });

    this.sessions.set(id, session);
    this.bus.emit('tty.opened', { ttyId: id, pid });

    return session;
  }

  /**
   * Set up a container PTY session using child_process (docker exec).
   * Docker exec handles its own PTY allocation.
   */
  private setupContainerSession(
    id: string,
    pid: PID,
    proc: ChildProcess,
    cols: number,
    rows: number,
    cwd: string,
  ): ContainerPTYSession {
    const session: ContainerPTYSession = {
      id,
      pid,
      ptyProcess: null,
      process: proc,
      cols,
      rows,
      cwd,
      createdAt: Date.now(),
      containerized: true,
    };

    // Forward stdout
    proc.stdout?.on('data', (data: Buffer) => {
      this.bus.emit('tty.output', {
        ttyId: id,
        pid,
        data: data.toString(),
      });
    });

    // Forward stderr (merge into same output stream)
    proc.stderr?.on('data', (data: Buffer) => {
      this.bus.emit('tty.output', {
        ttyId: id,
        pid,
        data: data.toString(),
      });
    });

    // Handle process exit
    proc.on('exit', (code, signal) => {
      this.bus.emit('tty.closed', { ttyId: id, pid, code, signal });
      this.sessions.delete(id);
    });

    proc.on('error', (err) => {
      this.bus.emit('tty.output', {
        ttyId: id,
        pid,
        data: `\r\nShell error: ${err.message}\r\n`,
      });
    });

    this.sessions.set(id, session);
    this.bus.emit('tty.opened', { ttyId: id, pid });

    return session;
  }

  /**
   * Send input to a terminal session.
   */
  write(ttyId: string, data: string): boolean {
    const session = this.sessions.get(ttyId);
    if (!session) return false;

    if (session.containerized) {
      if (!session.process.stdin?.writable) return false;
      session.process.stdin.write(data);
    } else {
      session.ptyProcess.write(data);
    }

    return true;
  }

  /**
   * Execute a command in a terminal session and return the output.
   * For containerized sessions, optionally uses `docker exec` directly
   * for cleaner command execution.
   */
  exec(ttyId: string, command: string): Promise<string> {
    const session = this.sessions.get(ttyId);
    if (!session) {
      return Promise.reject(new Error(`TTY ${ttyId} not found`));
    }

    // For containerized sessions with a ContainerManager, use docker exec directly
    if (session.containerized && this.containerManager) {
      return this.containerManager.exec(session.pid, command);
    }

    // Fallback: pipe through the shell session
    return this.execViaShell(ttyId, command);
  }

  /**
   * Execute a command by piping through the shell session (marker-based).
   */
  private execViaShell(ttyId: string, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(ttyId);
      if (!session) {
        reject(new Error(`TTY ${ttyId} not found`));
        return;
      }

      let output = '';
      const marker = `__AETHER_END_${Date.now()}__`;

      const onData = (data: { ttyId: string; data: string }) => {
        if (data.ttyId !== ttyId) return;
        output += data.data;

        if (output.includes(marker)) {
          unsub();
          // Extract output between command and marker
          const lines = output.split('\n');
          const markerIdx = lines.findIndex(l => l.includes(marker));
          const result = lines.slice(0, markerIdx).join('\n').trim();
          resolve(result);
        }
      };

      const unsub = this.bus.on('tty.output', onData);

      // Send command followed by marker echo
      this.write(ttyId, `${command}\necho "${marker}"\n`);

      // Timeout after 30 seconds
      setTimeout(() => {
        unsub();
        resolve(output.trim());
      }, 30_000);
    });
  }

  /**
   * Resize a terminal session.
   * For local sessions, sends SIGWINCH via node-pty.
   * For container sessions, updates stored dimensions only.
   */
  resize(ttyId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(ttyId);
    if (!session) return false;

    session.cols = cols;
    session.rows = rows;

    if (!session.containerized) {
      // node-pty sends SIGWINCH automatically
      session.ptyProcess.resize(cols, rows);
    }

    return true;
  }

  /**
   * Close a terminal session.
   */
  close(ttyId: string): void {
    const session = this.sessions.get(ttyId);
    if (!session) return;

    if (session.containerized) {
      session.process.kill('SIGTERM');
      setTimeout(() => {
        if (!session.process.killed) {
          session.process.kill('SIGKILL');
        }
      }, 3000);
    } else {
      session.ptyProcess.kill();
    }

    this.sessions.delete(ttyId);
  }

  /**
   * Get a session by ID.
   */
  get(ttyId: string): PTYSession | undefined {
    return this.sessions.get(ttyId);
  }

  /**
   * Get all sessions for a process.
   */
  getByPid(pid: PID): PTYSession[] {
    return Array.from(this.sessions.values()).filter(s => s.pid === pid);
  }

  /**
   * Shutdown: close all sessions.
   */
  async shutdown(): Promise<void> {
    for (const [id] of this.sessions) {
      this.close(id);
    }
  }
}
