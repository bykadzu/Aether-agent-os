/**
 * Aether Kernel - Process Manager
 *
 * Manages the lifecycle of all processes in the system. Each agent runs as
 * a process with its own PID, environment, and working directory.
 *
 * Process model:
 * - PID 0: kernel (init)
 * - PID 1+: user/agent processes
 *
 * Unlike a traditional OS, our "processes" are agent loops rather than
 * native executables. But the abstraction is the same: spawn, signal, wait.
 *
 * Includes per-process message queues for IPC between agents.
 */

import { EventBus } from './EventBus.js';
import {
  PID,
  ProcessState,
  AgentPhase,
  ProcessInfo,
  AgentConfig,
  Signal,
  IPCMessage,
  createMessageId,
  IPC_QUEUE_MAX_LENGTH,
} from '@aether/shared';
import { MAX_PROCESSES } from '@aether/shared';

export interface ManagedProcess {
  info: ProcessInfo;
  agentConfig?: AgentConfig;
  abortController: AbortController;
  /** The actual execution handle - set by the runtime */
  handle?: any;
  /** IPC message queue for this process */
  messageQueue: IPCMessage[];
}

export class ProcessManager {
  private processes = new Map<PID, ManagedProcess>();
  private nextPid: PID = 1;
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Allocate the next available PID.
   */
  private allocatePid(): PID {
    // Find next unused PID (skip over zombies)
    while (this.processes.has(this.nextPid) &&
           this.processes.get(this.nextPid)!.info.state !== 'dead') {
      this.nextPid++;
      if (this.nextPid > MAX_PROCESSES * 2) {
        this.nextPid = 1; // Wrap around
      }
    }
    return this.nextPid++;
  }

  /**
   * Create a new process for an agent.
   * Returns the PID. The process starts in 'created' state.
   * The runtime is responsible for actually starting execution.
   */
  spawn(config: AgentConfig, ppid: PID = 0): ManagedProcess {
    if (this.getAll().filter(p => p.info.state !== 'dead').length >= MAX_PROCESSES) {
      throw new Error('Process table full');
    }

    const pid = this.allocatePid();
    const now = Date.now();
    const uid = `agent_${pid}`;

    const info: ProcessInfo = {
      pid,
      ppid,
      uid,
      name: `${config.role} Agent`,
      command: `aether-agent --role="${config.role}" --goal="${config.goal}"`,
      state: 'created',
      agentPhase: 'booting',
      cwd: `/home/${uid}`,
      env: {
        HOME: `/home/${uid}`,
        USER: uid,
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
        AETHER_ROLE: config.role,
        AETHER_GOAL: config.goal,
        ...(config.model ? { AETHER_MODEL: config.model } : {}),
      },
      createdAt: now,
      cpuPercent: 0,
      memoryMB: 0,
    };

    const proc: ManagedProcess = {
      info,
      agentConfig: config,
      abortController: new AbortController(),
      messageQueue: [],
    };

    this.processes.set(pid, proc);

    this.bus.emit('process.spawned', { pid, info: { ...info } });
    return proc;
  }

  /**
   * Transition a process to a new state.
   */
  setState(pid: PID, state: ProcessState, agentPhase?: AgentPhase): void {
    const proc = this.processes.get(pid);
    if (!proc) return;

    const prev = proc.info.state;
    proc.info.state = state;
    if (agentPhase !== undefined) {
      proc.info.agentPhase = agentPhase;
    }

    this.bus.emit('process.stateChange', {
      pid,
      state,
      previousState: prev,
      agentPhase: proc.info.agentPhase,
    });
  }

  /**
   * Send a signal to a process.
   */
  signal(pid: PID, sig: Signal): boolean {
    const proc = this.processes.get(pid);
    if (!proc || proc.info.state === 'dead') return false;

    switch (sig) {
      case 'SIGTERM':
      case 'SIGKILL':
        proc.abortController.abort();
        this.setState(pid, 'zombie', 'failed');
        this.bus.emit('process.exit', {
          pid,
          code: sig === 'SIGKILL' ? 137 : 143,
          signal: sig,
        });
        // Clean up after a short delay (like waitpid)
        setTimeout(() => this.reap(pid), 1000);
        return true;

      case 'SIGSTOP':
        this.setState(pid, 'stopped');
        return true;

      case 'SIGCONT':
        if (proc.info.state === 'stopped') {
          this.setState(pid, 'running');
        }
        return true;

      case 'SIGINT':
        // Interrupt - agent should handle gracefully
        this.bus.emit('process.signal', { pid, signal: sig });
        return true;

      default:
        this.bus.emit('process.signal', { pid, signal: sig });
        return true;
    }
  }

  /**
   * Clean up a zombie process (equivalent to waitpid).
   */
  reap(pid: PID): void {
    const proc = this.processes.get(pid);
    if (!proc) return;
    proc.info.state = 'dead';
    proc.messageQueue = []; // Clear IPC queue
    this.bus.emit('process.reaped', { pid });
  }

  /**
   * Mark a process as exited with a code.
   */
  exit(pid: PID, code: number): void {
    const proc = this.processes.get(pid);
    if (!proc) return;

    proc.info.state = 'zombie';
    proc.info.agentPhase = code === 0 ? 'completed' : 'failed';
    this.bus.emit('process.exit', { pid, code });

    // Auto-reap after delay
    setTimeout(() => this.reap(pid), 2000);
  }

  /**
   * Get process by PID.
   */
  get(pid: PID): ManagedProcess | undefined {
    return this.processes.get(pid);
  }

  /**
   * Get all processes (optionally filtered by state).
   */
  getAll(filter?: { state?: ProcessState; uid?: string }): ManagedProcess[] {
    let results = Array.from(this.processes.values());
    if (filter?.state) {
      results = results.filter(p => p.info.state === filter.state);
    }
    if (filter?.uid) {
      results = results.filter(p => p.info.uid === filter.uid);
    }
    return results;
  }

  /**
   * Get all active (non-dead) processes.
   */
  getActive(): ManagedProcess[] {
    return this.getAll().filter(p => p.info.state !== 'dead');
  }

  /**
   * Get process count by state.
   */
  getCounts(): Record<ProcessState, number> {
    const counts: Record<string, number> = {
      created: 0, running: 0, sleeping: 0, stopped: 0, zombie: 0, dead: 0,
    };
    for (const proc of this.processes.values()) {
      counts[proc.info.state] = (counts[proc.info.state] || 0) + 1;
    }
    return counts as Record<ProcessState, number>;
  }

  /**
   * Update resource metrics for a process.
   */
  updateMetrics(pid: PID, cpu: number, memMB: number): void {
    const proc = this.processes.get(pid);
    if (!proc) return;
    proc.info.cpuPercent = cpu;
    proc.info.memoryMB = memMB;
  }

  // ---------------------------------------------------------------------------
  // IPC - Inter-Process Communication
  // ---------------------------------------------------------------------------

  /**
   * Send an IPC message from one process to another.
   * The message is queued and the receiving agent gets it on their next step.
   */
  sendMessage(fromPid: PID, toPid: PID, channel: string, payload: any): IPCMessage | null {
    const fromProc = this.processes.get(fromPid);
    const toProc = this.processes.get(toPid);

    if (!fromProc || fromProc.info.state === 'dead') return null;
    if (!toProc || toProc.info.state === 'dead') return null;

    const message: IPCMessage = {
      id: createMessageId(),
      fromPid,
      toPid,
      fromUid: fromProc.info.uid,
      toUid: toProc.info.uid,
      channel,
      payload,
      timestamp: Date.now(),
      delivered: false,
    };

    // Enforce queue limit
    if (toProc.messageQueue.length >= IPC_QUEUE_MAX_LENGTH) {
      toProc.messageQueue.shift(); // Drop oldest
    }

    toProc.messageQueue.push(message);

    this.bus.emit('ipc.message', { message });

    return message;
  }

  /**
   * Drain (consume) all pending IPC messages for a process.
   * Marks them as delivered and removes from queue.
   */
  drainMessages(pid: PID): IPCMessage[] {
    const proc = this.processes.get(pid);
    if (!proc) return [];

    const messages = proc.messageQueue.splice(0);
    for (const msg of messages) {
      msg.delivered = true;
      this.bus.emit('ipc.delivered', { messageId: msg.id, toPid: pid });
    }
    return messages;
  }

  /**
   * Peek at pending messages without consuming them.
   */
  peekMessages(pid: PID): IPCMessage[] {
    const proc = this.processes.get(pid);
    if (!proc) return [];
    return [...proc.messageQueue];
  }

  /**
   * List all active running agents (for /proc discovery).
   */
  listRunningAgents(): Array<{ pid: PID; uid: string; name: string; role: string; state: ProcessState; agentPhase?: AgentPhase }> {
    return this.getActive()
      .filter(p => p.info.state === 'running' || p.info.state === 'sleeping')
      .map(p => ({
        pid: p.info.pid,
        uid: p.info.uid,
        name: p.info.name,
        role: p.info.env.AETHER_ROLE || 'unknown',
        state: p.info.state,
        agentPhase: p.info.agentPhase,
      }));
  }

  /**
   * Shutdown: kill all processes.
   */
  async shutdown(): Promise<void> {
    const active = this.getActive();
    for (const proc of active) {
      this.signal(proc.info.pid, 'SIGTERM');
    }
    // Wait a bit, then force kill remaining
    await new Promise(r => setTimeout(r, 2000));
    for (const proc of this.getActive()) {
      this.signal(proc.info.pid, 'SIGKILL');
    }
  }
}
