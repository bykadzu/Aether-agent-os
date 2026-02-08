/**
 * CLI Configuration management
 *
 * Reads/writes ~/.aether/config.json for persistent configuration
 * such as server URL and auth token.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CLIConfig {
  server?: string;
  token?: string;
  username?: string;
}

export function getConfigDir(): string {
  return join(homedir(), '.aether');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): CLIConfig {
  try {
    const raw = readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(raw) as CLIConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: CLIConfig): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
