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
 * Supports multiple LLM providers via the llm/ abstraction layer.
 */

import { Kernel } from '@aether/kernel';
import {
  PID,
  AgentConfig,
  MemoryRecord,
  AGENT_STEP_INTERVAL,
  DEFAULT_AGENT_MAX_STEPS,
} from '@aether/shared';
import type { AgentProfile } from '@aether/shared';
import {
  createToolSet,
  getToolsForAgent,
  ToolDefinition,
  ToolResult,
  ToolContext,
} from './tools.js';
import { getProviderFromModelString, getProvider } from './llm/index.js';
import type { LLMProvider, ChatMessage, ToolDefinition as LLMToolDef } from './llm/index.js';
import { runReflection } from './reflection.js';
import { getActivePlan, renderPlanAsMarkdown } from './planner.js';

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
  } = {},
): Promise<void> {
  const proc = kernel.processes.get(pid);
  if (!proc) throw new Error(`Process ${pid} not found`);

  // Load plugins for this agent if PluginManager is available
  if (kernel.plugins) {
    await kernel.plugins.loadPluginsForAgent(pid, proc.info.uid);
  }

  const tools = kernel.plugins ? getToolsForAgent(pid, kernel.plugins) : createToolSet();
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // Resolve LLM provider from config.model string or environment
  const provider = resolveProvider(config, options.apiKey);

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

  // Load relevant memories for context (v0.3 memory-aware loop)
  let contextMemories: MemoryRecord[] = [];
  if (kernel.memory) {
    try {
      contextMemories = kernel.memory.getMemoriesForContext(proc.info.uid, config.goal, 10);
    } catch (err) {
      console.warn(`[AgentLoop] Failed to load memories for ${proc.info.uid}:`, err);
    }
  }

  // Load active plan context (if any from a previous session)
  let planMarkdown: string | undefined;
  try {
    const activePlan = getActivePlan(kernel, pid);
    if (activePlan) {
      planMarkdown = renderPlanAsMarkdown(activePlan);
    }
  } catch {
    // Non-critical
  }

  // Load agent profile if available (v0.3 Wave 4)
  let agentProfile: AgentProfile | undefined;
  if (kernel.memory) {
    try {
      agentProfile = kernel.memory.getProfile(proc.info.uid);
    } catch (err) {
      console.warn(`[AgentLoop] Failed to load profile for ${proc.info.uid}:`, err);
    }
  }

  // System prompt
  state.history.push({
    role: 'system',
    content: buildSystemPrompt(config, tools, contextMemories, planMarkdown, agentProfile),
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

      const decision = await getNextAction(state, config, tools, provider, options.apiKey);

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

      // Auto-journal significant observations as episodic memory (v0.3)
      if (kernel.memory && result.success && decision.tool !== 'think') {
        try {
          kernel.memory.store({
            agent_uid: proc.info.uid,
            layer: 'episodic',
            content: `[Step ${state.step + 1}] Used ${decision.tool}: ${result.output.substring(0, 300)}`,
            tags: ['auto-journal', decision.tool],
            importance: decision.tool === 'complete' ? 0.8 : 0.3,
            source_pid: pid,
          });
        } catch {
          // Non-critical — don't break the agent loop for journaling failures
        }
      }

      // Check if agent completed
      if (decision.tool === 'complete') {
        kernel.bus.emit('agent.progress', {
          pid,
          step: state.step + 1,
          maxSteps: state.maxSteps,
          summary: 'Task completed successfully.',
        });

        // Run post-task reflection (fire-and-forget, don't block exit)
        runReflection(
          kernel,
          provider,
          {
            pid,
            agentUid: proc.info.uid,
            config,
            steps: state.step + 1,
            lastObservation: state.lastObservation,
          },
          config,
        ).catch((err) => {
          console.warn(`[AgentLoop] Reflection failed for PID ${pid}:`, err);
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
// LLM Provider Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the appropriate LLM provider based on agent config and environment.
 */
function resolveProvider(config: AgentConfig, apiKey?: string): LLMProvider | null {
  // If config.model specifies a provider:model string, use that
  if (config.model) {
    const provider = getProviderFromModelString(config.model);
    if (provider && provider.isAvailable()) return provider;
    // If the explicit provider isn't available, fall through to auto-detect
  }

  // If an API key was passed explicitly (legacy GEMINI_API_KEY path),
  // and no provider was specified, default to Gemini
  if (apiKey) {
    const { GeminiProvider } = require('./llm/GeminiProvider.js');
    const gemini = new GeminiProvider(config.model);
    return gemini;
  }

  // Auto-detect first available provider
  return getProvider();
}

// ---------------------------------------------------------------------------
// LLM Integration
// ---------------------------------------------------------------------------

const MAX_LLM_RETRIES = 3;

async function getNextAction(
  state: AgentState,
  config: AgentConfig,
  tools: ToolDefinition[],
  provider: LLMProvider | null,
  apiKey?: string,
): Promise<LLMDecision> {
  // If no provider is available (and no API key), use heuristic fallback
  if (!provider || (!provider.isAvailable() && !apiKey)) {
    return getHeuristicAction(state, config);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_LLM_RETRIES; attempt++) {
    try {
      // Convert state history to ChatMessage format for the provider
      const messages: ChatMessage[] = state.history.slice(-10).map((msg) => ({
        role: msg.role === 'agent' ? 'assistant' : msg.role === 'tool' ? 'user' : msg.role,
        content: msg.content,
      }));

      // Add the step instruction
      messages.push({
        role: 'user',
        content: `Step ${state.step + 1}/${state.maxSteps}. What tool should you use next?`,
      });

      // Convert tool definitions to LLM format
      const llmTools: LLMToolDef[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: {},
        },
      }));

      const response = await provider.chat(messages, llmTools);

      // Extract tool call from response
      if (response.toolCalls && response.toolCalls.length > 0) {
        const tc = response.toolCalls[0];
        return {
          reasoning: response.content || 'No reasoning provided',
          tool: tc.name,
          args: tc.arguments,
        };
      }

      // Try to parse JSON from text response (for Gemini-style responses)
      if (response.content) {
        let parsed: any;
        try {
          parsed = JSON.parse(response.content);
        } catch {
          // Not JSON, use as reasoning
          return {
            reasoning: response.content,
            tool: 'think',
            args: { thought: response.content },
          };
        }

        if (parsed.tool && typeof parsed.tool === 'string') {
          return {
            reasoning: parsed.reasoning || response.content,
            tool: parsed.tool,
            args: parsed.args || {},
          };
        }

        // Response parsed but missing tool field
        console.warn('[AgentLoop] LLM response missing tool field, using think');
        return {
          reasoning: parsed.reasoning || 'LLM response missing tool selection.',
          tool: 'think',
          args: { thought: 'Re-evaluating which tool to use.' },
        };
      }

      return {
        reasoning: 'No response from LLM',
        tool: 'think',
        args: { thought: 'LLM returned empty response' },
      };
    } catch (err: any) {
      lastError = err;
      const isRateLimit =
        err.message?.includes('429') || err.message?.toLowerCase().includes('rate limit');
      const isServerError = err.message?.includes('500') || err.message?.includes('503');

      if ((isRateLimit || isServerError) && attempt < MAX_LLM_RETRIES - 1) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        console.warn(
          `[AgentLoop] LLM rate limited/server error (attempt ${attempt + 1}/${MAX_LLM_RETRIES}), retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
        continue;
      }

      break;
    }
  }

  // All retries exhausted
  const msg = lastError?.message || 'Unknown error';
  console.error(`[AgentLoop] LLM call failed after ${MAX_LLM_RETRIES} attempts:`, msg);
  return {
    reasoning: `LLM call failed after ${MAX_LLM_RETRIES} retries: ${msg}. Using heuristic.`,
    tool: 'think',
    args: { thought: `LLM error: ${msg}` },
  };
}

function buildSystemPrompt(
  config: AgentConfig,
  tools: ToolDefinition[],
  memories: MemoryRecord[] = [],
  planMarkdown?: string,
  profile?: AgentProfile,
): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

  const sections = [
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
    `- You have persistent memory across sessions (use remember/recall tools)`,
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
    `6. Use 'remember' to save important discoveries for future sessions`,
    `7. Use 'recall' to retrieve relevant knowledge from past sessions`,
  ];

  // Inject agent profile if available (v0.3 Wave 4)
  if (profile && profile.total_tasks > 0) {
    sections.push(``);
    sections.push(`## Your Profile (auto-tracked)`);
    sections.push(
      `- Tasks completed: ${profile.total_tasks} (${Math.round(profile.success_rate * 100)}% success rate)`,
    );
    sections.push(`- Average quality rating: ${profile.avg_quality_rating.toFixed(1)}/5`);
    sections.push(`- Total steps across all tasks: ${profile.total_steps}`);
    if (profile.expertise.length > 0) {
      sections.push(`- Areas of expertise: ${profile.expertise.join(', ')}`);
    }
    if (profile.personality_traits.length > 0) {
      sections.push(`- Known traits: ${profile.personality_traits.join(', ')}`);
    }
  }

  // Inject relevant memories if any were loaded
  if (memories.length > 0) {
    sections.push(``);
    sections.push(`## Recalled Memories (from previous sessions)`);
    for (const m of memories) {
      const layerTag = `[${m.layer}]`;
      const tagsStr = m.tags.length > 0 ? ` (${m.tags.join(', ')})` : '';
      sections.push(`- ${layerTag} ${m.content.substring(0, 200)}${tagsStr}`);
    }
  }

  // Inject active plan if one exists
  if (planMarkdown) {
    sections.push(``);
    sections.push(planMarkdown);
  }

  return sections.join('\n');
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
      args: {
        summary: `Completed initial setup for: ${config.goal}. Created project structure and initial files.`,
      },
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
  return new Promise((r) => setTimeout(r, ms));
}
