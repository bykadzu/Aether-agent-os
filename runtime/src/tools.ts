/**
 * Aether Runtime - Agent Tools
 *
 * Tools are the system calls available to AI agents. Each tool is a
 * well-defined capability with typed inputs and outputs.
 *
 * Design principles:
 * - Each tool maps to a real OS operation
 * - Tools are auditable (every invocation is logged)
 * - Tools can require human approval before execution
 * - Tools operate within the agent's sandbox
 */

import { Kernel, PluginManager } from '@aether/kernel';
import { PID, PlanNode } from '@aether/shared';
import {
  createPlan,
  getActivePlan,
  updatePlan,
  updateNodeStatus,
  renderPlanAsMarkdown,
  getPlanProgress,
} from './planner.js';

export interface ToolResult {
  success: boolean;
  output: string;
  artifacts?: Array<{ type: string; path?: string; content?: string }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  requiresApproval?: boolean;
  execute: (args: Record<string, any>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  kernel: Kernel;
  pid: PID;
  uid: string;
  cwd: string;
}

/**
 * Ensure a browser session exists for the given agent, creating one if needed.
 * Returns the session ID. Throws if BrowserManager is not available.
 */
async function ensureBrowserSession(ctx: ToolContext): Promise<string> {
  const sessionId = `browser_${ctx.pid}`;
  if (!ctx.kernel.browser.isAvailable()) {
    throw new Error('Browser not available. Playwright is not installed.');
  }
  try {
    await ctx.kernel.browser.createSession(sessionId, { width: 1280, height: 720 });
  } catch {
    // Session already exists
  }
  return sessionId;
}

/**
 * Create the standard tool set available to agents.
 */
export function createToolSet(): ToolDefinition[] {
  return [
    // ----- File Operations -----
    {
      name: 'read_file',
      description: 'Read the contents of a file',
      execute: async (args, ctx) => {
        try {
          const filePath = resolveCwd(ctx.cwd, args.path);
          const result = await ctx.kernel.fs.readFile(filePath);
          return { success: true, output: result.content };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'write_file',
      description: 'Write content to a file (creates or overwrites)',
      execute: async (args, ctx) => {
        try {
          const filePath = resolveCwd(ctx.cwd, args.path);
          await ctx.kernel.fs.writeFile(filePath, args.content);
          ctx.kernel.bus.emit('agent.file_created', {
            pid: ctx.pid,
            path: filePath,
            content: args.content,
          });
          return {
            success: true,
            output: `Wrote ${args.content.length} bytes to ${filePath}`,
            artifacts: [{ type: 'file', path: filePath, content: args.content }],
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'list_files',
      description: 'List files and directories in a path',
      execute: async (args, ctx) => {
        try {
          const dirPath = resolveCwd(ctx.cwd, args.path || '.');
          const entries = await ctx.kernel.fs.ls(dirPath);
          const listing = entries
            .map(
              (e) =>
                `${e.type === 'directory' ? 'd' : '-'} ${e.name}${e.type === 'directory' ? '/' : ''} (${formatSize(e.size)})`,
            )
            .join('\n');
          return { success: true, output: listing || '(empty directory)' };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'mkdir',
      description: 'Create a directory',
      execute: async (args, ctx) => {
        try {
          const dirPath = resolveCwd(ctx.cwd, args.path);
          await ctx.kernel.fs.mkdir(dirPath, true);
          return { success: true, output: `Created directory: ${dirPath}` };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'rm',
      description: 'Remove a file or directory',
      execute: async (args, ctx) => {
        try {
          const targetPath = resolveCwd(ctx.cwd, args.path);
          await ctx.kernel.fs.rm(targetPath);
          return { success: true, output: `Removed: ${targetPath}` };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'stat',
      description: 'Get file or directory metadata (size, type, timestamps)',
      execute: async (args, ctx) => {
        try {
          const targetPath = resolveCwd(ctx.cwd, args.path);
          const info = await ctx.kernel.fs.stat(targetPath);
          const lines = [
            `Path: ${info.path}`,
            `Name: ${info.name}`,
            `Type: ${info.type}`,
            `Size: ${formatSize(info.size)}`,
            `Created: ${new Date(info.createdAt).toISOString()}`,
            `Modified: ${new Date(info.modifiedAt).toISOString()}`,
          ];
          return { success: true, output: lines.join('\n') };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'mv',
      description: 'Move or rename a file or directory',
      execute: async (args, ctx) => {
        try {
          const srcPath = resolveCwd(ctx.cwd, args.source);
          const destPath = resolveCwd(ctx.cwd, args.destination);
          await ctx.kernel.fs.mv(srcPath, destPath);
          return { success: true, output: `Moved ${srcPath} -> ${destPath}` };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'cp',
      description: 'Copy a file or directory',
      execute: async (args, ctx) => {
        try {
          const srcPath = resolveCwd(ctx.cwd, args.source);
          const destPath = resolveCwd(ctx.cwd, args.destination);
          await ctx.kernel.fs.cp(srcPath, destPath);
          return { success: true, output: `Copied ${srcPath} -> ${destPath}` };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Shell Execution -----
    {
      name: 'run_command',
      description:
        'Execute a shell command in the agent terminal (runs inside container if sandboxed)',
      requiresApproval: false,
      execute: async (args, ctx) => {
        try {
          // Try container execution first via ContainerManager
          if (ctx.kernel.containers?.isDockerAvailable()) {
            const containerInfo = ctx.kernel.containers.get(ctx.pid);
            if (containerInfo) {
              const output = await ctx.kernel.containers.exec(ctx.pid, args.command);
              return { success: true, output };
            }
          }

          // Fallback to PTY execution
          const ttys = ctx.kernel.pty.getByPid(ctx.pid);
          if (ttys.length === 0) {
            return { success: false, output: 'No terminal session available' };
          }
          const tty = ttys[0];
          const output = await ctx.kernel.pty.exec(tty.id, args.command);
          return { success: true, output };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Web Browsing -----
    {
      name: 'browse_web',
      description: 'Browse a web page using a real browser (Playwright) or HTTP fetch fallback',
      execute: async (args, ctx) => {
        try {
          ctx.kernel.bus.emit('agent.browsing', {
            pid: ctx.pid,
            url: args.url,
          });

          // Try real browser first
          if (ctx.kernel.browser?.isAvailable()) {
            const sessionId = `browser_${ctx.pid}`;
            try {
              await ctx.kernel.browser.createSession(sessionId, { width: 1280, height: 720 });
            } catch {
              // Session might already exist, that's ok
            }

            const pageInfo = await ctx.kernel.browser.navigateTo(sessionId, args.url);
            const snapshot = await ctx.kernel.browser.getDOMSnapshot(sessionId);

            // Extract text from DOM elements
            const textContent = snapshot.elements
              .map((el: any) => el.text)
              .filter(Boolean)
              .join('\n')
              .substring(0, 4000);

            ctx.kernel.bus.emit('agent.browsing', {
              pid: ctx.pid,
              url: pageInfo.url,
              summary: textContent.substring(0, 200),
            });

            return {
              success: true,
              output: `Page: ${pageInfo.title}\nURL: ${pageInfo.url}\n\n${textContent}`,
            };
          }

          // Fallback to HTTP fetch
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          const response = await fetch(args.url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'AetherOS-Agent/0.1' },
          });
          clearTimeout(timeout);

          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text')) {
            return {
              success: true,
              output: `Fetched ${args.url} - Content-Type: ${contentType} (binary content, ${response.headers.get('content-length') || 'unknown'} bytes)`,
            };
          }

          const text = await response.text();
          // Strip HTML tags for a rough text extraction
          const plainText = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 4000);

          ctx.kernel.bus.emit('agent.browsing', {
            pid: ctx.pid,
            url: args.url,
            summary: plainText.substring(0, 200),
          });

          return { success: true, output: plainText };
        } catch (err: any) {
          return { success: false, output: `Failed to browse ${args.url}: ${err.message}` };
        }
      },
    },

    {
      name: 'screenshot_page',
      description: 'Take a screenshot of the current browser page (returns base64 PNG image)',
      execute: async (args, ctx) => {
        try {
          const sessionId = await ensureBrowserSession(ctx);

          if (args.url) {
            await ctx.kernel.browser.navigateTo(sessionId, args.url);
          }

          const base64 = await ctx.kernel.browser.getScreenshot(sessionId);
          return {
            success: true,
            output: base64,
            artifacts: [{ type: 'image/png', content: base64 }],
          };
        } catch (err: any) {
          return { success: false, output: `Screenshot failed: ${err.message}` };
        }
      },
    },

    {
      name: 'click_element',
      description: 'Click at coordinates on the current browser page',
      execute: async (args, ctx) => {
        try {
          const sessionId = await ensureBrowserSession(ctx);
          await ctx.kernel.browser.click(sessionId, args.x, args.y, args.button || 'left');
          const pageInfo = await ctx.kernel.browser.navigateTo(sessionId, '');
          return {
            success: true,
            output: `Clicked at (${args.x}, ${args.y}) with ${args.button || 'left'} button. Page: ${pageInfo.title} (${pageInfo.url})`,
          };
        } catch (err: any) {
          return { success: false, output: `Click failed: ${err.message}` };
        }
      },
    },

    {
      name: 'type_text',
      description: 'Type text into the focused element on the current browser page',
      execute: async (args, ctx) => {
        try {
          const sessionId = await ensureBrowserSession(ctx);

          if (args.key) {
            await ctx.kernel.browser.keyPress(sessionId, args.key);
            return { success: true, output: `Pressed key: ${args.key}` };
          }

          await ctx.kernel.browser.type(sessionId, args.text);
          return { success: true, output: `Typed: ${args.text}` };
        } catch (err: any) {
          return { success: false, output: `Type failed: ${err.message}` };
        }
      },
    },

    // ----- Agent-to-Agent IPC -----
    {
      name: 'list_agents',
      description: 'List all currently running agents (for IPC discovery)',
      execute: async (_args, ctx) => {
        try {
          const agents = ctx.kernel.processes.listRunningAgents();
          if (agents.length === 0) {
            return { success: true, output: 'No other agents are currently running.' };
          }
          const listing = agents
            .filter((a) => a.pid !== ctx.pid) // Exclude self
            .map(
              (a) =>
                `PID ${a.pid}: ${a.name} (${a.role}) - ${a.state}/${a.agentPhase || 'unknown'}`,
            )
            .join('\n');
          return {
            success: true,
            output: listing || 'No other agents are currently running.',
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'send_message',
      description:
        'Send a message to another running agent by PID. The message will be delivered to the target agent as an observation.',
      execute: async (args, ctx) => {
        try {
          const toPid = Number(args.pid);
          if (isNaN(toPid)) {
            return { success: false, output: 'Invalid PID: must be a number' };
          }
          if (toPid === ctx.pid) {
            return { success: false, output: 'Cannot send a message to yourself' };
          }

          const channel = args.channel || 'default';
          const payload = args.message || args.payload;
          if (!payload) {
            return {
              success: false,
              output: 'Message content is required (use "message" or "payload" arg)',
            };
          }

          const message = ctx.kernel.processes.sendMessage(ctx.pid, toPid, channel, payload);
          if (!message) {
            return {
              success: false,
              output: `Failed to send message: target PID ${toPid} not found or not alive`,
            };
          }

          return {
            success: true,
            output: `Message sent to PID ${toPid} on channel "${channel}" (id: ${message.id})`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'check_messages',
      description: 'Check for incoming IPC messages from other agents',
      execute: async (_args, ctx) => {
        try {
          const messages = ctx.kernel.processes.drainMessages(ctx.pid);
          if (messages.length === 0) {
            return { success: true, output: 'No new messages.' };
          }

          const formatted = messages
            .map(
              (m) =>
                `[${new Date(m.timestamp).toISOString()}] From PID ${m.fromPid} (${m.fromUid}) on "${m.channel}":\n${typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)}`,
            )
            .join('\n---\n');

          return {
            success: true,
            output: `${messages.length} message(s) received:\n${formatted}`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Shared Workspaces -----
    {
      name: 'create_shared_workspace',
      description:
        'Create a shared workspace directory that other agents can mount to collaborate on files',
      execute: async (args, ctx) => {
        try {
          const name = args.name;
          if (!name) {
            return { success: false, output: 'Workspace name is required' };
          }
          const mount = await ctx.kernel.fs.createSharedMount(name, ctx.pid);
          return {
            success: true,
            output: `Created shared workspace "${name}" at ${mount.path}. Other agents can mount it using mount_workspace.`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'mount_workspace',
      description: 'Mount an existing shared workspace into your home directory at ~/shared/{name}',
      execute: async (args, ctx) => {
        try {
          const name = args.name;
          if (!name) {
            return { success: false, output: 'Workspace name is required' };
          }
          await ctx.kernel.fs.mountShared(ctx.pid, name, args.mount_point);
          const mountPoint = args.mount_point || `shared/${name}`;
          return {
            success: true,
            output: `Mounted shared workspace "${name}" at ~/${mountPoint}. You can now read and write files there.`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'list_workspaces',
      description: 'List all available shared workspaces and which agents have them mounted',
      execute: async (_args, ctx) => {
        try {
          const mounts = await ctx.kernel.fs.listSharedMounts();
          if (mounts.length === 0) {
            return { success: true, output: 'No shared workspaces exist yet.' };
          }
          const listing = mounts
            .map(
              (m) =>
                `${m.name} (${m.path}) - owner: PID ${m.ownerPid}, mounted by: ${m.mountedBy.length > 0 ? m.mountedBy.map((p) => `PID ${p}`).join(', ') : 'none'}`,
            )
            .join('\n');
          return { success: true, output: `Shared workspaces:\n${listing}` };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Memory Tools (v0.3 Wave 1) -----
    {
      name: 'remember',
      description:
        'Store a memory for future sessions. Args: content (string), layer (episodic|semantic|procedural|social), tags (string[], optional), importance (0-1, optional)',
      execute: async (args, ctx) => {
        try {
          if (!ctx.kernel.memory) {
            return { success: false, output: 'Memory subsystem not available' };
          }
          const layer = args.layer || 'episodic';
          if (!['episodic', 'semantic', 'procedural', 'social'].includes(layer)) {
            return {
              success: false,
              output: `Invalid layer: ${layer}. Must be episodic, semantic, procedural, or social.`,
            };
          }
          const memory = ctx.kernel.memory.store({
            agent_uid: ctx.uid,
            layer,
            content: args.content,
            tags: args.tags || [],
            importance: args.importance ?? 0.5,
            source_pid: ctx.pid,
          });
          return {
            success: true,
            output: `Stored ${layer} memory (id: ${memory.id}): "${args.content.substring(0, 100)}${args.content.length > 100 ? '...' : ''}"`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'recall',
      description:
        'Recall memories from previous sessions. Args: query (string, optional), layer (string, optional), tags (string[], optional), limit (number, optional, default 10)',
      execute: async (args, ctx) => {
        try {
          if (!ctx.kernel.memory) {
            return { success: false, output: 'Memory subsystem not available' };
          }
          const memories = ctx.kernel.memory.recall({
            agent_uid: ctx.uid,
            query: args.query,
            layer: args.layer,
            tags: args.tags,
            limit: args.limit || 10,
          });
          if (memories.length === 0) {
            return { success: true, output: 'No memories found matching the query.' };
          }
          const formatted = memories
            .map(
              (m, i) =>
                `${i + 1}. [${m.layer}] ${m.content.substring(0, 200)} (importance: ${m.importance.toFixed(2)}, tags: ${m.tags.join(', ') || 'none'})`,
            )
            .join('\n');
          return {
            success: true,
            output: `Found ${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}:\n${formatted}`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'forget',
      description: 'Delete a specific memory by ID. Args: memoryId (string)',
      execute: async (args, ctx) => {
        try {
          if (!ctx.kernel.memory) {
            return { success: false, output: 'Memory subsystem not available' };
          }
          if (!args.memoryId) {
            return { success: false, output: 'memoryId is required' };
          }
          const deleted = ctx.kernel.memory.forget(args.memoryId, ctx.uid);
          return deleted
            ? { success: true, output: `Memory ${args.memoryId} has been forgotten.` }
            : { success: false, output: `Memory ${args.memoryId} not found or not owned by you.` };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Goal Decomposition & Planning (v0.3 Wave 2) -----
    {
      name: 'create_plan',
      description:
        'Create a hierarchical plan to decompose a complex goal. Args: goal (string), nodes (array of {title, description?, estimated_steps, children?}). Re-calling replaces the current plan.',
      execute: async (args, ctx) => {
        try {
          if (!args.goal) {
            return { success: false, output: 'goal is required' };
          }
          if (!args.nodes || !Array.isArray(args.nodes) || args.nodes.length === 0) {
            return { success: false, output: 'nodes array is required (at least one root node)' };
          }

          const rootNodes: PlanNode[] = args.nodes.map((n: any) => ({
            id: '',
            title: n.title || 'Untitled',
            description: n.description,
            status: 'pending' as const,
            estimated_steps: n.estimated_steps || 1,
            actual_steps: 0,
            children: (n.children || []).map((c: any) => ({
              id: '',
              title: c.title || 'Untitled',
              description: c.description,
              status: 'pending' as const,
              estimated_steps: c.estimated_steps || 1,
              actual_steps: 0,
              children: [],
            })),
          }));

          const plan = createPlan(ctx.kernel, ctx.pid, ctx.uid, args.goal, rootNodes);
          const progress = getPlanProgress(plan);
          return {
            success: true,
            output: `Plan created (id: ${plan.id}) with ${progress.total} nodes:\n${renderPlanAsMarkdown(plan)}`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'update_plan',
      description:
        'Update a plan node status. Args: node_id (string), status (pending|active|completed|failed|skipped), actual_steps (number, optional)',
      execute: async (args, ctx) => {
        try {
          if (!args.node_id) {
            return { success: false, output: 'node_id is required' };
          }
          if (
            !args.status ||
            !['pending', 'active', 'completed', 'failed', 'skipped'].includes(args.status)
          ) {
            return {
              success: false,
              output: 'status must be one of: pending, active, completed, failed, skipped',
            };
          }

          const plan = getActivePlan(ctx.kernel, ctx.pid);
          if (!plan) {
            return {
              success: false,
              output: 'No active plan found for this process. Create one first with create_plan.',
            };
          }

          const updated = updateNodeStatus(
            ctx.kernel,
            plan.id,
            args.node_id,
            args.status,
            args.actual_steps,
          );

          if (!updated) {
            return {
              success: false,
              output: `Node ${args.node_id} not found in the current plan.`,
            };
          }

          const progress = getPlanProgress(updated);
          return {
            success: true,
            output: `Plan updated. Progress: ${progress.completed}/${progress.total} nodes completed.\n${renderPlanAsMarkdown(updated)}`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Feedback Query (v0.3 Wave 2) -----
    {
      name: 'get_feedback',
      description:
        'Query historical user feedback for your actions. Args: limit (number, optional, default 20)',
      execute: async (args, ctx) => {
        try {
          const limit = args.limit || 20;
          const feedback = ctx.kernel.state.getFeedbackByAgent(ctx.uid, limit);

          if (feedback.length === 0) {
            return { success: true, output: 'No feedback received yet.' };
          }

          const formatted = feedback
            .map(
              (f: any) =>
                `PID ${f.pid} Step ${f.step}: ${f.rating === 1 ? '👍' : '👎'}${f.comment ? ` — "${f.comment}"` : ''} (${new Date(f.created_at).toISOString()})`,
            )
            .join('\n');

          const positive = feedback.filter((f: any) => f.rating === 1).length;
          const negative = feedback.filter((f: any) => f.rating === -1).length;

          return {
            success: true,
            output: `Feedback summary: ${positive} positive, ${negative} negative (${feedback.length} total):\n${formatted}`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    // ----- Thinking/Planning -----
    {
      name: 'think',
      description: 'Record a thought or plan (no side effects)',
      execute: async (args, ctx) => {
        ctx.kernel.bus.emit('agent.thought', {
          pid: ctx.pid,
          thought: args.thought,
        });
        return { success: true, output: args.thought };
      },
    },

    // ----- Task Completion -----
    {
      name: 'complete',
      description: 'Mark the current task as complete with a summary',
      execute: async (args, ctx) => {
        ctx.kernel.processes.setState(ctx.pid, 'zombie', 'completed');
        ctx.kernel.processes.exit(ctx.pid, 0);
        return { success: true, output: args.summary || 'Task completed.' };
      },
    },
  ];
}

/**
 * Get the full tool set for an agent, merging built-in tools with any
 * loaded plugin tools.
 */
export function getToolsForAgent(pid: PID, pluginManager?: PluginManager): ToolDefinition[] {
  const baseTools = createToolSet();

  if (!pluginManager) return baseTools;

  const plugins = pluginManager.getPlugins(pid);
  const pluginTools: ToolDefinition[] = [];

  for (const plugin of plugins) {
    for (const toolManifest of plugin.manifest.tools) {
      const handler = plugin.handlers.get(toolManifest.name);
      if (!handler) continue;

      pluginTools.push({
        name: toolManifest.name,
        description: toolManifest.description,
        requiresApproval: toolManifest.requiresApproval,
        execute: async (args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> => {
          try {
            const result = await handler(args, {
              pid: ctx.pid,
              cwd: ctx.cwd,
              kernel: ctx.kernel,
            });
            return { success: true, output: result };
          } catch (err: any) {
            return { success: false, output: `Plugin error: ${err.message}` };
          }
        },
      });
    }
  }

  return [...baseTools, ...pluginTools];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCwd(cwd: string, relativePath: string): string {
  if (relativePath.startsWith('/')) return relativePath;
  // Simple path join (posix-style)
  const parts = cwd.split('/').filter(Boolean);
  for (const part of relativePath.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
