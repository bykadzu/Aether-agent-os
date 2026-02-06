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
import { PID } from '@aether/shared';

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
          const listing = entries.map(e =>
            `${e.type === 'directory' ? 'd' : '-'} ${e.name}${e.type === 'directory' ? '/' : ''} (${formatSize(e.size)})`
          ).join('\n');
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

    // ----- Shell Execution -----
    {
      name: 'run_command',
      description: 'Execute a shell command in the agent terminal (runs inside container if sandboxed)',
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
      description: 'Fetch and summarize a web page (text content only)',
      execute: async (args, ctx) => {
        try {
          ctx.kernel.bus.emit('agent.browsing', {
            pid: ctx.pid,
            url: args.url,
          });
          // Real fetch (text only for now)
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
          return { success: false, output: `Failed to fetch ${args.url}: ${err.message}` };
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
            .filter(a => a.pid !== ctx.pid) // Exclude self
            .map(a => `PID ${a.pid}: ${a.name} (${a.role}) - ${a.state}/${a.agentPhase || 'unknown'}`)
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
      description: 'Send a message to another running agent by PID. The message will be delivered to the target agent as an observation.',
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
            return { success: false, output: 'Message content is required (use "message" or "payload" arg)' };
          }

          const message = ctx.kernel.processes.sendMessage(ctx.pid, toPid, channel, payload);
          if (!message) {
            return { success: false, output: `Failed to send message: target PID ${toPid} not found or not alive` };
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

          const formatted = messages.map(m =>
            `[${new Date(m.timestamp).toISOString()}] From PID ${m.fromPid} (${m.fromUid}) on "${m.channel}":\n${typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)}`
          ).join('\n---\n');

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
      description: 'Create a shared workspace directory that other agents can mount to collaborate on files',
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
          const listing = mounts.map(m =>
            `${m.name} (${m.path}) - owner: PID ${m.ownerPid}, mounted by: ${m.mountedBy.length > 0 ? m.mountedBy.map(p => `PID ${p}`).join(', ') : 'none'}`
          ).join('\n');
          return { success: true, output: `Shared workspaces:\n${listing}` };
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
