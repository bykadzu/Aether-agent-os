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
  CONTEXT_COMPACTION_STEP_INTERVAL,
  CONTEXT_COMPACTION_TOKEN_THRESHOLD,
  CONTEXT_COMPACTION_KEEP_RECENT,
} from '@aether/shared';
import type { AgentProfile } from '@aether/shared';
import {
  createToolSet,
  getToolsForAgent,
  getToolSchemasForAgent,
  ToolDefinition,
  ToolResult,
  ToolContext,
  TOOL_SCHEMAS,
} from './tools.js';
import { getProviderFromModelString, getProvider, GeminiProvider } from './llm/index.js';
import type { LLMProvider, ChatMessage, ToolDefinition as LLMToolDef } from './llm/index.js';
import { runReflection } from './reflection.js';
import { getActivePlan, renderPlanAsMarkdown } from './planner.js';
import { detectInjection } from './guards.js';

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

  const tools = getToolsForAgent(pid, kernel.plugins || undefined, kernel.mcp || undefined);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // Smart model routing: if no explicit model in config, ask the ModelRouter
  let effectiveConfig = config;
  if (!config.model && kernel.modelRouter) {
    const toolNames = tools.map((t) => t.name);
    const recommended = kernel.modelRouter.route({
      goal: config.goal,
      tools: toolNames,
      stepCount: 0,
      maxSteps: config.maxSteps || DEFAULT_AGENT_MAX_STEPS,
    });
    // Map model family to a concrete provider:model hint
    const familyModelMap: Record<string, string> = {
      flash: 'gemini:gemini-2.5-flash',
      standard: 'gemini:gemini-2.5-pro',
      frontier: 'anthropic:claude-sonnet-4-5-20250929',
    };
    const modelHint = familyModelMap[recommended];
    if (modelHint) {
      effectiveConfig = { ...config, model: modelHint };
    }
  }

  // Resolve LLM provider from config.model string or environment
  const provider = resolveProvider(effectiveConfig, options.apiKey);

  const startedAt = Date.now();

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
    content: buildSystemPrompt(
      config,
      tools,
      contextMemories,
      planMarkdown,
      agentProfile,
      proc.info.uid,
    ),
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

  // Tool alias map — normalize common LLM naming mistakes
  const TOOL_ALIASES: Record<string, string> = {
    finish: 'complete',
    done: 'complete',
    end: 'complete',
    exit: 'complete',
    search: 'browse_web',
    bash: 'run_command',
    shell: 'run_command',
    exec: 'run_command',
  };

  // Unified main loop with continuation support.
  // After step limit, waits for a continue signal and re-enters the same loop
  // (no degraded copy — all guards, injection checks, and journaling always apply).
  let loopActive = true;
  while (loopActive) {
    while (state.step < state.maxSteps) {
      // Check abort signal
      if (options.signal?.aborted) {
        kernel.bus.emit('agent.thought', { pid, thought: 'Received abort signal.' });
        kernel.bus.emit('agent.completed', {
          pid,
          outcome: 'aborted',
          steps: state.step,
          durationMs: Date.now() - startedAt,
          role: config.role,
          goal: config.goal,
          summary: 'Agent was aborted.',
        });
        kernel.processes.setState(pid, 'zombie', 'failed');
        return;
      }

      // Check if process is still running
      const currentProc = kernel.processes.get(pid);
      if (
        !currentProc ||
        currentProc.info.state === 'zombie' ||
        currentProc.info.state === 'dead'
      ) {
        return;
      }

      // If stopped or paused, wait
      if (currentProc.info.state === 'stopped' || currentProc.info.state === 'paused') {
        await sleep(1000);
        continue;
      }

      // Drain pending user messages and inject into context
      if (kernel.processes.drainUserMessages) {
        const userMsgs = kernel.processes.drainUserMessages(pid);
        for (const msg of userMsgs) {
          state.history.push({
            role: 'tool',
            content: `[User Message] ${msg}`,
            timestamp: Date.now(),
          });
          kernel.bus.emit('agent.thought', {
            pid,
            thought: `Received user message: "${msg.substring(0, 100)}"`,
          });
        }
      }

      // Drain pending IPC messages from other agents
      if (kernel.processes.drainMessages) {
        const ipcMsgs = kernel.processes.drainMessages(pid);
        for (const msg of ipcMsgs) {
          const sender = `PID ${msg.fromPid} (${msg.fromUid})`;
          const content =
            typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
          state.history.push({
            role: 'tool',
            content: `[Agent Message from ${sender} on "${msg.channel}"] ${content}`,
            timestamp: Date.now(),
          });
          kernel.bus.emit('agent.thought', {
            pid,
            thought: `Received message from ${sender}: "${content.substring(0, 100)}"`,
          });
        }
      }

      try {
        // Context compaction: summarize old history when it grows too large
        if (shouldCompact(state)) {
          await compactHistory(state, provider, kernel, pid);
        }

        // Phase 1: Think - ask LLM for next action
        kernel.processes.setState(pid, 'running', 'thinking');

        // Build dynamic tool schemas that include MCP tool schemas
        const dynamicSchemas = getToolSchemasForAgent(kernel.mcp || undefined);
        const decision = await getNextAction(
          state,
          config,
          tools,
          provider,
          options.apiKey,
          dynamicSchemas,
        );

        // Log the reasoning
        kernel.bus.emit('agent.thought', { pid, thought: decision.reasoning });
        state.history.push({
          role: 'agent',
          content: `[Think] ${decision.reasoning}\n[Action] ${decision.tool}(${JSON.stringify(decision.args)})`,
          timestamp: Date.now(),
        });

        // Normalize tool name aliases
        if (TOOL_ALIASES[decision.tool]) {
          decision.tool = TOOL_ALIASES[decision.tool];
        }

        // Phase 2: Act - execute the chosen tool
        const tool = toolMap.get(decision.tool);
        if (!tool) {
          const availableTools = tools.map((t) => t.name).join(', ');
          const errMsg = `Unknown tool: ${decision.tool}. Available tools: ${availableTools}`;
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

        // Prompt injection guard: scan tool args before execution
        const argsStr = JSON.stringify(decision.args);
        const injectionCheck = detectInjection(argsStr);
        if (!injectionCheck.safe) {
          const blockMsg = `Injection blocked: ${injectionCheck.reason}`;
          console.warn(`[AgentLoop] ${blockMsg} (PID ${pid}, tool ${decision.tool})`);
          kernel.bus.emit('agent.injectionBlocked', {
            pid,
            tool: decision.tool,
            reason: injectionCheck.reason,
          });
          state.history.push({ role: 'tool', content: blockMsg, timestamp: Date.now() });
          state.lastObservation = blockMsg;
          state.step++;
          continue;
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
        const output = result.output || '';
        kernel.processes.setState(pid, 'running', 'observing');
        kernel.bus.emit('agent.observation', {
          pid,
          result: output.substring(0, 500),
        });

        state.history.push({
          role: 'tool',
          content: `[${decision.tool}] ${result.success ? 'OK' : 'FAIL'}: ${output.substring(0, 4000)}`,
          timestamp: Date.now(),
        });
        state.lastObservation = output;

        if (result.artifacts) {
          state.artifacts.push(...result.artifacts);
        }

        // Auto-journal significant observations as episodic memory (v0.3)
        if (kernel.memory && result.success && decision.tool !== 'think') {
          try {
            kernel.memory.store({
              agent_uid: proc.info.uid,
              layer: 'episodic',
              content: `[Step ${state.step + 1}] Used ${decision.tool}: ${output.substring(0, 300)}`,
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
          const durationMs = Date.now() - startedAt;
          kernel.bus.emit('agent.progress', {
            pid,
            step: state.step + 1,
            maxSteps: state.maxSteps,
            summary: 'Task completed successfully.',
          });
          kernel.bus.emit('agent.completed', {
            pid,
            outcome: 'success',
            steps: state.step + 1,
            durationMs,
            role: config.role,
            goal: config.goal,
            summary: output.substring(0, 300) || 'Task completed.',
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

    // Step limit reached — offer to continue
    kernel.bus.emit('agent.thought', {
      pid,
      thought: `Reached step limit (${state.maxSteps}). Waiting for continue signal...`,
    });
    kernel.bus.emit('agent.stepLimitReached', {
      pid,
      stepsCompleted: state.maxSteps,
      summary: state.lastObservation?.substring(0, 200) || 'Step limit reached.',
    });
    kernel.processes.setState(pid, 'stopped', 'waiting');

    // Wait up to 5 minutes for a continue signal
    const continued = await waitForContinue(kernel, pid, options.signal, 300_000);
    if (continued > 0) {
      state.maxSteps += continued;
      kernel.bus.emit('agent.thought', {
        pid,
        thought: `Continuing for ${continued} more steps.`,
      });
      kernel.processes.setState(pid, 'running', 'thinking');
      // Re-enter the unified main loop (all guards apply)
    } else {
      loopActive = false;
    }
  }

  const durationMs = Date.now() - startedAt;
  const timedOut = state.step >= state.maxSteps;
  kernel.bus.emit('agent.thought', { pid, thought: `Agent finished after ${state.step} steps.` });
  kernel.bus.emit('agent.completed', {
    pid,
    outcome: timedOut ? 'timeout' : 'success',
    steps: state.step,
    durationMs,
    role: config.role,
    goal: config.goal,
    summary: state.lastObservation?.substring(0, 300) || 'Agent finished.',
  });
  kernel.processes.setState(pid, 'zombie', 'completed');
  kernel.processes.exit(pid, 0);
}

/**
 * Wait for an agent.continued event or timeout.
 * Returns the number of extra steps granted, or 0 if timed out.
 */
function waitForContinue(
  kernel: Kernel,
  pid: PID,
  signal?: AbortSignal,
  timeoutMs = 300_000,
): Promise<number> {
  return new Promise((resolve) => {
    let resolved = false;
    const unsub = kernel.bus.on('agent.continued', (data: { pid: PID; extraSteps: number }) => {
      if (data.pid === pid && !resolved) {
        resolved = true;
        unsub();
        resolve(data.extraSteps);
      }
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        resolve(0);
      }
    }, timeoutMs);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          if (!resolved) {
            resolved = true;
            unsub();
            clearTimeout(timer);
            resolve(0);
          }
        },
        { once: true },
      );
    }
  });
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
  toolSchemas?: Record<
    string,
    { type: string; properties: Record<string, any>; required?: string[] }
  >,
): Promise<LLMDecision> {
  // If no provider is available (and no API key), use heuristic fallback
  if (!provider || (!provider.isAvailable() && !apiKey)) {
    return getHeuristicAction(state, config);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_LLM_RETRIES; attempt++) {
    try {
      // Convert state history to ChatMessage format for the provider
      const messages: ChatMessage[] = state.history.slice(-20).map((msg) => ({
        role: msg.role === 'agent' ? 'assistant' : msg.role === 'tool' ? 'user' : msg.role,
        content: msg.content,
      }));

      // Add the step instruction
      messages.push({
        role: 'user',
        content: `Step ${state.step + 1}/${state.maxSteps}. What tool should you use next?`,
      });

      // Convert tool definitions to LLM format with proper parameter schemas
      const schemas = toolSchemas || TOOL_SCHEMAS;
      const llmTools: LLMToolDef[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: schemas[t.name] || {
          type: 'object',
          properties: {},
        },
      }));

      const response = await provider.chat(messages, llmTools);

      // Extract tool call from response
      if (response.toolCalls && response.toolCalls.length > 0) {
        const tc = response.toolCalls[0];
        // Retry once if args are empty and tool requires args
        const noArgTools = [
          'think',
          'complete',
          'finish',
          'done',
          'list_agents',
          'check_messages',
          'list_workspaces',
        ];
        if (
          tc.arguments &&
          Object.keys(tc.arguments).length === 0 &&
          !noArgTools.includes(tc.name)
        ) {
          console.warn(`[AgentLoop] Empty args for ${tc.name}, retrying with nudge`);
          messages.push({
            role: 'user',
            content: `Your args were empty. Please provide the required arguments for ${tc.name}.`,
          });
          const retryResponse = await provider.chat(messages, llmTools);
          if (retryResponse.toolCalls && retryResponse.toolCalls.length > 0) {
            const rtc = retryResponse.toolCalls[0];
            return {
              reasoning: retryResponse.content || response.content || 'No reasoning provided',
              tool: rtc.name,
              args: rtc.arguments,
            };
          }
        }
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
  uid?: string,
): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

  const sections = [
    `You are an AI agent running inside Aether OS, a purpose-built operating system for AI agents.`,
    ``,
    `## About Aether OS`,
    `Aether OS is an AI agent operating system with a kernel, process manager, virtual filesystem,`,
    `container sandboxing, memory system, and a React desktop UI. You run inside a Docker container`,
    `managed by the kernel. Your execution follows a think-act-observe loop (AgentLoop.ts) that`,
    `calls an LLM for decisions, executes tools, and observes results until the task is complete.`,
    `The system supports multiple agents collaborating via IPC, persistent memory across sessions,`,
    `VNC graphical desktops, and integrations with Slack, GitHub, Discord, and S3.`,
    `For detailed architecture, read /home/agent/shared/CODEBASE.md if available.`,
    ``,
    `## Your Identity`,
    `- Role: ${config.role}`,
    `- Goal: ${config.goal}`,
    ``,
    `## Your Environment`,
    `- You are running inside a Linux container with bash`,
    `- Use Linux / Unix commands (ls, cat, cp, rm, mkdir, etc.)`,
    `- Package managers: apt-get, pip, npm (Python 3, Node.js 22 pre-installed)`,
    `- You have a real filesystem with your home directory at /home/${uid || 'aether'}/`,
    `- **Shared workspace**: Save ALL deliverables to /home/agent/shared/ — this is visible to the user and persists across sessions`,
    `- Your home directory (/home/${uid || 'aether'}/) is private to you; the shared directory is the handoff point`,
    `- You can create files, run commands, and browse the web`,
    `- **Web search**: Use DuckDuckGo Lite for searching: browse_web({"url": "https://lite.duckduckgo.com/lite/?q=your+search+terms"})`,
    `- **NEVER use Google** — it will CAPTCHA/block you. Always use DuckDuckGo Lite (lite.duckduckgo.com/lite/).`,
    `- When browse_web results are truncated, follow specific links to get full content from individual pages`,
    `- Use click_element({"text": "link text"}) to click elements by visible text, or {css: "#id"} / {xpath: "//el"} for selectors`,
    `- If you have a graphical desktop (XFCE4), you can use Firefox, a file manager, and a terminal`,
    `- Your actions are observable by the human operator`,
    `- The operator can pause you, interact with your desktop, and resume you at any time`,
    `- You have persistent memory across sessions (use remember/recall tools)`,
    ``,
    `## Available Tools`,
    toolList,
    ``,
    `## Rules`,
    `1. Think step by step before acting`,
    `2. Use the simplest tool that accomplishes the task`,
    `3. Save all work output to /home/agent/shared/ so the user can access it`,
    `4. Use /home/${uid || 'aether'}/ for temporary/scratch files only`,
    `5. Call 'complete' when you've achieved your goal`,
    `6. Be efficient - don't repeat actions unnecessarily`,
    `7. Use 'remember' to save important discoveries for future sessions`,
    `8. Use 'recall' to retrieve relevant knowledge from past sessions`,
    `9. Use 'list_agents' to discover other running agents, 'send_message' to collaborate`,
    `10. Use 'delegate_task' to hand off sub-tasks to other agents when available`,
    ``,
    `## Tool Call Format`,
    `When using tools, always provide the required arguments. Never call a tool with empty arguments {}.`,
    `Examples:`,
    `- list_files: { "path": "/home/agent/shared" }`,
    `- write_file: { "path": "/home/agent/shared/output.txt", "content": "Hello world" }`,
    `- run_command: { "command": "python main.py" }`,
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
// Context Compaction
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a string using the chars/4 heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens across all history entries.
 */
export function estimateHistoryTokens(history: AgentMessage[]): number {
  let total = 0;
  for (const entry of history) {
    total += estimateTokens(entry.content);
  }
  return total;
}

/**
 * Determine whether compaction should trigger based on step interval or token threshold.
 */
export function shouldCompact(state: AgentState): boolean {
  // Must have enough entries to compact (system prompt + keep_recent + at least 1 old)
  if (state.history.length <= CONTEXT_COMPACTION_KEEP_RECENT + 1) return false;

  // Trigger on step interval
  if (state.step > 0 && state.step % CONTEXT_COMPACTION_STEP_INTERVAL === 0) return true;

  // Trigger on token threshold
  if (estimateHistoryTokens(state.history) > CONTEXT_COMPACTION_TOKEN_THRESHOLD) return true;

  return false;
}

/**
 * Try to resolve a cheap/fast model for summarization to save costs.
 * Falls back to null if no cheap model is available.
 */
function getCheapProvider(): LLMProvider | null {
  const cheapModels = ['gemini:gemini-2.5-flash', 'openai:gpt-4o-mini'];
  for (const modelStr of cheapModels) {
    try {
      const provider = getProviderFromModelString(modelStr);
      if (provider && provider.isAvailable()) return provider;
    } catch {
      // Skip unavailable providers
    }
  }
  return null;
}

async function compactHistory(
  state: AgentState,
  provider: LLMProvider | null,
  kernel: Kernel,
  pid: PID,
): Promise<void> {
  if (state.history.length <= CONTEXT_COMPACTION_KEEP_RECENT + 1) return;

  const entriesBefore = state.history.length;

  // Keep system prompt (index 0) and last N entries
  const systemPrompt = state.history[0];
  const oldEntries = state.history.slice(1, state.history.length - CONTEXT_COMPACTION_KEEP_RECENT);
  const recentEntries = state.history.slice(state.history.length - CONTEXT_COMPACTION_KEEP_RECENT);

  if (oldEntries.length === 0) return;

  // Try to use a cheap model first, fall back to the agent's primary provider
  const summarizer = getCheapProvider() || provider;

  if (summarizer && summarizer.isAvailable()) {
    try {
      const summaryText = oldEntries
        .map((e) => `[${e.role}] ${e.content.substring(0, 300)}`)
        .join('\n');

      const summaryMessages = [
        {
          role: 'system' as const,
          content:
            'Summarize the following agent work log into a concise paragraph. Focus on what was accomplished, key decisions made, and any important findings. Be brief.',
        },
        {
          role: 'user' as const,
          content: summaryText,
        },
      ];

      const response = await summarizer.chat(summaryMessages, []);
      const summary = response.content || 'Previous work completed (summary unavailable).';

      state.history = [
        systemPrompt,
        {
          role: 'tool',
          content: `[Previous work summary, steps 1-${oldEntries.length}] ${summary}`,
          timestamp: Date.now(),
        },
        ...recentEntries,
      ];

      console.log(
        `[AgentLoop] Compacted history for PID ${pid}: ${oldEntries.length} entries → 1 summary`,
      );

      kernel.bus.emit('agent.contextCompacted', {
        pid,
        entriesCompacted: oldEntries.length,
        newHistorySize: state.history.length,
        method: 'llm' as const,
      });
      return;
    } catch (err) {
      console.warn(`[AgentLoop] History summarization failed for PID ${pid}, using fallback:`, err);
    }
  }

  // Fallback: if summarization fails, keep system prompt + last KEEP_RECENT entries
  state.history = [
    systemPrompt,
    ...state.history.slice(state.history.length - CONTEXT_COMPACTION_KEEP_RECENT),
  ];
  console.log(
    `[AgentLoop] Compacted history for PID ${pid} (fallback): kept last ${CONTEXT_COMPACTION_KEEP_RECENT} entries`,
  );

  kernel.bus.emit('agent.contextCompacted', {
    pid,
    entriesCompacted: entriesBefore - state.history.length,
    newHistorySize: state.history.length,
    method: 'fallback' as const,
  });
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
