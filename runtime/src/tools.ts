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

import { Kernel } from '@aether/kernel';
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
      description: 'Execute a shell command in the agent terminal',
      requiresApproval: false, // Can be set to true for destructive commands
      execute: async (args, ctx) => {
        try {
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
