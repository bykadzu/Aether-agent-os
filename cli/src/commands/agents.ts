/**
 * aether agents <subcommand> [args]
 *
 * Subcommands: list, spawn, get, kill, logs, message
 */

import type { ParsedArgs } from '../cli.js';
import { createClient } from '../cli.js';
import { formatTable, printSuccess, printError, colors } from '../format.js';
import type { CLIConfig } from '../config.js';

export async function runAgents(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const sub = args.positional[1];

  switch (sub) {
    case 'list':
      return agentsList(args, config);
    case 'spawn':
      return agentsSpawn(args, config);
    case 'get':
      return agentsGet(args, config);
    case 'kill':
      return agentsKill(args, config);
    case 'logs':
      return agentsLogs(args, config);
    case 'message':
      return agentsMessage(args, config);
    default:
      printError(
        `Unknown agents subcommand: ${sub || '(none)'}. Available: list, spawn, get, kill, logs, message`,
      );
      process.exitCode = 1;
  }
}

async function agentsList(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const status = args.flags['status'] as string | undefined;
  const limit = args.flags['limit'] ? Number(args.flags['limit']) : undefined;

  const agents = await client.agents.list({ status, limit });

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(agents) + '\n');
    return;
  }

  if (!agents || agents.length === 0) {
    process.stdout.write('No agents found.\n');
    return;
  }

  const rows = agents.map((a: any) => [
    a.uid || a.pid?.toString() || '-',
    a.role || a.name || '-',
    truncate(a.goal || a.command || '-', 40),
    a.agentPhase || a.state || '-',
    String(a.step ?? a.cpuPercent ?? '-'),
    formatTimestamp(a.createdAt),
  ]);

  process.stdout.write(
    formatTable(['UID', 'ROLE', 'GOAL', 'STATUS', 'STEPS', 'CREATED'], rows) + '\n',
  );
}

async function agentsSpawn(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const role = args.positional[2];
  const goal = args.positional[3];

  if (!role || !goal) {
    printError('Usage: aether agents spawn <role> "<goal>" [--model=X] [--max-steps=N]');
    process.exitCode = 1;
    return;
  }

  const spawnConfig: any = { role, goal };
  if (args.flags['model']) spawnConfig.model = args.flags['model'];
  if (args.flags['max-steps']) spawnConfig.maxSteps = Number(args.flags['max-steps']);

  const result = await client.agents.spawn(spawnConfig);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Agent spawned: ${result.uid || result.pid}`);
  }
}

async function agentsGet(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const uid = args.positional[2];

  if (!uid) {
    printError('Usage: aether agents get <uid>');
    process.exitCode = 1;
    return;
  }

  const agent = await client.agents.get(uid);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(agent) + '\n');
    return;
  }

  const lines = [
    `${colors.bold}Agent: ${agent.uid || agent.pid}${colors.reset}`,
    `  Role:    ${agent.role || agent.name || '-'}`,
    `  Goal:    ${agent.goal || agent.command || '-'}`,
    `  State:   ${agent.state || '-'}`,
    `  Phase:   ${agent.agentPhase || '-'}`,
    `  Model:   ${agent.model || '-'}`,
    `  Steps:   ${agent.step ?? '-'}`,
    `  Created: ${formatTimestamp(agent.createdAt)}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

async function agentsKill(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const uid = args.positional[2];

  if (!uid) {
    printError('Usage: aether agents kill <uid>');
    process.exitCode = 1;
    return;
  }

  const result = await client.agents.kill(uid);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Agent ${uid} terminated`);
  }
}

async function agentsLogs(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const uid = args.positional[2];

  if (!uid) {
    printError('Usage: aether agents logs <uid> [--limit=50] [--follow]');
    process.exitCode = 1;
    return;
  }

  const limit = args.flags['limit'] ? Number(args.flags['limit']) : 50;
  const follow = args.flags['follow'] === true || args.flags['f'] === true;

  const entries = await client.agents.timeline(uid, { limit });

  if (args.flags['json'] === true && !follow) {
    process.stdout.write(JSON.stringify(entries) + '\n');
    return;
  }

  for (const entry of entries || []) {
    printTimelineEntry(entry);
  }

  if (follow) {
    const events = client.events.subscribe([`agent.${uid}`]);
    for await (const event of events) {
      if (args.flags['json'] === true) {
        process.stdout.write(JSON.stringify(event) + '\n');
      } else {
        printTimelineEntry(event);
      }
    }
  }
}

async function agentsMessage(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const uid = args.positional[2];
  const content = args.positional[3];

  if (!uid || !content) {
    printError('Usage: aether agents message <uid> "<content>"');
    process.exitCode = 1;
    return;
  }

  const result = await client.agents.message(uid, content);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Message sent to agent ${uid}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + '...';
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function printTimelineEntry(entry: any): void {
  const phase = entry.phase || entry.type || '?';
  const ts = formatTimestamp(entry.timestamp);
  const tool = entry.tool ? ` [${entry.tool}]` : '';
  const content = entry.content || entry.thought || entry.result || '';
  process.stdout.write(
    `${colors.dim}${ts}${colors.reset} ${colors.cyan}${phase}${colors.reset}${tool} ${content}\n`,
  );
}
