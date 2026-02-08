/**
 * aether help [command]
 */

import type { ParsedArgs } from '../cli.js';
import { colors } from '../format.js';

const GENERAL_HELP = `${colors.bold}Aether CLI v0.4.0${colors.reset} - Command-line interface for Aether OS

${colors.bold}USAGE${colors.reset}
  aether <command> [subcommand] [options]

${colors.bold}COMMANDS${colors.reset}
  login        Log in to an Aether OS server
  agents       Manage agents (list, spawn, get, kill, logs, message)
  fs           Filesystem operations (ls, cat, write, rm)
  system       System information (status, metrics)
  templates    Browse templates (list)
  cron         Manage cron jobs (list, create, delete)
  webhooks     Manage webhooks (list, create, delete)
  version      Print version
  help         Show this help

${colors.bold}GLOBAL OPTIONS${colors.reset}
  --json       Output raw JSON for any command

${colors.bold}EXAMPLES${colors.reset}
  aether login http://localhost:3001 --username=admin --password=secret
  aether agents list --status=running
  aether agents spawn researcher "Find latest AI papers" --model=gemini:flash
  aether agents logs agent-abc --follow
  aether fs ls /home
  aether system status --json
`;

const COMMAND_HELP: Record<string, string> = {
  login: `${colors.bold}aether login${colors.reset} <server-url> --username=X --password=X

  Log in to an Aether OS server and store credentials locally.

  ${colors.bold}ARGUMENTS${colors.reset}
    server-url    The Aether OS server URL (e.g. http://localhost:3001)

  ${colors.bold}OPTIONS${colors.reset}
    --username    Username for authentication
    --password    Password for authentication
`,

  agents: `${colors.bold}aether agents${colors.reset} <subcommand> [options]

  Manage agents on the Aether OS server.

  ${colors.bold}SUBCOMMANDS${colors.reset}
    list       List agents [--status=active|completed|failed] [--limit=20]
    spawn      Spawn agent: aether agents spawn <role> "<goal>" [--model=X] [--max-steps=N]
    get        Get agent details: aether agents get <uid>
    kill       Terminate agent: aether agents kill <uid>
    logs       View timeline: aether agents logs <uid> [--limit=50] [--follow]
    message    Send message: aether agents message <uid> "<content>"
`,

  fs: `${colors.bold}aether fs${colors.reset} <subcommand> [options]

  Filesystem operations on the Aether OS virtual filesystem.

  ${colors.bold}SUBCOMMANDS${colors.reset}
    ls         List directory: aether fs ls <path>
    cat        Read file: aether fs cat <path>
    write      Write file: aether fs write <path> [content] [--stdin]
    rm         Delete file: aether fs rm <path>
`,

  system: `${colors.bold}aether system${colors.reset} <subcommand>

  View system information.

  ${colors.bold}SUBCOMMANDS${colors.reset}
    status     Show kernel uptime, subsystems, process count
    metrics    Show CPU, memory, disk, network usage
`,

  templates: `${colors.bold}aether templates${colors.reset} <subcommand>

  Browse agent templates.

  ${colors.bold}SUBCOMMANDS${colors.reset}
    list       List available templates
`,

  cron: `${colors.bold}aether cron${colors.reset} <subcommand>

  Manage scheduled cron jobs.

  ${colors.bold}SUBCOMMANDS${colors.reset}
    list       List cron jobs
    create     Create job: aether cron create <name> --expression="0 * * * *" --role=X --goal="Y"
    delete     Delete job: aether cron delete <id>
`,

  webhooks: `${colors.bold}aether webhooks${colors.reset} <subcommand>

  Manage event webhooks/triggers.

  ${colors.bold}SUBCOMMANDS${colors.reset}
    list       List webhooks
    create     Create: aether webhooks create <name> --event=X --role=Y --goal="Z"
    delete     Delete: aether webhooks delete <id>
`,
};

export function runHelp(args: ParsedArgs): void {
  const topic =
    args.positional[1] || (args.positional[0] === 'help' ? args.positional[1] : undefined);

  if (topic && COMMAND_HELP[topic]) {
    process.stdout.write(COMMAND_HELP[topic] + '\n');
  } else if (topic) {
    process.stdout.write(
      `No help available for "${topic}". Run "aether help" for general usage.\n`,
    );
  } else {
    process.stdout.write(GENERAL_HELP);
  }
}
