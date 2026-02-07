import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createV1Router } from '../routes/v1.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

// ---------------------------------------------------------------------------
// Mock kernel and helpers
// ---------------------------------------------------------------------------

function createMockKernel() {
  return {
    processes: {
      spawn: vi.fn().mockReturnValue({
        info: {
          pid: 1,
          uid: 'agent_abc',
          name: 'Test Agent',
          cwd: '/home/agent_abc',
          env: {},
          state: 'running',
        },
        agentConfig: { role: 'Tester', goal: 'Test' },
        abortController: { signal: {} },
      }),
      getActiveByOwner: vi.fn().mockReturnValue([
        {
          info: {
            pid: 1,
            uid: 'agent_abc',
            name: 'Test Agent',
            state: 'running',
            createdAt: Date.now(),
          },
        },
      ]),
      getAll: vi.fn().mockReturnValue([
        {
          info: {
            pid: 1,
            uid: 'agent_abc',
            name: 'Test Agent',
            state: 'running',
            cwd: '/home/agent_abc',
            env: {},
            createdAt: Date.now(),
          },
        },
      ]),
      getCounts: vi.fn().mockReturnValue({
        running: 1,
        sleeping: 0,
        created: 0,
        stopped: 0,
        zombie: 0,
        dead: 0,
      }),
      signal: vi.fn().mockReturnValue(true),
      setState: vi.fn(),
    },
    fs: {
      createHome: vi.fn().mockResolvedValue(undefined),
      getRealRoot: vi.fn().mockReturnValue('/tmp/aether'),
      stat: vi.fn().mockResolvedValue({ type: 'file', size: 100 }),
      readFile: vi
        .fn()
        .mockResolvedValue({ path: '/test.txt', content: 'hello', encoding: 'utf-8', size: 5 }),
      ls: vi.fn().mockResolvedValue([]),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    },
    pty: {
      open: vi.fn().mockReturnValue({ id: 'tty_1' }),
    },
    state: {
      getAllProcesses: vi.fn().mockReturnValue([]),
      getAgentLogs: vi
        .fn()
        .mockReturnValue([
          { pid: 1, step: 0, phase: 'thought', content: 'Thinking...', timestamp: Date.now() },
        ]),
      getActivePlanByPid: vi.fn().mockReturnValue(null),
    },
    memory: {
      recall: vi.fn().mockReturnValue([]),
      getProfile: vi.fn().mockReturnValue({
        agent_uid: 'agent_abc',
        display_name: 'Test Agent',
        total_tasks: 5,
        successful_tasks: 4,
        failed_tasks: 1,
        success_rate: 0.8,
        expertise: [],
        personality_traits: [],
        avg_quality_rating: 4.0,
        total_steps: 50,
        first_seen: Date.now(),
        last_active: Date.now(),
        updated_at: Date.now(),
      }),
    },
    containers: {
      isDockerAvailable: vi.fn().mockReturnValue(false),
      getAll: vi.fn().mockReturnValue([]),
      isGPUAvailable: vi.fn().mockReturnValue(false),
      getGPUs: vi.fn().mockReturnValue([]),
    },
    bus: {
      on: vi.fn().mockReturnValue(() => {}),
      emit: vi.fn(),
    },
    cron: {
      listJobs: vi.fn().mockReturnValue([]),
      createJob: vi.fn().mockReturnValue({
        id: 'cron_1',
        name: 'Test Job',
        cron_expression: '* * * * *',
        enabled: true,
      }),
      deleteJob: vi.fn().mockReturnValue(true),
      enableJob: vi.fn().mockReturnValue(true),
      disableJob: vi.fn().mockReturnValue(true),
      listTriggers: vi.fn().mockReturnValue([]),
      createTrigger: vi.fn().mockReturnValue({
        id: 'trigger_1',
        name: 'Test Trigger',
        event_type: 'process.exit',
        enabled: true,
      }),
      deleteTrigger: vi.fn().mockReturnValue(true),
    },
    getUptime: vi.fn().mockReturnValue(12345),
  } as any;
}

const mockUser: UserInfo = {
  id: 'user_1',
  username: 'testuser',
  displayName: 'Test User',
  role: 'admin',
};

function createMockReq(method: string, urlStr: string, body = ''): IncomingMessage {
  const req = {
    method,
    url: urlStr,
    headers: {},
    on: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      if (body) yield body;
    },
  } as any;
  return req;
}

function createMockRes(): ServerResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
} {
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    setHeader: vi.fn((name: string, value: string) => {
      res._headers[name.toLowerCase()] = value;
    }),
    writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res._headers[k.toLowerCase()] = v;
        }
      }
    }),
    end: vi.fn((data?: string) => {
      if (data) res._body = data;
    }),
    write: vi.fn(),
    headersSent: false,
  };
  return res;
}

const mockAuth = vi.fn().mockReturnValue(mockUser);
const mockReadBody = vi.fn(async (req: IncomingMessage) => {
  let body = '';
  for await (const chunk of req as any) {
    body += chunk;
  }
  return body;
});
const mockRunAgentLoop = vi.fn().mockResolvedValue(undefined);
const mockTemplates = [
  { id: 'researcher', name: 'Researcher', role: 'Researcher', goal: 'Research topics' },
  { id: 'coder', name: 'Coder', role: 'Coder', goal: 'Write code' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API v1 Router', () => {
  let kernel: ReturnType<typeof createMockKernel>;
  let handler: ReturnType<typeof createV1Router>;

  beforeEach(() => {
    vi.clearAllMocks();
    kernel = createMockKernel();
    handler = createV1Router(kernel, mockAuth, mockReadBody, mockRunAgentLoop, mockTemplates);
  });

  // ---------------------------------------------------------------------------
  // Response format
  // ---------------------------------------------------------------------------

  describe('response format', () => {
    it('includes X-Aether-Version header on success', async () => {
      const req = createMockReq('GET', '/api/v1/system/status');
      const res = createMockRes();
      const url = new URL('/api/v1/system/status', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._headers['x-aether-version']).toBe('0.4.0');
    });

    it('returns { data } format on success', async () => {
      const req = createMockReq('GET', '/api/v1/system/status');
      const res = createMockRes();
      const url = new URL('/api/v1/system/status', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      const body = JSON.parse(res._body);
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('version');
    });

    it('returns { error: { code, message } } format on error', async () => {
      // Request a non-existent agent
      kernel.processes.getAll.mockReturnValue([]);
      const req = createMockReq('GET', '/api/v1/agents/nonexistent');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/nonexistent', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(404);
      const body = JSON.parse(res._body);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('includes X-Aether-Version header on error', async () => {
      kernel.processes.getAll.mockReturnValue([]);
      const req = createMockReq('GET', '/api/v1/agents/nonexistent');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/nonexistent', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._headers['x-aether-version']).toBe('0.4.0');
    });
  });

  // ---------------------------------------------------------------------------
  // Agent CRUD
  // ---------------------------------------------------------------------------

  describe('agents', () => {
    it('POST /api/v1/agents spawns a new agent', async () => {
      const body = JSON.stringify({ role: 'Tester', goal: 'Run tests' });
      const req = createMockReq('POST', '/api/v1/agents', body);
      const res = createMockRes();
      const url = new URL('/api/v1/agents', 'http://localhost:3001');
      const handled = await handler(req, res, url, mockUser);
      expect(handled).toBe(true);
      expect(res._status).toBe(201);
      const response = JSON.parse(res._body);
      expect(response.data.pid).toBe(1);
      expect(response.data.uid).toBe('agent_abc');
      expect(kernel.processes.spawn).toHaveBeenCalled();
    });

    it('POST /api/v1/agents returns 400 for missing role', async () => {
      const body = JSON.stringify({ goal: 'Run tests' });
      const req = createMockReq('POST', '/api/v1/agents', body);
      const res = createMockRes();
      const url = new URL('/api/v1/agents', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(400);
    });

    it('GET /api/v1/agents lists agents with pagination', async () => {
      const req = createMockReq('GET', '/api/v1/agents?limit=10&offset=0');
      const res = createMockRes();
      const url = new URL('/api/v1/agents?limit=10&offset=0', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('meta');
      expect(response.meta).toHaveProperty('total');
      expect(response.meta).toHaveProperty('limit', 10);
      expect(response.meta).toHaveProperty('offset', 0);
    });

    it('GET /api/v1/agents/:uid returns agent details', async () => {
      const req = createMockReq('GET', '/api/v1/agents/agent_abc');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/agent_abc', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response.data.uid).toBe('agent_abc');
    });

    it('GET /api/v1/agents/:uid returns 404 for unknown agent', async () => {
      kernel.processes.getAll.mockReturnValue([]);
      kernel.state.getAllProcesses.mockReturnValue([]);
      const req = createMockReq('GET', '/api/v1/agents/unknown');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/unknown', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(404);
    });

    it('DELETE /api/v1/agents/:uid kills the agent', async () => {
      const req = createMockReq('DELETE', '/api/v1/agents/agent_abc');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/agent_abc', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.processes.signal).toHaveBeenCalledWith(1, 'SIGTERM');
    });

    it('GET /api/v1/agents/:uid/timeline returns logs with pagination', async () => {
      const req = createMockReq('GET', '/api/v1/agents/agent_abc/timeline?limit=10&offset=0');
      const res = createMockRes();
      const url = new URL(
        '/api/v1/agents/agent_abc/timeline?limit=10&offset=0',
        'http://localhost:3001',
      );
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response).toHaveProperty('meta');
      expect(kernel.state.getAgentLogs).toHaveBeenCalledWith(1);
    });

    it('GET /api/v1/agents/:uid/memory searches agent memories', async () => {
      const req = createMockReq('GET', '/api/v1/agents/agent_abc/memory?q=test&layer=semantic');
      const res = createMockRes();
      const url = new URL(
        '/api/v1/agents/agent_abc/memory?q=test&layer=semantic',
        'http://localhost:3001',
      );
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.memory.recall).toHaveBeenCalledWith({
        agent_uid: 'agent_abc',
        query: 'test',
        layer: 'semantic',
        limit: 10,
      });
    });

    it('GET /api/v1/agents/:uid/plan returns current plan', async () => {
      const req = createMockReq('GET', '/api/v1/agents/agent_abc/plan');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/agent_abc/plan', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.state.getActivePlanByPid).toHaveBeenCalledWith(1);
    });

    it('GET /api/v1/agents/:uid/profile returns agent profile', async () => {
      const req = createMockReq('GET', '/api/v1/agents/agent_abc/profile');
      const res = createMockRes();
      const url = new URL('/api/v1/agents/agent_abc/profile', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response.data.agent_uid).toBe('agent_abc');
      expect(kernel.memory.getProfile).toHaveBeenCalledWith('agent_abc');
    });

    it('POST /api/v1/agents/:uid/message sends message to agent', async () => {
      const body = JSON.stringify({ content: 'Hello agent!' });
      const req = createMockReq('POST', '/api/v1/agents/agent_abc/message', body);
      const res = createMockRes();
      const url = new URL('/api/v1/agents/agent_abc/message', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.bus.emit).toHaveBeenCalledWith(
        'ipc.message',
        expect.objectContaining({ toPid: 1, channel: 'user.message' }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Filesystem
  // ---------------------------------------------------------------------------

  describe('filesystem', () => {
    it('GET /api/v1/fs/home/root reads a file', async () => {
      kernel.fs.stat.mockResolvedValue({ type: 'file', size: 5 });
      const req = createMockReq('GET', '/api/v1/fs/home/root');
      const res = createMockRes();
      const url = new URL('/api/v1/fs/home/root', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.fs.readFile).toHaveBeenCalledWith('/home/root');
    });

    it('GET /api/v1/fs/home lists a directory', async () => {
      kernel.fs.stat.mockResolvedValue({ type: 'directory' });
      kernel.fs.ls.mockResolvedValue([{ name: 'root', type: 'directory' }]);
      const req = createMockReq('GET', '/api/v1/fs/home');
      const res = createMockRes();
      const url = new URL('/api/v1/fs/home', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.fs.ls).toHaveBeenCalledWith('/home');
    });

    it('PUT /api/v1/fs/home/root/test.txt writes a file', async () => {
      const body = 'file content here';
      const req = createMockReq('PUT', '/api/v1/fs/home/root/test.txt', body);
      const res = createMockRes();
      const url = new URL('/api/v1/fs/home/root/test.txt', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.fs.writeFile).toHaveBeenCalledWith('/home/root/test.txt', body);
    });

    it('DELETE /api/v1/fs/home/root/test.txt deletes a file', async () => {
      const req = createMockReq('DELETE', '/api/v1/fs/home/root/test.txt');
      const res = createMockRes();
      const url = new URL('/api/v1/fs/home/root/test.txt', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.fs.rm).toHaveBeenCalledWith('/home/root/test.txt', true);
    });

    it('GET /api/v1/fs/nonexistent returns 404', async () => {
      kernel.fs.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const req = createMockReq('GET', '/api/v1/fs/nonexistent');
      const res = createMockRes();
      const url = new URL('/api/v1/fs/nonexistent', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  describe('templates', () => {
    it('GET /api/v1/templates returns templates list', async () => {
      const req = createMockReq('GET', '/api/v1/templates');
      const res = createMockRes();
      const url = new URL('/api/v1/templates', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response).toHaveProperty('data');
    });

    it('GET /api/v1/templates/:id returns 404 for unknown template', async () => {
      const req = createMockReq('GET', '/api/v1/templates/nonexistent');
      const res = createMockRes();
      const url = new URL('/api/v1/templates/nonexistent', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------------

  describe('system', () => {
    it('GET /api/v1/system/status returns kernel health', async () => {
      const req = createMockReq('GET', '/api/v1/system/status');
      const res = createMockRes();
      const url = new URL('/api/v1/system/status', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response.data).toHaveProperty('version', '0.4.0');
      expect(response.data).toHaveProperty('uptime');
      expect(response.data).toHaveProperty('processes');
    });

    it('GET /api/v1/system/metrics returns resource usage', async () => {
      const req = createMockReq('GET', '/api/v1/system/metrics');
      const res = createMockRes();
      const url = new URL('/api/v1/system/metrics', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      const response = JSON.parse(res._body);
      expect(response.data).toHaveProperty('cpu');
      expect(response.data).toHaveProperty('memory');
      expect(response.data).toHaveProperty('agents');
    });
  });

  // ---------------------------------------------------------------------------
  // SSE Events
  // ---------------------------------------------------------------------------

  describe('events', () => {
    it('GET /api/v1/events sets up SSE stream', async () => {
      const req = createMockReq('GET', '/api/v1/events');
      const res = createMockRes();
      const url = new URL('/api/v1/events', 'http://localhost:3001');
      const handled = await handler(req, res, url, mockUser);
      expect(handled).toBe(true);
      expect(res._status).toBe(200);
      expect(res._headers['content-type']).toBe('text/event-stream');
      expect(res._headers['cache-control']).toBe('no-cache');
      // Should have written initial connection event
      expect(res.write).toHaveBeenCalledWith('data: {"type":"connected"}\n\n');
      // Should have subscribed to bus events
      expect(kernel.bus.on).toHaveBeenCalled();
    });

    it('GET /api/v1/events with filter subscribes to filtered events only', async () => {
      const req = createMockReq('GET', '/api/v1/events?filter=agent.*,process.*');
      const res = createMockRes();
      const url = new URL('/api/v1/events?filter=agent.*,process.*', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      // Should have subscribed only to matching events
      const subscribedEvents = kernel.bus.on.mock.calls.map((c: any) => c[0]);
      for (const event of subscribedEvents) {
        expect(event.startsWith('agent.') || event.startsWith('process.')).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Cron & Triggers
  // ---------------------------------------------------------------------------

  describe('cron', () => {
    it('GET /api/v1/cron lists cron jobs', async () => {
      const req = createMockReq('GET', '/api/v1/cron');
      const res = createMockRes();
      const url = new URL('/api/v1/cron', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.cron.listJobs).toHaveBeenCalled();
    });

    it('POST /api/v1/cron creates a cron job', async () => {
      const body = JSON.stringify({
        name: 'Test',
        cron_expression: '* * * * *',
        agent_config: { role: 'Tester', goal: 'Test' },
      });
      const req = createMockReq('POST', '/api/v1/cron', body);
      const res = createMockRes();
      const url = new URL('/api/v1/cron', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(201);
      expect(kernel.cron.createJob).toHaveBeenCalled();
    });

    it('DELETE /api/v1/cron/:id deletes a cron job', async () => {
      const req = createMockReq('DELETE', '/api/v1/cron/cron_1');
      const res = createMockRes();
      const url = new URL('/api/v1/cron/cron_1', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.cron.deleteJob).toHaveBeenCalledWith('cron_1');
    });

    it('PATCH /api/v1/cron/:id enables a cron job', async () => {
      const body = JSON.stringify({ enabled: true });
      const req = createMockReq('PATCH', '/api/v1/cron/cron_1', body);
      const res = createMockRes();
      const url = new URL('/api/v1/cron/cron_1', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.cron.enableJob).toHaveBeenCalledWith('cron_1');
    });

    it('PATCH /api/v1/cron/:id disables a cron job', async () => {
      const body = JSON.stringify({ enabled: false });
      const req = createMockReq('PATCH', '/api/v1/cron/cron_1', body);
      const res = createMockRes();
      const url = new URL('/api/v1/cron/cron_1', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.cron.disableJob).toHaveBeenCalledWith('cron_1');
    });

    it('DELETE /api/v1/cron/:id returns 404 for unknown job', async () => {
      kernel.cron.deleteJob.mockReturnValue(false);
      const req = createMockReq('DELETE', '/api/v1/cron/unknown');
      const res = createMockRes();
      const url = new URL('/api/v1/cron/unknown', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(404);
    });
  });

  describe('triggers', () => {
    it('GET /api/v1/triggers lists event triggers', async () => {
      const req = createMockReq('GET', '/api/v1/triggers');
      const res = createMockRes();
      const url = new URL('/api/v1/triggers', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.cron.listTriggers).toHaveBeenCalled();
    });

    it('POST /api/v1/triggers creates an event trigger', async () => {
      const body = JSON.stringify({
        name: 'On Exit',
        event_type: 'process.exit',
        agent_config: { role: 'Responder', goal: 'React' },
      });
      const req = createMockReq('POST', '/api/v1/triggers', body);
      const res = createMockRes();
      const url = new URL('/api/v1/triggers', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(201);
      expect(kernel.cron.createTrigger).toHaveBeenCalled();
    });

    it('DELETE /api/v1/triggers/:id deletes a trigger', async () => {
      const req = createMockReq('DELETE', '/api/v1/triggers/trigger_1');
      const res = createMockRes();
      const url = new URL('/api/v1/triggers/trigger_1', 'http://localhost:3001');
      await handler(req, res, url, mockUser);
      expect(res._status).toBe(200);
      expect(kernel.cron.deleteTrigger).toHaveBeenCalledWith('trigger_1');
    });
  });

  // ---------------------------------------------------------------------------
  // Unhandled routes
  // ---------------------------------------------------------------------------

  describe('unhandled routes', () => {
    it('returns false for non-v1 paths', async () => {
      const req = createMockReq('GET', '/api/v1/unknown/path');
      const res = createMockRes();
      const url = new URL('/api/v1/unknown/path', 'http://localhost:3001');
      const handled = await handler(req, res, url, mockUser);
      expect(handled).toBe(false);
    });
  });
});
