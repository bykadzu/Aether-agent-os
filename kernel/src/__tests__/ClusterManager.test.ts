import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { ClusterManager } from '../ClusterManager.js';
import {
  CLUSTER_DEFAULT_CAPACITY,
  CLUSTER_HEARTBEAT_INTERVAL,
  CLUSTER_HEARTBEAT_TIMEOUT,
} from '@aether/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock WebSocket with send/close/on stubs. */
function createMockWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
}

/** Shorthand to build a process.spawn command. */
function spawnCmd(id = 'cmd-1') {
  return {
    type: 'process.spawn' as const,
    id,
    config: { role: 'worker', goal: 'test', model: 'gpt-4', tools: [], maxSteps: 5 },
  };
}

/** Shorthand for a non-spawn command. */
function listCmd(id = 'cmd-2') {
  return { type: 'process.list' as const, id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClusterManager', () => {
  let bus: EventBus;
  let cm: ClusterManager;

  // Preserve original env so we can restore after each test
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear cluster-related env vars by default (standalone)
    delete process.env.AETHER_CLUSTER_ROLE;
    delete process.env.AETHER_HUB_URL;
    delete process.env.AETHER_NODE_CAPACITY;

    bus = new EventBus();
  });

  afterEach(async () => {
    // Ensure all intervals/timers are cleaned up
    if (cm) {
      await cm.shutdown();
    }
    // Restore env
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('defaults to standalone role when no env vars are set', () => {
      cm = new ClusterManager(bus);
      expect(cm.getRole()).toBe('standalone');
    });

    it('sets role to hub when AETHER_CLUSTER_ROLE=hub', () => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      expect(cm.getRole()).toBe('hub');
    });

    it('sets role to standalone with warning when AETHER_CLUSTER_ROLE=node but AETHER_HUB_URL not set', () => {
      process.env.AETHER_CLUSTER_ROLE = 'node';
      // AETHER_HUB_URL deliberately not set
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cm = new ClusterManager(bus);

      expect(cm.getRole()).toBe('standalone');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('AETHER_CLUSTER_ROLE=node but AETHER_HUB_URL not set'),
      );
    });

    it('sets role to node when AETHER_CLUSTER_ROLE=node and AETHER_HUB_URL is set', () => {
      process.env.AETHER_CLUSTER_ROLE = 'node';
      process.env.AETHER_HUB_URL = 'ws://hub:3000';
      cm = new ClusterManager(bus);
      expect(cm.getRole()).toBe('node');
    });

    it('uses CLUSTER_DEFAULT_CAPACITY when AETHER_NODE_CAPACITY is unset', () => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      // Default capacity is reflected in cluster info
      const info = cm.getClusterInfo();
      expect(info.totalCapacity).toBe(CLUSTER_DEFAULT_CAPACITY);
    });

    it('uses AETHER_NODE_CAPACITY when set', () => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      process.env.AETHER_NODE_CAPACITY = '32';
      cm = new ClusterManager(bus);
      const info = cm.getClusterInfo();
      expect(info.totalCapacity).toBe(32);
    });
  });

  // -------------------------------------------------------------------------
  // getRole / getNodeId
  // -------------------------------------------------------------------------

  describe('getRole / getNodeId', () => {
    it('getRole returns the current cluster role', () => {
      cm = new ClusterManager(bus);
      expect(cm.getRole()).toBe('standalone');
    });

    it('getNodeId returns an 8-char string', () => {
      cm = new ClusterManager(bus);
      const nodeId = cm.getNodeId();
      expect(typeof nodeId).toBe('string');
      expect(nodeId.length).toBe(8);
    });
  });

  // -------------------------------------------------------------------------
  // init()
  // -------------------------------------------------------------------------

  describe('init()', () => {
    it('does nothing for standalone mode', async () => {
      cm = new ClusterManager(bus);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await cm.init();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('standalone'));
    });

    it('starts health check for hub mode', async () => {
      vi.useFakeTimers();
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await cm.init();

      // Register a node, then let health check tick
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000, capacity: 10, load: 0 });

      // Advance past the heartbeat timeout so the health check marks the node offline
      const events: any[] = [];
      bus.on('cluster.nodeOffline', (data: any) => events.push(data));

      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL);

      expect(events.length).toBe(1);
      expect(events[0]).toEqual(expect.objectContaining({ nodeId: 'n1' }));
    });
  });

  // -------------------------------------------------------------------------
  // registerNode
  // -------------------------------------------------------------------------

  describe('registerNode', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('adds node to internal map and returns it via getNodes()', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000, capacity: 8, load: 2 });

      const nodes = cm.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual(
        expect.objectContaining({
          id: 'n1',
          host: 'host1',
          port: 4000,
          capacity: 8,
          load: 2,
          status: 'online',
        }),
      );
    });

    it('emits cluster.nodeJoined event', () => {
      const ws = createMockWs();
      const events: any[] = [];
      bus.on('cluster.nodeJoined', (data: any) => events.push(data));

      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          node: expect.objectContaining({ id: 'n1', host: 'host1', port: 4000, status: 'online' }),
        }),
      );
    });

    it('uses defaults when nodeInfo fields are missing', () => {
      const ws = createMockWs();
      cm.registerNode(ws, {});

      const nodes = cm.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].host).toBe('unknown');
      expect(nodes[0].port).toBe(0);
      expect(nodes[0].capacity).toBe(CLUSTER_DEFAULT_CAPACITY);
      expect(nodes[0].load).toBe(0);
    });

    it('is a no-op when role is not hub', () => {
      delete process.env.AETHER_CLUSTER_ROLE;
      cm = new ClusterManager(bus);

      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });
      expect(cm.getNodes()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // unregisterNode
  // -------------------------------------------------------------------------

  describe('unregisterNode', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('removes node from internal map', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });
      expect(cm.getNodes()).toHaveLength(1);

      cm.unregisterNode('n1');
      expect(cm.getNodes()).toHaveLength(0);
    });

    it('emits cluster.nodeLeft event', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });

      const events: any[] = [];
      bus.on('cluster.nodeLeft', (data: any) => events.push(data));

      cm.unregisterNode('n1');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ nodeId: 'n1' }));
    });

    it('is a no-op when nodeId does not exist', () => {
      const events: any[] = [];
      bus.on('cluster.nodeLeft', (data: any) => events.push(data));

      cm.unregisterNode('nonexistent');
      expect(events).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // handleNodeHeartbeat
  // -------------------------------------------------------------------------

  describe('handleNodeHeartbeat', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('updates node load and capacity', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000, capacity: 8, load: 0 });

      cm.handleNodeHeartbeat('n1', { load: 5, capacity: 10 });

      const nodes = cm.getNodes();
      expect(nodes[0].load).toBe(5);
      expect(nodes[0].capacity).toBe(10);
    });

    it('updates lastHeartbeat timestamp', () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });

      const timeBefore = Date.now();
      vi.advanceTimersByTime(5000);

      cm.handleNodeHeartbeat('n1', { load: 1, capacity: 8 });

      const nodes = cm.getNodes();
      expect(nodes[0].lastHeartbeat).toBeGreaterThan(timeBefore);
    });

    it('updates gpuAvailable and dockerAvailable when provided', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });

      cm.handleNodeHeartbeat('n1', {
        load: 0,
        capacity: 8,
        gpuAvailable: true,
        dockerAvailable: true,
      });

      const nodes = cm.getNodes();
      expect(nodes[0].gpuAvailable).toBe(true);
      expect(nodes[0].dockerAvailable).toBe(true);
    });

    it('marks offline node back as online', () => {
      vi.useFakeTimers();
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'host1', port: 4000 });

      // Start health check manually by calling init
      cm.init();

      // Advance past timeout so node goes offline
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL);

      let nodes = cm.getNodes();
      expect(nodes[0].status).toBe('offline');

      // Send a heartbeat -- node should come back online
      cm.handleNodeHeartbeat('n1', { load: 0, capacity: 8 });
      nodes = cm.getNodes();
      expect(nodes[0].status).toBe('online');
    });

    it('is a no-op for unknown node', () => {
      // Should not throw
      cm.handleNodeHeartbeat('nonexistent', { load: 0, capacity: 8 });
      expect(cm.getNodes()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getNodes
  // -------------------------------------------------------------------------

  describe('getNodes', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('returns empty array when no nodes are registered', () => {
      expect(cm.getNodes()).toEqual([]);
    });

    it('returns array of NodeInfo objects for all registered nodes', () => {
      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001 });
      cm.registerNode(createMockWs(), { id: 'n2', host: 'h2', port: 4002 });

      const nodes = cm.getNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    });

    it('returns copies (not references) of node info', () => {
      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001 });
      const nodes1 = cm.getNodes();
      const nodes2 = cm.getNodes();
      expect(nodes1[0]).toEqual(nodes2[0]);
      expect(nodes1[0]).not.toBe(nodes2[0]); // different object reference
    });
  });

  // -------------------------------------------------------------------------
  // routeCommand
  // -------------------------------------------------------------------------

  describe('routeCommand', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('returns local:true for non-spawn commands', () => {
      const result = cm.routeCommand(listCmd());
      expect(result).toEqual({ local: true });
    });

    it('returns local:true for spawn when standalone', () => {
      delete process.env.AETHER_CLUSTER_ROLE;
      cm = new ClusterManager(bus);
      const result = cm.routeCommand(spawnCmd());
      expect(result).toEqual({ local: true });
    });

    it('returns local:true for spawn when no nodes registered', () => {
      const result = cm.routeCommand(spawnCmd());
      expect(result).toEqual({ local: true });
    });

    it('returns local:true when local capacity is not full', () => {
      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001, capacity: 10, load: 0 });
      cm.updateLocalLoad(0); // well under default capacity
      const result = cm.routeCommand(spawnCmd());
      expect(result).toEqual({ local: true });
    });

    it('routes to least-loaded online node when local is full', () => {
      // Fill local capacity
      cm.updateLocalLoad(CLUSTER_DEFAULT_CAPACITY);

      // Register two nodes with different loads
      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001, capacity: 10, load: 5 });
      cm.registerNode(createMockWs(), { id: 'n2', host: 'h2', port: 4002, capacity: 10, load: 2 });

      const result = cm.routeCommand(spawnCmd());
      expect(result).toEqual({ local: false, nodeId: 'n2' });
    });

    it('returns local:true when all nodes are full', () => {
      cm.updateLocalLoad(CLUSTER_DEFAULT_CAPACITY);
      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001, capacity: 5, load: 5 });
      cm.registerNode(createMockWs(), { id: 'n2', host: 'h2', port: 4002, capacity: 8, load: 8 });

      const result = cm.routeCommand(spawnCmd());
      expect(result).toEqual({ local: true });
    });

    it('skips offline nodes when routing', () => {
      vi.useFakeTimers();
      cm.updateLocalLoad(CLUSTER_DEFAULT_CAPACITY);

      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001, capacity: 10, load: 1 });
      cm.registerNode(createMockWs(), { id: 'n2', host: 'h2', port: 4002, capacity: 10, load: 3 });

      // Drain n1 (mark offline by manipulating through the health check)
      cm.init();
      // Only let n1 miss heartbeats. We do this by advancing time past timeout,
      // then sending a heartbeat for n2 only.
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL);

      // Both are now offline. Bring n2 back.
      cm.handleNodeHeartbeat('n2', { load: 3, capacity: 10 });

      const result = cm.routeCommand(spawnCmd());
      expect(result).toEqual({ local: false, nodeId: 'n2' });
    });

    it('skips draining nodes when routing', () => {
      cm.updateLocalLoad(CLUSTER_DEFAULT_CAPACITY);

      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001, capacity: 10, load: 1 });
      cm.registerNode(createMockWs(), { id: 'n2', host: 'h2', port: 4002, capacity: 10, load: 3 });

      cm.drainNode('n1');

      const result = cm.routeCommand(spawnCmd());
      // n1 is draining so n2 should be chosen
      expect(result).toEqual({ local: false, nodeId: 'n2' });
    });
  });

  // -------------------------------------------------------------------------
  // forwardCommand
  // -------------------------------------------------------------------------

  describe('forwardCommand', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('sends command to node via ws.send', async () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const cmd = spawnCmd('cmd-fwd-1');
      // Don't await -- we need to resolve it via handleNodeResponse
      const promise = cm.forwardCommand('n1', cmd);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'cluster.command', command: cmd }),
      );

      // Resolve the pending request
      cm.handleNodeResponse('n1', 'cmd-fwd-1', [{ type: 'response.ok', id: 'cmd-fwd-1' }]);

      const result = await promise;
      expect(result).toEqual([{ type: 'response.ok', id: 'cmd-fwd-1' }]);
    });

    it('returns error when node does not exist', async () => {
      const result = await cm.forwardCommand('nonexistent', spawnCmd('cmd-x'));
      expect(result).toEqual([
        expect.objectContaining({
          type: 'response.error',
          error: expect.stringContaining('not available'),
        }),
      ]);
    });

    it('returns error when node is offline', async () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      // Mark offline via health check
      await cm.init();
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL);

      const result = await cm.forwardCommand('n1', spawnCmd('cmd-off'));
      expect(result).toEqual([
        expect.objectContaining({
          type: 'response.error',
          error: expect.stringContaining('not available'),
        }),
      ]);
    });

    it('returns error on timeout', async () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const promise = cm.forwardCommand('n1', spawnCmd('cmd-timeout'));

      // Advance 30 seconds (the timeout in forwardCommand)
      vi.advanceTimersByTime(30_000);

      const result = await promise;
      expect(result).toEqual([
        expect.objectContaining({
          type: 'response.error',
          error: expect.stringContaining('timed out'),
        }),
      ]);
    });

    it('returns error when ws.send throws', async () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => {
        throw new Error('connection reset');
      });
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const result = await cm.forwardCommand('n1', spawnCmd('cmd-err'));
      expect(result).toEqual([
        expect.objectContaining({
          type: 'response.error',
          error: expect.stringContaining('Failed to send'),
        }),
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // handleNodeResponse
  // -------------------------------------------------------------------------

  describe('handleNodeResponse', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('resolves pending request with events', async () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const promise = cm.forwardCommand('n1', spawnCmd('cmd-resp'));
      cm.handleNodeResponse('n1', 'cmd-resp', [
        { type: 'response.ok', id: 'cmd-resp', data: { pid: 42 } },
      ]);

      const result = await promise;
      expect(result).toEqual([{ type: 'response.ok', id: 'cmd-resp', data: { pid: 42 } }]);
    });

    it('is a no-op for unknown node', () => {
      // Should not throw
      cm.handleNodeResponse('nonexistent', 'cmd-1', []);
    });

    it('is a no-op for unknown command id', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });
      // Should not throw
      cm.handleNodeResponse('n1', 'unknown-cmd', []);
    });
  });

  // -------------------------------------------------------------------------
  // drainNode
  // -------------------------------------------------------------------------

  describe('drainNode', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('sets node status to draining', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      cm.drainNode('n1');

      const nodes = cm.getNodes();
      expect(nodes[0].status).toBe('draining');
    });

    it('sends drain message to node via ws', () => {
      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      cm.drainNode('n1');

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'cluster.drain' }));
    });

    it('is a no-op for unknown node', () => {
      // Should not throw
      cm.drainNode('nonexistent');
    });

    it('does not throw if ws.send fails during drain', () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => {
        throw new Error('ws closed');
      });
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      expect(() => cm.drainNode('n1')).not.toThrow();
      expect(cm.getNodes()[0].status).toBe('draining');
    });
  });

  // -------------------------------------------------------------------------
  // getClusterInfo
  // -------------------------------------------------------------------------

  describe('getClusterInfo', () => {
    it('returns cluster summary for standalone mode', () => {
      cm = new ClusterManager(bus);
      const info = cm.getClusterInfo();

      expect(info.role).toBe('standalone');
      expect(info.nodes).toEqual([]);
      expect(info.totalCapacity).toBe(CLUSTER_DEFAULT_CAPACITY);
      expect(info.totalLoad).toBe(0);
    });

    it('returns cluster summary for hub mode with nodes', () => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);

      cm.registerNode(createMockWs(), { id: 'n1', host: 'h1', port: 4001, capacity: 10, load: 3 });
      cm.registerNode(createMockWs(), { id: 'n2', host: 'h2', port: 4002, capacity: 8, load: 2 });
      cm.updateLocalLoad(5);

      const info = cm.getClusterInfo();

      expect(info.role).toBe('hub');
      expect(info.nodes).toHaveLength(2);
      // totalCapacity = localCapacity(CLUSTER_DEFAULT_CAPACITY) + 10 + 8
      expect(info.totalCapacity).toBe(CLUSTER_DEFAULT_CAPACITY + 10 + 8);
      // totalLoad = localLoad(5) + 3 + 2
      expect(info.totalLoad).toBe(5 + 3 + 2);
    });

    it('includes hubUrl for node role', () => {
      process.env.AETHER_CLUSTER_ROLE = 'node';
      process.env.AETHER_HUB_URL = 'ws://hub:3000';
      cm = new ClusterManager(bus);

      const info = cm.getClusterInfo();
      expect(info.hubUrl).toBe('ws://hub:3000');
    });
  });

  // -------------------------------------------------------------------------
  // updateLocalLoad / setLocalCapabilities
  // -------------------------------------------------------------------------

  describe('updateLocalLoad / setLocalCapabilities', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
    });

    it('updateLocalLoad updates the load reflected in cluster info', () => {
      cm.updateLocalLoad(7);
      expect(cm.getClusterInfo().totalLoad).toBe(7);
    });

    it('setLocalCapabilities updates internal state', () => {
      cm.setLocalCapabilities(true, true);
      // Capabilities are internal but affect node registration in node mode.
      // For hub mode we just verify no error is thrown.
      expect(() => cm.setLocalCapabilities(false, false)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Health Check (hub mode)
  // -------------------------------------------------------------------------

  describe('health check', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('marks node offline after heartbeat timeout', async () => {
      await cm.init();

      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const offlineEvents: any[] = [];
      bus.on('cluster.nodeOffline', (data: any) => offlineEvents.push(data));

      // Advance past the timeout
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL);

      expect(offlineEvents).toHaveLength(1);
      expect(offlineEvents[0]).toEqual(expect.objectContaining({ nodeId: 'n1' }));
      expect(cm.getNodes()[0].status).toBe('offline');
    });

    it('does not mark node offline if heartbeats are received in time', async () => {
      await cm.init();

      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const offlineEvents: any[] = [];
      bus.on('cluster.nodeOffline', (data: any) => offlineEvents.push(data));

      // Send heartbeats periodically within timeout
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(CLUSTER_HEARTBEAT_INTERVAL);
        cm.handleNodeHeartbeat('n1', { load: i, capacity: 10 });
      }

      expect(offlineEvents).toHaveLength(0);
      expect(cm.getNodes()[0].status).toBe('online');
    });

    it('does not re-emit offline for already-offline nodes', async () => {
      await cm.init();

      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      const offlineEvents: any[] = [];
      bus.on('cluster.nodeOffline', (data: any) => offlineEvents.push(data));

      // First timeout - goes offline
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL);
      expect(offlineEvents).toHaveLength(1);

      // Additional health check cycles should NOT emit again
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_INTERVAL * 3);
      expect(offlineEvents).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // shutdown
  // -------------------------------------------------------------------------

  describe('shutdown', () => {
    it('clears intervals and closes node connections', async () => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await cm.init();

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      cm.registerNode(ws1, { id: 'n1', host: 'h1', port: 4001 });
      cm.registerNode(ws2, { id: 'n2', host: 'h2', port: 4002 });

      await cm.shutdown();

      expect(ws1.close).toHaveBeenCalledWith(1001, 'Hub shutting down');
      expect(ws2.close).toHaveBeenCalledWith(1001, 'Hub shutting down');
      expect(cm.getNodes()).toHaveLength(0);
    });

    it('does not throw if ws.close throws during shutdown', async () => {
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);

      const ws = createMockWs();
      ws.close.mockImplementation(() => {
        throw new Error('already closed');
      });
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      await expect(cm.shutdown()).resolves.toBeUndefined();
    });

    it('clears health check interval so no further checks run', async () => {
      vi.useFakeTimers();
      process.env.AETHER_CLUSTER_ROLE = 'hub';
      cm = new ClusterManager(bus);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await cm.init();

      const ws = createMockWs();
      cm.registerNode(ws, { id: 'n1', host: 'h1', port: 4001 });

      await cm.shutdown();

      // Re-register a node to verify health check is no longer running
      // (we need a new ClusterManager for fresh nodes, but after shutdown
      // the old intervals should be gone)
      const offlineEvents: any[] = [];
      bus.on('cluster.nodeOffline', (data: any) => offlineEvents.push(data));

      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_TIMEOUT + CLUSTER_HEARTBEAT_INTERVAL * 2);
      // No offline events since nodes were cleared and intervals stopped
      expect(offlineEvents).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // connectToHub (node mode)
  // -------------------------------------------------------------------------

  describe('connectToHub', () => {
    beforeEach(() => {
      process.env.AETHER_CLUSTER_ROLE = 'node';
      process.env.AETHER_HUB_URL = 'ws://hub:3000';
      cm = new ClusterManager(bus);
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('sends registration message to hub', () => {
      const ws = createMockWs();
      cm.connectToHub(ws);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentPayload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentPayload.type).toBe('cluster.register');
      expect(sentPayload.node).toEqual(
        expect.objectContaining({
          id: cm.getNodeId(),
          capacity: CLUSTER_DEFAULT_CAPACITY,
        }),
      );
    });

    it('registers on("close") and on("error") handlers', () => {
      const ws = createMockWs();
      cm.connectToHub(ws);

      const onCalls = ws.on.mock.calls.map((c: any[]) => c[0]);
      expect(onCalls).toContain('close');
      expect(onCalls).toContain('error');
    });

    it('starts sending heartbeats', () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      cm.connectToHub(ws);

      // First call is the registration
      expect(ws.send).toHaveBeenCalledTimes(1);

      // Advance by one heartbeat interval
      vi.advanceTimersByTime(CLUSTER_HEARTBEAT_INTERVAL);

      // Should have sent a heartbeat (second call)
      expect(ws.send).toHaveBeenCalledTimes(2);
      const heartbeat = JSON.parse(ws.send.mock.calls[1][0]);
      expect(heartbeat.type).toBe('cluster.heartbeat');
      expect(heartbeat.nodeId).toBe(cm.getNodeId());
    });

    it('is a no-op when role is not node', () => {
      delete process.env.AETHER_CLUSTER_ROLE;
      delete process.env.AETHER_HUB_URL;
      cm = new ClusterManager(bus);

      const ws = createMockWs();
      cm.connectToHub(ws);

      expect(ws.send).not.toHaveBeenCalled();
      expect(ws.on).not.toHaveBeenCalled();
    });

    it('emits cluster.hubDisconnected when connection closes', () => {
      const ws = createMockWs();
      cm.connectToHub(ws);

      const events: any[] = [];
      bus.on('cluster.hubDisconnected', (data: any) => events.push(data));

      // Find the close handler and call it
      const closeCall = ws.on.mock.calls.find((c: any[]) => c[0] === 'close');
      expect(closeCall).toBeDefined();
      closeCall![1](); // invoke the close handler

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({}));
    });

    it('handles registration send failure gracefully', () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => {
        throw new Error('ws not ready');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => cm.connectToHub(ws)).not.toThrow();
    });
  });
});
