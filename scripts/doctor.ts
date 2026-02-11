#!/usr/bin/env npx tsx
/**
 * Aether OS — Doctor Diagnostic Tool
 *
 * Checks system prerequisites and configuration health.
 * Run with: npm run doctor
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function ok(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}
function fail(msg: string): void {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

function commandExists(cmd: string): string | null {
  try {
    const output = execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, {
      stdio: 'pipe',
      timeout: 5000,
    })
      .toString()
      .trim();
    return output.split('\n')[0];
  } catch {
    return null;
  }
}

function getCommandVersion(cmd: string, flag = '--version'): string | null {
  try {
    return execSync(`${cmd} ${flag}`, { stdio: 'pipe', timeout: 5000 })
      .toString()
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = getCommandVersion('node');
  if (!version)
    return {
      name: 'Node.js',
      status: 'fail',
      message: 'Node.js not found',
      fix: 'Install Node.js >= 22 from https://nodejs.org',
    };
  const major = parseInt(version.replace(/^v/, ''), 10);
  if (major >= 22) return { name: 'Node.js', status: 'ok', message: `${version}` };
  return {
    name: 'Node.js',
    status: 'fail',
    message: `${version} (need >= 22)`,
    fix: 'Upgrade Node.js to >= 22',
  };
}

async function checkNpm(): Promise<CheckResult> {
  const version = getCommandVersion('npm');
  if (!version)
    return {
      name: 'npm',
      status: 'fail',
      message: 'npm not found',
      fix: 'Install npm (comes with Node.js)',
    };
  return { name: 'npm', status: 'ok', message: `npm ${version}` };
}

async function checkDocker(): Promise<CheckResult> {
  if (!commandExists('docker')) {
    return {
      name: 'Docker',
      status: 'warn',
      message: 'Not installed (agents will use process mode)',
      fix: 'Install Docker: https://docs.docker.com/get-docker/',
    };
  }
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return { name: 'Docker', status: 'ok', message: 'Installed and running' };
  } catch {
    return {
      name: 'Docker',
      status: 'warn',
      message: 'Installed but not running',
      fix: 'Start Docker Desktop or the Docker daemon',
    };
  }
}

async function checkPlaywright(): Promise<CheckResult> {
  // Check common Playwright browser cache locations
  const cacheLocations = [
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers'),
  ];
  for (const loc of cacheLocations) {
    if (fs.existsSync(loc)) {
      const entries = fs.readdirSync(loc);
      if (entries.some((e) => e.startsWith('chromium'))) {
        return { name: 'Playwright', status: 'ok', message: `Chromium found in ${loc}` };
      }
    }
  }
  return {
    name: 'Playwright',
    status: 'warn',
    message: 'Chromium browser not found (web browsing disabled for agents)',
    fix: 'Run: npx playwright install chromium',
  };
}

async function checkEnvFile(): Promise<CheckResult> {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return {
      name: '.env file',
      status: 'warn',
      message: 'Not found',
      fix: 'Run: cp .env.example .env',
    };
  }
  return { name: '.env file', status: 'ok', message: 'Found' };
}

async function checkApiKeys(): Promise<CheckResult> {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return {
      name: 'LLM API Key',
      status: 'warn',
      message: 'No .env file — agents will use Ollama fallback',
      fix: 'Add at least one API key to .env (GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)',
    };
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const keys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const configured = keys.filter((k) => {
    const match = content.match(new RegExp(`^${k}=(.+)$`, 'm'));
    return match && match[1].trim().length > 0;
  });
  if (configured.length > 0) {
    return { name: 'LLM API Key', status: 'ok', message: `${configured.join(', ')} configured` };
  }
  // Check if Ollama is available
  if (commandExists('ollama')) {
    return {
      name: 'LLM API Key',
      status: 'ok',
      message: 'No cloud API keys, but Ollama is available',
    };
  }
  return {
    name: 'LLM API Key',
    status: 'warn',
    message: 'No API keys configured — agents need at least one LLM provider',
    fix: 'Add GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to .env',
  };
}

async function checkPortAvailable(): Promise<CheckResult> {
  const port = parseInt(process.env.AETHER_PORT || '3001', 10);
  const available = await checkPort(port);
  if (available) return { name: `Port ${port}`, status: 'ok', message: 'Available' };
  return {
    name: `Port ${port}`,
    status: 'warn',
    message: 'In use (kernel may already be running, or another service is using it)',
    fix: `Set AETHER_PORT in .env to use a different port`,
  };
}

async function checkDataDir(): Promise<CheckResult> {
  const dataRoot = process.env.AETHER_FS_ROOT || path.join(os.homedir(), '.aether');
  if (!fs.existsSync(dataRoot)) {
    return {
      name: 'Data directory',
      status: 'ok',
      message: `${dataRoot} (will be created on first boot)`,
    };
  }
  try {
    const testFile = path.join(dataRoot, '.doctor-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return { name: 'Data directory', status: 'ok', message: `${dataRoot} (writable)` };
  } catch {
    return {
      name: 'Data directory',
      status: 'fail',
      message: `${dataRoot} is not writable`,
      fix: `Fix permissions: chmod 755 ${dataRoot}`,
    };
  }
}

async function checkDiskSpace(): Promise<CheckResult> {
  try {
    if (process.platform === 'win32') {
      const output = execSync('wmic logicaldisk get freespace,caption', {
        stdio: 'pipe',
        timeout: 5000,
      }).toString();
      const lines = output.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0].includes(':')) {
          const freeBytes = parseInt(parts[1], 10);
          const freeMB = Math.round(freeBytes / (1024 * 1024));
          if (freeMB > 500)
            return { name: 'Disk space', status: 'ok', message: `${freeMB}MB free on ${parts[0]}` };
        }
      }
    } else {
      const output = execSync('df -m / | tail -1', { stdio: 'pipe', timeout: 5000 }).toString();
      const parts = output.trim().split(/\s+/);
      const freeMB = parseInt(parts[3], 10);
      if (freeMB > 500) return { name: 'Disk space', status: 'ok', message: `${freeMB}MB free` };
      return {
        name: 'Disk space',
        status: 'warn',
        message: `${freeMB}MB free (low)`,
        fix: 'Free up disk space (recommend >= 500MB)',
      };
    }
  } catch {
    /* ignore */
  }
  return { name: 'Disk space', status: 'ok', message: 'Unable to check (assuming sufficient)' };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n${BOLD}Aether OS — Doctor${RESET}\n`);

  const checks = [
    checkNodeVersion,
    checkNpm,
    checkDocker,
    checkPlaywright,
    checkEnvFile,
    checkApiKeys,
    checkPortAvailable,
    checkDataDir,
    checkDiskSpace,
  ];

  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await check();
    results.push(result);
    if (result.status === 'ok')
      ok(result.message ? `${result.name}: ${result.message}` : result.name);
    else if (result.status === 'warn')
      warn(result.message ? `${result.name}: ${result.message}` : result.name);
    else fail(result.message ? `${result.name}: ${result.message}` : result.name);
  }

  // Print fixes for non-ok results
  const fixable = results.filter((r) => r.status !== 'ok' && r.fix);
  if (fixable.length > 0) {
    console.log(`\n${BOLD}Suggested fixes:${RESET}`);
    for (const r of fixable) {
      console.log(`  → ${r.name}: ${r.fix}`);
    }
  }

  const failCount = results.filter((r) => r.status === 'fail').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  console.log();
  if (failCount > 0) {
    console.log(
      `${RED}${failCount} critical issue(s) found.${RESET} Fix these before running Aether OS.`,
    );
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(
      `${YELLOW}${warnCount} warning(s).${RESET} Aether OS will work but some features may be limited.`,
    );
  } else {
    console.log(`${GREEN}All checks passed!${RESET} Run ${BOLD}npm run dev:full${RESET} to start.`);
  }
  console.log();
}

main().catch(console.error);
