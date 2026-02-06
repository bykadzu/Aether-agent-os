/**
 * Aether Runtime - Agent Loop
 *
 * The core execution loop for an AI agent. This is the "brain" that
 * drives agent behavior through a think-act-observe cycle.
 *
 * The loop:
 *   1. Gather context (files, terminal output, previous actions)
 *   2. Ask the LLM what to do next (think)
 *   3. Execute the chosen tool (act)
 *   4. Observe the result
 *   5. Repeat until goal is achieved or limit reached
 *
 * This runs server-side, within the kernel's process space.
 * The LLM integration uses the Gemini API.
 */

import { Kernel } from '@aether/kernel';
import { PID, AgentConfig, AGENT_STEP_INTERVAL, DEFAULT_AGENT_MAX_STEPS } from '@aether/shared';
import { createToolSet, getToolsForAgent, ToolDefinition, ToolResult, ToolContext } from './tools.js';

interface AgentState {
  step: number;
  maxSteps: number;
  history: AgentMessage[];
  lastObservation: string;
  artifacts: Array<{ type: string; path?: string }>;
}

interface AgentMessage {
  role: 'system' | 'agent' | 'tool';
  content: string;
  timestamp: number;
}

interface LLMDecision {
  tool: string;
  args: Record<string, any>;
  reasoning: string;
}

/**
 * Run the agent loop for a given process.
 *
 * This is a long-running async function that continues until the agent
 * completes, errors, or is killed.
 */
export async function runAgentLoop(
  kernel: Kernel,
  pid: PID,
  config: AgentConfig,
  options: {
    apiKey?: string;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  const proc = kernel.processes.get(pid);
  if (!proc) throw new Error(`Process ${pid} not found`);

  // Load plugins for this agent if PluginManager is available
  if (kernel.plugins) {
    await kernel.plugins.loadPluginsForAgent(pid, proc.info.uid);
  }

  const tools = kernel.plugins
    ? getToolsForAgent(pid, kernel.plugins)
    : createToolSet();
  const toolMap = new Map(tools.map(t => [t.name, t]));

  const state: AgentState = {
    step: 0,
    maxSteps: config.maxSteps || DEFAULT_AGENT_MAX_STEPS,
    history: [],
    lastObservation: '',
    artifacts: [],
  };

  const ctx: ToolContext = {
    kernel,
    pid,
    uid: proc.info.uid,
    cwd: proc.info.cwd,
  };

  // System prompt
  state.history.push({
    role: 'system',
    content: buildSystemPrompt(config, tools),
    timestamp: Date.now(),
  });

  kernel.processes.setState(pid, 'running', 'thinking');

  // Log initial state
  kernel.bus.emit('agent.thought', {
    pid,
    thought: `Initialized as ${config.role}. Goal: ${config.goal}`,
  });

  kernel.bus.emit('agent.progress', {
    pid,
    step: 0,
    maxSteps: state.maxSteps,
    summary: 'Agent initialized, beginning work...',
  });

  // Main loop
  while (state.step < state.maxSteps) {
    // Check abort signal
    if (options.signal?.aborted) {
      kernel.bus.emit('agent.thought', { pid, thought: 'Received abort signal.' });
      kernel.processes.setState(pid, 'zombie', 'failed');
      return;
    }

    // Check if process is still running
    const currentProc = kernel.processes.get(pid);
    if (!currentProc || currentProc.info.state === 'zombie' || currentProc.info.state === 'dead') {
      return;
    }

    // If stopped, wait
    if (currentProc.info.state === 'stopped') {
      await sleep(1000);
      continue;
    }

    try {
      // Phase 1: Think - ask LLM for next action
      kernel.processes.setState(pid, 'running', 'thinking');

      const decision = await getNextAction(state, config, tools, options.apiKey);

      // Log the reasoning
      kernel.bus.emit('agent.thought', { pid, thought: decision.reasoning });
      state.history.push({
        role: 'agent',
        content: `[Think] ${decision.reasoning}\n[Action] ${decision.tool}(${JSON.stringify(decision.args)})`,
        timestamp: Date.now(),
      });

      // Phase 2: Act - execute the chosen tool
      const tool = toolMap.get(decision.tool);
      if (!tool) {
        const errMsg = `Unknown tool: ${decision.tool}`;
        state.history.push({ role: 'tool', content: errMsg, timestamp: Date.now() });
        state.lastObservation = errMsg;
        state.step++;
        continue;
      }

      // Check if approval is needed
      if (tool.requiresApproval) {
        kernel.processes.setState(pid, 'sleeping', 'waiting');
        kernel.bus.emit('process.approval_required', {
          pid,
          action: tool.name,
          details: JSON.stringify(decision.args),
        });

        // Wait for approval or rejection
        const approved = await waitForApproval(kernel, pid, options.signal);
        if (!approved) {
          state.history.push({
            role: 'tool',
            content: 'Action was rejected by the user.',
            timestamp: Date.now(),
          });
          state.lastObservation = 'Action rejected by user.';
          state.step++;
          continue;
        }
      }

      kernel.processes.setState(pid, 'running', 'executing');
      kernel.bus.emit('agent.action', {
        pid,
        tool: decision.tool,
        args: decision.args,
      });

      // Execute the tool
      const result = await tool.execute(decision.args, ctx);

      // Phase 3: Observe - record the result
      kernel.processes.setState(pid, 'running', 'observing');
      kernel.bus.emit('agent.observation', {
        pid,
        result: result.output.substring(0, 500),
      });

      state.history.push({
        role: 'tool',
        content: `[${decision.tool}] ${result.success ? 'OK' : 'FAIL'}: ${result.output.substring(0, 1000)}`,
        timestamp: Date.now(),
      });
      state.lastObservation = result.output;

      if (result.artifacts) {
        state.artifacts.push(...result.artifacts);
      }

      // Check if agent completed
      if (decision.tool === 'complete') {
        kernel.bus.emit('agent.progress', {
          pid,
          step: state.step + 1,
          maxSteps: state.maxSteps,
          summary: 'Task completed successfully.',
        });
        return;
      }

      state.step++;
      kernel.bus.emit('agent.progress', {
        pid,
        step: state.step,
        maxSteps: state.maxSteps,
        summary: decision.reasoning.substring(0, 100),
      });

      // Rate limit between steps
      await sleep(AGENT_STEP_INTERVAL);

    } catch (err: any) {
      console.error(`[AgentLoop] Error in step ${state.step} for PID ${pid}:`, err);
      kernel.bus.emit('agent.thought', {
        pid,
        thought: `Error: ${err.message}`,
      });

      state.history.push({
        role: 'tool',
        content: `Error: ${err.message}`,
        timestamp: Date.now(),
      });

      // Continue on non-fatal errors
      state.step++;
      await sleep(AGENT_STEP_INTERVAL);
    }
  }

  // Max steps reached
  kernel.bus.emit('agent.thought', {
    pid,
    thought: `Reached maximum step limit (${state.maxSteps}). Stopping.`,
  });
  kernel.processes.setState(pid, 'zombie', 'completed');
  kernel.processes.exit(pid, 0);
}

// ---------------------------------------------------------------------------
// LLM Integration
// ---------------------------------------------------------------------------

async function getNextAction(
  state: AgentState,
  config: AgentConfig,
  tools: ToolDefinition[],
  apiKey?: string,
): Promise<LLMDecision> {
  // If no API key, use a simple heuristic fallback
  if (!apiKey) {
    return getHeuristicAction(state, config);
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const prompt = buildPrompt(state, tools);

    const response = await ai.models.generateContent({
      model: config.model || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as any,
          properties: {
            reasoning: { type: 'string' as any, description: 'Your step-by-step reasoning' },
            tool: { type: 'string' as any, description: 'The tool to use' },
            args: { type: 'object' as any, description: 'Arguments for the tool' },
          },
          required: ['reasoning', 'tool', 'args'],
        },
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);

    return {
      reasoning: parsed.reasoning || 'No reasoning provided',
      tool: parsed.tool || 'think',
      args: parsed.args || {},
    };
  } catch (err: any) {
    console.error('[AgentLoop] LLM call failed:', err.message);
    return {
      reasoning: `LLM call failed: ${err.message}. Using heuristic.`,
      tool: 'think',
      args: { thought: `LLM error: ${err.message}` },
    };
  }
}

function buildSystemPrompt(config: AgentConfig, tools: ToolDefinition[]): string {
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  return [
    `You are an AI agent running inside Aether OS, a purpose-built operating system for AI agents.`,
    ``,
    `## Your Identity`,
    `- Role: ${config.role}`,
    `- Goal: ${config.goal}`,
    ``,
    `## Your Environment`,
    `- You have a real Linux terminal with bash`,
    `- You have a real filesystem with your home directory`,
    `- You can create files, run commands, and browse the web`,
    `- Your actions are observable by the human operator`,
    ``,
    `## Available Tools`,
    toolList,
    ``,
    `## Rules`,
    `1. Think step by step before acting`,
    `2. Use the simplest tool that accomplishes the task`,
    `3. Create files in your home directory when producing artifacts`,
    `4. Call 'complete' when you've achieved your goal`,
    `5. Be efficient - don't repeat actions unnecessarily`,
  ].join('\n');
}

function buildPrompt(state: AgentState, tools: ToolDefinition[]): string {
  // Build a conversation-style prompt from history
  const recentHistory = state.history.slice(-10); // Last 10 messages
  let prompt = '';

  for (const msg of recentHistory) {
    if (msg.role === 'system') {
      prompt += `${msg.content}\n\n`;
    } else if (msg.role === 'agent') {
      prompt += `Previous action: ${msg.content}\n\n`;
    } else {
      prompt += `Tool result: ${msg.content}\n\n`;
    }
  }

  prompt += `Step ${state.step + 1}/${state.maxSteps}. What tool should you use next? Respond with JSON: { "reasoning": "...", "tool": "...", "args": {...} }`;

  return prompt;
}

/**
 * Simple heuristic-based action selection when no LLM is available.
 * This allows the system to function as a demo without an API key.
 */
function getHeuristicAction(state: AgentState, config: AgentConfig): LLMDecision {
  const step = state.step;

  if (step === 0) {
    return {
      reasoning: `Starting task as ${config.role}. First, I'll explore the working directory.`,
      tool: 'list_files',
      args: { path: '.' },
    };
  }

  if (step === 1) {
    return {
      reasoning: 'Setting up project structure by creating a workspace directory.',
      tool: 'mkdir',
      args: { path: 'Projects/workspace' },
    };
  }

  if (step === 2 && config.role === 'Coder') {
    return {
      reasoning: 'Creating an initial project file based on the goal.',
      tool: 'write_file',
      args: {
        path: 'Projects/workspace/main.py',
        content: `#!/usr/bin/env python3\n"""${config.goal}"""\n\ndef main():\n    print("Aether OS Agent - Task: ${config.goal}")\n\nif __name__ == "__main__":\n    main()\n`,
      },
    };
  }

  if (step === 2 && config.role === 'Researcher') {
    return {
      reasoning: 'Creating a research notes file to organize findings.',
      tool: 'write_file',
      args: {
        path: 'Documents/research-notes.md',
        content: `# Research: ${config.goal}\n\n## Objective\n${config.goal}\n\n## Findings\n- (Starting research...)\n\n## Sources\n- (To be added)\n`,
      },
    };
  }

  if (step === 2) {
    return {
      reasoning: 'Creating a task plan document.',
      tool: 'write_file',
      args: {
        path: 'Documents/task-plan.md',
        content: `# Task Plan\n\n## Goal\n${config.goal}\n\n## Steps\n1. Analyze requirements\n2. Execute plan\n3. Verify results\n`,
      },
    };
  }

  if (step === 3) {
    return {
      reasoning: 'Running a shell command to verify the environment.',
      tool: 'run_command',
      args: { command: 'echo "Environment check:" && uname -a && pwd && ls -la' },
    };
  }

  if (step >= 4) {
    return {
      reasoning: 'Initial setup complete. Marking task as done for this demo iteration.',
      tool: 'complete',
      args: { summary: `Completed initial setup for: ${config.goal}. Created project structure and initial files.` },
    };
  }

  return {
    reasoning: 'Thinking about next steps...',
    tool: 'think',
    args: { thought: `Planning next action for step ${step}` },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForApproval(kernel: Kernel, pid: PID, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const unsubApprove = kernel.bus.on('agent.approved', (data: { pid: PID }) => {
      if (data.pid === pid) {
        unsubApprove();
        unsubReject();
        resolve(true);
      }
    });

    const unsubReject = kernel.bus.on('agent.rejected', (data: { pid: PID }) => {
      if (data.pid === pid) {
        unsubApprove();
        unsubReject();
        resolve(false);
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      unsubApprove();
      unsubReject();
      resolve(false);
    }, 300_000);

    // Handle abort
    signal?.addEventListener('abort', () => {
      unsubApprove();
      unsubReject();
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
