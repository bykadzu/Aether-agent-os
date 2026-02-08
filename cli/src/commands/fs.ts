/**
 * aether fs <subcommand> [args]
 *
 * Subcommands: ls, cat, write, rm
 */

import type { ParsedArgs } from '../cli.js';
import { createClient } from '../cli.js';
import { formatTable, printSuccess, printError } from '../format.js';
import type { CLIConfig } from '../config.js';

export async function runFs(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const sub = args.positional[1];

  switch (sub) {
    case 'ls':
      return fsLs(args, config);
    case 'cat':
      return fsCat(args, config);
    case 'write':
      return fsWrite(args, config);
    case 'rm':
      return fsRm(args, config);
    default:
      printError(`Unknown fs subcommand: ${sub || '(none)'}. Available: ls, cat, write, rm`);
      process.exitCode = 1;
  }
}

async function fsLs(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const path = args.positional[2] || '/';

  const result = await client.fs.read(path);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }

  // The result may be an array of entries or a directory listing
  const entries = Array.isArray(result) ? result : result?.entries || result?.children || [result];

  if (!entries.length) {
    process.stdout.write('Empty directory.\n');
    return;
  }

  const rows = entries.map((e: any) => [
    e.name || e.path || '-',
    formatSize(e.size),
    e.type || '-',
    formatTimestamp(e.modifiedAt),
  ]);

  process.stdout.write(formatTable(['NAME', 'SIZE', 'TYPE', 'MODIFIED'], rows) + '\n');
}

async function fsCat(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const path = args.positional[2];

  if (!path) {
    printError('Usage: aether fs cat <path>');
    process.exitCode = 1;
    return;
  }

  const result = await client.fs.read(path);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    const content = typeof result === 'string' ? result : result?.content || JSON.stringify(result);
    process.stdout.write(content + '\n');
  }
}

async function fsWrite(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const path = args.positional[2];

  if (!path) {
    printError('Usage: aether fs write <path> [--stdin]');
    process.exitCode = 1;
    return;
  }

  let content: string;

  if (args.flags['stdin'] === true) {
    content = await readStdin();
  } else {
    const contentArg = args.positional[3];
    if (!contentArg) {
      printError('Provide content as argument or use --stdin to read from stdin');
      process.exitCode = 1;
      return;
    }
    content = contentArg;
  }

  const result = await client.fs.write(path, content);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Written: ${path}`);
  }
}

async function fsRm(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const client = createClient(config);
  const path = args.positional[2];

  if (!path) {
    printError('Usage: aether fs rm <path>');
    process.exitCode = 1;
    return;
  }

  const result = await client.fs.delete(path);

  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    printSuccess(`Deleted: ${path}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
