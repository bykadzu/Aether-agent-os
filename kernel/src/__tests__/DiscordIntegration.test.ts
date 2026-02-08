import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { IntegrationManager } from '../IntegrationManager.js';

// ---------------------------------------------------------------------------
// Unit tests for DiscordIntegration
// ---------------------------------------------------------------------------

describe('DiscordIntegration', () => {
  let bus: EventBus;
  let store: StateStore;
  let manager: IntegrationManager;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-discord-test-${crypto.randomBytes(8).toString('hex')}`,
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
    it('registers a discord integration and returns info', () => {
      const info = manager.register({
        type: 'discord',
        name: 'My Discord',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });

      expect(info.id).toBeDefined();
      expect(info.type).toBe('discord');
      expect(info.name).toBe('My Discord');
      expect(info.enabled).toBe(true);
      expect(info.status).toBe('disconnected');
      expect(info.available_actions.length).toBe(6);
    });

    it('lists available actions', () => {
      const info = manager.register({ type: 'discord', name: 'Actions Test' });
      const names = info.available_actions.map((a: any) => a.name);
      expect(names).toContain('discord.send_message');
      expect(names).toContain('discord.list_guilds');
      expect(names).toContain('discord.list_channels');
      expect(names).toContain('discord.read_messages');
      expect(names).toContain('discord.add_reaction');
      expect(names).toContain('discord.get_guild_members');
    });
  });

  // ---------------------------------------------------------------------------
  // testConnection
  // ---------------------------------------------------------------------------

  describe('testConnection', () => {
    it('returns success when list_guilds succeeds', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response(JSON.stringify([{ id: '123', name: 'Test Guild' }]), {
            status: 200,
          }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'discord',
        name: 'Test Conn',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(true);
      expect(result.message).toContain('1 guild(s)');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/users/@me/guilds');
      expect(opts.headers.Authorization).toBe('Bot MTk4NjIy.test.token');
    });

    it('returns failure when Discord returns error status', async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'discord',
        name: 'Fail Conn',
        credentials: { bot_token: 'bad-token' },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('401');
    });

    it('returns failure on network error', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network error');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'discord',
        name: 'Net Error',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });
  });

  // ---------------------------------------------------------------------------
  // Actions (all 6)
  // ---------------------------------------------------------------------------

  describe('actions', () => {
    function stubFetch(responseData: any, status = 200) {
      const mockFetch = vi.fn(async () => new Response(JSON.stringify(responseData), { status }));
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    }

    function registerDiscord() {
      return manager.register({
        type: 'discord',
        name: 'Action Test',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });
    }

    it('send_message posts to channel messages endpoint', async () => {
      const mockFetch = stubFetch({ id: '999', content: 'Hello' });
      const info = registerDiscord();

      const result = await manager.execute(info.id, 'discord.send_message', {
        channel_id: '123456',
        content: 'Hello Discord',
      });

      expect(result.id).toBe('999');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/channels/123456/messages');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bot MTk4NjIy.test.token');
      const body = JSON.parse(opts.body);
      expect(body.content).toBe('Hello Discord');
    });

    it('send_message includes embeds when provided', async () => {
      const mockFetch = stubFetch({ id: '999' });
      const info = registerDiscord();

      await manager.execute(info.id, 'discord.send_message', {
        channel_id: '123456',
        content: 'With embed',
        embeds: JSON.stringify([{ title: 'Test Embed' }]),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds).toEqual([{ title: 'Test Embed' }]);
    });

    it('list_guilds calls users/@me/guilds', async () => {
      const mockFetch = stubFetch([{ id: 'g1', name: 'Guild 1' }]);
      const info = registerDiscord();

      const result = await manager.execute(info.id, 'discord.list_guilds', {});

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Guild 1');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/users/@me/guilds');
    });

    it('list_channels calls guilds/{id}/channels', async () => {
      const mockFetch = stubFetch([{ id: 'c1', name: 'general' }]);
      const info = registerDiscord();

      const result = await manager.execute(info.id, 'discord.list_channels', {
        guild_id: 'g123',
      });

      expect(result).toHaveLength(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/guilds/g123/channels');
    });

    it('read_messages calls channel messages with limit', async () => {
      const mockFetch = stubFetch([
        { id: 'm1', content: 'msg 1' },
        { id: 'm2', content: 'msg 2' },
      ]);
      const info = registerDiscord();

      const result = await manager.execute(info.id, 'discord.read_messages', {
        channel_id: 'c456',
        limit: 25,
      });

      expect(result).toHaveLength(2);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/channels/c456/messages?limit=25');
    });

    it('add_reaction sends PUT to reactions endpoint', async () => {
      // Discord returns 204 No Content for successful reaction
      const mockFetch = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', mockFetch);

      const info = registerDiscord();

      const result = await manager.execute(info.id, 'discord.add_reaction', {
        channel_id: 'c456',
        message_id: 'm789',
        emoji: '%F0%9F%91%8D',
      });

      expect(result.success).toBe(true);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://discord.com/api/v10/channels/c456/messages/m789/reactions/%F0%9F%91%8D/@me',
      );
      expect(opts.method).toBe('PUT');
    });

    it('get_guild_members calls members endpoint with limit', async () => {
      const mockFetch = stubFetch([{ user: { id: 'u1', username: 'alice' } }]);
      const info = registerDiscord();

      const result = await manager.execute(info.id, 'discord.get_guild_members', {
        guild_id: 'g123',
        limit: 50,
      });

      expect(result).toHaveLength(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/guilds/g123/members?limit=50');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws on unknown action', async () => {
      const info = manager.register({
        type: 'discord',
        name: 'Error Test',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });
      await expect(manager.execute(info.id, 'discord.nonexistent', {})).rejects.toThrow(
        'Unknown action: discord.nonexistent',
      );
    });

    it('logs errors to integration logs', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'discord',
        name: 'Error Log',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });

      await expect(
        manager.execute(info.id, 'discord.send_message', {
          channel_id: 'c1',
          content: 'test',
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
        type: 'discord',
        name: 'Error Event',
        credentials: { bot_token: 'MTk4NjIy.test.token' },
      });

      await expect(manager.execute(info.id, 'discord.list_guilds', {})).rejects.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0].error).toContain('Timeout');
    });
  });
});
