/**
 * Aether OS - Kernel Client
 *
 * The frontend's connection to the kernel server. Manages WebSocket
 * communication, reconnection, and provides a typed API for all
 * kernel operations.
 *
 * This replaces the mock agent loop and simulated file system
 * with real kernel-backed operations.
 *
 * Usage:
 *   const kernel = new KernelClient('ws://localhost:3001/kernel');
 *   kernel.on('process.spawned', (data) => { ... });
 *   await kernel.spawnAgent({ role: 'Coder', goal: 'Build a web app' });
 */

// Types inlined to avoid import issues with Vite's module resolution
// These mirror @aether/shared exactly

type PID = number;
type Signal = 'SIGTERM' | 'SIGKILL' | 'SIGSTOP' | 'SIGCONT' | 'SIGINT' | 'SIGUSR1' | 'SIGUSR2';
type ProcessState = 'created' | 'running' | 'sleeping' | 'stopped' | 'zombie' | 'dead';
type AgentPhase =
  | 'booting'
  | 'thinking'
  | 'executing'
  | 'waiting'
  | 'observing'
  | 'idle'
  | 'completed'
  | 'failed';

export interface KernelProcessInfo {
  pid: PID;
  ppid: PID;
  uid: string;
  ownerUid?: string;
  name: string;
  command: string;
  state: ProcessState;
  agentPhase?: AgentPhase;
  cwd: string;
  env: Record<string, string>;
  createdAt: number;
  cpuPercent: number;
  memoryMB: number;
  ttyId?: string;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

export interface ClusterInfo {
  role: 'hub' | 'node' | 'standalone';
  hubUrl?: string;
  nodes: Array<{
    id: string;
    host: string;
    port: number;
    capacity: number;
    load: number;
    gpuAvailable: boolean;
    dockerAvailable: boolean;
    status: 'online' | 'offline' | 'draining';
  }>;
  totalCapacity: number;
  totalLoad: number;
}

export interface KernelAgentConfig {
  role: string;
  goal: string;
  model?: string;
  tools?: string[];
  maxSteps?: number;
  sandbox?: {
    type?: 'process' | 'container' | 'vm';
    graphical?: boolean;
    gpu?: { enabled: boolean; count?: number; deviceIds?: string[] };
    networkAccess?: boolean;
    memoryLimitMB?: number;
    cpuLimit?: number;
    image?: string;
  };
}

export interface VNCInfo {
  pid: number;
  wsPort: number;
  display: string;
}

export interface GPUInfo {
  id: number;
  name: string;
  memoryTotal: number;
  memoryFree: number;
  utilization: number;
}

export interface GPUStats extends GPUInfo {
  temperature: number;
  powerUsage: number;
}

export interface KernelFileStat {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'pipe' | 'device';
  size: number;
  uid: string;
  createdAt: number;
  modifiedAt: number;
  isHidden: boolean;
}

// Default connection settings
const DEFAULT_WS_URL = 'ws://localhost:3001/kernel';
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL = 30000;

type EventHandler = (data: any) => void;

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class KernelClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners = new Map<string, Set<EventHandler>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _version: string = '';
  private _token: string | null = null;
  private _currentUser: UserInfo | null = null;

  constructor(url?: string) {
    this.url = url || DEFAULT_WS_URL;
  }

  // -----------------------------------------------------------------------
  // Connection Management
  // -----------------------------------------------------------------------

  /**
   * Connect to the kernel server.
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)
      return;

    try {
      const wsUrl = this._token ? `${this.url}?token=${encodeURIComponent(this._token)}` : this.url;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connection', { connected: true });
        console.log('[KernelClient] Connected to kernel');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleEvent(data);
        } catch (err) {
          console.error('[KernelClient] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        this._connected = false;
        this.stopHeartbeat();
        this.emit('connection', { connected: false, code: event.code });
        console.log('[KernelClient] Disconnected from kernel');

        // Auto-reconnect unless intentionally closed
        if (event.code !== 1000) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Error is followed by close event, so we handle reconnection there
      };
    } catch (err) {
      console.error('[KernelClient] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the kernel server.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    this._connected = false;
  }

  /**
   * Force a fresh reconnection (disconnect + connect).
   * Useful after token changes to ensure the WS URL includes the new token.
   */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  get connected(): boolean {
    return this._connected;
  }

  get version(): string {
    return this._version;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[KernelClient] Max reconnect attempts reached');
      this.emit('connection', { connected: false, error: 'Max reconnect attempts reached' });
      return;
    }

    const delay = RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`[KernelClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'kernel.status', id: `hb_${Date.now()}` });
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Message Handling
  // -----------------------------------------------------------------------

  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Send a command and wait for its response.
   */
  private request<T = any>(cmd: any, timeout = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      cmd.id = id;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${cmd.type}`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout: timer });
      this.send(cmd);
    });
  }

  private handleEvent(event: any): void {
    // Handle responses to pending requests
    if (event.type === 'response.ok' || event.type === 'response.error') {
      const pending = this.pendingRequests.get(event.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(event.id);

        if (event.type === 'response.ok') {
          pending.resolve(event.data);
        } else {
          pending.reject(new Error(event.error));
        }
      }
    }

    // Track kernel version
    if (event.type === 'kernel.ready') {
      this._version = event.version;
    }

    // Emit the event to all listeners
    this.emit(event.type, event);
  }

  // -----------------------------------------------------------------------
  // Event System
  // -----------------------------------------------------------------------

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  off(event: string, handler?: EventHandler): void {
    if (handler) {
      this.listeners.get(event)?.delete(handler);
    } else {
      this.listeners.delete(event);
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[KernelClient] Error in handler for '${event}':`, err);
        }
      }
    }
    // Wildcard listeners
    const wildcardHandlers = this.listeners.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler({ type: event, ...data });
        } catch {}
      }
    }
  }

  // -----------------------------------------------------------------------
  // Process API
  // -----------------------------------------------------------------------

  /**
   * Spawn a new agent process.
   */
  async spawnAgent(config: KernelAgentConfig): Promise<{ pid: PID; ttyId: string }> {
    return this.request({ type: 'process.spawn', config });
  }

  /**
   * Send a signal to a process.
   */
  async signalProcess(pid: PID, signal: Signal): Promise<void> {
    return this.request({ type: 'process.signal', pid, signal });
  }

  /**
   * Kill a process (SIGTERM).
   */
  async killProcess(pid: PID): Promise<void> {
    return this.signalProcess(pid, 'SIGTERM');
  }

  /**
   * Pause a running agent.
   */
  async pauseAgent(pid: PID): Promise<void> {
    return this.request({ type: 'agent.pause', pid });
  }

  /**
   * Resume a paused agent.
   */
  async resumeAgent(pid: PID): Promise<void> {
    return this.request({ type: 'agent.resume', pid });
  }

  /**
   * Continue an agent that hit its step limit.
   */
  async continueAgent(pid: PID, extraSteps = 25): Promise<void> {
    return this.request({ type: 'agent.continue', pid, extraSteps });
  }

  /**
   * List all active processes.
   */
  async listProcesses(): Promise<KernelProcessInfo[]> {
    return this.request({ type: 'process.list' });
  }

  /**
   * Get info about a specific process.
   */
  async getProcessInfo(pid: PID): Promise<KernelProcessInfo> {
    return this.request({ type: 'process.info', pid });
  }

  /**
   * Approve a pending agent action.
   */
  async approveAction(pid: PID): Promise<void> {
    return this.request({ type: 'process.approve', pid });
  }

  /**
   * Reject a pending agent action.
   */
  async rejectAction(pid: PID, reason?: string): Promise<void> {
    return this.request({ type: 'process.reject', pid, reason });
  }

  // -----------------------------------------------------------------------
  // Filesystem API
  // -----------------------------------------------------------------------

  /**
   * Read a file.
   */
  async readFile(path: string): Promise<{ content: string; size: number }> {
    return this.request({ type: 'fs.read', path });
  }

  /**
   * Write a file.
   */
  async writeFile(path: string, content: string): Promise<void> {
    return this.request({ type: 'fs.write', path, content });
  }

  /**
   * List directory contents.
   */
  async listDir(path: string): Promise<KernelFileStat[]> {
    return this.request({ type: 'fs.ls', path });
  }

  /**
   * Get file stats.
   */
  async statFile(path: string): Promise<KernelFileStat> {
    return this.request({ type: 'fs.stat', path });
  }

  /**
   * Create a directory.
   */
  async mkdir(path: string): Promise<void> {
    return this.request({ type: 'fs.mkdir', path, recursive: true });
  }

  /**
   * Delete a file or directory.
   */
  async rm(path: string, recursive = false): Promise<void> {
    return this.request({ type: 'fs.rm', path, recursive });
  }

  /**
   * Upload a file to the virtual filesystem.
   */
  async uploadFile(file: File, destinationPath: string): Promise<{ path: string; size: number }> {
    const fullPath = destinationPath.endsWith('/')
      ? `${destinationPath}${file.name}`
      : `${destinationPath}/${file.name}`;

    const res = await fetch(
      `${this.getBaseUrl()}/api/fs/upload?path=${encodeURIComponent(fullPath)}`,
      {
        method: 'POST',
        headers: {
          ...(this._token ? { Authorization: `Bearer ${this._token}` } : {}),
        },
        body: file,
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Terminal API
  // -----------------------------------------------------------------------

  /**
   * Open a terminal session for a process.
   */
  async openTerminal(pid: PID, cols?: number, rows?: number): Promise<{ ttyId: string }> {
    return this.request({ type: 'tty.open', pid, cols, rows });
  }

  /**
   * Send input to a terminal.
   */
  sendTerminalInput(ttyId: string, data: string): void {
    this.send({ type: 'tty.input', id: `tty_${Date.now()}`, ttyId, data });
  }

  /**
   * Resize a terminal.
   */
  resizeTerminal(ttyId: string, cols: number, rows: number): void {
    this.send({ type: 'tty.resize', id: `tty_${Date.now()}`, ttyId, cols, rows });
  }

  /**
   * Close a terminal session.
   */
  closeTerminal(ttyId: string): void {
    this.send({ type: 'tty.close', id: `tty_${Date.now()}`, ttyId });
  }

  // -----------------------------------------------------------------------
  // VNC API
  // -----------------------------------------------------------------------

  /**
   * Get VNC proxy info for a graphical agent.
   */
  async getVNCInfo(pid: number): Promise<VNCInfo | null> {
    try {
      return await this.request({ type: 'vnc.info', pid });
    } catch {
      return null;
    }
  }

  /**
   * Execute a graphical command inside an agent's container.
   */
  async execGraphical(pid: number, command: string): Promise<void> {
    return this.request({ type: 'vnc.exec', pid, command });
  }

  // -----------------------------------------------------------------------
  // GPU API
  // -----------------------------------------------------------------------

  /**
   * List available GPUs and allocations.
   */
  async getGPUs(): Promise<{
    gpus: GPUInfo[];
    allocations: Array<{ pid: number; gpuIds: number[] }>;
  }> {
    const res = await fetch(`${this.getBaseUrl()}/api/gpu`, { headers: this.getRestHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch GPUs: ${res.statusText}`);
    return res.json();
  }

  /**
   * Get real-time GPU stats.
   */
  async getGPUStats(): Promise<GPUStats[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/gpu/stats`, {
      headers: this.getRestHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch GPU stats: ${res.statusText}`);
    return res.json();
  }

  // -----------------------------------------------------------------------
  // History API (REST - fetches from HTTP endpoints)
  // -----------------------------------------------------------------------

  /**
   * Get agent log history for a specific PID.
   */
  private getRestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    return headers;
  }

  private getBaseUrl(): string {
    return this.url
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace('/kernel', '');
  }

  async getAgentHistory(pid: number): Promise<
    Array<{
      id: number;
      pid: number;
      step: number;
      phase: string;
      tool?: string;
      content: string;
      timestamp: number;
    }>
  > {
    const res = await fetch(`${this.getBaseUrl()}/api/history/logs/${pid}`, {
      headers: this.getRestHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch agent history: ${res.statusText}`);
    return res.json();
  }

  /**
   * Get process history (all spawned agents).
   */
  async getProcessHistory(): Promise<
    Array<{
      pid: number;
      uid: string;
      name: string;
      role: string;
      goal: string;
      state: string;
      agentPhase?: string;
      exitCode?: number;
      createdAt: number;
      exitedAt?: number;
    }>
  > {
    const res = await fetch(`${this.getBaseUrl()}/api/history/processes`, {
      headers: this.getRestHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch process history: ${res.statusText}`);
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Auth API
  // -----------------------------------------------------------------------

  /**
   * Set the auth token. Reconnects if already connected.
   */
  setToken(token: string | null): void {
    this._token = token;
    if (token) {
      localStorage.setItem('aether_token', token);
    } else {
      localStorage.removeItem('aether_token');
      this._currentUser = null;
    }

    // Reconnect with new token
    if (this._connected) {
      this.disconnect();
      this.connect();
    }
  }

  getToken(): string | null {
    return this._token;
  }

  /**
   * Login via the kernel WebSocket.
   */
  async login(username: string, password: string): Promise<{ token: string; user: UserInfo }> {
    const result = await this.request<{ token: string; user: UserInfo }>({
      type: 'auth.login',
      username,
      password,
    });
    this._currentUser = result.user;
    this.setToken(result.token);
    return result;
  }

  /**
   * Login via HTTP REST endpoint (useful before WS is connected).
   */
  async loginHttp(username: string, password: string): Promise<{ token: string; user: UserInfo }> {
    const baseUrl = this.url
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace('/kernel', '');
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(data.error || 'Login failed');
    }
    const result = await res.json();
    this._currentUser = result.user;
    this.setToken(result.token);
    return result;
  }

  /**
   * Register via HTTP REST endpoint.
   */
  async registerHttp(
    username: string,
    password: string,
    displayName?: string,
  ): Promise<{ token: string; user: UserInfo }> {
    const baseUrl = this.url
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace('/kernel', '');
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, displayName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(data.error || 'Registration failed');
    }
    const result = await res.json();
    this._currentUser = result.user;
    this.setToken(result.token);
    return result;
  }

  /**
   * Validate the current stored token.
   */
  async validateToken(token: string): Promise<UserInfo | null> {
    try {
      const result = await this.request<{ user: UserInfo }>({
        type: 'auth.validate',
        token,
      });
      this._currentUser = result.user;
      return result.user;
    } catch {
      return null;
    }
  }

  /**
   * Get the currently authenticated user.
   */
  getCurrentUser(): UserInfo | null {
    return this._currentUser;
  }

  /**
   * Set current user (used when restoring from token validation).
   */
  setCurrentUser(user: UserInfo | null): void {
    this._currentUser = user;
  }

  /**
   * Logout - clear token and user.
   */
  logout(): void {
    this._currentUser = null;
    this.setToken(null);
  }

  // -----------------------------------------------------------------------
  // Cluster API
  // -----------------------------------------------------------------------

  /**
   * Get cluster status information.
   */
  async getClusterInfo(): Promise<ClusterInfo> {
    const baseUrl = this.url
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace('/kernel', '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    const res = await fetch(`${baseUrl}/api/cluster`, { headers });
    if (!res.ok) throw new Error('Failed to fetch cluster info');
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Cron & Trigger API
  // -----------------------------------------------------------------------

  /**
   * List all cron jobs.
   */
  async listCronJobs(): Promise<any[]> {
    return this.request({ type: 'cron.list' });
  }

  /**
   * Create a cron job.
   */
  async createCronJob(
    name: string,
    cron_expression: string,
    agent_config: KernelAgentConfig,
    owner_uid: string,
  ): Promise<any> {
    return this.request({ type: 'cron.create', name, cron_expression, agent_config, owner_uid });
  }

  /**
   * Delete a cron job.
   */
  async deleteCronJob(jobId: string): Promise<void> {
    return this.request({ type: 'cron.delete', jobId });
  }

  /**
   * Enable a cron job.
   */
  async enableCronJob(jobId: string): Promise<void> {
    return this.request({ type: 'cron.enable', jobId });
  }

  /**
   * Disable a cron job.
   */
  async disableCronJob(jobId: string): Promise<void> {
    return this.request({ type: 'cron.disable', jobId });
  }

  /**
   * List all event triggers.
   */
  async listTriggers(): Promise<any[]> {
    return this.request({ type: 'trigger.list' });
  }

  /**
   * Create an event trigger.
   */
  async createTrigger(
    name: string,
    event_type: string,
    agent_config: KernelAgentConfig,
    owner_uid: string,
    cooldown_ms?: number,
    event_filter?: Record<string, any>,
  ): Promise<any> {
    return this.request({
      type: 'trigger.create',
      name,
      event_type,
      agent_config,
      owner_uid,
      cooldown_ms,
      event_filter,
    });
  }

  /**
   * Delete an event trigger.
   */
  async deleteTrigger(triggerId: string): Promise<void> {
    return this.request({ type: 'trigger.delete', triggerId });
  }

  // -----------------------------------------------------------------------
  // System API
  // -----------------------------------------------------------------------

  /**
   * Get kernel status.
   */
  async getStatus(): Promise<{
    version: string;
    uptime: number;
    processes: Record<string, number>;
  }> {
    return this.request({ type: 'kernel.status' });
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

let _instance: KernelClient | null = null;

/**
 * Get the global KernelClient instance.
 * Connects automatically on first call.
 */
export function getKernelClient(url?: string): KernelClient {
  if (!_instance) {
    _instance = new KernelClient(url);
  }
  return _instance;
}
