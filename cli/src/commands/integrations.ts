/**
 * aether integrations <subcommand>
 *
 * Subcommands: list, test, exec
 *
 * Manages external service integrations (S3, Discord, GitHub, Slack, etc.).
 * Uses direct HTTP calls to the Aether API server.
 */

import type { ParsedArgs } from '../cli.js';
import { formatTable, printSuccess, printError } from '../format.js';
import type { CLIConfig } from '../config.js';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiGet(config: CLIConfig, path: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
  const res = await fetch(`${config.server}${path}`, { headers });
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

async function apiPost(config: CLIConfig, path: string, body?: any): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
  const res = await fetch(`${config.server}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

// ---------------------------------------------------------------------------
// Main command dispatcher
// ---------------------------------------------------------------------------

export async function runIntegrations(args: ParsedArgs, config: CLIConfig): Promise<void> {
  if (!config.server) {
    printError('Not logged in. Run: aether login <server-url> --username=X --password=X');
    process.exitCode = 1;
    return;
  }

  const sub = args.positional[1];

  switch (sub) {
    case 'list':
      return integrationsList(args, config);
    case 'test':
      return integrationsTest(args, config);
    case 'exec':
      return integrationsExec(args, config);
    default:
      printError(
        `Unknown integrations subcommand: ${sub || '(none)'}. Available: list, test, exec`,
      );
      process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function integrationsList(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const integrations = await apiGet(config, '/api/integrations');

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(integrations) + '\n');
    return;
  }

  if (!integrations || !Array.isArray(integrations) || integrations.length === 0) {
    process.stdout.write('No integrations found.\n');
    return;
  }

  const rows = integrations.map((i: any) => [
    i.id || '-',
    i.type || '-',
    i.name || '-',
    i.status || 'disconnected',
    String(i.available_actions?.length ?? 0),
  ]);

  process.stdout.write(formatTable(['ID', 'TYPE', 'NAME', 'STATUS', 'ACTIONS'], rows) + '\n');
}

async function integrationsTest(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const id = args.positional[2];

  if (!id) {
    printError('Usage: aether integrations test <id>');
    process.exitCode = 1;
    return;
  }

  const result = await apiPost(config, `/api/integrations/${id}/test`);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }

  if (result.success) {
    printSuccess(`Connection test passed: ${result.message}`);
  } else {
    printError(`Connection test failed: ${result.message}`);
    process.exitCode = 1;
  }
}

async function integrationsExec(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const id = args.positional[2];
  const action = args.positional[3];

  if (!id || !action) {
    printError('Usage: aether integrations exec <id> <action> [--param key=value ...]');
    process.exitCode = 1;
    return;
  }

  // Gather params from --param flags (format: key=value)
  const params: Record<string, string> = {};
  const paramValues = args.flags['param'];
  if (typeof paramValues === 'string') {
    const eqIdx = paramValues.indexOf('=');
    if (eqIdx !== -1) {
      params[paramValues.slice(0, eqIdx)] = paramValues.slice(eqIdx + 1);
    }
  }

  // Also gather any other flags that are not reserved
  const reserved = new Set(['json', 'param']);
  for (const [key, value] of Object.entries(args.flags)) {
    if (!reserved.has(key) && typeof value === 'string') {
      params[key] = value;
    }
  }

  const result = await apiPost(config, `/api/integrations/${id}/execute`, {
    action,
    params,
  });

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Action ${action} executed successfully.`);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}
