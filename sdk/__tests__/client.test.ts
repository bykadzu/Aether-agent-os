import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AetherClient, AetherApiError } from '../src/client';

// Mock fetch
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

describe('AetherClient', () => {
  let client: AetherClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new AetherClient({ baseUrl: 'http://localhost:3001' });
  });

  // ---------------------------------------------------------------------------
  // Constructor and Auth
  // ---------------------------------------------------------------------------

  describe('constructor and auth', () => {
    it('strips trailing slash from baseUrl', () => {
      const c = new AetherClient({ baseUrl: 'http://localhost:3001/' });
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      c.system.status();
      expect(mockFetch.mock.calls[0][0]).toContain('http://localhost:3001/api/v1/system/status');
    });

    it('sets token via constructor option', async () => {
      const c = new AetherClient({ baseUrl: 'http://localhost:3001', token: 'mytoken' });
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await c.agents.list();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer mytoken');
    });

    it('login sets token automatically', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ token: 'jwt123', user: { id: '1', username: 'admin' } }),
      );
      const res = await client.login('admin', 'pass');
      expect(res.token).toBe('jwt123');

      // Subsequent requests should include the token
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.agents.list();
      const headers = mockFetch.mock.calls[1][1].headers;
      expect(headers['Authorization']).toBe('Bearer jwt123');
    });

    it('setToken sets the token for subsequent requests', async () => {
      client.setToken('manual-token');
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.agents.list();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer manual-token');
    });

    it('no Authorization header when no token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.agents.list();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  describe('agents', () => {
    it('agents.list sends GET /api/v1/agents', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ pid: 1 }] }));
      const result = await client.agents.list();
      expect(result).toEqual([{ pid: 1 }]);
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents');
      expect(mockFetch.mock.calls[0][1].headers).toBeDefined();
    });

    it('agents.list passes query params', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.agents.list({ status: 'running', limit: 10, offset: 5 });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('status=running');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
    });

    it('agents.spawn sends POST /api/v1/agents', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { pid: 1, uid: 'agent-1' } }));
      const config = { role: 'coder', goal: 'write code' };
      const result = await client.agents.spawn(config);
      expect(result).toEqual({ pid: 1, uid: 'agent-1' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(config);
    });

    it('agents.get sends GET /api/v1/agents/:uid', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { uid: 'agent-1', state: 'running' } }));
      const result = await client.agents.get('agent-1');
      expect(result).toEqual({ uid: 'agent-1', state: 'running' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents/agent-1');
    });

    it('agents.kill sends DELETE /api/v1/agents/:uid', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { pid: 1, signal: 'SIGTERM' } }));
      await client.agents.kill('agent-1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents/agent-1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('agents.message sends POST /api/v1/agents/:uid/message', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { delivered: true } }));
      await client.agents.message('agent-1', 'hello');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents/agent-1/message');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ content: 'hello' });
    });

    it('agents.timeline sends GET /api/v1/agents/:uid/timeline', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ step: 1 }] }));
      await client.agents.timeline('agent-1', { limit: 10, offset: 0 });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/api/v1/agents/agent-1/timeline');
      expect(url).toContain('limit=10');
    });

    it('agents.memory sends GET /api/v1/agents/:uid/memory', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.agents.memory('agent-1', { query: 'test', layer: 'semantic', limit: 5 });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/api/v1/agents/agent-1/memory');
      expect(url).toContain('query=test');
      expect(url).toContain('layer=semantic');
    });

    it('agents.plan sends GET /api/v1/agents/:uid/plan', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { goal: 'test' } }));
      const result = await client.agents.plan('agent-1');
      expect(result).toEqual({ goal: 'test' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents/agent-1/plan');
    });

    it('agents.profile sends GET /api/v1/agents/:uid/profile', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { display_name: 'Agent' } }));
      const result = await client.agents.profile('agent-1');
      expect(result).toEqual({ display_name: 'Agent' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/agents/agent-1/profile');
    });
  });

  // ---------------------------------------------------------------------------
  // Filesystem
  // ---------------------------------------------------------------------------

  describe('fs', () => {
    it('fs.read sends GET /api/v1/fs/:path', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: 'file content' }));
      await client.fs.read('/home/test.txt');
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/api/v1/fs/');
      expect(url).toContain(encodeURIComponent('/home/test.txt'));
    });

    it('fs.write sends PUT /api/v1/fs/:path', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { written: true } }));
      await client.fs.write('/home/test.txt', 'new content');
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ content: 'new content' });
    });

    it('fs.delete sends DELETE /api/v1/fs/:path', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.fs.delete('/home/test.txt');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  describe('templates', () => {
    it('templates.list sends GET /api/v1/templates', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [{ id: 't1' }] }));
      const result = await client.templates.list();
      expect(result).toEqual([{ id: 't1' }]);
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/templates');
    });

    it('templates.get sends GET /api/v1/templates/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 't1', name: 'Dev' } }));
      const result = await client.templates.get('t1');
      expect(result).toEqual({ id: 't1', name: 'Dev' });
    });
  });

  // ---------------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------------

  describe('system', () => {
    it('system.status sends GET /api/v1/system/status', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { version: '0.4.0', uptime: 1000 } }));
      const result = await client.system.status();
      expect(result.version).toBe('0.4.0');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/system/status');
    });

    it('system.metrics sends GET /api/v1/system/metrics', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { cpu: { percent: 5.0 } } }));
      const result = await client.system.metrics();
      expect(result.cpu.percent).toBe(5.0);
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/system/metrics');
    });
  });

  // ---------------------------------------------------------------------------
  // Cron
  // ---------------------------------------------------------------------------

  describe('cron', () => {
    it('cron.list sends GET /api/v1/cron', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.cron.list();
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/cron');
    });

    it('cron.create sends POST /api/v1/cron', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'c1' } }));
      const data = { name: 'daily', expression: '0 0 * * *', agent_config: {} };
      await client.cron.create(data);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(data);
    });

    it('cron.delete sends DELETE /api/v1/cron/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.cron.delete('c1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/cron/c1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('cron.update sends PATCH /api/v1/cron/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'c1', enabled: false } }));
      await client.cron.update('c1', { enabled: false });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/cron/c1');
      expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ enabled: false });
    });
  });

  // ---------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------

  describe('triggers', () => {
    it('triggers.list sends GET /api/v1/triggers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.triggers.list();
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/triggers');
    });

    it('triggers.create sends POST /api/v1/triggers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 't1' } }));
      const data = { name: 'on-spawn', event_type: 'process.spawned', agent_config: {} };
      await client.triggers.create(data);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(data);
    });

    it('triggers.delete sends DELETE /api/v1/triggers/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.triggers.delete('t1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/triggers/t1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // ---------------------------------------------------------------------------
  // Marketplace
  // ---------------------------------------------------------------------------

  describe('marketplace', () => {
    it('marketplace.templates.list sends GET /api/v1/marketplace/templates', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.marketplace.templates.list({ category: 'development', tags: ['ai', 'code'] });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/api/v1/marketplace/templates');
      expect(url).toContain('category=development');
      expect(url).toContain('tags=ai%2Ccode');
    });

    it('marketplace.templates.publish sends POST /api/v1/marketplace/templates', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'mt1' } }));
      const template = { name: 'My Template', category: 'development' };
      await client.marketplace.templates.publish(template);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(template);
    });

    it('marketplace.templates.unpublish sends DELETE /api/v1/marketplace/templates/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.marketplace.templates.unpublish('mt1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/marketplace/templates/mt1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('marketplace.templates.rate sends POST /api/v1/marketplace/templates/:id/rate', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { newAvg: 4.5 } }));
      await client.marketplace.templates.rate('mt1', { rating: 5, review: 'Great!' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/marketplace/templates/mt1/rate');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ rating: 5, review: 'Great!' });
    });

    it('marketplace.templates.fork sends POST /api/v1/marketplace/templates/:id/fork', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'forked-1' } }));
      await client.marketplace.templates.fork('mt1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/marketplace/templates/mt1/fork');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });
  });

  // ---------------------------------------------------------------------------
  // Integrations
  // ---------------------------------------------------------------------------

  describe('integrations', () => {
    it('integrations.list sends GET /api/v1/integrations', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.integrations.list();
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/integrations');
    });

    it('integrations.get sends GET /api/v1/integrations/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'int_1' } }));
      const result = await client.integrations.get('int_1');
      expect(result).toEqual({ id: 'int_1' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/integrations/int_1');
    });

    it('integrations.register sends POST /api/v1/integrations', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'int_1' } }));
      const data = { type: 'slack', name: 'My Slack', credentials: { token: 'xoxb-123' } };
      await client.integrations.register(data);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/integrations');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(data);
    });

    it('integrations.test sends POST /api/v1/integrations/:id/test', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { success: true } }));
      await client.integrations.test('int_1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/integrations/int_1/test');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('integrations.execute sends POST /api/v1/integrations/:id/execute', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { result: 'ok' } }));
      await client.integrations.execute('int_1', 'send_message', { channel: '#general' });
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/integrations/int_1/execute');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        action: 'send_message',
        params: { channel: '#general' },
      });
    });

    it('integrations.unregister sends DELETE /api/v1/integrations/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.integrations.unregister('int_1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/integrations/int_1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  describe('webhooks', () => {
    it('webhooks.list sends GET /api/v1/webhooks', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.webhooks.list();
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/webhooks');
    });

    it('webhooks.create sends POST /api/v1/webhooks', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'wh_1' } }));
      const data = {
        url: 'https://example.com/hook',
        events: ['agent:completed'],
        secret: 's3cret',
      };
      await client.webhooks.create(data);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(data);
    });

    it('webhooks.delete sends DELETE /api/v1/webhooks/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.webhooks.delete('wh_1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/webhooks/wh_1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // ---------------------------------------------------------------------------
  // Plugins
  // ---------------------------------------------------------------------------

  describe('plugins', () => {
    it('plugins.list sends GET /api/v1/marketplace/plugins', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.plugins.list();
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/marketplace/plugins');
    });

    it('plugins.list with category filter', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.plugins.list({ category: 'tools' });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/api/v1/marketplace/plugins');
      expect(url).toContain('category=tools');
    });

    it('plugins.install sends POST /api/v1/marketplace/plugins', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { id: 'p1' } }));
      const manifest = { id: 'p1', name: 'Test Plugin' };
      await client.plugins.install(manifest);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(manifest);
    });

    it('plugins.uninstall sends DELETE /api/v1/marketplace/plugins/:id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: { deleted: true } }));
      await client.plugins.uninstall('p1');
      expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/marketplace/plugins/p1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws AetherApiError on non-200 response with error body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404),
      );
      try {
        await client.agents.get('nonexistent');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AetherApiError);
        const apiErr = err as AetherApiError;
        expect(apiErr.message).toBe('Agent not found');
        expect(apiErr.code).toBe('NOT_FOUND');
        expect(apiErr.status).toBe(404);
      }
    });

    it('throws AetherApiError with fallback message when body is not JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('Server Error'),
      });
      try {
        await client.system.status();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AetherApiError);
        const apiErr = err as AetherApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.code).toBe('HTTP_500');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Query Parameter Serialization
  // ---------------------------------------------------------------------------

  describe('query parameter serialization', () => {
    it('skips undefined and null values', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.agents.list({ status: undefined, limit: 10 });
      const url = mockFetch.mock.calls[0][0];
      expect(url).not.toContain('status');
      expect(url).toContain('limit=10');
    });

    it('serializes arrays as comma-separated values', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ data: [] }));
      await client.marketplace.templates.list({ tags: ['ai', 'code', 'review'] });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('tags=ai%2Ccode%2Creview');
    });
  });
});
