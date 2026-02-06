/**
 * Aether Kernel - PTY Manager
 *
 * Manages pseudo-terminal sessions for agent processes. Each agent can
 * have a terminal that connects to a real shell on the host.
 *
 * Uses Node.js child_process with a shell, providing real command execution.
 * In future, this will connect to sandboxed containers instead.
 *
 * The PTY output is streamed over the event bus and forwarded to the UI
 * via WebSocket.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventBus } from './EventBus.js';
import { PID, DEFAULT_TTY_COLS, DEFAULT_TTY_ROWS } from '@aether/shared';

export interface PTYSession {
  id: string;
  pid: PID;
  process: ChildProcess;
  cols: number;
  rows: number;
  cwd: string;
  createdAt: number;
}

export class PTYManager {
  private sessions = new Map<string, PTYSession>();
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Open a new terminal session for a process.
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

    // Spawn a real shell process
    const proc = spawn(shell, ['--login'], {
      cwd,
      env: {
        ...process.env,
        ...options.env,
        TERM: 'xterm-256color',
        COLUMNS: String(cols),
        LINES: String(rows),
        PS1: '\\u@aether:\\w\\$ ',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: PTYSession = {
      id,
      pid,
      process: proc,
      cols,
      rows,
      cwd,
      createdAt: Date.now(),
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
    if (!session || !session.process.stdin?.writable) return false;

    session.process.stdin.write(data);
    return true;
  }

  /**
   * Execute a command in a terminal session and return the output.
   * Useful for agent tool execution.
   */
  exec(ttyId: string, command: string): Promise<string> {
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
