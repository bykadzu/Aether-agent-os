/**
 * Aether Kernel - Agent Subprocess Manager
 *
 * Manages the lifecycle of external agent subprocesses (Claude Code, OpenClaw).
 * Each external agent runs as a real OS process with its stdin/stdout/stderr
 * piped through the Aether EventBus. The manager also writes runtime-specific
 * config files (CLAUDE.md, .openclaw/INSTRUCTIONS.md) into the agent's
 * working directory before spawning.
 *
 * Supports: start, stop (SIGTERM -> SIGKILL), pause (SIGSTOP), resume (SIGCONT),
 * sendInput (stdin), and stopAll (kernel shutdown).
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from './EventBus.js';
import type { AetherMCPServer } from './AetherMCPServer.js';
import type { PID, AgentConfig, AgentRuntime } from '@aether/shared';
import { SUBPROCESS_OUTPUT_MAX_BUFFER, SUBPROCESS_GRACEFUL_TIMEOUT } from '@aether/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubprocessInfo {
  pid: PID; // Aether process ID
  osPid: number; // Actual OS process ID
  runtime: AgentRuntime;
  process: ChildProcess;
  startedAt: number;
  outputBuffer: string; // Captured stdout (ring buffer)
  errorBuffer: string; // Captured stderr (ring buffer)
}

// ---------------------------------------------------------------------------
// AgentSubprocess
// ---------------------------------------------------------------------------

export class AgentSubprocess {
  private bus: EventBus;
  private mcpServer: AetherMCPServer;
  private subprocesses: Map<PID, SubprocessInfo> = new Map();

  constructor(bus: EventBus, mcpServer: AetherMCPServer) {
    this.bus = bus;
    this.mcpServer = mcpServer;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start an external agent subprocess.
   *
   * 1. Ensures the working directory exists
   * 2. Writes runtime-specific config files (CLAUDE.md, .mcp.json, etc.)
   * 3. Spawns the process with stdio piped
   * 4. Captures stdout/stderr and relays through EventBus
   * 5. Handles process exit and cleanup
   *
   * @param pid     - Aether process ID (from ProcessManager)
   * @param config  - Agent configuration (role, goal, runtime, skills, etc.)
   * @param workDir - Agent's working directory (real filesystem path)
   */
  async start(pid: PID, config: AgentConfig, workDir: string): Promise<SubprocessInfo> {
    const runtime = config.runtime || 'builtin';

    // 1. Ensure work directory exists
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    // 2. Write config files for the runtime
    await this.writeRuntimeConfig(pid, config, workDir, runtime);

    // 3. Build the command
    const { command, args, env } = this.buildCommand(pid, runtime, config, workDir);

    // 4. Spawn the process
    const child = spawn(command, args, {
      cwd: workDir,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const info: SubprocessInfo = {
      pid,
      osPid: child.pid || 0,
      runtime,
      process: child,
      startedAt: Date.now(),
      outputBuffer: '',
      errorBuffer: '',
    };

    this.subprocesses.set(pid, info);

    // 5. Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      info.outputBuffer += text;
      if (info.outputBuffer.length > SUBPROCESS_OUTPUT_MAX_BUFFER) {
        info.outputBuffer = info.outputBuffer.slice(-SUBPROCESS_OUTPUT_MAX_BUFFER);
      }
      this.bus.emit('subprocess.output', { pid, stream: 'stdout', data: text });
      // Also emit as agent log so the UI live-log panel picks it up
      this.bus.emit('agent.log', { pid, type: 'observation', message: text.trimEnd() });
    });

    // 6. Capture stderr
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      info.errorBuffer += text;
      if (info.errorBuffer.length > SUBPROCESS_OUTPUT_MAX_BUFFER) {
        info.errorBuffer = info.errorBuffer.slice(-SUBPROCESS_OUTPUT_MAX_BUFFER);
      }
      this.bus.emit('subprocess.output', { pid, stream: 'stderr', data: text });
    });

    // 7. Handle exit
    child.on('exit', (code, signal) => {
      this.bus.emit('subprocess.exited', {
        pid,
        code: code ?? null,
        signal: signal || null,
      });
      this.subprocesses.delete(pid);
    });

    child.on('error', (err) => {
      this.bus.emit('subprocess.output', {
        pid,
        stream: 'stderr',
        data: `Process error: ${err.message}`,
      });
    });

    this.bus.emit('subprocess.started', {
      pid,
      runtime,
      processId: child.pid || 0,
    });

    return info;
  }

  /**
   * Stop a subprocess gracefully.
   * Sends SIGTERM first, then SIGKILL after SUBPROCESS_GRACEFUL_TIMEOUT.
   */
  async stop(pid: PID): Promise<void> {
    const info = this.subprocesses.get(pid);
    if (!info) return;

    return new Promise<void>((resolve) => {
      // Try graceful shutdown
      try {
        info.process.kill('SIGTERM');
      } catch {
        // Process may already be dead
        resolve();
        return;
      }

      // Force kill after timeout
      const killTimer = setTimeout(() => {
        try {
          info.process.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }, SUBPROCESS_GRACEFUL_TIMEOUT);

      info.process.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      // Safety: if exit event never fires, resolve after SIGKILL timeout + buffer
      setTimeout(() => resolve(), SUBPROCESS_GRACEFUL_TIMEOUT + 2000);
    });
  }

  /**
   * Pause a subprocess (SIGSTOP on Unix).
   * On Windows, SIGSTOP is not available -- the kernel's ProcessManager
   * handles the logical state change and the agent is effectively idle.
   */
  pause(pid: PID): void {
    const info = this.subprocesses.get(pid);
    if (!info) return;
    try {
      if (process.platform !== 'win32') {
        info.process.kill('SIGSTOP');
      }
      // On Windows, we rely on ProcessManager setting the paused state.
      // The subprocess continues running but the UI treats it as paused.
    } catch {
      /* ignore - process may be gone */
    }
  }

  /**
   * Resume a paused subprocess (SIGCONT on Unix).
   */
  resume(pid: PID): void {
    const info = this.subprocesses.get(pid);
    if (!info) return;
    try {
      if (process.platform !== 'win32') {
        info.process.kill('SIGCONT');
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Send text to a subprocess's stdin.
   * Used for message injection (e.g., user sends instructions to a running agent).
   */
  sendInput(pid: PID, text: string): void {
    const info = this.subprocesses.get(pid);
    if (!info || !info.process.stdin) return;
    info.process.stdin.write(text + '\n');
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Get the buffered output for a subprocess.
   */
  getOutput(pid: PID): { stdout: string; stderr: string } | null {
    const info = this.subprocesses.get(pid);
    if (!info) return null;
    return { stdout: info.outputBuffer, stderr: info.errorBuffer };
  }

  /**
   * Check if a subprocess is currently running.
   */
  isRunning(pid: PID): boolean {
    return this.subprocesses.has(pid);
  }

  /**
   * Get subprocess info.
   */
  get(pid: PID): SubprocessInfo | undefined {
    return this.subprocesses.get(pid);
  }

  /**
   * Get all active subprocesses.
   */
  getAll(): SubprocessInfo[] {
    return Array.from(this.subprocesses.values());
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  /**
   * Stop all running subprocesses (for kernel shutdown).
   */
  async stopAll(): Promise<void> {
    const pids = Array.from(this.subprocesses.keys());
    await Promise.all(pids.map((pid) => this.stop(pid)));
  }

  // -------------------------------------------------------------------------
  // Config Generation (private)
  // -------------------------------------------------------------------------

  /**
   * Write runtime-specific config files to the agent's working directory.
   * These files tell the external runtime about the agent's role, goal,
   * and how to connect to Aether's MCP server.
   */
  private async writeRuntimeConfig(
    pid: PID,
    config: AgentConfig,
    workDir: string,
    runtime: AgentRuntime,
  ): Promise<void> {
    if (runtime === 'claude-code') {
      await this.writeClaudeCodeConfig(pid, config, workDir);
    } else if (runtime === 'openclaw') {
      await this.writeOpenClawConfig(pid, config, workDir);
    }

    // Write shared skills file if skills are pre-loaded
    if (config.skills?.length) {
      const skillsInfo = config.skills.map((s) => `- ${s}`).join('\n');
      fs.writeFileSync(path.join(workDir, 'SKILLS.md'), `# Pre-loaded Skills\n\n${skillsInfo}\n`);
    }
  }

  /**
   * Write CLAUDE.md and .mcp.json for Claude Code runtime.
   */
  private async writeClaudeCodeConfig(
    pid: PID,
    config: AgentConfig,
    workDir: string,
  ): Promise<void> {
    // CLAUDE.md — injected context for the Claude Code agent
    const claudeMd = [
      `# Agent Context`,
      ``,
      `You are an AI agent running inside Aether OS.`,
      `- Role: ${config.role}`,
      `- Goal: ${config.goal}`,
      `- PID: ${pid}`,
      ``,
      `## Available Aether Tools`,
      `You have access to Aether OS tools via MCP (prefixed with aether_).`,
      `Use these to store memories, discover/create skills, collaborate with other agents, and read the system source code.`,
      ``,
      `## Your Task`,
      `${config.goal}`,
    ].join('\n');

    fs.writeFileSync(path.join(workDir, 'CLAUDE.md'), claudeMd);

    // .mcp.json — MCP server config pointing to the Aether stdio bridge
    const bridgeScript = path.resolve(__dirname, '../src/aether-mcp-bridge.ts');
    const bridgeDist = path.resolve(__dirname, './aether-mcp-bridge.js');
    const bridgePath = fs.existsSync(bridgeDist) ? bridgeDist : bridgeScript;
    const kernelPort = process.env.AETHER_PORT || '3001';

    const mcpConfig = {
      mcpServers: {
        'aether-os': {
          command: fs.existsSync(bridgeDist) ? 'node' : 'npx',
          args: fs.existsSync(bridgeDist)
            ? [bridgePath, '--pid', String(pid), '--port', kernelPort]
            : ['tsx', bridgePath, '--pid', String(pid), '--port', kernelPort],
        },
      },
    };
    fs.writeFileSync(path.join(workDir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2));
  }

  /**
   * Write INSTRUCTIONS.md for OpenClaw runtime.
   */
  private async writeOpenClawConfig(pid: PID, config: AgentConfig, workDir: string): Promise<void> {
    const instructions = [
      `# Agent Instructions`,
      ``,
      `Role: ${config.role}`,
      `Goal: ${config.goal}`,
      ``,
      `You are running inside Aether OS. Use aether_* MCP tools for memory, skills, and collaboration.`,
    ].join('\n');

    const instructionsDir = path.join(workDir, '.openclaw');
    if (!fs.existsSync(instructionsDir)) {
      fs.mkdirSync(instructionsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(instructionsDir, 'INSTRUCTIONS.md'), instructions);

    // .mcp.json — same bridge config as Claude Code
    const bridgeScript = path.resolve(__dirname, '../src/aether-mcp-bridge.ts');
    const bridgeDist = path.resolve(__dirname, './aether-mcp-bridge.js');
    const bridgePath = fs.existsSync(bridgeDist) ? bridgeDist : bridgeScript;
    const kernelPort = process.env.AETHER_PORT || '3001';

    const mcpConfig = {
      mcpServers: {
        'aether-os': {
          command: fs.existsSync(bridgeDist) ? 'node' : 'npx',
          args: fs.existsSync(bridgeDist)
            ? [bridgePath, '--pid', String(pid), '--port', kernelPort]
            : ['tsx', bridgePath, '--pid', String(pid), '--port', kernelPort],
        },
      },
    };
    fs.writeFileSync(path.join(workDir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2));
  }

  // -------------------------------------------------------------------------
  // Command Building (private)
  // -------------------------------------------------------------------------

  /**
   * Build the command, args, and env for spawning the external agent process.
   */
  private buildCommand(
    _pid: PID,
    runtime: AgentRuntime,
    config: AgentConfig,
    workDir: string,
  ): { command: string; args: string[]; env: Record<string, string> } {
    const env: Record<string, string> = {
      AETHER_PID: String(_pid),
      AETHER_ROLE: config.role,
      AETHER_GOAL: config.goal,
    };

    const mcpConfigPath = path.join(workDir, '.mcp.json');

    switch (runtime) {
      case 'claude-code':
        return {
          command: 'claude',
          args: [
            '--print', // Non-interactive streaming output
            '--dangerously-skip-permissions', // Agent mode — no interactive prompts
            '--mcp-config',
            mcpConfigPath, // Connect to Aether MCP tools
            config.goal, // The task to accomplish
          ],
          env,
        };

      case 'openclaw':
        return {
          command: 'openclaw',
          args: ['agent', '--mcp-config', mcpConfigPath, config.goal],
          env,
        };

      default:
        // Fallback: shouldn't reach here for external runtimes.
        // Builtin runtime uses AgentLoop, not AgentSubprocess.
        return {
          command: 'echo',
          args: ['Builtin runtime -- use AgentLoop'],
          env,
        };
    }
  }
}
