/**
 * Aether Kernel - AetherMCPServer (v0.8)
 *
 * Exposes Aether kernel capabilities as MCP-compatible tools for external
 * agents (Claude Code, OpenClaw). This is a **tool registry**, not a network
 * server -- tools are called in-process by AgentSubprocess when an external
 * agent makes a tool call.
 *
 * Each tool has:
 *   - name: unique identifier prefixed with `aether_`
 *   - description: human-readable text for the agent
 *   - inputSchema: JSON Schema for the tool arguments
 *   - execute: async handler that delegates to kernel subsystems
 *
 * Tools span four domains:
 *   1. Memory   — aether_remember, aether_recall
 *   2. Skills   — aether_discover_skills, aether_create_skill, aether_install_skill, aether_share_skill
 *   3. Collab   — aether_list_agents, aether_send_message, aether_check_messages
 *   4. OS       — aether_system_status, aether_read_source, aether_get_architecture
 */

import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { StateStore } from './StateStore.js';
import { MemoryManager } from './MemoryManager.js';
import { SkillForge } from './SkillForge.js';
import { ProcessManager } from './ProcessManager.js';
import { OpenClawAdapter } from './OpenClawAdapter.js';
import type { PID } from '@aether/shared';
import { AETHER_MCP_SERVER_NAME, AETHER_MCP_SERVER_VERSION } from '@aether/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single tool in the Aether MCP tool registry. */
export interface AetherTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  execute: (
    args: Record<string, any>,
    context: { pid: PID; uid: string },
  ) => Promise<{ content: string; isError?: boolean }>;
}

// ---------------------------------------------------------------------------
// AetherMCPServer
// ---------------------------------------------------------------------------

export class AetherMCPServer {
  readonly serverName = AETHER_MCP_SERVER_NAME;
  readonly serverVersion = AETHER_MCP_SERVER_VERSION;

  private bus: EventBus;
  private state: StateStore;
  private memory: MemoryManager;
  private skillForge: SkillForge;
  private processes: ProcessManager;
  private openClaw: OpenClawAdapter;
  private tools: Map<string, AetherTool> = new Map();

  constructor(
    bus: EventBus,
    state: StateStore,
    memory: MemoryManager,
    skillForge: SkillForge,
    processes: ProcessManager,
    openClaw: OpenClawAdapter,
  ) {
    this.bus = bus;
    this.state = state;
    this.memory = memory;
    this.skillForge = skillForge;
    this.processes = processes;
    this.openClaw = openClaw;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    this.registerTools();
    console.log(`[AetherMCPServer] Registered ${this.tools.size} tools`);
  }

  // -------------------------------------------------------------------------
  // Public API — used by AgentSubprocess
  // -------------------------------------------------------------------------

  /** Get all registered tools. */
  getTools(): AetherTool[] {
    return Array.from(this.tools.values());
  }

  /** Get tool list in MCP schema format (name + description + inputSchema). */
  getToolSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, any>;
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** Execute a tool by name. */
  async callTool(
    name: string,
    args: Record<string, any>,
    context: { pid: PID; uid: string },
  ): Promise<{ content: string; isError?: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    this.bus.emit('aether-mcp.tool.called', {
      pid: context.pid,
      tool: name,
      args,
    });

    try {
      return await tool.execute(args, context);
    } catch (err: unknown) {
      return { content: `Tool error: ${errMsg(err)}`, isError: true };
    }
  }

  /** Generate MCP server config JSON for an agent's working directory. */
  generateMCPConfig(pid: PID): Record<string, any> {
    return {
      mcpServers: {
        [AETHER_MCP_SERVER_NAME]: {
          command: 'node',
          args: ['aether-mcp-stdio-bridge.js', '--pid', String(pid)],
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Tool Registration
  // -------------------------------------------------------------------------

  private registerTools(): void {
    this.registerMemoryTools();
    this.registerSkillTools();
    this.registerCollaborationTools();
    this.registerOSTools();
  }

  // -------------------------------------------------------------------------
  // Memory Tools
  // -------------------------------------------------------------------------

  private registerMemoryTools(): void {
    this.tools.set('aether_remember', {
      name: 'aether_remember',
      description:
        'Store a memory for future sessions. Layers: episodic (events), semantic (facts), procedural (skills), social (relationships).',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Memory content to store' },
          layer: {
            type: 'string',
            enum: ['episodic', 'semantic', 'procedural', 'social'],
            description: 'Memory layer (default: episodic)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Categorization tags',
          },
          importance: {
            type: 'number',
            description: '0-1 importance score (default 0.5)',
          },
        },
        required: ['content'],
      },
      execute: async (args, ctx) => {
        const layer = args.layer || 'episodic';
        const memory = this.memory.store({
          agent_uid: ctx.uid,
          layer,
          content: args.content,
          tags: args.tags || [],
          importance: args.importance ?? 0.5,
          source_pid: ctx.pid,
        });
        return { content: `Stored ${layer} memory (id: ${memory.id})` };
      },
    });

    this.tools.set('aether_recall', {
      name: 'aether_recall',
      description: 'Search memories from current and past sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          layer: {
            type: 'string',
            enum: ['episodic', 'semantic', 'procedural', 'social'],
          },
          tags: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
      execute: async (args, ctx) => {
        const memories = this.memory.recall({
          agent_uid: ctx.uid,
          query: args.query,
          layer: args.layer,
          tags: args.tags,
          limit: args.limit || 10,
        });
        if (memories.length === 0) return { content: 'No memories found.' };
        const formatted = memories
          .map(
            (m, i) =>
              `${i + 1}. [${m.layer}] ${m.content.substring(0, 200)} (importance: ${m.importance.toFixed(2)})`,
          )
          .join('\n');
        return { content: `Found ${memories.length} memories:\n${formatted}` };
      },
    });
  }

  // -------------------------------------------------------------------------
  // Skill Tools
  // -------------------------------------------------------------------------

  private registerSkillTools(): void {
    this.tools.set('aether_discover_skills', {
      name: 'aether_discover_skills',
      description: 'Search for available skills in the Aether skill library.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What capability you need',
          },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
      execute: async (args, _ctx) => {
        const results = await this.skillForge.discover(args.query, 'all', args.limit || 10);
        if (results.length === 0) return { content: 'No skills found.' };
        const formatted = results
          .map(
            (r, i) =>
              `${i + 1}. [${r.source}] ${r.name}: ${r.description} (${r.installed ? 'installed' : 'available'})`,
          )
          .join('\n');
        return { content: formatted };
      },
    });

    this.tools.set('aether_create_skill', {
      name: 'aether_create_skill',
      description: 'Create a new reusable skill that other agents can discover and use.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Skill identifier (lowercase-hyphens)',
          },
          description: { type: 'string', description: 'What the skill does' },
          instructions: {
            type: 'string',
            description: 'Markdown instructions for using the skill',
          },
          tools_used: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of tool names this skill uses',
          },
        },
        required: ['name', 'description', 'instructions'],
      },
      execute: async (args, ctx) => {
        const result = await this.skillForge.create(
          {
            name: args.name,
            description: args.description,
            instructions: args.instructions,
            tools_used: args.tools_used,
          },
          ctx.uid,
        );
        return { content: result.message, isError: !result.success };
      },
    });

    this.tools.set('aether_install_skill', {
      name: 'aether_install_skill',
      description: 'Install a skill by path or ID.',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill path or ID' },
          source: { type: 'string', enum: ['local', 'clawhub'] },
        },
        required: ['skill_id'],
      },
      execute: async (args, ctx) => {
        const result = await this.skillForge.install(
          args.skill_id,
          args.source || 'local',
          ctx.uid,
        );
        return { content: result.message, isError: !result.success };
      },
    });

    this.tools.set('aether_share_skill', {
      name: 'aether_share_skill',
      description: 'Share a skill you created with all agents.',
      inputSchema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill ID to share' },
        },
        required: ['skill_id'],
      },
      execute: async (args, ctx) => {
        const result = await this.skillForge.share(args.skill_id, 'all', ctx.uid);
        return {
          content: result.message || 'Shared.',
          isError: !result.success,
        };
      },
    });
  }

  // -------------------------------------------------------------------------
  // Collaboration Tools
  // -------------------------------------------------------------------------

  private registerCollaborationTools(): void {
    this.tools.set('aether_list_agents', {
      name: 'aether_list_agents',
      description: 'List all running agents in the system.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, _ctx) => {
        const procs = this.processes.getAll().filter((p) => p.info.state === 'running');
        if (procs.length === 0) {
          return { content: 'No agents currently running.' };
        }
        const formatted = procs
          .map((p) => `PID ${p.info.pid}: ${p.info.name} (${p.info.agentPhase})`)
          .join('\n');
        return { content: `${procs.length} running agent(s):\n${formatted}` };
      },
    });

    this.tools.set('aether_send_message', {
      name: 'aether_send_message',
      description: 'Send a message to another agent via IPC.',
      inputSchema: {
        type: 'object',
        properties: {
          target_pid: {
            type: 'number',
            description: 'PID of the target agent',
          },
          channel: {
            type: 'string',
            description: 'Message channel (e.g. task, info, request)',
          },
          content: { type: 'string', description: 'Message content' },
        },
        required: ['target_pid', 'content'],
      },
      execute: async (args, ctx) => {
        const msg = this.processes.sendMessage(
          ctx.pid,
          args.target_pid,
          args.channel || 'message',
          { text: args.content },
        );
        if (!msg) {
          return {
            content: `Failed to send message to PID ${args.target_pid} (process not found or dead).`,
            isError: true,
          };
        }
        return { content: `Message sent to PID ${args.target_pid}.` };
      },
    });

    this.tools.set('aether_check_messages', {
      name: 'aether_check_messages',
      description: 'Check your incoming messages from other agents.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => {
        const messages = this.processes.drainMessages(ctx.pid);
        if (messages.length === 0) return { content: 'No new messages.' };
        const formatted = messages
          .map(
            (m, i) =>
              `${i + 1}. From PID ${m.fromPid} [${m.channel}]: ${JSON.stringify(m.payload)}`,
          )
          .join('\n');
        return { content: `${messages.length} message(s):\n${formatted}` };
      },
    });
  }

  // -------------------------------------------------------------------------
  // OS Tools
  // -------------------------------------------------------------------------

  private registerOSTools(): void {
    this.tools.set('aether_system_status', {
      name: 'aether_system_status',
      description: 'Get Aether OS system status -- subsystems, agents, resources.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, _ctx) => {
        const procs = this.processes.getAll();
        const running = procs.filter((p) => p.info.state === 'running').length;
        const total = procs.filter((p) => p.info.state !== 'dead').length;
        return {
          content: `Aether OS v${AETHER_MCP_SERVER_VERSION} -- 30 subsystems online\nAgents: ${running} running, ${total} total\nMemory: ready\nSkillForge: ready`,
        };
      },
    });

    this.tools.set('aether_read_source', {
      name: 'aether_read_source',
      description:
        'Read a file from the Aether OS source code repository. Use this to understand and improve the system.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from repo root (e.g. "kernel/src/SkillForge.ts")',
          },
        },
        required: ['path'],
      },
      execute: async (args, _ctx) => {
        try {
          const nodefs = await import('node:fs');
          const nodepath = await import('node:path');
          // Server runs from <project>/server/, so go up one level for repo root
          const repoRoot = nodepath.resolve(process.cwd(), '..');
          const filePath = nodepath.join(repoRoot, args.path);
          // Security: ensure path stays within repo
          if (!filePath.startsWith(repoRoot)) {
            return { content: 'Access denied: path outside repo.', isError: true };
          }
          const content = nodefs.readFileSync(filePath, 'utf-8');
          return { content: content.substring(0, 50_000) };
        } catch (err: unknown) {
          return { content: `Error reading file: ${errMsg(err)}`, isError: true };
        }
      },
    });

    this.tools.set('aether_get_architecture', {
      name: 'aether_get_architecture',
      description:
        'Read the Aether OS architecture document for self-knowledge about the system you are running inside.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, _ctx) => {
        try {
          const nodefs = await import('node:fs');
          const nodepath = await import('node:path');
          const repoRoot = nodepath.resolve(process.cwd(), '..');
          const archPath = nodepath.join(repoRoot, 'docs', 'ARCHITECTURE.md');
          const content = nodefs.readFileSync(archPath, 'utf-8');
          return { content: content.substring(0, 50_000) };
        } catch (err: unknown) {
          return { content: `Error: ${errMsg(err)}`, isError: true };
        }
      },
    });
  }
}
