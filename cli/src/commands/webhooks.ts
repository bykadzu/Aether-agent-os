/**
 * aether webhooks <subcommand>
 *
 * Subcommands: list, create, delete
 *
 * Uses the triggers API from the SDK since webhook endpoints
 * map to the trigger system.
 */

import type { ParsedArgs } from '../cli.js';
import { createClient } from '../cli.js';
import { formatTable, printSuccess, printError } from '../format.js';
import type { CLIConfig } from '../config.js';

export async function runWebhooks(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const sub = args.positional[1];

  switch (sub) {
    case 'list':
      return webhooksList(args, config);
    case 'create':
      return webhooksCreate(args, config);
    case 'delete':
      return webhooksDelete(args, config);
    default:
      printError(
        `Unknown webhooks subcommand: ${sub || '(none)'}. Available: list, create, delete`,
      );
      process.exitCode = 1;
  }
}

async function webhooksList(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const triggers = await client.triggers.list();

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(triggers) + '\n');
    return;
  }

  if (!triggers || triggers.length === 0) {
    process.stdout.write('No webhooks found.\n');
    return;
  }

  const rows = triggers.map((t: any) => [
    t.id || '-',
    t.name || '-',
    t.event_type || '-',
    t.enabled ? 'enabled' : 'disabled',
    String(t.fire_count ?? 0),
  ]);

  process.stdout.write(formatTable(['ID', 'NAME', 'EVENT', 'STATUS', 'FIRES'], rows) + '\n');
}

async function webhooksCreate(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const name = args.positional[2];
  const eventType = args.flags['event'] as string | undefined;
  const role = args.flags['role'] as string | undefined;
  const goal = args.flags['goal'] as string | undefined;

  if (!name || !eventType || !role || !goal) {
    printError('Usage: aether webhooks create <name> --event=X --role=Y --goal="Z"');
    process.exitCode = 1;
    return;
  }

  const result = await client.triggers.create({
    name,
    event_type: eventType,
    agent_config: { role, goal },
  });

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Webhook created: ${result.id || name}`);
  }
}

async function webhooksDelete(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const id = args.positional[2];

  if (!id) {
    printError('Usage: aether webhooks delete <id>');
    process.exitCode = 1;
    return;
  }

  const result = await client.triggers.delete(id);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Webhook deleted: ${id}`);
  }
}
