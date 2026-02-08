/**
 * aether cron <subcommand>
 *
 * Subcommands: list, create, delete
 */

import type { ParsedArgs } from '../cli.js';
import { createClient } from '../cli.js';
import { formatTable, printSuccess, printError } from '../format.js';
import type { CLIConfig } from '../config.js';

export async function runCron(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const sub = args.positional[1];

  switch (sub) {
    case 'list':
      return cronList(args, config);
    case 'create':
      return cronCreate(args, config);
    case 'delete':
      return cronDelete(args, config);
    default:
      printError(`Unknown cron subcommand: ${sub || '(none)'}. Available: list, create, delete`);
      process.exitCode = 1;
  }
}

async function cronList(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const jobs = await client.cron.list();

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(jobs) + '\n');
    return;
  }

  if (!jobs || jobs.length === 0) {
    process.stdout.write('No cron jobs found.\n');
    return;
  }

  const rows = jobs.map((j: any) => [
    j.id || '-',
    j.name || '-',
    j.cron_expression || '-',
    j.enabled ? 'enabled' : 'disabled',
    String(j.run_count ?? 0),
  ]);

  process.stdout.write(formatTable(['ID', 'NAME', 'EXPRESSION', 'STATUS', 'RUNS'], rows) + '\n');
}

async function cronCreate(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const name = args.positional[2];
  const expression = args.flags['expression'] as string | undefined;
  const role = args.flags['role'] as string | undefined;
  const goal = args.flags['goal'] as string | undefined;

  if (!name || !expression || !role || !goal) {
    printError('Usage: aether cron create <name> --expression="0 * * * *" --role=X --goal="Y"');
    process.exitCode = 1;
    return;
  }

  const result = await client.cron.create({
    name,
    expression,
    agent_config: { role, goal },
  });

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Cron job created: ${result.id || name}`);
  }
}

async function cronDelete(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const id = args.positional[2];

  if (!id) {
    printError('Usage: aether cron delete <id>');
    process.exitCode = 1;
    return;
  }

  const result = await client.cron.delete(id);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Cron job deleted: ${id}`);
  }
}
