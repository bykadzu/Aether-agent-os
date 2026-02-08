import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, formatTable, main } from '../src/cli';
import * as configModule from '../src/config';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// ---------------------------------------------------------------------------
// Mock config module
// ---------------------------------------------------------------------------
vi.mock('../src/config', async () => {
  let storedConfig: any = {};
  return {
    loadConfig: vi.fn(() => storedConfig),
    saveConfig: vi.fn((cfg: any) => {
      storedConfig = cfg;
    }),
    getConfigDir: vi.fn(() => '/tmp/.aether'),
    getConfigPath: vi.fn(() => '/tmp/.aether/config.json'),
    __setConfig: (cfg: any) => {
      storedConfig = cfg;
    },
  };
});

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
// Tests
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses positional arguments', () => {
    const result = parseArgs(['agents', 'list']);
    expect(result.positional).toEqual(['agents', 'list']);
    expect(result.flags).toEqual({});
  });

  it('parses --key=value flags', () => {
    const result = parseArgs(['agents', 'list', '--status=running', '--limit=10']);
    expect(result.positional).toEqual(['agents', 'list']);
    expect(result.flags['status']).toBe('running');
    expect(result.flags['limit']).toBe('10');
  });

  it('parses --key value flags', () => {
    const result = parseArgs(['agents', 'list', '--status', 'running']);
    expect(result.positional).toEqual(['agents', 'list']);
    expect(result.flags['status']).toBe('running');
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['agents', 'logs', 'uid', '--follow', '--json']);
    expect(result.positional).toEqual(['agents', 'logs', 'uid']);
    expect(result.flags['follow']).toBe(true);
    expect(result.flags['json']).toBe(true);
  });

  it('parses short flags', () => {
    const result = parseArgs(['agents', 'logs', 'uid', '-f']);
    expect(result.flags['f']).toBe(true);
  });

  it('handles -- separator', () => {
    const result = parseArgs(['cmd', '--', '--not-a-flag', 'value']);
    expect(result.positional).toEqual(['cmd', '--not-a-flag', 'value']);
    expect(result.flags).toEqual({});
  });

  it('handles mixed positional and flags', () => {
    const result = parseArgs([
      'agents',
      'spawn',
      'researcher',
      'Find papers',
      '--model=gemini:flash',
      '--max-steps=50',
    ]);
    expect(result.positional).toEqual(['agents', 'spawn', 'researcher', 'Find papers']);
    expect(result.flags['model']).toBe('gemini:flash');
    expect(result.flags['max-steps']).toBe('50');
  });

  it('handles empty argv', () => {
    const result = parseArgs([]);
    expect(result.positional).toEqual([]);
    expect(result.flags).toEqual({});
  });
});

describe('formatTable', () => {
  it('formats a table with headers and rows', () => {
    const headers = ['NAME', 'STATUS'];
    const rows = [
      ['agent-1', 'running'],
      ['agent-2', 'completed'],
    ];
    const output = formatTable(headers, rows);
    expect(output).toContain('NAME');
    expect(output).toContain('STATUS');
    expect(output).toContain('agent-1');
    expect(output).toContain('running');
    expect(output).toContain('----');
  });

  it('handles empty rows', () => {
    const output = formatTable(['A', 'B'], []);
    expect(output).toContain('A');
    expect(output).toContain('B');
    // Should have header + separator only
    const lines = output.split('\n');
    expect(lines.length).toBe(2);
  });

  it('pads columns to longest value', () => {
    const output = formatTable(
      ['ID', 'NAME'],
      [
        ['1', 'very-long-name'],
        ['2', 'x'],
      ],
    );
    const lines = output.split('\n');
    // All data lines should have the same length structure
    expect(lines[2]).toContain('very-long-name');
    expect(lines[3]).toContain('x');
  });
});

describe('CLI commands', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.exitCode = undefined;
    captureOutput();
    // Set up default logged-in config
    (configModule as any).__setConfig({
      server: 'http://localhost:3001',
      token: 'test-token',
      username: 'admin',
    });
  });

  afterEach(() => {
    restoreOutput();
  });

  // -------------------------------------------------------------------------
  // version
  // -------------------------------------------------------------------------

  describe('version', () => {
    it('prints version string', async () => {
      await main(['node', 'aether', 'version']);
      expect(stdoutOutput).toContain('aether-cli v0.4.0');
    });

    it('outputs JSON with --json flag', async () => {
      await main(['node', 'aether', 'version', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(json.version).toBe('0.4.0');
    });
  });

  // -------------------------------------------------------------------------
  // help
  // -------------------------------------------------------------------------

  describe('help', () => {
    it('prints general help with no command', async () => {
      await main(['node', 'aether', 'help']);
      expect(stdoutOutput).toContain('USAGE');
      expect(stdoutOutput).toContain('COMMANDS');
      expect(stdoutOutput).toContain('agents');
      expect(stdoutOutput).toContain('login');
    });

    it('prints command-specific help', async () => {
      await main(['node', 'aether', 'help', 'agents']);
      expect(stdoutOutput).toContain('spawn');
      expect(stdoutOutput).toContain('kill');
      expect(stdoutOutput).toContain('logs');
    });

    it('prints fallback for unknown help topic', async () => {
      await main(['node', 'aether', 'help', 'nonexistent']);
      expect(stdoutOutput).toContain('No help available');
    });
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  describe('login', () => {
    it('logs in and saves config', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ token: 'jwt-abc', user: { id: '1', username: 'admin' } }),
      );

      await main([
        'node',
        'aether',
        'login',
        'http://localhost:3001',
        '--username=admin',
        '--password=secret',
      ]);

      expect(stdoutOutput).toContain('Logged in');
      expect(configModule.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          server: 'http://localhost:3001',
          token: 'jwt-abc',
          username: 'admin',
        }),
      );
    });

    it('errors on missing server URL', async () => {
      await main(['node', 'aether', 'login']);
      expect(stderrOutput).toContain('Missing server URL');
      expect(process.exitCode).toBe(1);
    });

    it('errors on missing credentials', async () => {
      await main(['node', 'aether', 'login', 'http://localhost:3001']);
      expect(stderrOutput).toContain('Missing credentials');
      expect(process.exitCode).toBe(1);
    });

    it('outputs JSON with --json', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ token: 'jwt-abc', user: { id: '1', username: 'admin' } }),
      );

      await main([
        'node',
        'aether',
        'login',
        'http://localhost:3001',
        '--username=admin',
        '--password=secret',
        '--json',
      ]);

      const json = JSON.parse(stdoutOutput.trim());
      expect(json.token).toBe('jwt-abc');
      expect(json.server).toBe('http://localhost:3001');
    });
  });

  // -------------------------------------------------------------------------
  // agents
  // -------------------------------------------------------------------------

  describe('agents', () => {
    it('agents list displays table', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            {
              uid: 'agent-1',
              role: 'researcher',
              goal: 'Find papers',
              agentPhase: 'thinking',
              step: 3,
              createdAt: 1700000000000,
            },
          ],
        }),
      );

      await main(['node', 'aether', 'agents', 'list']);
      expect(stdoutOutput).toContain('UID');
      expect(stdoutOutput).toContain('agent-1');
      expect(stdoutOutput).toContain('researcher');
    });

    it('agents list --json outputs JSON array', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ uid: 'agent-1' }] }));

      await main(['node', 'aether', 'agents', 'list', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(json)).toBe(true);
      expect(json[0].uid).toBe('agent-1');
    });

    it('agents list passes status and limit params', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));

      await main(['node', 'aether', 'agents', 'list', '--status=running', '--limit=5']);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('status=running');
      expect(url).toContain('limit=5');
    });

    it('agents spawn sends correct request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { uid: 'agent-new', pid: 42 } }));

      await main([
        'node',
        'aether',
        'agents',
        'spawn',
        'researcher',
        'Find AI papers',
        '--model=gemini:flash',
        '--max-steps=50',
      ]);

      expect(stdoutOutput).toContain('Agent spawned');
      expect(stdoutOutput).toContain('agent-new');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.role).toBe('researcher');
      expect(body.goal).toBe('Find AI papers');
      expect(body.model).toBe('gemini:flash');
      expect(body.maxSteps).toBe(50);
    });

    it('agents spawn errors on missing args', async () => {
      await main(['node', 'aether', 'agents', 'spawn']);
      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });

    it('agents get displays agent details', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: {
            uid: 'agent-1',
            role: 'coder',
            goal: 'Build feature',
            state: 'running',
            agentPhase: 'executing',
            model: 'gemini:flash',
            step: 5,
            createdAt: 1700000000000,
          },
        }),
      );

      await main(['node', 'aether', 'agents', 'get', 'agent-1']);
      expect(stdoutOutput).toContain('agent-1');
      expect(stdoutOutput).toContain('coder');
      expect(stdoutOutput).toContain('Build feature');
    });

    it('agents get errors on missing uid', async () => {
      await main(['node', 'aether', 'agents', 'get']);
      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });

    it('agents kill sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { pid: 1, signal: 'SIGTERM' } }));

      await main(['node', 'aether', 'agents', 'kill', 'agent-1']);
      expect(stdoutOutput).toContain('terminated');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('agents logs fetches timeline', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            { phase: 'thought', content: 'Analyzing...', timestamp: 1700000000000 },
            { phase: 'action', tool: 'search', content: 'Searching', timestamp: 1700000001000 },
          ],
        }),
      );

      await main(['node', 'aether', 'agents', 'logs', 'agent-1', '--limit=10']);
      expect(stdoutOutput).toContain('thought');
      expect(stdoutOutput).toContain('Analyzing...');
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=10');
    });

    it('agents message sends POST', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { delivered: true } }));

      await main(['node', 'aether', 'agents', 'message', 'agent-1', 'Hello agent']);
      expect(stdoutOutput).toContain('Message sent');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toBe('Hello agent');
    });

    it('agents message errors on missing args', async () => {
      await main(['node', 'aether', 'agents', 'message', 'agent-1']);
      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });

    it('unknown agents subcommand errors', async () => {
      await main(['node', 'aether', 'agents', 'unknown']);
      expect(stderrOutput).toContain('Unknown agents subcommand');
      expect(process.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // fs
  // -------------------------------------------------------------------------

  describe('fs', () => {
    it('fs ls displays directory listing', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            { name: 'file.txt', size: 1024, type: 'file', modifiedAt: 1700000000000 },
            { name: 'subdir', size: 0, type: 'directory', modifiedAt: 1700000000000 },
          ],
        }),
      );

      await main(['node', 'aether', 'fs', 'ls', '/home']);
      expect(stdoutOutput).toContain('NAME');
      expect(stdoutOutput).toContain('file.txt');
      expect(stdoutOutput).toContain('subdir');
    });

    it('fs cat prints file content', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { content: 'Hello, World!' } }));

      await main(['node', 'aether', 'fs', 'cat', '/home/test.txt']);
      expect(stdoutOutput).toContain('Hello, World!');
    });

    it('fs cat errors on missing path', async () => {
      await main(['node', 'aether', 'fs', 'cat']);
      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });

    it('fs write sends PUT request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { written: true } }));

      await main(['node', 'aether', 'fs', 'write', '/home/test.txt', 'new content']);
      expect(stdoutOutput).toContain('Written');
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    });

    it('fs rm sends DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));

      await main(['node', 'aether', 'fs', 'rm', '/home/test.txt']);
      expect(stdoutOutput).toContain('Deleted');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('fs rm errors on missing path', async () => {
      await main(['node', 'aether', 'fs', 'rm']);
      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // system
  // -------------------------------------------------------------------------

  describe('system', () => {
    it('system status displays system info', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: { version: '0.4.0', uptime: 3600000, processCount: 5, containerCount: 2 },
        }),
      );

      await main(['node', 'aether', 'system', 'status']);
      expect(stdoutOutput).toContain('System Status');
      expect(stdoutOutput).toContain('0.4.0');
      expect(stdoutOutput).toContain('1h');
    });

    it('system status --json outputs JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: { version: '0.4.0', uptime: 3600000 } }),
      );

      await main(['node', 'aether', 'system', 'status', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(json.version).toBe('0.4.0');
    });

    it('system metrics displays metrics', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: {
            cpuPercent: 15.5,
            memoryMB: 512,
            processCount: 8,
          },
        }),
      );

      await main(['node', 'aether', 'system', 'metrics']);
      expect(stdoutOutput).toContain('Metrics');
      expect(stdoutOutput).toContain('15.5');
    });

    it('unknown system subcommand errors', async () => {
      await main(['node', 'aether', 'system', 'unknown']);
      expect(stderrOutput).toContain('Unknown system subcommand');
      expect(process.exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // templates
  // -------------------------------------------------------------------------

  describe('templates', () => {
    it('templates list displays table', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            { id: 't1', name: 'Researcher', config: { role: 'researcher', tools: ['search'] } },
          ],
        }),
      );

      await main(['node', 'aether', 'templates', 'list']);
      expect(stdoutOutput).toContain('ID');
      expect(stdoutOutput).toContain('t1');
      expect(stdoutOutput).toContain('Researcher');
    });

    it('templates list --json outputs JSON', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ id: 't1' }] }));

      await main(['node', 'aether', 'templates', 'list', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(json)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // cron
  // -------------------------------------------------------------------------

  describe('cron', () => {
    it('cron list displays table', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            {
              id: 'c1',
              name: 'daily-check',
              cron_expression: '0 0 * * *',
              enabled: true,
              run_count: 5,
            },
          ],
        }),
      );

      await main(['node', 'aether', 'cron', 'list']);
      expect(stdoutOutput).toContain('daily-check');
      expect(stdoutOutput).toContain('0 0 * * *');
      expect(stdoutOutput).toContain('enabled');
    });

    it('cron create sends POST', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'c2' } }));

      await main([
        'node',
        'aether',
        'cron',
        'create',
        'hourly-scan',
        '--expression=0 * * * *',
        '--role=scanner',
        '--goal=Scan for issues',
      ]);

      expect(stdoutOutput).toContain('Cron job created');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.name).toBe('hourly-scan');
      expect(body.expression).toBe('0 * * * *');
    });

    it('cron create errors on missing args', async () => {
      await main(['node', 'aether', 'cron', 'create', 'test']);
      expect(stderrOutput).toContain('Usage');
      expect(process.exitCode).toBe(1);
    });

    it('cron delete sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));

      await main(['node', 'aether', 'cron', 'delete', 'c1']);
      expect(stdoutOutput).toContain('Cron job deleted');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // -------------------------------------------------------------------------
  // webhooks
  // -------------------------------------------------------------------------

  describe('webhooks', () => {
    it('webhooks list displays table', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: [
            {
              id: 'w1',
              name: 'on-push',
              event_type: 'github.push',
              enabled: true,
              fire_count: 12,
            },
          ],
        }),
      );

      await main(['node', 'aether', 'webhooks', 'list']);
      expect(stdoutOutput).toContain('on-push');
      expect(stdoutOutput).toContain('github.push');
    });

    it('webhooks create sends POST', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'w2' } }));

      await main([
        'node',
        'aether',
        'webhooks',
        'create',
        'deploy-hook',
        '--event=deploy',
        '--role=deployer',
        '--goal=Deploy changes',
      ]);

      expect(stdoutOutput).toContain('Webhook created');
    });

    it('webhooks delete sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));

      await main(['node', 'aether', 'webhooks', 'delete', 'w1']);
      expect(stdoutOutput).toContain('Webhook deleted');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('handles AetherApiError', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404),
      );

      await main(['node', 'aether', 'agents', 'get', 'nonexistent']);
      expect(stderrOutput).toContain('NOT_FOUND');
      expect(stderrOutput).toContain('Agent not found');
      expect(process.exitCode).toBe(1);
    });

    it('handles AetherApiError with --json', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404),
      );

      await main(['node', 'aether', 'agents', 'get', 'nonexistent', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toBe('Agent not found');
    });

    it('handles not-logged-in error', async () => {
      (configModule as any).__setConfig({});
      await main(['node', 'aether', 'agents', 'list']);
      expect(stderrOutput).toContain('Not logged in');
      expect(process.exitCode).toBe(1);
    });

    it('handles unknown command', async () => {
      await main(['node', 'aether', 'foobar']);
      expect(stderrOutput).toContain('Unknown command');
      expect(process.exitCode).toBe(1);
    });

    it('shows help when no command given', async () => {
      await main(['node', 'aether']);
      expect(stdoutOutput).toContain('USAGE');
    });
  });

  // -------------------------------------------------------------------------
  // --json flag across commands
  // -------------------------------------------------------------------------

  describe('--json flag', () => {
    it('agents get --json outputs valid JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          data: { uid: 'a1', role: 'coder', goal: 'test', state: 'running' },
        }),
      );

      await main(['node', 'aether', 'agents', 'get', 'a1', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(json.uid).toBe('a1');
    });

    it('fs ls --json outputs valid JSON', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ name: 'file.txt', size: 100 }] }));

      await main(['node', 'aether', 'fs', 'ls', '/home', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(json)).toBe(true);
    });

    it('cron list --json outputs valid JSON', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ id: 'c1', name: 'test' }] }));

      await main(['node', 'aether', 'cron', 'list', '--json']);
      const json = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(json)).toBe(true);
    });
  });
});
