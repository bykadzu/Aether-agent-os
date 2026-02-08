/**
 * aether login <server-url> --username=X --password=X
 */

import { AetherClient } from '@aether/sdk';
import type { ParsedArgs } from '../cli.js';
import { printSuccess, printError } from '../format.js';
import { saveConfig, type CLIConfig } from '../config.js';

export async function runLogin(args: ParsedArgs, config: CLIConfig): Promise<void> {
  const serverUrl = args.positional[1];
  const username = args.flags['username'] as string | undefined;
  const password = args.flags['password'] as string | undefined;

  if (!serverUrl) {
    printError('Missing server URL. Usage: aether login <server-url> --username=X --password=X');
    process.exitCode = 1;
    return;
  }

  if (!username || !password) {
    printError('Missing credentials. Usage: aether login <server-url> --username=X --password=X');
    process.exitCode = 1;
    return;
  }

  const client = new AetherClient({ baseUrl: serverUrl });
  const result = await client.login(username, password);

  const newConfig: CLIConfig = {
    ...config,
    server: serverUrl,
    token: result.token,
    username,
  };
  saveConfig(newConfig);

  if (args.flags['json'] === true) {
    process.stdout.write(
      JSON.stringify({ server: serverUrl, username, token: result.token }) + '\n',
    );
  } else {
    printSuccess(`Logged in to ${serverUrl} as ${username}`);
  }
}
