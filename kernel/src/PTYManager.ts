/**
 * Aether Kernel - PTY Manager
 *
 * Manages pseudo-terminal sessions for agent processes. Each agent can
 * have a terminal that connects to a real shell.
 *
 * Supports two modes:
 * - Docker mode: terminal sessions run inside containers via ContainerManager
 * - Process mode: direct child_process spawning (fallback when Docker unavailable)
 *
 * The PTY output is streamed over the event bus and forwarded to the UI
 * via WebSocket.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventBus } from './EventBus.js';
import { ContainerManager } from './ContainerManager.js';
import { PID, DEFAULT_TTY_COLS, DEFAULT_TTY_ROWS } from '@aether/shared';

export interface PTYSession {
  id: string;
  pid: PID;
  process: ChildProcess;
  cols: number;
  rows: number;
  cwd: string;
  createdAt: number;
  /** Whether this session runs inside a Docker container */
  containerized: boolean;
}

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
   * otherwise falls back to direct child_process.
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

    let proc: ChildProcess;
    let containerized = false;

    // Try to use container shell if ContainerManager has a container for this PID
    if (this.containerManager) {
      const containerProc = this.containerManager.spawnShell(pid, {
        cwd: '/home/agent',
        env: options.env,
      });
      if (containerProc) {
        proc = containerProc;
        containerized = true;
      } else {
        proc = this.spawnLocalShell(shell, cwd, cols, rows, options.env);
      }
    } else {
      proc = this.spawnLocalShell(shell, cwd, cols, rows, options.env);
    }

    const session: PTYSession = {
      id,
      pid,
      process: proc,
      cols,
      rows,
      cwd,
      createdAt: Date.now(),
      containerized,
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
   * Spawn a local shell process (fallback when no container).
   */
  private spawnLocalShell(
    shell: string,
    cwd: string,
    cols: number,
    rows: number,
    env?: Record<string, string>,
  ): ChildProcess {
    return spawn(shell, ['--login'], {
      cwd,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        COLUMNS: String(cols),
        LINES: String(rows),
        PS1: '\\u@aether:\\w\\$ ',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Send input to a terminal session.
   */
  write(ttyId: string, data: string): boolean {
    const session = this.sessions.get(ttyId);
    if (!session || !session.process.stdin?.writable) return false;

    session.process.stdin.write(data);
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
   */
  resize(ttyId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(ttyId);
    if (!session) return false;

    session.cols = cols;
    session.rows = rows;

    // Note: without node-pty, we can't send SIGWINCH properly.
    // We update env vars which some programs respect.
    return true;
  }

  /**
   * Close a terminal session.
   */
  close(ttyId: string): void {
    const session = this.sessions.get(ttyId);
    if (!session) return;

    session.process.kill('SIGTERM');
    setTimeout(() => {
      if (!session.process.killed) {
        session.process.kill('SIGKILL');
      }
    }, 3000);

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
