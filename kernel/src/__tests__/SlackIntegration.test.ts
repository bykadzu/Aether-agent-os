import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { IntegrationManager } from '../IntegrationManager.js';
import {
  SlackIntegration,
  verifySlackSignature,
  renderTemplate,
  parseSlashCommand,
} from '../integrations/SlackIntegration.js';

// ---------------------------------------------------------------------------
// Unit tests for SlackIntegration + helper functions
// ---------------------------------------------------------------------------

describe('SlackIntegration', () => {
  let bus: EventBus;
  let store: StateStore;
  let manager: IntegrationManager;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-slack-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    manager = new IntegrationManager(bus, store);
    await manager.init();
  });

  afterEach(() => {
    manager.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  describe('registration', () => {
    it('registers a slack integration and returns info', () => {
      const info = manager.register({
        type: 'slack',
        name: 'My Slack',
        credentials: { bot_token: 'xoxb-test', signing_secret: 'secret123' },
      });

      expect(info.id).toBeDefined();
      expect(info.type).toBe('slack');
      expect(info.name).toBe('My Slack');
      expect(info.enabled).toBe(true);
      expect(info.status).toBe('disconnected');
      expect(info.available_actions.length).toBe(8);
    });

    it('lists available actions', () => {
      const info = manager.register({ type: 'slack', name: 'Actions Test' });
      const names = info.available_actions.map((a: any) => a.name);
      expect(names).toContain('slack.send_message');
      expect(names).toContain('slack.list_channels');
      expect(names).toContain('slack.read_channel');
      expect(names).toContain('slack.add_reaction');
      expect(names).toContain('slack.set_topic');
      expect(names).toContain('slack.upload_file');
      expect(names).toContain('slack.list_users');
      expect(names).toContain('slack.send_dm');
    });
  });

  // ---------------------------------------------------------------------------
  // testConnection (auth.test)
  // ---------------------------------------------------------------------------

  describe('testConnection', () => {
    it('returns success when auth.test succeeds', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, user: 'aether-bot', team: 'Aether Team' }), {
            status: 200,
          }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Test Conn',
        credentials: { bot_token: 'xoxb-test' },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(true);
      expect(result.message).toContain('aether-bot');
      expect(result.message).toContain('Aether Team');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://slack.com/api/auth.test');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer xoxb-test');
    });

    it('returns failure when auth.test returns error', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Fail Conn',
        credentials: { bot_token: 'xoxb-bad' },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid_auth');
    });

    it('returns failure on network error', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network error');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Net Error',
        credentials: { bot_token: 'xoxb-test' },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('updates integration status on success', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, user: 'bot', team: 'T' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Status Test',
        credentials: { bot_token: 'xoxb-test' },
      });

      await manager.test(info.id);
      const fetched = manager.get(info.id);
      expect(fetched!.status).toBe('connected');
    });

    it('updates integration status on failure', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: 'token_revoked' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Status Fail',
        credentials: { bot_token: 'xoxb-bad' },
      });

      await manager.test(info.id);
      const fetched = manager.get(info.id);
      expect(fetched!.status).toBe('error');
    });
  });

  // ---------------------------------------------------------------------------
  // Actions (all 8)
  // ---------------------------------------------------------------------------

  describe('actions', () => {
    function stubFetch(responseData: any) {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify(responseData), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    }

    function registerSlack() {
      return manager.register({
        type: 'slack',
        name: 'Action Test',
        credentials: { bot_token: 'xoxb-test123' },
      });
    }

    it('send_message posts to chat.postMessage', async () => {
      const mockFetch = stubFetch({ ok: true, ts: '1234.5678' });
      const info = registerSlack();

      const result = await manager.execute(info.id, 'slack.send_message', {
        channel: 'C123',
        text: 'Hello world',
      });

      expect(result.ok).toBe(true);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://slack.com/api/chat.postMessage');
      const body = JSON.parse(opts.body);
      expect(body.channel).toBe('C123');
      expect(body.text).toBe('Hello world');
    });

    it('send_message includes thread_ts when provided', async () => {
      const mockFetch = stubFetch({ ok: true, ts: '1234.5678' });
      const info = registerSlack();

      await manager.execute(info.id, 'slack.send_message', {
        channel: 'C123',
        text: 'Reply',
        thread_ts: '1111.2222',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thread_ts).toBe('1111.2222');
    });

    it('list_channels calls conversations.list', async () => {
      const mockFetch = stubFetch({ ok: true, channels: [{ id: 'C1' }, { id: 'C2' }] });
      const info = registerSlack();

      const result = await manager.execute(info.id, 'slack.list_channels', { limit: 50 });

      expect(result.ok).toBe(true);
      expect(result.channels).toHaveLength(2);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('conversations.list');
      expect(url).toContain('limit=50');
    });

    it('read_channel calls conversations.history', async () => {
      const messages = [{ text: 'msg1' }, { text: 'msg2' }];
      const mockFetch = stubFetch({ ok: true, messages });
      const info = registerSlack();

      const result = await manager.execute(info.id, 'slack.read_channel', {
        channel: 'C123',
        limit: 5,
      });

      expect(result.ok).toBe(true);
      expect(result.messages).toHaveLength(2);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('conversations.history');
      expect(url).toContain('channel=C123');
      expect(url).toContain('limit=5');
    });

    it('add_reaction calls reactions.add', async () => {
      const mockFetch = stubFetch({ ok: true });
      const info = registerSlack();

      await manager.execute(info.id, 'slack.add_reaction', {
        channel: 'C123',
        timestamp: '1234.5678',
        name: 'thumbsup',
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://slack.com/api/reactions.add');
      const body = JSON.parse(opts.body);
      expect(body.channel).toBe('C123');
      expect(body.timestamp).toBe('1234.5678');
      expect(body.name).toBe('thumbsup');
    });

    it('set_topic calls conversations.setTopic', async () => {
      const mockFetch = stubFetch({ ok: true });
      const info = registerSlack();

      await manager.execute(info.id, 'slack.set_topic', {
        channel: 'C123',
        topic: 'New topic',
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://slack.com/api/conversations.setTopic');
      const body = JSON.parse(opts.body);
      expect(body.channel).toBe('C123');
      expect(body.topic).toBe('New topic');
    });

    it('upload_file calls files.upload', async () => {
      const mockFetch = stubFetch({ ok: true, file: { id: 'F123' } });
      const info = registerSlack();

      await manager.execute(info.id, 'slack.upload_file', {
        channels: 'C123,C456',
        content: 'file contents',
        filename: 'test.txt',
        title: 'Test File',
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://slack.com/api/files.upload');
      const body = JSON.parse(opts.body);
      expect(body.channels).toBe('C123,C456');
      expect(body.content).toBe('file contents');
      expect(body.filename).toBe('test.txt');
      expect(body.title).toBe('Test File');
    });

    it('list_users calls users.list', async () => {
      const mockFetch = stubFetch({ ok: true, members: [{ id: 'U1' }] });
      const info = registerSlack();

      const result = await manager.execute(info.id, 'slack.list_users', {});

      expect(result.ok).toBe(true);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('users.list');
    });

    it('send_dm opens conversation then sends message', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, ts: '9999.0000' }), { status: 200 }),
        );
      vi.stubGlobal('fetch', mockFetch);

      const info = registerSlack();

      const result = await manager.execute(info.id, 'slack.send_dm', {
        user: 'U123',
        text: 'Hello DM',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call: conversations.open
      expect(mockFetch.mock.calls[0][0]).toBe('https://slack.com/api/conversations.open');
      const openBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(openBody.users).toBe('U123');

      // Second call: chat.postMessage
      expect(mockFetch.mock.calls[1][0]).toBe('https://slack.com/api/chat.postMessage');
      const msgBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(msgBody.channel).toBe('D123');
      expect(msgBody.text).toBe('Hello DM');

      expect(result.ok).toBe(true);
    });

    it('send_dm returns error when conversations.open fails', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false, error: 'user_not_found' }), { status: 200 }),
        );
      vi.stubGlobal('fetch', mockFetch);

      const info = registerSlack();
      const result = await manager.execute(info.id, 'slack.send_dm', {
        user: 'UBAD',
        text: 'test',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('user_not_found');
    });

    it('throws on unknown action', async () => {
      const info = registerSlack();
      await expect(manager.execute(info.id, 'slack.nonexistent', {})).rejects.toThrow(
        'Unknown action: slack.nonexistent',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // API error handling
  // ---------------------------------------------------------------------------

  describe('API error handling', () => {
    it('logs errors to integration logs', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Error Log',
        credentials: { bot_token: 'xoxb-test' },
      });

      await expect(
        manager.execute(info.id, 'slack.send_message', {
          channel: 'C1',
          text: 'test',
        }),
      ).rejects.toThrow('Connection refused');

      const logs = store.getIntegrationLogs(info.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('error');
    });

    it('emits integration.error event on failure', async () => {
      const events: any[] = [];
      bus.on('integration.error', (data: any) => events.push(data));

      const mockFetch = vi.fn(async () => {
        throw new Error('Timeout');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'slack',
        name: 'Error Event',
        credentials: { bot_token: 'xoxb-test' },
      });

      await expect(manager.execute(info.id, 'slack.list_channels', {})).rejects.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0].error).toContain('Timeout');
    });
  });
});

// ---------------------------------------------------------------------------
// verifySlackSignature
// ---------------------------------------------------------------------------

describe('verifySlackSignature', () => {
  const signingSecret = 'my_signing_secret_123';

  function computeSignature(secret: string, timestamp: string, body: string): string {
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', secret).update(baseString).digest('hex');
    return `v0=${hmac}`;
  }

  it('returns true for a valid signature', () => {
    const timestamp = '1531420618';
    const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J';
    const signature = computeSignature(signingSecret, timestamp, body);

    expect(verifySlackSignature(signingSecret, timestamp, body, signature)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const timestamp = '1531420618';
    const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J';

    expect(verifySlackSignature(signingSecret, timestamp, body, 'v0=invalid_hex')).toBe(false);
  });

  it('returns false for tampered body', () => {
    const timestamp = '1531420618';
    const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J';
    const signature = computeSignature(signingSecret, timestamp, body);

    expect(verifySlackSignature(signingSecret, timestamp, body + 'tampered', signature)).toBe(
      false,
    );
  });

  it('returns false for wrong secret', () => {
    const timestamp = '1531420618';
    const body = 'token=test';
    const signature = computeSignature(signingSecret, timestamp, body);

    expect(verifySlackSignature('wrong_secret', timestamp, body, signature)).toBe(false);
  });

  it('returns false for wrong timestamp', () => {
    const timestamp = '1531420618';
    const body = 'test';
    const signature = computeSignature(signingSecret, timestamp, body);

    expect(verifySlackSignature(signingSecret, '9999999999', body, signature)).toBe(false);
  });

  it('returns false for length-mismatched signature', () => {
    expect(verifySlackSignature(signingSecret, '123', 'body', 'v0=short')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSlashCommand
// ---------------------------------------------------------------------------

describe('parseSlashCommand', () => {
  it('parses "spawn coder" command', () => {
    const result = parseSlashCommand('spawn coder "Fix the login bug"');
    expect(result.command).toBe('spawn');
    expect(result.args).toEqual(['coder', 'Fix the login bug']);
  });

  it('parses "status" command with no args', () => {
    const result = parseSlashCommand('status');
    expect(result.command).toBe('status');
    expect(result.args).toEqual([]);
  });

  it('parses "kill 42" command', () => {
    const result = parseSlashCommand('kill 42');
    expect(result.command).toBe('kill');
    expect(result.args).toEqual(['42']);
  });

  it('parses "ask" command with quoted text', () => {
    const result = parseSlashCommand('ask coder "What is the status?"');
    expect(result.command).toBe('ask');
    expect(result.args).toEqual(['coder', 'What is the status?']);
  });

  it('handles empty text', () => {
    const result = parseSlashCommand('');
    expect(result.command).toBe('');
    expect(result.args).toEqual([]);
  });

  it('handles text with extra whitespace', () => {
    const result = parseSlashCommand('  spawn   researcher  "topic" ');
    expect(result.command).toBe('spawn');
    expect(result.args).toEqual(['researcher', 'topic']);
  });

  it('handles text with no quotes', () => {
    const result = parseSlashCommand('list agents active');
    expect(result.command).toBe('list');
    expect(result.args).toEqual(['agents', 'active']);
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('replaces simple fields', () => {
    const result = renderTemplate('Hello {{name}}, welcome to {{team}}!', {
      name: 'Alice',
      team: 'Aether',
    });
    expect(result).toBe('Hello Alice, welcome to Aether!');
  });

  it('replaces nested field paths', () => {
    const result = renderTemplate('Agent {{agent.name}} completed {{task.status}}', {
      agent: { name: 'Coder' },
      task: { status: 'success' },
    });
    expect(result).toBe('Agent Coder completed success');
  });

  it('replaces missing fields with empty string', () => {
    const result = renderTemplate('Hello {{name}}, role: {{role}}', { name: 'Bob' });
    expect(result).toBe('Hello Bob, role: ');
  });

  it('handles null in nested path', () => {
    const result = renderTemplate('{{a.b.c}}', { a: null });
    expect(result).toBe('');
  });

  it('handles empty template', () => {
    expect(renderTemplate('', { foo: 'bar' })).toBe('');
  });

  it('handles template with no placeholders', () => {
    expect(renderTemplate('plain text', { foo: 'bar' })).toBe('plain text');
  });

  it('converts numeric values to string', () => {
    const result = renderTemplate('Count: {{count}}', { count: 42 });
    expect(result).toBe('Count: 42');
  });

  it('handles deeply nested paths', () => {
    const result = renderTemplate('{{a.b.c.d}}', { a: { b: { c: { d: 'deep' } } } });
    expect(result).toBe('deep');
  });
});
