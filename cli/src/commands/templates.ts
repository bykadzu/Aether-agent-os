/**
 * aether templates <subcommand>
 *
 * Subcommands: list
 */

import type { ParsedArgs } from '../cli.js';
import { createClient } from '../cli.js';
import { formatTable, printError } from '../format.js';
import type { CLIConfig } from '../config.js';

export async function runTemplates(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const sub = args.positional[1] || 'list';

  switch (sub) {
    case 'list':
      return templatesList(args, config);
    default:
      printError(`Unknown templates subcommand: ${sub}. Available: list`);
      process.exitCode = 1;
  }
}

async function templatesList(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const templates = await client.templates.list();

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(templates) + '\n');
    return;
  }

  if (!templates || templates.length === 0) {
    process.stdout.write('No templates found.\n');
    return;
  }

  const rows = templates.map((t: any) => [
    t.id || '-',
    t.name || '-',
    t.role || t.config?.role || '-',
    String(t.tools?.length ?? t.config?.tools?.length ?? 0),
  ]);

  process.stdout.write(formatTable(['ID', 'NAME', 'ROLE', 'TOOLS'], rows) + '\n');
}
