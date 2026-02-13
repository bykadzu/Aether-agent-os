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

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Kernel, PluginManager, MCPManager } from '@aether/kernel';
import { PID, PlanNode, DEFAULT_COMMAND_TIMEOUT, MAX_COMMAND_TIMEOUT } from '@aether/shared';

const execAsync = promisify(execCb);
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
  } catch (err: any) {
    // Only swallow "already exists" — re-throw real failures (launch errors, etc.)
    if (!err.message?.includes('already exists')) {
      throw err;
    }
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
        if (!args.path) {
          return {
            success: false,
            output: 'Error: "path" argument is required (e.g. read_file({"path":"file.txt"}))',
          };
        }
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
        if (!args.path || !args.content) {
          return {
            success: false,
            output:
              'Error: "path" and "content" arguments are required (e.g. write_file({"path":"file.txt","content":"hello"}))',
          };
        }
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
        if (!args.command || typeof args.command !== 'string') {
          return {
            success: false,
            output: 'Error: "command" argument is required (e.g. run_command({"command":"dir"}))',
          };
        }
        try {
          // Execute inside pre-created container (containers are created at spawn time)
          const containerInfo = ctx.kernel.containers?.get(ctx.pid);
          if (containerInfo) {
            const requestedTimeout = args.timeout
              ? Math.min(Number(args.timeout) * 1000, MAX_COMMAND_TIMEOUT)
              : DEFAULT_COMMAND_TIMEOUT;
            const output = await ctx.kernel.containers.exec(ctx.pid, args.command, {
              timeout: requestedTimeout,
            });
            return { success: true, output };
          }

          // Fallback: no container (Docker unavailable or creation failed at spawn)
          // Security: refuse host execution unless explicitly allowed via env var
          if (!process.env.AETHER_ALLOW_HOST_EXEC) {
            return {
              success: false,
              output:
                'Shell commands require a Docker container for sandboxing, but no container is available for this agent. ' +
                'To allow unsandboxed host execution (development only), set AETHER_ALLOW_HOST_EXEC=1 in your environment.',
            };
          }
          console.warn(
            `[Tools] run_command falling back to HOST execution for PID ${ctx.pid} — no container available`,
          );
          const proc = ctx.kernel.processes.get(ctx.pid);
          // proc.info.cwd is a virtual path — resolve to real path via FS root
          const virtualCwd = proc?.info.cwd || '/tmp';
          const cwd = ctx.kernel.fs.getRealRoot() + virtualCwd;
          const shell = process.platform === 'win32' ? true : '/bin/bash';

          const requestedTimeout = args.timeout
            ? Math.min(Number(args.timeout) * 1000, MAX_COMMAND_TIMEOUT)
            : DEFAULT_COMMAND_TIMEOUT;
          const { stdout, stderr } = await execAsync(args.command, {
            cwd,
            shell,
            timeout: requestedTimeout,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, ...(proc?.info.env || {}) },
          });

          const output = (stdout + (stderr ? `\n${stderr}` : '')).trim();
          return { success: true, output: output || '(no output)' };
        } catch (err: any) {
          // If process was killed due to timeout but produced stdout, treat as partial success
          if (err.killed && err.stdout) {
            return { success: true, output: `(process timed out)\n${err.stdout}`.trim() };
          }
          // If exit code is non-zero but there's stdout, include both
          const stdout = (err.stdout || '').trim();
          const stderr = (err.stderr || '').trim();
          if (stdout) {
            return { success: true, output: stdout + (stderr ? `\n(stderr: ${stderr})` : '') };
          }
          return { success: false, output: `Error: ${stderr || err.message}` };
        }
      },
    },

    // ----- Web Browsing -----
    {
      name: 'browse_web',
      description:
        'Browse a web page using a real browser. Provide {url: "https://..."}. For web search use DuckDuckGo: {url: "https://duckduckgo.com/?q=your+search+terms"}',
      execute: async (args, ctx) => {
        try {
          if (!args.url || typeof args.url !== 'string') {
            return {
              success: false,
              output:
                'Missing url argument. Usage: browse_web({"url": "https://example.com"}). For search: browse_web({"url": "https://duckduckgo.com/?q=your+search"})',
            };
          }

          // Auto-rewrite DuckDuckGo and Google URLs for better agent compatibility
          let url: string = args.url;
          // Rewrite duckduckgo.com to lite.duckduckgo.com (JS-free HTML results)
          url = url.replace(
            /^https?:\/\/(www\.)?duckduckgo\.com\/?\?/,
            'https://lite.duckduckgo.com/lite/?',
          );
          // Rewrite Google search to DuckDuckGo Lite (Google always CAPTCHAs)
          if (/^https?:\/\/(www\.)?google\.\w+\/search\?/.test(url)) {
            const googleQ = new URL(url).searchParams.get('q') || '';
            url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(googleQ)}`;
          }

          ctx.kernel.bus.emit('agent.browsing', {
            pid: ctx.pid,
            url,
          });

          // Try real browser first
          if (ctx.kernel.browser?.isAvailable()) {
            const sessionId = await ensureBrowserSession(ctx);

            const pageInfo = await ctx.kernel.browser.navigateTo(sessionId, url);

            // Extract full page text content (not just interactive elements)
            // and links separately for richer agent context
            const session = ctx.kernel.browser.getSessionPage(sessionId);
            let textContent = '';
            let links = '';
            if (session) {
              // Get visible text, stripping nav/header/footer noise for cleaner content
              textContent = (await session
                .evaluate(
                  `(() => {
                // Remove noisy elements before extracting text
                const remove = ['nav', 'header', 'footer', '[role="navigation"]', '[role="banner"]', '[aria-hidden="true"]', '.skip-link', '#skip-to-content'];
                const cloned = document.body.cloneNode(true);
                remove.forEach(sel => {
                  cloned.querySelectorAll(sel).forEach(el => el.remove());
                });
                // Try main/article content first, fall back to full body
                const main = cloned.querySelector('main, [role="main"], article, .content, #content');
                const text = (main || cloned).innerText || (main || cloned).textContent || '';
                return text;
              })()`,
                )
                .catch(() => '')) as string;
              textContent = (textContent as string).substring(0, 12000);

              // Get top links with text
              const linkData = (await session
                .evaluate(
                  `(() => {
                const main = document.querySelector('main, [role="main"], article, .content, #content') || document.body;
                const anchors = Array.from(main.querySelectorAll('a[href]'));
                return anchors
                  .map(a => ({ text: (a.textContent || '').trim().substring(0, 100), href: a.href }))
                  .filter(l => l.text && l.href && !l.href.startsWith('javascript:'))
                  .slice(0, 40);
              })()`,
                )
                .catch(() => [])) as Array<{ text: string; href: string }>;
              if (Array.isArray(linkData) && linkData.length > 0) {
                links =
                  '\n\nLinks:\n' + linkData.map((l: any) => `- [${l.text}](${l.href})`).join('\n');
              }
            }

            ctx.kernel.bus.emit('agent.browsing', {
              pid: ctx.pid,
              url: pageInfo.url,
              summary: textContent.substring(0, 200),
            });

            return {
              success: true,
              output: `Page: ${pageInfo.title}\nURL: ${pageInfo.url}\n\n${textContent}${links}`,
            };
          }

          // Fallback to HTTP fetch with structured extraction
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; AetherOS-Agent/0.5; +https://aetheros.dev)',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          clearTimeout(timeout);

          const finalUrl = response.url || args.url;
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text') && !contentType.includes('html')) {
            return {
              success: true,
              output: `Fetched ${finalUrl} - Content-Type: ${contentType} (binary content, ${response.headers.get('content-length') || 'unknown'} bytes)`,
            };
          }

          const html = await response.text();

          // Extract structured content from HTML
          const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
          const metaDesc =
            html
              .match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)?.[1]
              ?.trim() || '';

          // Extract headings
          const headings: string[] = [];
          const headingRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
          let hMatch;
          while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 15) {
            const text = hMatch[1].replace(/<[^>]+>/g, '').trim();
            if (text) headings.push(text);
          }

          // Extract links (up to 20)
          const links: string[] = [];
          const linkRegex = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let lMatch;
          while ((lMatch = linkRegex.exec(html)) !== null && links.length < 20) {
            const linkText = lMatch[2].replace(/<[^>]+>/g, '').trim();
            if (linkText && linkText.length > 1) {
              links.push(`${linkText} → ${lMatch[1]}`);
            }
          }

          // Extract main text content (strip scripts, styles, nav, footer, header)
          const mainText = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/\s+/g, ' ')
            .trim();

          // Build structured output
          const sections: string[] = [];
          if (title) sections.push(`Title: ${title}`);
          sections.push(`URL: ${finalUrl}`);
          if (metaDesc) sections.push(`Description: ${metaDesc}`);
          if (headings.length > 0) {
            sections.push(`\nHeadings:\n${headings.map((h) => `  - ${h}`).join('\n')}`);
          }
          if (links.length > 0) {
            sections.push(`\nLinks:\n${links.map((l) => `  - ${l}`).join('\n')}`);
          }
          sections.push(`\nContent:\n${mainText.substring(0, 2500)}`);

          const output = sections.join('\n').substring(0, 4000);

          ctx.kernel.bus.emit('agent.browsing', {
            pid: ctx.pid,
            url: finalUrl,
            summary: (title || mainText).substring(0, 200),
          });

          return { success: true, output };
        } catch (err: any) {
          return { success: false, output: `Failed to browse ${url}: ${err.message}` };
        }
      },
    },

    {
      name: 'screenshot_page',
      description: 'Take a screenshot of the current browser page (returns base64 PNG image)',
      execute: async (args, ctx) => {
        if (!ctx.kernel.browser?.isAvailable()) {
          return {
            success: false,
            output:
              'Screenshot unavailable — Playwright is not installed. Use browse_web to read page content as text instead.',
          };
        }
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
      description:
        'Click an element on the current browser page. Accepts EITHER {text: "Button label"} to click by visible text, {css: "#id"} for CSS selector, {xpath: "//button"} for XPath, OR {x: number, y: number} for coordinates. Optionally add {button: "right"} for right-click.',
      execute: async (args, ctx) => {
        if (!ctx.kernel.browser?.isAvailable()) {
          return {
            success: false,
            output:
              'Click unavailable — Playwright is not installed. Use browse_web to navigate to URLs directly, or use run_command with curl/wget for downloads.',
          };
        }
        try {
          const sessionId = await ensureBrowserSession(ctx);
          const btn = args.button || 'left';

          // If x and y are valid numbers, click at coordinates
          if (typeof args.x === 'number' && typeof args.y === 'number') {
            await ctx.kernel.browser.click(sessionId, args.x, args.y, btn);
            return {
              success: true,
              output: `Clicked at (${args.x}, ${args.y}) with ${btn} button.`,
            };
          }

          // Otherwise, use selector-based click (text, css, or xpath)
          const selector: { text?: string; css?: string; xpath?: string } = {};
          if (args.text) selector.text = args.text;
          else if (args.css) selector.css = args.css;
          else if (args.xpath) selector.xpath = args.xpath;
          else if (args.selector) selector.css = args.selector;

          if (!selector.text && !selector.css && !selector.xpath) {
            return {
              success: false,
              output:
                'No valid target provided. Use {text: "label"}, {css: "#id"}, {xpath: "//el"}, or {x: number, y: number}.',
            };
          }

          const coords = await ctx.kernel.browser.clickBySelector(sessionId, selector, btn);
          return {
            success: true,
            output: `Clicked element at (${coords.x}, ${coords.y}) with ${btn} button.`,
          };
        } catch (err: any) {
          return { success: false, output: `Click failed: ${err.message}` };
        }
      },
    },

    {
      name: 'type_text',
      description:
        'Type text into the focused element on the current browser page (requires Playwright)',
      execute: async (args, ctx) => {
        if (!ctx.kernel.browser?.isAvailable()) {
          return {
            success: false,
            output:
              'Type unavailable — Playwright is not installed. Use run_command to interact with web services via curl, or write_file to create content directly.',
          };
        }
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

    // ----- Collaboration Protocols (v0.3 Wave 4) -----
    {
      name: 'request_review',
      description:
        'Request another agent to review your work. Args: pid (number - target agent PID), subject (string), content (string), context (string, optional), urgency (low|medium|high, default medium)',
      execute: async (args, ctx) => {
        try {
          const { requestReview } = await import('./collaboration.js');
          const toPid = Number(args.pid);
          if (isNaN(toPid)) return { success: false, output: 'Invalid PID' };

          const correlationId = requestReview(ctx.kernel, ctx.pid, toPid, {
            subject: args.subject || 'Review request',
            content: args.content || '',
            context: args.context,
            urgency: args.urgency || 'medium',
          });

          return {
            success: true,
            output: `Review request sent to PID ${toPid} (correlation: ${correlationId}). Check messages later for the response.`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'respond_to_review',
      description:
        'Respond to a review request from another agent. Args: pid (number - requester PID), correlation_id (string), approved (boolean), feedback (string), suggestions (string[], optional)',
      execute: async (args, ctx) => {
        try {
          const { respondToReview } = await import('./collaboration.js');
          const toPid = Number(args.pid);
          if (isNaN(toPid)) return { success: false, output: 'Invalid PID' };

          respondToReview(ctx.kernel, ctx.pid, toPid, args.correlation_id || '', {
            approved: !!args.approved,
            feedback: args.feedback || '',
            suggestions: args.suggestions,
          });

          return {
            success: true,
            output: `Review response sent to PID ${toPid}. ${args.approved ? 'Approved' : 'Changes requested'}.`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'delegate_task',
      description:
        'Delegate a task to another agent. Args: pid (number - target agent PID), goal (string), context (string), priority (low|medium|high, default medium)',
      execute: async (args, ctx) => {
        try {
          const { delegateTask } = await import('./collaboration.js');
          const toPid = Number(args.pid);
          if (isNaN(toPid)) return { success: false, output: 'Invalid PID' };

          const correlationId = delegateTask(ctx.kernel, ctx.pid, toPid, {
            goal: args.goal || '',
            context: args.context || '',
            priority: args.priority || 'medium',
          });

          return {
            success: true,
            output: `Task delegated to PID ${toPid} (correlation: ${correlationId}): "${args.goal}"`,
          };
        } catch (err: any) {
          return { success: false, output: `Error: ${err.message}` };
        }
      },
    },

    {
      name: 'share_knowledge',
      description:
        'Share a piece of knowledge with another agent. Args: pid (number - target agent PID), topic (string), content (string), layer (episodic|semantic|procedural|social, default semantic), tags (string[], optional)',
      execute: async (args, ctx) => {
        try {
          const { shareKnowledge } = await import('./collaboration.js');
          const toPid = Number(args.pid);
          if (isNaN(toPid)) return { success: false, output: 'Invalid PID' };

          shareKnowledge(ctx.kernel, ctx.pid, toPid, {
            topic: args.topic || '',
            content: args.content || '',
            layer: args.layer || 'semantic',
            tags: args.tags || [],
          });

          return {
            success: true,
            output: `Knowledge shared with PID ${toPid}: "${args.topic}"`,
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

    // ----- Vision Tools (v0.3 Wave 4) -----
    {
      name: 'analyze_image',
      description:
        'Analyze an image using a vision-capable LLM. Can analyze screenshots from browser or uploaded images. Args: image_base64 (string - base64 encoded image), prompt (string, optional - what to analyze), screenshot (boolean, optional - if true, takes a screenshot first)',
      execute: async (args, ctx) => {
        try {
          // If screenshot mode, grab the current browser screenshot
          let imageData = args.image_base64;

          if (args.screenshot && ctx.kernel.browser?.isAvailable()) {
            const sessionId = `browser_${ctx.pid}`;
            try {
              imageData = await ctx.kernel.browser.getScreenshot(sessionId);
            } catch (err: any) {
              return { success: false, output: `Screenshot failed: ${err.message}` };
            }
          }

          if (!imageData) {
            return {
              success: false,
              output: 'No image data provided. Use image_base64 or set screenshot=true.',
            };
          }

          // Find a vision-capable provider
          const { getProvider } = await import('./llm/index.js');
          const provider = getProvider();

          if (!provider || !provider.supportsVision?.() || !provider.analyzeImage) {
            return {
              success: false,
              output:
                'No vision-capable LLM provider available. Ensure you have a Gemini, OpenAI, or Anthropic API key set.',
            };
          }

          const prompt =
            args.prompt ||
            'Describe what you see in this image. Be specific about UI elements, text, layout, and any notable details.';
          const response = await provider.analyzeImage(imageData, prompt);

          return {
            success: true,
            output: response.content || 'Image analyzed but no description returned.',
            artifacts: [{ type: 'analysis', content: response.content }],
          };
        } catch (err: any) {
          return { success: false, output: `Vision analysis failed: ${err.message}` };
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
 * loaded plugin tools and MCP server tools.
 */
export function getToolsForAgent(
  pid: PID,
  pluginManager?: PluginManager,
  mcpManager?: MCPManager,
): ToolDefinition[] {
  const baseTools = createToolSet();

  const pluginTools: ToolDefinition[] = [];
  if (pluginManager) {
    const plugins = pluginManager.getPlugins(pid);
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
  }

  // MCP tools: create ToolDefinition wrappers for each connected MCP server tool
  const mcpTools: ToolDefinition[] = [];
  if (mcpManager) {
    const allMCPTools = mcpManager.getTools();
    for (const mcpTool of allMCPTools) {
      mcpTools.push({
        name: mcpTool.name, // e.g. "mcp__filesystem__read_file"
        description: `[MCP: ${mcpTool.serverId}] ${mcpTool.description}`,
        requiresApproval: false,
        execute: async (args: Record<string, any>): Promise<ToolResult> => {
          try {
            const result = await mcpManager.callTool(mcpTool.serverId, mcpTool.mcpName, args);
            return { success: true, output: result };
          } catch (err: any) {
            return { success: false, output: `MCP tool error: ${err.message}` };
          }
        },
      });
    }
  }

  return [...baseTools, ...pluginTools, ...mcpTools];
}

/**
 * Get tool parameter schemas for an agent, merging built-in TOOL_SCHEMAS
 * with MCP tool schemas (which carry their own JSON Schema via inputSchema).
 */
export function getToolSchemasForAgent(
  mcpManager?: MCPManager,
): Record<string, { type: string; properties: Record<string, any>; required?: string[] }> {
  const schemas = { ...TOOL_SCHEMAS };

  if (mcpManager) {
    for (const mcpTool of mcpManager.getTools()) {
      schemas[mcpTool.name] = {
        type: 'object',
        properties: mcpTool.inputSchema?.properties || {},
        required: mcpTool.inputSchema?.required,
      };
    }
  }

  return schemas;
}

// ---------------------------------------------------------------------------
// Tool Parameter Schemas — sent to the LLM so it knows exact argument shapes
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS: Record<
  string,
  { type: string; properties: Record<string, any>; required?: string[] }
> = {
  read_file: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
    },
    required: ['path'],
  },
  write_file: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write to' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  list_files: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current dir)' },
    },
  },
  mkdir: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to create' },
    },
    required: ['path'],
  },
  rm: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to remove' },
    },
    required: ['path'],
  },
  stat: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to inspect' },
    },
    required: ['path'],
  },
  mv: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source path' },
      destination: { type: 'string', description: 'Destination path' },
    },
    required: ['source', 'destination'],
  },
  cp: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source path' },
      destination: { type: 'string', description: 'Destination path' },
    },
    required: ['source', 'destination'],
  },
  run_command: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in seconds (optional)' },
    },
    required: ['command'],
  },
  browse_web: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'URL to browse. For search use: https://lite.duckduckgo.com/lite/?q=your+search+terms',
      },
    },
    required: ['url'],
  },
  screenshot_page: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to before screenshot (optional)' },
    },
  },
  click_element: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Click element by visible text label' },
      css: { type: 'string', description: 'Click element by CSS selector' },
      xpath: { type: 'string', description: 'Click element by XPath' },
      x: { type: 'number', description: 'Click at x coordinate' },
      y: { type: 'number', description: 'Click at y coordinate' },
      button: { type: 'string', description: 'Mouse button: left or right (default: left)' },
    },
  },
  type_text: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to type into focused element' },
      key: { type: 'string', description: 'Single key to press (e.g. Enter, Tab, Escape)' },
    },
  },
  list_agents: {
    type: 'object',
    properties: {},
  },
  send_message: {
    type: 'object',
    properties: {
      pid: { type: 'number', description: 'Target agent PID' },
      message: { type: 'string', description: 'Message content to send' },
      channel: { type: 'string', description: 'Message channel (default: "default")' },
    },
    required: ['pid', 'message'],
  },
  check_messages: {
    type: 'object',
    properties: {},
  },
  request_review: {
    type: 'object',
    properties: {
      pid: { type: 'number', description: 'Target agent PID' },
      subject: { type: 'string', description: 'Review subject' },
      content: { type: 'string', description: 'Content to review' },
      context: { type: 'string', description: 'Additional context (optional)' },
      urgency: { type: 'string', description: 'low, medium, or high (default: medium)' },
    },
    required: ['pid', 'subject', 'content'],
  },
  respond_to_review: {
    type: 'object',
    properties: {
      pid: { type: 'number', description: 'Requester agent PID' },
      correlation_id: { type: 'string', description: 'Review request correlation ID' },
      approved: { type: 'boolean', description: 'Whether the review is approved' },
      feedback: { type: 'string', description: 'Feedback text' },
      suggestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Suggested changes (optional)',
      },
    },
    required: ['pid', 'correlation_id', 'approved', 'feedback'],
  },
  delegate_task: {
    type: 'object',
    properties: {
      pid: { type: 'number', description: 'Target agent PID' },
      goal: { type: 'string', description: 'Task goal to delegate' },
      context: { type: 'string', description: 'Context for the task (optional)' },
      priority: { type: 'string', description: 'low, medium, or high (default: medium)' },
    },
    required: ['pid', 'goal'],
  },
  share_knowledge: {
    type: 'object',
    properties: {
      pid: { type: 'number', description: 'Target agent PID' },
      topic: { type: 'string', description: 'Knowledge topic' },
      content: { type: 'string', description: 'Knowledge content' },
      layer: {
        type: 'string',
        description: 'Memory layer: episodic, semantic, procedural, or social (default: semantic)',
      },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags (optional)' },
    },
    required: ['pid', 'topic', 'content'],
  },
  create_shared_workspace: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Workspace name' },
    },
    required: ['name'],
  },
  mount_workspace: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Workspace name to mount' },
      mount_point: { type: 'string', description: 'Mount point path (optional)' },
    },
    required: ['name'],
  },
  list_workspaces: {
    type: 'object',
    properties: {},
  },
  remember: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Memory content to store' },
      layer: {
        type: 'string',
        description: 'Memory layer: episodic, semantic, procedural, or social (default: episodic)',
      },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags (optional)' },
      importance: { type: 'number', description: 'Importance score 0-1 (default: 0.5)' },
    },
    required: ['content'],
  },
  recall: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for memories' },
      layer: { type: 'string', description: 'Filter by memory layer (optional)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (optional)' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
    },
  },
  forget: {
    type: 'object',
    properties: {
      memoryId: { type: 'string', description: 'ID of memory to delete' },
    },
    required: ['memoryId'],
  },
  analyze_image: {
    type: 'object',
    properties: {
      image_base64: { type: 'string', description: 'Base64 encoded image data' },
      prompt: { type: 'string', description: 'What to analyze (optional)' },
      screenshot: {
        type: 'boolean',
        description: 'Take browser screenshot instead of using image_base64 (optional)',
      },
    },
  },
  create_plan: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Plan goal' },
      nodes: {
        type: 'array',
        description: 'Plan nodes with title, description, estimated_steps, children',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            estimated_steps: { type: 'number' },
          },
        },
      },
    },
    required: ['goal', 'nodes'],
  },
  update_plan: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'Plan node ID to update' },
      status: {
        type: 'string',
        description: 'New status: pending, active, completed, failed, or skipped',
      },
      actual_steps: { type: 'number', description: 'Actual steps taken (optional)' },
    },
    required: ['node_id', 'status'],
  },
  get_feedback: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max feedback entries to return (default: 20)' },
    },
  },
  think: {
    type: 'object',
    properties: {
      thought: { type: 'string', description: 'Your thought or reasoning' },
    },
    required: ['thought'],
  },
  complete: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Summary of what was accomplished' },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCwd(cwd: string, relativePath: string): string {
  // Normalize backslashes to forward slashes
  const normalized = relativePath.replace(/\\/g, '/');

  // Handle absolute paths (POSIX or Windows drive letter)
  if (normalized.startsWith('/')) return normalized;
  if (/^[a-zA-Z]:\//.test(normalized)) {
    // Windows absolute path — treat as relative to virtual root
    // e.g. C:/temp/aether/home/agent_1/file.py → /home/agent_1/file.py
    return normalized;
  }

  // Simple path join (posix-style)
  const parts = cwd.split('/').filter(Boolean);
  for (const part of normalized.split('/')) {
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
