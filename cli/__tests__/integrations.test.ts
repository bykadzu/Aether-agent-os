import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runIntegrations } from '../src/commands/integrations.js';
import type { ParsedArgs } from '../src/cli.js';
import type { CLIConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

// ---------------------------------------------------------------------------
// Capture stdout/stderr
// ---------------------------------------------------------------------------
let stdoutOutput: string;
let stderrOutput: string;
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

function captureOutput() {
  stdoutOutput = '';
  stderrOutput = '';
  originalStdoutWrite = process.stdout.write;
  originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: any) => {
    stdoutOutput += String(chunk);
    return true;
  }) as any;
  process.stderr.write = ((chunk: any) => {
    stderrOutput += String(chunk);
    return true;
  }) as any;
}

function restoreOutput() {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------
const config: CLIConfig = {
  server: 'http://localhost:3001',
  token: 'test-token',
  username: 'admin',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integrations command', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.exitCode = undefined;
    captureOutput();
  });

  afterEach(() => {
    restoreOutput();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('displays integrations in a table', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            {
              id: 'int-1',
              type: 'github',
              name: 'My GitHub',
              status: 'connected',
              available_actions: [{ name: 'github.list_repos' }],
            },
            {
              id: 'int-2',
              type: 's3',
              name: 'My S3',
              status: 'disconnected',
              available_actions: [{ name: 's3.list_buckets' }, { name: 's3.get_object' }],
            },
          ],
        }),
      );

      const args: ParsedArgs = { positional: ['integrations', 'list'], flags: {} };
      await runIntegrations(args, config);

      expect(stdoutOutput).toContain('ID');
      expect(stdoutOutput).toContain('TYPE');
      expect(stdoutOutput).toContain('NAME');
      expect(stdoutOutput).toContain('STATUS');
      expect(stdoutOutput).toContain('ACTIONS');
      expect(stdoutOutput).toContain('int-1');
      expect(stdoutOutput).toContain('github');
      expect(stdoutOutput).toContain('My GitHub');
      expect(stdoutOutput).toContain('connected');
    });

    it('outputs JSON with --json flag', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [{ id: 'int-1', type: 's3', name: 'My S3', status: 'connected' }],
        }),
      );

      const args: ParsedArgs = {
        positional: ['integrations', 'list'],
        flags: { json: true },
      };
      await runIntegrations(args, config);

      const json = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(json)).toBe(true);
      expect(json[0].type).toBe('s3');
    });

    it('shows message when no integrations found', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));

      const args: ParsedArgs = { positional: ['integrations', 'list'], flags: {} };
      await runIntegrations(args, config);

      expect(stdoutOutput).toContain('No integrations found');
    });
  });

  // -------------------------------------------------------------------------
  // test
  // -------------------------------------------------------------------------

  describe('test', () => {
    it('displays success result', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: { success: true, message: 'Connected as bot' } }),
      );

      const args: ParsedArgs = {
        positional: ['integrations', 'test', 'int-1'],
        flags: {},
      };
      await runIntegrations(args, config);

      expect(stdoutOutput).toContain('Connection test passed');
      expect(stdoutOutput).toContain('Connected as bot');
    });

    it('displays failure result', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: { success: false, message: 'Invalid token' } }),
      );

      const args: ParsedArgs = {
        positional: ['integrations', 'test', 'int-1'],
        flags: {},
      };
      await runIntegrations(args, config);

      expect(stderrOutput).toContain('Connection test failed');
      expect(stderrOutput).toContain('Invalid token');
      expect(process.exitCode).toBe(1);
    });

    it('errors on missing id', async () => {
      const args: ParsedArgs = {
        positional: ['integrations', 'test'],
        flags: {},
      };
      await runIntegrations(args, config);

      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // exec
  // -------------------------------------------------------------------------

  describe('exec', () => {
    it('executes an action and displays result', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: { ok: true, channels: [{ id: 'C1' }] } }),
      );

      const args: ParsedArgs = {
        positional: ['integrations', 'exec', 'int-1', 'slack.list_channels'],
        flags: { limit: '50' },
      };
      await runIntegrations(args, config);

      expect(stdoutOutput).toContain('executed successfully');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/integrations/int-1/execute');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.action).toBe('slack.list_channels');
      expect(body.params.limit).toBe('50');
    });

    it('outputs JSON with --json flag', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { result: 'ok' } }));

      const args: ParsedArgs = {
        positional: ['integrations', 'exec', 'int-1', 's3.list_buckets'],
        flags: { json: true },
      };
      await runIntegrations(args, config);

      const json = JSON.parse(stdoutOutput.trim());
      expect(json.result).toBe('ok');
    });

    it('errors on missing id or action', async () => {
      const args: ParsedArgs = {
        positional: ['integrations', 'exec', 'int-1'],
        flags: {},
      };
      await runIntegrations(args, config);

      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('errors on unknown subcommand', async () => {
      const args: ParsedArgs = {
        positional: ['integrations', 'unknown'],
        flags: {},
      };
      await runIntegrations(args, config);

      expect(stderrOutput).toContain('Unknown integrations subcommand');
      expect(process.exitCode).toBe(1);
    });

    it('errors when not logged in', async () => {
      const args: ParsedArgs = {
        positional: ['integrations', 'list'],
        flags: {},
      };
      await runIntegrations(args, { server: undefined, token: undefined });

      expect(stderrOutput).toContain('Not logged in');
      expect(process.exitCode).toBe(1);
    });
  });
});
