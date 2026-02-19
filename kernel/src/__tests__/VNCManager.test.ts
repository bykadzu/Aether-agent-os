import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventBus } from '../EventBus.js';

// ---------------------------------------------------------------------------
// Module-level mocks for ws and node:http and node:net (ESM-compatible)
// ---------------------------------------------------------------------------

// Mock HTTP server - behaves like an EventEmitter with listen/close
const mockHttpServer = new EventEmitter() as EventEmitter & {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
mockHttpServer.listen = vi.fn((_port: number, _host: string, cb: () => void) => cb());
mockHttpServer.close = vi.fn();

// Mock WebSocketServer - behaves like an EventEmitter with close
const mockWss = new EventEmitter() as EventEmitter & {
  close: ReturnType<typeof vi.fn>;
};
mockWss.close = vi.fn();

vi.mock('node:http', () => ({
  createServer: vi.fn(() => mockHttpServer),
}));

vi.mock('ws', () => {
  // WebSocketServer must be a constructor (called with `new`)
  function WebSocketServer(this: any) {
    return mockWss;
  }
  return {
    WebSocketServer,
    WebSocket: { OPEN: 1, CONNECTING: 0 },
  };
});

vi.mock('node:net', () => {
  // Socket must be a constructor (called with `new`)
  function Socket(this: any) {
    const sock = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      writable: boolean;
      destroyed: boolean;
    };
    sock.connect = vi.fn();
    sock.write = vi.fn();
    sock.destroy = vi.fn();
    sock.writable = true;
    sock.destroyed = false;
    return sock;
  }
  return { Socket };
});

// ---------------------------------------------------------------------------
// Import AFTER mocks are in place
// ---------------------------------------------------------------------------

const { VNCManager } = await import('../VNCManager.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainerManager(overrides?: Record<string, any>) {
  return {
    execGraphical: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VNCManager', () => {
  let bus: EventBus;
  let vnc: InstanceType<typeof VNCManager>;

  beforeEach(() => {
    bus = new EventBus();
    vnc = new VNCManager(bus);

    // Reset mock state between tests
    mockHttpServer.listen.mockClear();
    mockHttpServer.close.mockClear();
    mockHttpServer.removeAllListeners();
    mockHttpServer.listen.mockImplementation((_port: number, _host: string, cb: () => void) =>
      cb(),
    );

    mockWss.close.mockClear();
    mockWss.removeAllListeners();
  });

  // -------------------------------------------------------------------------
  // setContainerManager
  // -------------------------------------------------------------------------

  describe('setContainerManager', () => {
    it('sets the container manager for later use', async () => {
      const cm = makeContainerManager();
      vnc.setContainerManager(cm as any);

      // Verify it works by calling resizeDisplay (which requires a CM)
      // Start a proxy first so we have a valid PID
      const { wsPort } = await vnc.startProxy(1, 5900);
      expect(wsPort).toBeTypeOf('number');

      await vnc.resizeDisplay(1, 1920, 1080);
      expect(cm.execGraphical).toHaveBeenCalledWith(1, expect.any(String));
    });
  });

  // -------------------------------------------------------------------------
  // startProxy
  // -------------------------------------------------------------------------

  describe('startProxy', () => {
    it('starts a proxy and returns the wsPort', async () => {
      const result = await vnc.startProxy(10, 5900);

      expect(result).toHaveProperty('wsPort');
      expect(result.wsPort).toBeTypeOf('number');
    });

    it('emits vnc.started with pid, wsPort, and display', async () => {
      const events: any[] = [];
      bus.on('vnc.started', (data: any) => events.push(data));

      const { wsPort } = await vnc.startProxy(10, 5900);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          pid: 10,
          wsPort,
          display: ':99',
        }),
      );
    });

    it('returns existing wsPort if proxy already exists for the PID', async () => {
      const first = await vnc.startProxy(20, 5900);
      const second = await vnc.startProxy(20, 5900);

      expect(second.wsPort).toBe(first.wsPort);
    });

    it('does not create a new server when proxy already exists', async () => {
      const { createServer } = await import('node:http');

      await vnc.startProxy(20, 5900);
      const callCountAfterFirst = (createServer as ReturnType<typeof vi.fn>).mock.calls.length;

      await vnc.startProxy(20, 5900);
      const callCountAfterSecond = (createServer as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callCountAfterSecond).toBe(callCountAfterFirst);
    });

    it('calls httpServer.listen with the wsPort and 0.0.0.0', async () => {
      await vnc.startProxy(30, 5901);

      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        expect.any(Number),
        '0.0.0.0',
        expect.any(Function),
      );
    });
  });

  // -------------------------------------------------------------------------
  // stopProxy
  // -------------------------------------------------------------------------

  describe('stopProxy', () => {
    it('closes the wss and httpServer and emits vnc.stopped', async () => {
      const events: any[] = [];
      bus.on('vnc.stopped', (data: any) => events.push(data));

      await vnc.startProxy(40, 5900);
      vnc.stopProxy(40);

      expect(mockWss.close).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ pid: 40 }));
    });

    it('removes proxy info so getProxyInfo returns null afterwards', async () => {
      await vnc.startProxy(41, 5900);
      expect(vnc.getProxyInfo(41)).not.toBeNull();

      vnc.stopProxy(41);
      expect(vnc.getProxyInfo(41)).toBeNull();
    });

    it('does nothing for an unknown PID', () => {
      // Should not throw or emit any event
      const events: any[] = [];
      bus.on('vnc.stopped', (data: any) => events.push(data));

      vnc.stopProxy(999);

      expect(events).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getProxyInfo
  // -------------------------------------------------------------------------

  describe('getProxyInfo', () => {
    it('returns { wsPort } for an active proxy', async () => {
      const { wsPort } = await vnc.startProxy(50, 5900);
      const info = vnc.getProxyInfo(50);

      expect(info).toEqual({ wsPort });
    });

    it('returns null for an unknown PID', () => {
      expect(vnc.getProxyInfo(999)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // resizeDisplay
  // -------------------------------------------------------------------------

  describe('resizeDisplay', () => {
    it('calls containerManager.execGraphical with the xrandr command', async () => {
      const cm = makeContainerManager();
      vnc.setContainerManager(cm as any);

      await vnc.resizeDisplay(60, 1280, 720);

      expect(cm.execGraphical).toHaveBeenCalledTimes(1);
      expect(cm.execGraphical).toHaveBeenCalledWith(60, expect.stringContaining('1280x720'));
    });

    it('does not throw when containerManager is not set', async () => {
      // vnc was constructed without a containerManager
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(vnc.resizeDisplay(60, 1920, 1080)).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no ContainerManager'));

      warnSpy.mockRestore();
    });

    it('warns but does not throw when execGraphical rejects', async () => {
      const cm = makeContainerManager({
        execGraphical: vi.fn().mockRejectedValue(new Error('container gone')),
      });
      vnc.setContainerManager(cm as any);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(vnc.resizeDisplay(61, 800, 600)).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to resize display'));

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // shutdown
  // -------------------------------------------------------------------------

  describe('shutdown', () => {
    it('stops all active proxies', async () => {
      const events: any[] = [];
      bus.on('vnc.stopped', (data: any) => events.push(data));

      await vnc.startProxy(70, 5900);
      await vnc.startProxy(71, 5901);
      await vnc.startProxy(72, 5902);

      await vnc.shutdown();

      // All three should have been stopped
      expect(events).toHaveLength(3);

      const stoppedPids = events.map((e) => e.pid).sort();
      expect(stoppedPids).toEqual([70, 71, 72]);

      // All proxy info should be cleaned up
      expect(vnc.getProxyInfo(70)).toBeNull();
      expect(vnc.getProxyInfo(71)).toBeNull();
      expect(vnc.getProxyInfo(72)).toBeNull();
    });

    it('does nothing when no proxies are active', async () => {
      const events: any[] = [];
      bus.on('vnc.stopped', (data: any) => events.push(data));

      await vnc.shutdown();

      expect(events).toHaveLength(0);
    });
  });
});
