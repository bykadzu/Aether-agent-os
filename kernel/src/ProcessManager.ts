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
 * Includes priority-based scheduling with a wait queue (v0.5 Phase 2).
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
  QueuedSpawnRequest,
  createMessageId,
  IPC_QUEUE_MAX_LENGTH,
} from '@aether/shared';
import { MAX_PROCESSES } from '@aether/shared';

/** Default max concurrent active (non-dead, non-zombie) processes */
const DEFAULT_MAX_CONCURRENT = 20;

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

  /** Queue of spawn requests waiting for a slot, sorted by priority (1 = highest) */
  private waitQueue: QueuedSpawnRequest[] = [];

  /** Maximum number of concurrently active processes */
  readonly maxConcurrent: number;

  constructor(bus: EventBus, maxConcurrent?: number) {
    this.bus = bus;
    this.maxConcurrent = maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  /**
   * Allocate the next available PID.
   */
  private allocatePid(): PID {
    // Find next unused PID (skip over zombies)
    while (
      this.processes.has(this.nextPid) &&
      this.processes.get(this.nextPid)!.info.state !== 'dead'
    ) {
      this.nextPid++;
      if (this.nextPid > MAX_PROCESSES * 2) {
        this.nextPid = 1; // Wrap around
      }
    }
    return this.nextPid++;
  }

  /**
   * Count currently active processes (not dead, not zombie).
   */
  private activeCount(): number {
    let count = 0;
    for (const proc of this.processes.values()) {
      if (proc.info.state !== 'dead' && proc.info.state !== 'zombie') {
        count++;
      }
    }
    return count;
  }

  /**
   * Create a new process for an agent.
   * Returns the PID. The process starts in 'created' state.
   * The runtime is responsible for actually starting execution.
   *
   * If the active process count >= maxConcurrent, the spawn is queued
   * and null is returned. The request will be dequeued when a slot opens.
   */
  spawn(config: AgentConfig, ppid: PID = 0, ownerUid?: string): ManagedProcess {
    if (this.getAll().filter((p) => p.info.state !== 'dead').length >= MAX_PROCESSES) {
      throw new Error('Process table full');
    }

    const priority = Math.max(1, Math.min(5, config.priority ?? 3));

    // Check concurrent limit — queue if at capacity
    if (this.activeCount() >= this.maxConcurrent) {
      const request: QueuedSpawnRequest = {
        config,
        ppid,
        ownerUid,
        priority,
        queuedAt: Date.now(),
      };
      this.waitQueue.push(request);
      // Keep sorted by priority (1 = highest first), then by queuedAt
      this.waitQueue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);

      const position = this.waitQueue.indexOf(request) + 1;
      this.bus.emit('process.queued', { priority, position });

      throw new Error(`Process queued (position ${position}): concurrent limit reached`);
    }

    return this.doSpawn(config, ppid, ownerUid, priority);
  }

  /**
   * Internal: actually create the process (bypasses queue check).
   */
  private doSpawn(
    config: AgentConfig,
    ppid: PID,
    ownerUid: string | undefined,
    priority: number,
  ): ManagedProcess {
    const pid = this.allocatePid();
    const now = Date.now();
    const uid = `agent_${pid}`;

    const info: ProcessInfo = {
      pid,
      ppid,
      uid,
      ownerUid: ownerUid || 'root',
      name: `${config.role} Agent`,
      command: `aether-agent --role="${config.role}" --goal="${config.goal}"`,
      state: 'created',
      agentPhase: 'booting',
      cwd: `/home/${uid}`,
      env: {
        HOME: `/home/${uid}`,
        USER: uid,
        SHELL: process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash',
        TERM: 'xterm-256color',
        AETHER_ROLE: config.role,
        AETHER_GOAL: config.goal,
        ...(config.model ? { AETHER_MODEL: config.model } : {}),
      },
      createdAt: now,
      priority,
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
   * Try to dequeue the highest-priority waiting spawn request.
   * Called when a process exits or is reaped to free up a slot.
   */
  private dequeueNext(): ManagedProcess | null {
    if (this.waitQueue.length === 0) return null;
    if (this.activeCount() >= this.maxConcurrent) return null;

    const request = this.waitQueue.shift()!;
    const proc = this.doSpawn(request.config, request.ppid, request.ownerUid, request.priority);
    this.bus.emit('process.dequeued', { pid: proc.info.pid, priority: request.priority });
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

    // If process transitioned to a terminal state, try dequeuing
    if (state === 'zombie' || state === 'dead') {
      this.dequeueNext();
    }
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
        if (proc.info.state === 'stopped' || proc.info.state === 'paused') {
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
    // Emit cleanup event for home directory removal
    this.bus.emit('process.cleanup', { pid, uid: proc.info.uid, cwd: proc.info.cwd });
    // Try dequeuing a waiting request
    this.dequeueNext();
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

  // ---------------------------------------------------------------------------
  // Pause / Resume (Agent Takeover)
  // ---------------------------------------------------------------------------

  /**
   * Pause an agent so a human can take over its desktop.
   * The agent loop will spin-wait until resumed.
   */
  pause(pid: PID): boolean {
    const proc = this.processes.get(pid);
    if (!proc) return false;
    if (proc.info.state !== 'running' && proc.info.state !== 'sleeping') return false;

    this.setState(pid, 'paused');
    this.bus.emit('agent.paused', { pid });
    return true;
  }

  /**
   * Resume a paused agent, returning control from the human.
   */
  resume(pid: PID): boolean {
    const proc = this.processes.get(pid);
    if (!proc || proc.info.state !== 'paused') return false;

    this.setState(pid, 'running', 'thinking');
    this.bus.emit('agent.resumed', { pid });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Priority Scheduling
  // ---------------------------------------------------------------------------

  /**
   * Set the priority of a running process.
   * Priority must be 1-5 (1 = highest).
   */
  setPriority(pid: PID, priority: number): boolean {
    if (priority < 1 || priority > 5 || !Number.isInteger(priority)) {
      throw new Error('Priority must be an integer between 1 and 5');
    }

    const proc = this.processes.get(pid);
    if (!proc || proc.info.state === 'dead') return false;

    const prev = proc.info.priority;
    proc.info.priority = priority;

    this.bus.emit('process.priorityChanged', { pid, priority, previousPriority: prev });
    return true;
  }

  /**
   * Get the current wait queue (queued spawn requests), sorted by priority.
   */
  getQueue(): QueuedSpawnRequest[] {
    return [...this.waitQueue];
  }

  /**
   * Get active processes filtered by priority level.
   */
  getByPriority(priority: number): ManagedProcess[] {
    return this.getActive().filter((p) => p.info.priority === priority);
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
      results = results.filter((p) => p.info.state === filter.state);
    }
    if (filter?.uid) {
      results = results.filter((p) => p.info.uid === filter.uid);
    }
    return results;
  }

  /**
   * Get all active (non-dead) processes.
   */
  getActive(): ManagedProcess[] {
    return this.getAll().filter((p) => p.info.state !== 'dead');
  }

  /**
   * Get active processes filtered by owner user ID.
   * Admin users (ownerUid undefined) see all processes.
   */
  getActiveByOwner(ownerUid?: string, isAdmin = false): ManagedProcess[] {
    const active = this.getActive();
    if (!ownerUid || isAdmin) return active;
    return active.filter((p) => p.info.ownerUid === ownerUid);
  }

  /**
   * Check if a user owns a process (or is admin).
   */
  isOwner(pid: PID, ownerUid?: string, isAdmin = false): boolean {
    if (!ownerUid || isAdmin) return true;
    const proc = this.processes.get(pid);
    if (!proc) return false;
    return proc.info.ownerUid === ownerUid;
  }

  /**
   * Get process count by state.
   */
  getCounts(): Record<ProcessState, number> {
    const counts: Record<string, number> = {
      created: 0,
      running: 0,
      sleeping: 0,
      stopped: 0,
      paused: 0,
      zombie: 0,
      dead: 0,
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
  listRunningAgents(): Array<{
    pid: PID;
    uid: string;
    name: string;
    role: string;
    state: ProcessState;
    agentPhase?: AgentPhase;
  }> {
    return this.getActive()
      .filter((p) => p.info.state === 'running' || p.info.state === 'sleeping')
      .map((p) => ({
        pid: p.info.pid,
        uid: p.info.uid,
        name: p.info.name,
        role: p.info.env.AETHER_ROLE || 'unknown',
        state: p.info.state,
        agentPhase: p.info.agentPhase,
      }));
  }

  /**
   * Shutdown: kill all processes and clear wait queue.
   */
  async shutdown(): Promise<void> {
    this.waitQueue = [];
    const active = this.getActive();
    for (const proc of active) {
      this.signal(proc.info.pid, 'SIGTERM');
    }
    // Wait a bit, then force kill remaining
    await new Promise((r) => setTimeout(r, 2000));
    for (const proc of this.getActive()) {
      this.signal(proc.info.pid, 'SIGKILL');
    }
  }
}
