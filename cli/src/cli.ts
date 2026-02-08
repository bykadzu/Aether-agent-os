#!/usr/bin/env node

/**
 * Aether CLI - Command-line interface for Aether OS
 *
 * Hand-rolled argument parser with no third-party dependencies.
 * Uses @aether/sdk as the API client.
 */

import { AetherClient, AetherApiError } from '@aether/sdk';
import { loadConfig, type CLIConfig } from './config.js';
import { colors, formatTable, printError, printSuccess, printWarn } from './format.js';
import { runLogin } from './commands/login.js';
import { runAgents } from './commands/agents.js';
import { runFs } from './commands/fs.js';
import { runSystem } from './commands/system.js';
import { runTemplates } from './commands/templates.js';
import { runCron } from './commands/cron.js';
import { runWebhooks } from './commands/webhooks.js';
import { runIntegrations } from './commands/integrations.js';
import { runVersion } from './commands/version.js';
import { runHelp } from './commands/help.js';

// Re-export format utilities for command modules
export { colors, formatTable, printError, printSuccess, printWarn };

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      // Everything after -- is positional
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        // --flag or --key value
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag: -f or -f value
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createClient(config: CLIConfig): AetherClient {
  if (!config.server) {
    throw new Error('Not logged in. Run: aether login <server-url> --username=X --password=X');
  }
  return new AetherClient({
    baseUrl: config.server,
    token: config.token,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const command = args.positional[0];

  const config = loadConfig();

  try {
    switch (command) {
      case 'login':
        await runLogin(args, config);
        break;
      case 'agents':
        await runAgents(args, config);
        break;
      case 'fs':
        await runFs(args, config);
        break;
      case 'system':
        await runSystem(args, config);
        break;
      case 'templates':
        await runTemplates(args, config);
        break;
      case 'cron':
        await runCron(args, config);
        break;
      case 'webhooks':
        await runWebhooks(args, config);
        break;
      case 'integrations':
        await runIntegrations(args, config);
        break;
      case 'version':
        runVersion(args);
        break;
      case 'help':
      case undefined:
        runHelp(args);
        break;
      default:
        printError(`Unknown command: ${command}`);
        printWarn('Run "aether help" for usage information.');
        process.exitCode = 1;
    }
  } catch (err: unknown) {
    if (err instanceof AetherApiError) {
      if (args.flags['json'] === true) {
        process.stdout.write(
          JSON.stringify({ error: { code: err.code, message: err.message, status: err.status } }) +
            '\n',
        );
      } else {
        printError(`[${err.code}] ${err.message} (HTTP ${err.status})`);
      }
      process.exitCode = 1;
    } else if (err instanceof Error) {
      if (args.flags['json'] === true) {
        process.stdout.write(JSON.stringify({ error: { message: err.message } }) + '\n');
      } else {
        printError(err.message);
      }
      process.exitCode = 1;
    } else {
      printError(String(err));
      process.exitCode = 1;
    }
  }
}

// Run if invoked directly
const isDirectRun =
  typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isDirectRun) {
  main(process.argv);
}
