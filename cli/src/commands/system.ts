/**
 * aether system <subcommand>
 *
 * Subcommands: status, metrics
 */

import type { ParsedArgs } from '../cli.js';
import { createClient } from '../cli.js';
import { printError, colors } from '../format.js';
import type { CLIConfig } from '../config.js';

export async function runSystem(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const sub = args.positional[1];

  switch (sub) {
    case 'status':
      return systemStatus(args, config);
    case 'metrics':
      return systemMetrics(args, config);
    default:
      printError(`Unknown system subcommand: ${sub || '(none)'}. Available: status, metrics`);
      process.exitCode = 1;
  }
}

async function systemStatus(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const status = await client.system.status();

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(status) + '\n');
    return;
  }

  const lines = [
    `${colors.bold}Aether OS System Status${colors.reset}`,
    `  Version:    ${status.version || '-'}`,
    `  Uptime:     ${formatUptime(status.uptime)}`,
    `  Processes:  ${status.processCount ?? '-'}`,
    `  Containers: ${status.containerCount ?? '-'}`,
  ];

  if (status.subsystems) {
    lines.push(`  Subsystems:`);
    for (const [name, state] of Object.entries(status.subsystems)) {
      lines.push(`    ${name}: ${state}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}

async function systemMetrics(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const metrics = await client.system.metrics();

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(metrics) + '\n');
    return;
  }

  const lines = [
    `${colors.bold}System Metrics${colors.reset}`,
    `  CPU:       ${metrics.cpu?.percent ?? metrics.cpuPercent ?? '-'}%`,
    `  Memory:    ${metrics.memory?.usedMB ?? metrics.memoryMB ?? '-'} MB`,
    `  Disk:      ${metrics.disk?.usedGB ?? '-'} GB`,
    `  Network:   ${metrics.network?.bytesIn ?? '-'} in / ${metrics.network?.bytesOut ?? '-'} out`,
    `  Processes: ${metrics.processCount ?? '-'}`,
  ];

  process.stdout.write(lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(ms: number | undefined): string {
  if (!ms) return '-';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}
