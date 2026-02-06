/**
 * Aether Kernel - Cluster Manager
 *
 * Hub-and-spoke model for distributing the kernel across multiple hosts.
 *
 * Hub mode (default):
 *   - Accepts node registrations via WebSocket on /cluster
 *   - Tracks registered nodes and their health via heartbeats
 *   - Routes process.spawn to least-loaded node when local capacity is full
 *   - Proxies commands for remote processes to the appropriate node
 *
 * Node mode (AETHER_CLUSTER_ROLE=node):
 *   - Connects to hub at AETHER_HUB_URL via WebSocket
 *   - Sends heartbeat every 10s with current load and resources
 *   - Receives commands from hub and executes locally
 *   - Reports events back to hub for UI broadcast
 */

import { EventBus } from './EventBus.js';
import {
  NodeInfo,
  ClusterInfo,
  ClusterRole,
  NodeStatus,
  KernelCommand,
  KernelEvent,
  PID,
  CLUSTER_HEARTBEAT_INTERVAL,
  CLUSTER_HEARTBEAT_TIMEOUT,
  CLUSTER_DEFAULT_CAPACITY,
} from '@aether/shared';
import * as crypto from 'node:crypto';

interface RegisteredNode {
  info: NodeInfo;
  ws: any;  // WebSocket instance (from ws library on server side)
  lastHeartbeat: number;
  pendingRequests: Map<string, { resolve: (events: KernelEvent[]) => void; timeout: ReturnType<typeof setTimeout> }>;
}

export class ClusterManager {
  private bus: EventBus;
  private role: ClusterRole;
  private nodeId: string;
  private nodes = new Map<string, RegisteredNode>();
  private hubWs: any = null;           // WebSocket to hub (node mode)
  private hubUrl?: string;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private healthCheckInterval?: ReturnType<typeof setInterval>;
  private localCapacity: number;
  private localLoad = 0;
  private localGpuAvailable = false;
  private localDockerAvailable = false;

  constructor(bus: EventBus) {
    this.bus = bus;
    this.nodeId = crypto.randomUUID().substring(0, 8);

    // Determine role from env
    const envRole = process.env.AETHER_CLUSTER_ROLE;
    if (envRole === 'node') {
      this.role = 'node';
      this.hubUrl = process.env.AETHER_HUB_URL;
      if (!this.hubUrl) {
        console.warn('[Cluster] AETHER_CLUSTER_ROLE=node but AETHER_HUB_URL not set. Running standalone.');
        this.role = 'standalone';
      }
    } else if (envRole === 'hub') {
      this.role = 'hub';
    } else {
      this.role = 'standalone';
    }

    this.localCapacity = parseInt(process.env.AETHER_NODE_CAPACITY || String(CLUSTER_DEFAULT_CAPACITY), 10);
  }

  /**
   * Initialize the cluster manager.
   */
  async init(): Promise<void> {
    if (this.role === 'standalone') {
      console.log('[Cluster] Running in standalone mode (no clustering)');
      return;
    }

    if (this.role === 'hub') {
      console.log(`[Cluster] Running as HUB (node id: ${this.nodeId})`);
      this.startHealthCheck();
    }

    if (this.role === 'node') {
      console.log(`[Cluster] Running as NODE (id: ${this.nodeId}), connecting to hub: ${this.hubUrl}`);
      // Connection is established externally by the server when WS is available
    }
  }

  // ---------------------------------------------------------------------------
  // Hub Mode - Node Management
  // ---------------------------------------------------------------------------

  /**
   * Register a new node (hub mode). Called when a node connects via WebSocket.
   */
  registerNode(ws: any, nodeInfo: Partial<NodeInfo>): void {
    if (this.role !== 'hub') return;

    const info: NodeInfo = {
      id: nodeInfo.id || crypto.randomUUID().substring(0, 8),
      host: nodeInfo.host || 'unknown',
      port: nodeInfo.port || 0,
      capacity: nodeInfo.capacity || CLUSTER_DEFAULT_CAPACITY,
      load: nodeInfo.load || 0,
      gpuAvailable: nodeInfo.gpuAvailable || false,
      dockerAvailable: nodeInfo.dockerAvailable || false,
      status: 'online',
      lastHeartbeat: Date.now(),
    };

    const node: RegisteredNode = {
      info,
      ws,
      lastHeartbeat: Date.now(),
      pendingRequests: new Map(),
    };

    this.nodes.set(info.id, node);
    console.log(`[Cluster] Node registered: ${info.id} (${info.host}:${info.port}, capacity: ${info.capacity})`);

    this.bus.emit('cluster.nodeJoined', { node: info });
  }

  /**
   * Unregister a node (hub mode). Called when a node disconnects.
   */
  unregisterNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    this.nodes.delete(nodeId);
    console.log(`[Cluster] Node unregistered: ${nodeId}`);

    this.bus.emit('cluster.nodeLeft', { nodeId });
  }

  /**
   * Handle a heartbeat from a node.
   */
  handleNodeHeartbeat(nodeId: string, data: { load: number; capacity: number; gpuAvailable?: boolean; dockerAvailable?: boolean }): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.lastHeartbeat = Date.now();
    node.info.lastHeartbeat = Date.now();
    node.info.load = data.load;
    node.info.capacity = data.capacity;
    if (data.gpuAvailable !== undefined) node.info.gpuAvailable = data.gpuAvailable;
    if (data.dockerAvailable !== undefined) node.info.dockerAvailable = data.dockerAvailable;

    // If node was offline, mark it as online again
    if (node.info.status === 'offline') {
      node.info.status = 'online';
      console.log(`[Cluster] Node ${nodeId} is back online`);
    }
  }

  /**
   * Get all registered nodes.
   */
  getNodes(): NodeInfo[] {
    return Array.from(this.nodes.values()).map(n => ({ ...n.info }));
  }

  /**
   * Determine where to route a command.
   * Returns { local: true } if it should run locally, or { local: false, nodeId } for remote.
   */
  routeCommand(cmd: KernelCommand): { local: boolean; nodeId?: string } {
    // Only route process.spawn commands
    if (cmd.type !== 'process.spawn') {
      return { local: true };
    }

    // If standalone or no nodes, always local
    if (this.role !== 'hub' || this.nodes.size === 0) {
      return { local: true };
    }

    // If local capacity isn't full, run locally
    if (this.localLoad < this.localCapacity) {
      return { local: true };
    }

    // Find least-loaded online node with available capacity
    let bestNode: RegisteredNode | null = null;
    let lowestLoad = Infinity;

    for (const node of this.nodes.values()) {
      if (node.info.status !== 'online') continue;
      if (node.info.status === 'draining' as any) continue;
      if (node.info.load >= node.info.capacity) continue;

      if (node.info.load < lowestLoad) {
        lowestLoad = node.info.load;
        bestNode = node;
      }
    }

    if (bestNode) {
      return { local: false, nodeId: bestNode.info.id };
    }

    // All nodes full, run locally anyway
    return { local: true };
  }

  /**
   * Forward a command to a remote node and wait for response events.
   */
  async forwardCommand(nodeId: string, cmd: KernelCommand): Promise<KernelEvent[]> {
    const node = this.nodes.get(nodeId);
    if (!node || node.info.status !== 'online') {
      return [{ type: 'response.error', id: (cmd as any).id, error: `Node ${nodeId} is not available` }];
    }

    return new Promise((resolve) => {
      const cmdId = (cmd as any).id;
      const timeout = setTimeout(() => {
        node.pendingRequests.delete(cmdId);
        resolve([{ type: 'response.error', id: cmdId, error: `Node ${nodeId} timed out` }]);
      }, 30000);

      node.pendingRequests.set(cmdId, { resolve, timeout });

      try {
        node.ws.send(JSON.stringify({ type: 'cluster.command', command: cmd }));
      } catch {
        clearTimeout(timeout);
        node.pendingRequests.delete(cmdId);
        resolve([{ type: 'response.error', id: cmdId, error: `Failed to send command to node ${nodeId}` }]);
      }
    });
  }

  /**
   * Handle response from a node for a forwarded command.
   */
  handleNodeResponse(nodeId: string, cmdId: string, events: KernelEvent[]): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const pending = node.pendingRequests.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      node.pendingRequests.delete(cmdId);
      pending.resolve(events);
    }
  }

  /**
   * Drain a node — stop accepting new processes, let existing ones finish.
   */
  drainNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.info.status = 'draining';
    console.log(`[Cluster] Node ${nodeId} set to draining`);

    // Notify the node
    try {
      node.ws.send(JSON.stringify({ type: 'cluster.drain' }));
    } catch { /* node may already be disconnected */ }
  }

  // ---------------------------------------------------------------------------
  // Node Mode - Hub Communication
  // ---------------------------------------------------------------------------

  /**
   * Connect to the hub (node mode). Called by the server layer with the WS instance.
   */
  connectToHub(ws: any): void {
    if (this.role !== 'node') return;

    this.hubWs = ws;

    // Send registration
    ws.send(JSON.stringify({
      type: 'cluster.register',
      node: {
        id: this.nodeId,
        host: process.env.AETHER_NODE_HOST || 'localhost',
        port: parseInt(process.env.AETHER_PORT || '3001', 10),
        capacity: this.localCapacity,
        load: this.localLoad,
        gpuAvailable: this.localGpuAvailable,
        dockerAvailable: this.localDockerAvailable,
      },
    }));

    // Start heartbeats
    this.startHeartbeat();
    console.log('[Cluster] Connected to hub');
  }

  /**
   * Send heartbeat to hub (node mode).
   */
  private sendHeartbeat(): void {
    if (!this.hubWs || this.role !== 'node') return;

    try {
      this.hubWs.send(JSON.stringify({
        type: 'cluster.heartbeat',
        nodeId: this.nodeId,
        load: this.localLoad,
        capacity: this.localCapacity,
        gpuAvailable: this.localGpuAvailable,
        dockerAvailable: this.localDockerAvailable,
      }));
    } catch {
      console.error('[Cluster] Failed to send heartbeat to hub');
    }
  }

  /**
   * Handle a command from the hub (node mode).
   */
  async handleHubCommand(cmd: KernelCommand): Promise<KernelEvent[]> {
    // This is called by the server layer which delegates to the kernel
    // The server handles the actual command execution
    return [];
  }

  // ---------------------------------------------------------------------------
  // Health Monitoring (Hub Mode)
  // ---------------------------------------------------------------------------

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();

      for (const [nodeId, node] of this.nodes) {
        if (node.info.status === 'offline') continue;

        const elapsed = now - node.lastHeartbeat;
        if (elapsed > CLUSTER_HEARTBEAT_TIMEOUT) {
          console.warn(`[Cluster] Node ${nodeId} missed heartbeats (${elapsed}ms). Marking offline.`);
          node.info.status = 'offline';
          this.bus.emit('cluster.nodeOffline', { nodeId });
        }
      }
    }, CLUSTER_HEARTBEAT_INTERVAL);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, CLUSTER_HEARTBEAT_INTERVAL);
  }

  // ---------------------------------------------------------------------------
  // Cluster Info
  // ---------------------------------------------------------------------------

  /**
   * Get cluster status information.
   */
  getClusterInfo(): ClusterInfo {
    const nodes = this.getNodes();
    const totalCapacity = this.localCapacity + nodes.reduce((sum, n) => sum + n.capacity, 0);
    const totalLoad = this.localLoad + nodes.reduce((sum, n) => sum + n.load, 0);

    return {
      role: this.role,
      hubUrl: this.hubUrl,
      nodes,
      totalCapacity,
      totalLoad,
    };
  }

  /**
   * Get the cluster role.
   */
  getRole(): ClusterRole {
    return this.role;
  }

  /**
   * Get the node ID.
   */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * Update local load counter.
   */
  updateLocalLoad(load: number): void {
    this.localLoad = load;
  }

  /**
   * Set local capabilities.
   */
  setLocalCapabilities(docker: boolean, gpu: boolean): void {
    this.localDockerAvailable = docker;
    this.localGpuAvailable = gpu;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close all node connections (hub mode)
    for (const [, node] of this.nodes) {
      try {
        node.ws.close(1001, 'Hub shutting down');
      } catch { /* ignore */ }
    }
    this.nodes.clear();

    // Close hub connection (node mode)
    if (this.hubWs) {
      try {
        this.hubWs.close(1001, 'Node shutting down');
      } catch { /* ignore */ }
      this.hubWs = null;
    }
  }
}
