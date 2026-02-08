/**
 * aether version
 */

import type { ParsedArgs } from '../cli.js';

export function runVersion(args: ParsedArgs): void {
  const version = 'aether-cli v0.4.0';
  if (args.flags['json'] === true) {
    process.stdout.write(JSON.stringify({ version: '0.4.0' }) + '\n');
  } else {
    process.stdout.write(version + '\n');
  }
}
