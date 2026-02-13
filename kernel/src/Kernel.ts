/**
 * Aether Kernel
 *
 * The core of Aether OS. Coordinates all subsystems:
 * - ProcessManager: lifecycle of agent processes
 * - VirtualFS: sandboxed filesystem per agent
 * - PTYManager: terminal sessions
 * - ContainerManager: Docker container sandboxing
 * - StateStore: SQLite persistence for history and metrics
 * - EventBus: inter-component communication
 *
 * The kernel processes commands from the UI (via the server's WebSocket
 * handler) and emits events back. It's the single source of truth for
 * all system state.
 *
 * Design note: The kernel is intentionally not aware of the transport
 * layer (WebSocket, HTTP). It takes commands and emits events through
 * the EventBus. The server layer handles transport.
 */

import { EventBus } from './EventBus.js';
import { ProcessManager } from './ProcessManager.js';
import { VirtualFS } from './VirtualFS.js';
import { PTYManager } from './PTYManager.js';
import { ContainerManager } from './ContainerManager.js';
import { VNCManager } from './VNCManager.js';
import { BrowserManager } from './BrowserManager.js';
import { PluginManager } from './PluginManager.js';
import { SnapshotManager } from './SnapshotManager.js';
import { StateStore } from './StateStore.js';
import { MemoryManager } from './MemoryManager.js';
import { CronManager } from './CronManager.js';
import { AuthManager } from './AuthManager.js';
import { ClusterManager } from './ClusterManager.js';
import { WebhookManager } from './WebhookManager.js';
import { AppManager } from './AppManager.js';
import { PluginRegistryManager } from './PluginRegistryManager.js';
import { IntegrationManager } from './IntegrationManager.js';
import { TemplateManager } from './TemplateManager.js';
import { SkillManager } from './SkillManager.js';
import { RemoteAccessManager } from './RemoteAccessManager.js';
import { ResourceGovernor } from './ResourceGovernor.js';
import { AuditLogger } from './AuditLogger.js';
import { ModelRouter } from './ModelRouter.js';
import { MetricsExporter } from './MetricsExporter.js';
import { ToolCompatLayer } from './ToolCompatLayer.js';
import {
  KernelCommand,
  KernelEvent,
  UserInfo,
  AETHER_VERSION,
  DEFAULT_PORT,
  ProcessInfo,
  AgentProfile,
} from '@aether/shared';

export class Kernel {
  readonly version = AETHER_VERSION;
  readonly bus: EventBus;
  readonly processes: ProcessManager;
  readonly fs: VirtualFS;
  readonly pty: PTYManager;
  readonly containers: ContainerManager;
  readonly vnc: VNCManager;
  readonly browser: BrowserManager;
  readonly plugins: PluginManager;
  readonly snapshots: SnapshotManager;
  readonly state: StateStore;
  readonly memory: MemoryManager;
  readonly cron: CronManager;
  readonly auth: AuthManager;
  readonly cluster: ClusterManager;
  readonly webhooks: WebhookManager;
  readonly apps: AppManager;
  readonly pluginRegistry: PluginRegistryManager;
  readonly integrations: IntegrationManager;
  readonly templateMarketplace: TemplateManager;
  readonly skills: SkillManager;
  readonly remoteAccess: RemoteAccessManager;
  readonly resources: ResourceGovernor;
  readonly audit: AuditLogger;
  readonly modelRouter: ModelRouter;
  readonly metrics: MetricsExporter;
  readonly toolCompat: ToolCompatLayer;

  private startTime: number;
  private running = false;

  constructor(options: { fsRoot?: string; dbPath?: string } = {}) {
    this.bus = new EventBus();
    this.processes = new ProcessManager(this.bus);
    this.fs = new VirtualFS(this.bus, options.fsRoot);
    this.containers = new ContainerManager(this.bus);
    this.vnc = new VNCManager(this.bus);
    this.browser = new BrowserManager(this.bus);
    this.pty = new PTYManager(this.bus);
    this.plugins = new PluginManager(this.bus, options.fsRoot);
    this.state = new StateStore(this.bus, options.dbPath);
    this.memory = new MemoryManager(this.bus, this.state);
    this.cron = new CronManager(this.bus, this.state);
    this.auth = new AuthManager(this.bus, this.state);
    this.cluster = new ClusterManager(this.bus);
    this.webhooks = new WebhookManager(this.bus, this.state);
    this.apps = new AppManager(this.bus, this.state);
    this.pluginRegistry = new PluginRegistryManager(this.bus, this.state);
    this.integrations = new IntegrationManager(this.bus, this.state);
    this.templateMarketplace = new TemplateManager(this.bus, this.state);
    this.skills = new SkillManager(this.bus, this.state);
    this.remoteAccess = new RemoteAccessManager(this.bus, this.state);
    this.resources = new ResourceGovernor(this.bus, this.processes);
    this.audit = new AuditLogger(this.bus, this.state);
    this.modelRouter = new ModelRouter();
    this.metrics = new MetricsExporter(this.bus, this.processes, this.resources);
    this.toolCompat = new ToolCompatLayer(this.bus, this.state);
    this.snapshots = new SnapshotManager(
      this.bus,
      this.processes,
      this.state,
      options.fsRoot,
      this.memory,
      this.resources,
    );
    this.startTime = Date.now();
  }

  /**
   * Boot the kernel. Initialize all subsystems.
   */
  async boot(): Promise<void> {
    if (this.running) return;

    console.log(`[Kernel] Aether OS v${this.version} booting...`);
    console.log(`[Kernel] Data root: ${this.fs.getRealRoot()}`);

    // Warn about legacy /tmp/aether data if the new default is in use
    if (!process.env.AETHER_FS_ROOT) {
      try {
        const legacyRoot = process.platform === 'win32' ? 'C:\\temp\\aether' : '/tmp/aether';
        const legacyFs = await import('node:fs/promises');
        const legacyStat = await legacyFs.stat(legacyRoot).catch(() => null);
        if (legacyStat?.isDirectory()) {
          console.warn(`[Kernel] ⚠ Legacy data found at ${legacyRoot}`);
          console.warn(`[Kernel]   Data now lives at ${this.fs.getRealRoot()}`);
          console.warn(
            `[Kernel]   To migrate: copy contents from ${legacyRoot} to ${this.fs.getRealRoot()}`,
          );
        }
      } catch {
        /* ignore */
      }
    }

    // Initialize filesystem
    await this.fs.init();
    console.log('[Kernel] Filesystem initialized');

    // Initialize container manager (detects Docker + GPU availability)
    await this.containers.init();
    console.log(
      `[Kernel] Container manager initialized (Docker: ${this.containers.isDockerAvailable() ? 'available' : 'unavailable, using process fallback'})`,
    );
    console.log(
      `[Kernel] GPU: ${this.containers.isGPUAvailable() ? `${this.containers.getGPUs().length} GPU(s) detected` : 'not available'}`,
    );

    // VNC manager is initialized (starts proxies on demand)
    console.log('[Kernel] VNC manager initialized');

    // Initialize browser manager (detects Playwright availability)
    await this.browser.init();
    console.log(
      `[Kernel] Browser manager initialized (Playwright: ${this.browser.isAvailable() ? 'available' : 'unavailable'})`,
    );

    // Wire container manager into PTY manager
    this.pty.setContainerManager(this.containers);

    // Initialize snapshot manager
    await this.snapshots.init();
    console.log('[Kernel] Snapshot manager initialized');

    console.log('[Kernel] State store initialized (SQLite)');

    // Initialize memory manager (uses StateStore tables)
    console.log('[Kernel] Memory manager initialized');

    // Initialize cron manager
    this.cron.start(async (config) => {
      const proc = this.processes.spawn(config, 0);
      if (proc) {
        await this.fs.createHome(proc.info.uid);
        this.pty.open(proc.info.pid, {
          cwd: this.fs.getRealRoot() + proc.info.cwd,
          env: proc.info.env,
        });
        this.processes.setState(proc.info.pid, 'running', 'booting');
        return proc.info.pid;
      }
      return null;
    });
    console.log('[Kernel] Cron manager initialized');

    // Initialize auth
    await this.auth.init();
    console.log('[Kernel] Auth manager initialized');

    // Initialize cluster
    await this.cluster.init();
    this.cluster.setLocalCapabilities(this.containers.isDockerAvailable(), false);
    console.log(`[Kernel] Cluster manager initialized (role: ${this.cluster.getRole()})`);

    // Initialize app manager
    await this.apps.init();
    console.log('[Kernel] App manager initialized');

    // Initialize webhook manager
    await this.webhooks.init();
    this.webhooks.setSpawnCallback(async (config) => {
      const proc = this.processes.spawn(config, 0);
      if (proc) {
        await this.fs.createHome(proc.info.uid);
        this.pty.open(proc.info.pid, {
          cwd: this.fs.getRealRoot() + proc.info.cwd,
          env: proc.info.env,
        });
        this.processes.setState(proc.info.pid, 'running', 'booting');
        return proc.info.pid;
      }
      return null;
    });
    console.log('[Kernel] Webhook manager initialized');

    // Initialize plugin registry
    await this.pluginRegistry.init();
    console.log('[Kernel] Plugin registry initialized');

    // Initialize integration manager
    await this.integrations.init();
    console.log('[Kernel] Integration manager initialized');

    // Initialize template marketplace
    await this.templateMarketplace.init();
    console.log('[Kernel] Template marketplace initialized');

    // Initialize skill manager
    await this.skills.init();
    console.log('[Kernel] Skill manager initialized');

    // Initialize remote access manager
    await this.remoteAccess.init();
    console.log('[Kernel] Remote access manager initialized');

    // Resource governor is ready (no async init needed)
    console.log('[Kernel] Resource governor initialized');

    // Audit logger is ready (subscribed to EventBus, prune timer started)
    console.log('[Kernel] Audit logger initialized');

    // Model router is ready (stateless, no async init needed)
    console.log('[Kernel] Model router initialized');

    // Initialize metrics exporter (subscribes to EventBus)
    this.metrics.init();
    console.log('[Kernel] Metrics exporter initialized');

    // Initialize tool compatibility layer
    await this.toolCompat.init();
    console.log('[Kernel] Tool compatibility layer initialized');

    // Listen for process cleanup events to remove agent home directories
    this.bus.on('process.cleanup', async (data: { pid: number; uid: string; cwd: string }) => {
      // Skip cleanup if a snapshot exists for this PID
      try {
        const snapshots = await this.snapshots.listSnapshots(data.pid);
        if (snapshots && snapshots.length > 0) {
          console.log(`[Kernel] Skipping home cleanup for PID ${data.pid} (snapshot exists)`);
          return;
        }
      } catch {
        // Non-critical — proceed with cleanup
      }

      const removed = await this.fs.removeHome(data.uid);
      if (removed) {
        console.log(`[Kernel] Cleaned up home directory for ${data.uid} (PID ${data.pid})`);
      }
    });

    // Handle browser downloads — copy into agent's Downloads folder
    this.bus.on(
      'browser:download',
      async (data: { sessionId: string; filename: string; tempPath: string }) => {
        try {
          const nodeFs = await import('node:fs/promises');
          const content = await nodeFs.readFile(data.tempPath, 'utf-8').catch(() => null);
          if (content !== null) {
            const downloadPath = `/home/downloads/${data.filename}`;
            await this.fs.writeFile(downloadPath, content);
            console.log(`[Kernel] Browser download saved to ${downloadPath}`);
          }
        } catch (err: any) {
          console.warn(`[Kernel] Failed to save browser download: ${err.message}`);
        }
      },
    );

    this.running = true;
    this.startTime = Date.now();

    this.bus.emit('kernel.ready', {
      version: this.version,
      uptime: 0,
    });

    this.printBootBanner();
  }

  /**
   * Handle a command from the UI.
   * Returns events to send back.
   * @param user - The authenticated user making the request (if any)
   */
  async handleCommand(cmd: KernelCommand, user?: UserInfo): Promise<KernelEvent[]> {
    const events: KernelEvent[] = [];

    try {
      switch (cmd.type) {
        // ----- Process Commands -----
        case 'process.spawn': {
          // Route via cluster if needed
          const route = this.cluster.routeCommand(cmd);
          if (!route.local && route.nodeId) {
            const remoteEvents = await this.cluster.forwardCommand(route.nodeId, cmd);
            return remoteEvents;
          }

          const proc = this.processes.spawn(cmd.config, 0, user?.id);
          const pid = proc.info.pid;

          // Create home directory for the agent
          await this.fs.createHome(proc.info.uid);

          // Pre-create container at spawn time (not lazily on first run_command).
          // This prevents the first command from accidentally running on the host OS.
          const sandbox = cmd.config.sandbox;
          let vncWsPort: number | undefined;
          if (this.containers.isDockerAvailable()) {
            // Create persistent workspace based on agent role/name
            const workspaceName = cmd.config.role.toLowerCase().replace(/\s+/g, '-') + `-${pid}`;
            const workspacePath = this.containers.createWorkspace(workspaceName);
            const containerInfo = await this.containers.create(pid, workspacePath, sandbox);
            if (containerInfo) {
              proc.info.containerId = containerInfo.containerId;
              proc.info.containerStatus = 'running';

              // Start VNC proxy for graphical containers
              if (sandbox?.graphical && containerInfo.vncPort) {
                try {
                  const proxy = await this.vnc.startProxy(pid, containerInfo.vncPort);
                  vncWsPort = proxy.wsPort;
                } catch (err: any) {
                  console.error(`[Kernel] Failed to start VNC proxy for PID ${pid}:`, err.message);
                }
              }
            } else {
              console.warn(
                `[Kernel] Container creation failed for PID ${pid}, agent will use host fallback`,
              );
            }
          }

          // Open a terminal for the agent
          const tty = this.pty.open(pid, {
            cwd: this.fs.getRealRoot() + proc.info.cwd,
            env: proc.info.env,
          });
          proc.info.ttyId = tty.id;

          // Mark as running
          this.processes.setState(pid, 'running', 'booting');

          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { pid, ttyId: tty.id, containerId: proc.info.containerId, vncWsPort },
          });
          // Note: process.spawned is already emitted by ProcessManager via EventBus
          break;
        }

        case 'process.signal': {
          // Verify ownership
          const isAdmin = !user || user.role === 'admin';
          if (!this.processes.isOwner(cmd.pid, user?.id, isAdmin)) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Permission denied: you do not own this process',
            });
            break;
          }
          const success = this.processes.signal(cmd.pid, cmd.signal);

          // If killing a process, also clean up its container and VNC proxy
          if (success && (cmd.signal === 'SIGTERM' || cmd.signal === 'SIGKILL')) {
            this.vnc.stopProxy(cmd.pid);
            this.containers.remove(cmd.pid).catch(() => {});
          }

          events.push({
            type: success ? 'response.ok' : 'response.error',
            id: cmd.id,
            ...(success ? {} : { error: `Process ${cmd.pid} not found` }),
          } as KernelEvent);
          break;
        }

        case 'process.list': {
          const isAdmin = !user || user.role === 'admin';
          const processes = this.processes
            .getActiveByOwner(user?.id, isAdmin)
            .map((p) => ({ ...p.info }));
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: processes,
          });
          events.push({
            type: 'process.list',
            processes,
          });
          break;
        }

        case 'process.info': {
          const proc = this.processes.get(cmd.pid);
          if (proc) {
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { ...proc.info },
            });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `Process ${cmd.pid} not found`,
            });
          }
          break;
        }

        case 'process.approve': {
          const proc = this.processes.get(cmd.pid);
          if (proc && proc.info.agentPhase === 'waiting') {
            this.processes.setState(cmd.pid, 'running', 'executing');
            this.bus.emit('agent.approved', { pid: cmd.pid });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not in waiting state',
            });
          }
          break;
        }

        case 'process.reject': {
          const proc = this.processes.get(cmd.pid);
          if (proc && proc.info.agentPhase === 'waiting') {
            this.processes.setState(cmd.pid, 'running', 'thinking');
            this.bus.emit('agent.rejected', { pid: cmd.pid, reason: cmd.reason });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not in waiting state',
            });
          }
          break;
        }

        case 'agent.pause': {
          const paused = this.processes.pause(cmd.pid);
          if (paused) {
            this.bus.emit('agent.thought', { pid: cmd.pid, thought: 'Paused by operator.' });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not running or already paused',
            } as KernelEvent);
          }
          break;
        }

        case 'agent.resume': {
          const resumed = this.processes.resume(cmd.pid);
          if (resumed) {
            this.bus.emit('agent.thought', { pid: cmd.pid, thought: 'Resumed by operator.' });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not paused',
            } as KernelEvent);
          }
          break;
        }

        case 'agent.continue': {
          const proc = this.processes.get(cmd.pid);
          if (proc && proc.info.state === 'stopped' && proc.info.agentPhase === 'waiting') {
            this.processes.setState(cmd.pid, 'running', 'thinking');
            this.bus.emit('agent.continued', { pid: cmd.pid, extraSteps: cmd.extraSteps || 25 });
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Process not waiting for continue',
            } as KernelEvent);
          }
          break;
        }

        // ----- Filesystem Commands -----
        case 'fs.read': {
          const result = await this.fs.readFile(cmd.path);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: result,
          });
          break;
        }

        case 'fs.write': {
          await this.fs.writeFile(cmd.path, cmd.content);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.mkdir': {
          await this.fs.mkdir(cmd.path, cmd.recursive);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.rm': {
          await this.fs.rm(cmd.path, cmd.recursive);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.ls': {
          const entries = await this.fs.ls(cmd.path);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: entries,
          });
          events.push({
            type: 'fs.list',
            path: cmd.path,
            entries,
          });
          break;
        }

        case 'fs.stat': {
          const stat = await this.fs.stat(cmd.path);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: stat,
          });
          break;
        }

        case 'fs.mv': {
          await this.fs.mv(cmd.from, cmd.to);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.cp': {
          await this.fs.cp(cmd.from, cmd.to);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.watch': {
          this.fs.watch(cmd.path);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'fs.unwatch': {
          this.fs.unwatch(cmd.path);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- Terminal Commands -----
        case 'tty.open': {
          const proc = this.processes.get(cmd.pid);
          if (!proc) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `Process ${cmd.pid} not found`,
            });
            break;
          }
          const tty = this.pty.open(cmd.pid, {
            cwd: this.fs.getRealRoot() + proc.info.cwd,
            env: proc.info.env,
            cols: cmd.cols,
            rows: cmd.rows,
          });
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { ttyId: tty.id },
          });
          events.push({
            type: 'tty.opened',
            ttyId: tty.id,
            pid: cmd.pid,
          });
          break;
        }

        case 'tty.input': {
          this.pty.write(cmd.ttyId, cmd.data);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'tty.resize': {
          this.pty.resize(cmd.ttyId, cmd.cols, cmd.rows);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'tty.close': {
          this.pty.close(cmd.ttyId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- IPC Commands -----
        case 'ipc.send': {
          const message = this.processes.sendMessage(
            cmd.fromPid,
            cmd.toPid,
            cmd.channel,
            cmd.payload,
          );
          if (message) {
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { messageId: message.id },
            });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Failed to send IPC message: source or target process not found',
            });
          }
          break;
        }

        case 'ipc.list_agents': {
          const agents = this.processes.listRunningAgents();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: agents,
          });
          break;
        }

        // ----- Plugin Commands -----
        case 'plugins.list': {
          const pluginInfos = this.plugins.getPluginInfos(cmd.pid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: pluginInfos,
          });
          events.push({
            type: 'plugins.list',
            pid: cmd.pid,
            plugins: pluginInfos,
          } as KernelEvent);
          break;
        }

        // ----- Snapshot Commands -----
        case 'snapshot.create': {
          const snapshot = await this.snapshots.createSnapshot(cmd.pid, cmd.description);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: snapshot,
          });
          events.push({
            type: 'snapshot.created',
            snapshot,
          } as KernelEvent);
          break;
        }

        case 'snapshot.list': {
          const snapshots = await this.snapshots.listSnapshots(cmd.pid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: snapshots,
          });
          events.push({
            type: 'snapshot.list',
            snapshots,
          } as KernelEvent);
          break;
        }

        case 'snapshot.restore': {
          const newPid = await this.snapshots.restoreSnapshot(cmd.snapshotId);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { newPid },
          });
          events.push({
            type: 'snapshot.restored',
            snapshotId: cmd.snapshotId,
            newPid,
          } as KernelEvent);
          break;
        }

        case 'snapshot.delete': {
          await this.snapshots.deleteSnapshot(cmd.snapshotId);
          events.push({
            type: 'response.ok',
            id: cmd.id,
          });
          events.push({
            type: 'snapshot.deleted',
            snapshotId: cmd.snapshotId,
          } as KernelEvent);
          break;
        }

        // ----- Shared Filesystem Commands -----
        case 'fs.createShared': {
          const mount = await this.fs.createSharedMount(cmd.name, cmd.ownerPid);
          this.state.recordSharedMount({
            name: cmd.name,
            path: mount.path,
            ownerPid: cmd.ownerPid,
            createdAt: Date.now(),
          });
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: mount,
          });
          events.push({
            type: 'fs.sharedCreated',
            mount,
          } as KernelEvent);
          break;
        }

        case 'fs.mountShared': {
          await this.fs.mountShared(cmd.pid, cmd.name, cmd.mountPoint);
          const proc = this.processes.get(cmd.pid);
          const mountPoint = cmd.mountPoint || `shared/${cmd.name}`;
          if (proc) {
            this.state.addMountMember(cmd.name, cmd.pid, mountPoint);
          }
          events.push({
            type: 'response.ok',
            id: cmd.id,
          });
          events.push({
            type: 'fs.sharedMounted',
            pid: cmd.pid,
            name: cmd.name,
          } as KernelEvent);
          break;
        }

        case 'fs.unmountShared': {
          await this.fs.unmountShared(cmd.pid, cmd.name);
          this.state.removeMountMember(cmd.name, cmd.pid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
          });
          events.push({
            type: 'fs.sharedUnmounted',
            pid: cmd.pid,
            name: cmd.name,
          } as KernelEvent);
          break;
        }

        case 'fs.listShared': {
          const mounts = await this.fs.listSharedMounts();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: mounts,
          });
          events.push({
            type: 'fs.sharedList',
            mounts,
          } as KernelEvent);
          break;
        }

        // ----- VNC Commands -----
        case 'vnc.info': {
          const vncPort = this.containers.getVNCPort(cmd.pid);
          if (vncPort) {
            const proxyInfo = this.vnc.getProxyInfo(cmd.pid);
            if (proxyInfo) {
              events.push({
                type: 'response.ok',
                id: cmd.id,
                data: { pid: cmd.pid, wsPort: proxyInfo.wsPort, display: ':99' },
              });
              events.push({
                type: 'vnc.info',
                pid: cmd.pid,
                wsPort: proxyInfo.wsPort,
                display: ':99',
              } as KernelEvent);
            } else {
              events.push({
                type: 'response.error',
                id: cmd.id,
                error: `VNC proxy not running for PID ${cmd.pid}`,
              });
            }
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `No VNC available for PID ${cmd.pid} (not a graphical agent)`,
            });
          }
          break;
        }

        case 'vnc.exec': {
          try {
            const output = await this.containers.execGraphical(cmd.pid, cmd.command);
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { output },
            });
          } catch (err: any) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: err.message,
            });
          }
          break;
        }

        // ----- GPU Commands -----
        case 'gpu.list': {
          const gpus = this.containers.getGPUs();
          const allocations = this.containers.getAllGPUAllocations();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { gpus, allocations },
          });
          events.push({
            type: 'gpu.list',
            gpus,
          } as KernelEvent);
          break;
        }

        case 'gpu.stats': {
          const stats = await this.containers.getGPUStats();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: { stats },
          });
          events.push({
            type: 'gpu.stats',
            stats,
          } as KernelEvent);
          break;
        }

        // ----- Auth Commands -----
        case 'auth.login': {
          const result = await this.auth.authenticateUser(cmd.username, cmd.password);
          if (result) {
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { token: result.token, user: result.user },
            });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Invalid credentials',
            });
          }
          break;
        }

        case 'auth.register': {
          if (!this.auth.isRegistrationOpen()) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Registration is closed',
            });
            break;
          }
          try {
            const newUser = await this.auth.createUser(cmd.username, cmd.password, cmd.displayName);
            const authResult = await this.auth.authenticateUser(cmd.username, cmd.password);
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { token: authResult!.token, user: authResult!.user },
            });
          } catch (err: any) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: err.message,
            });
          }
          break;
        }

        case 'auth.validate': {
          const validUser = this.auth.validateToken(cmd.token);
          if (validUser) {
            events.push({
              type: 'response.ok',
              id: cmd.id,
              data: { user: validUser },
            });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Invalid or expired token',
            });
          }
          break;
        }

        case 'user.list': {
          if (user && user.role !== 'admin') {
            events.push({ type: 'response.error', id: cmd.id, error: 'Admin access required' });
            break;
          }
          const users = this.auth.listUsers();
          events.push({ type: 'response.ok', id: cmd.id, data: users });
          break;
        }

        case 'user.delete': {
          if (user && user.role !== 'admin') {
            events.push({ type: 'response.error', id: cmd.id, error: 'Admin access required' });
            break;
          }
          try {
            this.auth.deleteUser(cmd.userId);
            events.push({ type: 'response.ok', id: cmd.id });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        // ----- Cluster Commands -----
        case 'cluster.status': {
          const clusterInfo = this.cluster.getClusterInfo();
          // Update local load
          const activeCounts = this.processes.getCounts();
          this.cluster.updateLocalLoad(
            activeCounts.running + activeCounts.sleeping + activeCounts.created,
          );
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: this.cluster.getClusterInfo(),
          });
          break;
        }

        case 'cluster.nodes': {
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: this.cluster.getNodes(),
          });
          break;
        }

        case 'cluster.drain': {
          if (user && user.role !== 'admin') {
            events.push({ type: 'response.error', id: cmd.id, error: 'Admin access required' });
            break;
          }
          this.cluster.drainNode(cmd.nodeId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- Browser Commands -----
        case 'browser:create': {
          await this.browser.createSession(cmd.sessionId, cmd.options);
          events.push({ type: 'response.ok', id: cmd.id, data: { sessionId: cmd.sessionId } });
          events.push({ type: 'browser:created', sessionId: cmd.sessionId } as KernelEvent);
          break;
        }

        case 'browser:destroy': {
          await this.browser.destroySession(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id });
          events.push({ type: 'browser:destroyed', sessionId: cmd.sessionId } as KernelEvent);
          break;
        }

        case 'browser:navigate': {
          const pageInfo = await this.browser.navigateTo(cmd.sessionId, cmd.url);
          events.push({ type: 'response.ok', id: cmd.id, data: pageInfo });
          events.push({
            type: 'browser:navigated',
            sessionId: cmd.sessionId,
            url: pageInfo.url,
            title: pageInfo.title,
          } as KernelEvent);
          break;
        }

        case 'browser:back': {
          const backInfo = await this.browser.goBack(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id, data: backInfo });
          break;
        }

        case 'browser:forward': {
          const fwdInfo = await this.browser.goForward(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id, data: fwdInfo });
          break;
        }

        case 'browser:reload': {
          const reloadInfo = await this.browser.reload(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id, data: reloadInfo });
          break;
        }

        case 'browser:screenshot': {
          const screenshot = await this.browser.getScreenshot(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id, data: { screenshot } });
          break;
        }

        case 'browser:dom_snapshot': {
          const snapshot = await this.browser.getDOMSnapshot(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id, data: snapshot });
          break;
        }

        case 'browser:click': {
          await this.browser.click(cmd.sessionId, cmd.x, cmd.y, cmd.button);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'browser:type': {
          await this.browser.type(cmd.sessionId, cmd.text);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'browser:keypress': {
          await this.browser.keyPress(cmd.sessionId, cmd.key);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'browser:scroll': {
          await this.browser.scroll(cmd.sessionId, cmd.deltaX, cmd.deltaY);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'browser:screencast_start': {
          this.browser.startScreencast(cmd.sessionId, cmd.fps);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'browser:screencast_stop': {
          this.browser.stopScreencast(cmd.sessionId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- Memory Commands (v0.3) -----
        case 'memory.store': {
          const memory = this.memory.store(cmd.memory);
          events.push({ type: 'response.ok', id: cmd.id, data: memory });
          break;
        }

        case 'memory.recall': {
          const memories = this.memory.recall(cmd.query);
          events.push({ type: 'response.ok', id: cmd.id, data: memories });
          break;
        }

        case 'memory.forget': {
          const deleted = this.memory.forget(cmd.memoryId, cmd.agent_uid);
          if (deleted) {
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({ type: 'response.error', id: cmd.id, error: 'Memory not found' });
          }
          break;
        }

        case 'memory.share': {
          const shared = this.memory.share(cmd.memoryId, cmd.from_uid, cmd.to_uid);
          if (shared) {
            events.push({ type: 'response.ok', id: cmd.id, data: shared });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Memory not found or not owned by source agent',
            });
          }
          break;
        }

        case 'memory.list': {
          const result = cmd.layer
            ? this.memory.recall({ agent_uid: cmd.agent_uid, layer: cmd.layer, limit: 100 })
            : this.memory.recall({ agent_uid: cmd.agent_uid, limit: 100 });
          events.push({ type: 'response.ok', id: cmd.id, data: result });
          break;
        }

        case 'memory.consolidate': {
          const removed = this.memory.consolidate(cmd.agent_uid);
          events.push({ type: 'response.ok', id: cmd.id, data: { removed } });
          break;
        }

        // ----- Cron & Trigger Commands (v0.3) -----
        case 'cron.create': {
          try {
            const job = this.cron.createJob(
              cmd.name,
              cmd.cron_expression,
              cmd.agent_config,
              cmd.owner_uid,
            );
            events.push({ type: 'response.ok', id: cmd.id, data: job });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'cron.delete': {
          const deleted = this.cron.deleteJob(cmd.jobId);
          if (deleted) {
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({ type: 'response.error', id: cmd.id, error: 'Cron job not found' });
          }
          break;
        }

        case 'cron.enable': {
          const enabled = this.cron.enableJob(cmd.jobId);
          events.push(
            enabled
              ? { type: 'response.ok', id: cmd.id }
              : { type: 'response.error', id: cmd.id, error: 'Cron job not found' },
          );
          break;
        }

        case 'cron.disable': {
          const disabled = this.cron.disableJob(cmd.jobId);
          events.push(
            disabled
              ? { type: 'response.ok', id: cmd.id }
              : { type: 'response.error', id: cmd.id, error: 'Cron job not found' },
          );
          break;
        }

        case 'cron.list': {
          const jobs = this.cron.listJobs();
          events.push({ type: 'response.ok', id: cmd.id, data: jobs });
          events.push({ type: 'cron.list', jobs } as any);
          break;
        }

        case 'trigger.create': {
          const trigger = this.cron.createTrigger(
            cmd.name,
            cmd.event_type,
            cmd.agent_config,
            cmd.owner_uid,
            cmd.cooldown_ms,
            cmd.event_filter,
          );
          events.push({ type: 'response.ok', id: cmd.id, data: trigger });
          break;
        }

        case 'trigger.delete': {
          const deleted = this.cron.deleteTrigger(cmd.triggerId);
          if (deleted) {
            events.push({ type: 'response.ok', id: cmd.id });
          } else {
            events.push({ type: 'response.error', id: cmd.id, error: 'Trigger not found' });
          }
          break;
        }

        case 'trigger.list': {
          const triggers = this.cron.listTriggers();
          events.push({ type: 'response.ok', id: cmd.id, data: triggers });
          events.push({ type: 'trigger.list', triggers } as any);
          break;
        }

        // ----- Agent Profile Commands (v0.3 Wave 4) -----
        case 'profile.get': {
          const profile = this.memory.getProfile(cmd.agent_uid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: profile,
          });
          events.push({
            type: 'profile.data',
            agent_uid: cmd.agent_uid,
            profile,
          } as KernelEvent);
          break;
        }

        case 'profile.list': {
          const rawProfiles = this.state.getAllProfiles();
          const profiles: AgentProfile[] = rawProfiles.map((row: any) => ({
            ...row,
            expertise: JSON.parse(row.expertise || '[]'),
            personality_traits: JSON.parse(row.personality_traits || '[]'),
          }));
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: profiles,
          });
          events.push({
            type: 'profile.list',
            profiles,
          } as KernelEvent);
          break;
        }

        case 'profile.update': {
          const existing = this.memory.getProfile(cmd.agent_uid);
          const merged = { ...existing, ...cmd.updates, updated_at: Date.now() };
          this.state.upsertProfile({
            ...merged,
            expertise: JSON.stringify(merged.expertise),
            personality_traits: JSON.stringify(merged.personality_traits),
          });
          const updated = this.memory.getProfile(cmd.agent_uid);
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: updated,
          });
          events.push({
            type: 'profile.updated',
            agent_uid: cmd.agent_uid,
            profile: updated,
          } as KernelEvent);
          break;
        }

        // ----- App Commands (v0.4) -----
        case 'app.install': {
          try {
            const app = this.apps.install(cmd.manifest, cmd.source, cmd.owner_uid);
            events.push({ type: 'response.ok', id: cmd.id, data: app });
            events.push({ type: 'app.installed', app } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'app.uninstall': {
          try {
            this.apps.uninstall(cmd.appId);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({ type: 'app.uninstalled', appId: cmd.appId } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'app.enable': {
          try {
            this.apps.enable(cmd.appId);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({ type: 'app.enabled', appId: cmd.appId } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'app.disable': {
          try {
            this.apps.disable(cmd.appId);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({ type: 'app.disabled', appId: cmd.appId } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'app.list': {
          const appsList = this.apps.list();
          events.push({ type: 'response.ok', id: cmd.id, data: appsList });
          events.push({ type: 'app.list', apps: appsList } as KernelEvent);
          break;
        }

        case 'app.get': {
          const app = this.apps.get(cmd.appId);
          if (app) {
            events.push({ type: 'response.ok', id: cmd.id, data: app });
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `App ${cmd.appId} not found`,
            });
          }
          break;
        }

        // ----- Webhook Commands (v0.4) -----
        case 'webhook.register': {
          const webhookId = this.webhooks.register(cmd.name, cmd.url, cmd.events, {
            secret: cmd.secret,
            filters: cmd.filters,
            headers: cmd.headers,
            owner_uid: cmd.owner_uid,
            retry_count: cmd.retry_count,
            timeout_ms: cmd.timeout_ms,
          });
          events.push({ type: 'response.ok', id: cmd.id, data: { webhookId } });
          break;
        }

        case 'webhook.unregister': {
          this.webhooks.unregister(cmd.webhookId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'webhook.list': {
          const webhookList = this.webhooks.list(cmd.owner_uid);
          events.push({ type: 'response.ok', id: cmd.id, data: webhookList });
          break;
        }

        case 'webhook.enable': {
          this.webhooks.enable(cmd.webhookId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'webhook.disable': {
          this.webhooks.disable(cmd.webhookId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'webhook.logs': {
          const logs = this.webhooks.getLogs(cmd.webhookId, cmd.limit);
          events.push({ type: 'response.ok', id: cmd.id, data: logs });
          break;
        }

        case 'webhook.inbound.create': {
          const inbound = this.webhooks.createInbound(cmd.name, cmd.agent_config, {
            transform: cmd.transform,
            owner_uid: cmd.owner_uid,
          });
          events.push({ type: 'response.ok', id: cmd.id, data: inbound });
          break;
        }

        case 'webhook.inbound.delete': {
          this.webhooks.deleteInbound(cmd.inboundId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'webhook.inbound.list': {
          const inboundList = this.webhooks.listInbound(cmd.owner_uid);
          events.push({ type: 'response.ok', id: cmd.id, data: inboundList });
          break;
        }

        // ----- Webhook DLQ Commands (v0.5 Phase 3) -----
        case 'webhook.dlq.list': {
          const dlqEntries = this.webhooks.getDlqEntries(cmd.limit, cmd.offset);
          events.push({ type: 'response.ok', id: cmd.id, data: dlqEntries });
          break;
        }

        case 'webhook.dlq.retry': {
          const retrySuccess = await this.webhooks.retryDlqEntry(cmd.dlqId);
          events.push({ type: 'response.ok', id: cmd.id, data: { success: retrySuccess } });
          break;
        }

        case 'webhook.dlq.purge': {
          if (cmd.dlqId) {
            const purged = this.webhooks.purgeDlqEntry(cmd.dlqId);
            events.push({ type: 'response.ok', id: cmd.id, data: { purged: purged ? 1 : 0 } });
          } else {
            const purgedCount = this.webhooks.purgeDlq();
            events.push({ type: 'response.ok', id: cmd.id, data: { purged: purgedCount } });
          }
          break;
        }

        // ----- Plugin Registry Commands (v0.4 Wave 2) -----
        case 'plugin.registry.install': {
          try {
            const plugin = this.pluginRegistry.install(cmd.manifest, cmd.source, cmd.owner_uid);
            events.push({ type: 'response.ok', id: cmd.id, data: plugin });
            events.push({ type: 'plugin.registry.installed', plugin } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'plugin.registry.uninstall': {
          try {
            this.pluginRegistry.uninstall(cmd.pluginId);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({
              type: 'plugin.registry.uninstalled',
              pluginId: cmd.pluginId,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'plugin.registry.enable': {
          this.pluginRegistry.enable(cmd.pluginId);
          events.push({ type: 'response.ok', id: cmd.id });
          events.push({ type: 'plugin.registry.enabled', pluginId: cmd.pluginId } as KernelEvent);
          break;
        }

        case 'plugin.registry.disable': {
          this.pluginRegistry.disable(cmd.pluginId);
          events.push({ type: 'response.ok', id: cmd.id });
          events.push({ type: 'plugin.registry.disabled', pluginId: cmd.pluginId } as KernelEvent);
          break;
        }

        case 'plugin.registry.list': {
          const plugins = this.pluginRegistry.list(cmd.category);
          events.push({ type: 'response.ok', id: cmd.id, data: plugins });
          events.push({ type: 'plugin.registry.list', plugins } as KernelEvent);
          break;
        }

        case 'plugin.registry.search': {
          const searchResults = this.pluginRegistry.search(cmd.query, cmd.category);
          events.push({ type: 'response.ok', id: cmd.id, data: searchResults });
          break;
        }

        case 'plugin.registry.rate': {
          try {
            const rateResult = this.pluginRegistry.rate(
              cmd.pluginId,
              cmd.user_id,
              cmd.rating,
              cmd.review,
            );
            events.push({ type: 'response.ok', id: cmd.id, data: rateResult });
            events.push({
              type: 'plugin.registry.rated',
              pluginId: cmd.pluginId,
              rating: cmd.rating,
              newAvg: rateResult.newAvg,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'plugin.registry.settings.get': {
          const settings = this.pluginRegistry.getSettings(cmd.pluginId);
          events.push({ type: 'response.ok', id: cmd.id, data: settings });
          break;
        }

        case 'plugin.registry.settings.set': {
          this.pluginRegistry.setSetting(cmd.pluginId, cmd.key, cmd.value);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- Integration Commands (v0.4 Wave 2) -----
        case 'integration.register': {
          try {
            const integration = this.integrations.register(cmd.config, cmd.owner_uid);
            events.push({ type: 'response.ok', id: cmd.id, data: integration });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'integration.unregister': {
          this.integrations.unregister(cmd.integrationId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'integration.configure': {
          this.integrations.configure(cmd.integrationId, cmd.settings);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'integration.enable': {
          this.integrations.enable(cmd.integrationId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'integration.disable': {
          this.integrations.disable(cmd.integrationId);
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        case 'integration.list': {
          const integrationsList = this.integrations.list();
          events.push({ type: 'response.ok', id: cmd.id, data: integrationsList });
          events.push({ type: 'integration.list', integrations: integrationsList } as KernelEvent);
          break;
        }

        case 'integration.test': {
          try {
            const testResult = await this.integrations.test(cmd.integrationId);
            events.push({ type: 'response.ok', id: cmd.id, data: testResult });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'integration.execute': {
          try {
            const execResult = await this.integrations.execute(
              cmd.integrationId,
              cmd.action,
              cmd.params,
            );
            events.push({ type: 'response.ok', id: cmd.id, data: execResult });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        // ----- Template Marketplace Commands (v0.4 Wave 2) -----
        case 'template.publish': {
          try {
            const entry = this.templateMarketplace.publish(cmd.template);
            events.push({ type: 'response.ok', id: cmd.id, data: entry });
            events.push({ type: 'template.published', entry } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'template.unpublish': {
          this.templateMarketplace.unpublish(cmd.templateId);
          events.push({ type: 'response.ok', id: cmd.id });
          events.push({ type: 'template.unpublished', templateId: cmd.templateId } as KernelEvent);
          break;
        }

        case 'template.marketplace.list': {
          const templates = this.templateMarketplace.list(cmd.category, cmd.tags);
          events.push({ type: 'response.ok', id: cmd.id, data: templates });
          events.push({ type: 'template.marketplace.list', templates } as KernelEvent);
          break;
        }

        case 'template.rate': {
          try {
            const rateRes = this.templateMarketplace.rate(
              cmd.templateId,
              cmd.user_id,
              cmd.rating,
              cmd.review,
            );
            events.push({ type: 'response.ok', id: cmd.id, data: rateRes });
            events.push({
              type: 'template.rated',
              templateId: cmd.templateId,
              rating: cmd.rating,
              newAvg: rateRes.newAvg,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'template.fork': {
          try {
            const forked = this.templateMarketplace.fork(cmd.templateId, cmd.user_id);
            events.push({ type: 'response.ok', id: cmd.id, data: forked });
            events.push({
              type: 'template.forked',
              originalId: cmd.templateId,
              newId: forked.id,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        // ----- Organization Commands (v0.5 RBAC) -----
        case 'org.create': {
          try {
            const org = this.auth.createOrg(cmd.name, user!.id, cmd.displayName);
            events.push({ type: 'response.ok', id: cmd.id, data: org });
            events.push({ type: 'org.created', org } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.delete': {
          try {
            this.auth.deleteOrg(cmd.orgId, user!.id);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({ type: 'org.deleted', orgId: cmd.orgId } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.list': {
          const orgs = this.auth.listOrgs(user?.id);
          events.push({ type: 'response.ok', id: cmd.id, data: orgs });
          break;
        }

        case 'org.get': {
          const org = this.auth.getOrg(cmd.orgId);
          if (org) {
            events.push({ type: 'response.ok', id: cmd.id, data: org });
          } else {
            events.push({ type: 'response.error', id: cmd.id, error: 'Organization not found' });
          }
          break;
        }

        case 'org.update': {
          try {
            const org = this.auth.updateOrg(cmd.orgId, { settings: cmd.settings }, user!.id);
            events.push({ type: 'response.ok', id: cmd.id, data: org });
            events.push({ type: 'org.updated', org } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.members.list': {
          const members = this.auth.listMembers(cmd.orgId);
          events.push({ type: 'response.ok', id: cmd.id, data: members });
          break;
        }

        case 'org.members.invite': {
          try {
            this.auth.inviteMember(cmd.orgId, cmd.userId, cmd.role, user!.id);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({
              type: 'org.member.invited',
              orgId: cmd.orgId,
              userId: cmd.userId,
              role: cmd.role,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.members.remove': {
          try {
            this.auth.removeMember(cmd.orgId, cmd.userId, user!.id);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({
              type: 'org.member.removed',
              orgId: cmd.orgId,
              userId: cmd.userId,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.members.update': {
          try {
            this.auth.updateMemberRole(cmd.orgId, cmd.userId, cmd.role, user!.id);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({
              type: 'org.member.updated',
              orgId: cmd.orgId,
              userId: cmd.userId,
              role: cmd.role,
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.teams.create': {
          try {
            const team = this.auth.createTeam(cmd.orgId, cmd.name, user!.id, cmd.description);
            events.push({ type: 'response.ok', id: cmd.id, data: team });
            events.push({ type: 'org.team.created', team } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.teams.delete': {
          try {
            this.auth.deleteTeam(cmd.teamId, user!.id);
            events.push({ type: 'response.ok', id: cmd.id });
            events.push({ type: 'org.team.deleted', teamId: cmd.teamId } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.teams.list': {
          const teams = this.auth.listTeams(cmd.orgId);
          events.push({ type: 'response.ok', id: cmd.id, data: teams });
          break;
        }

        case 'org.teams.addMember': {
          try {
            this.auth.addToTeam(cmd.teamId, cmd.userId, user!.id, cmd.role || 'member');
            events.push({ type: 'response.ok', id: cmd.id });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'org.teams.removeMember': {
          try {
            this.auth.removeFromTeam(cmd.teamId, cmd.userId, user!.id);
            events.push({ type: 'response.ok', id: cmd.id });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        // ----- Workspace Commands (v0.5) -----
        case 'workspace.list': {
          const workspaces = this.containers.listWorkspaces();
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: workspaces,
          });
          events.push({
            type: 'workspace.list',
            workspaces,
          } as KernelEvent);
          break;
        }

        case 'workspace.cleanup': {
          const success = this.containers.cleanupWorkspace(cmd.agentName);
          events.push({
            type: success ? 'response.ok' : 'response.error',
            id: cmd.id,
            ...(success ? {} : { error: `Failed to cleanup workspace: ${cmd.agentName}` }),
          } as KernelEvent);
          if (success) {
            events.push({
              type: 'workspace.cleaned',
              agentName: cmd.agentName,
              success: true,
            } as KernelEvent);
          }
          break;
        }

        // ----- System Commands -----
        case 'kernel.status': {
          events.push({
            type: 'response.ok',
            id: cmd.id,
            data: {
              version: this.version,
              uptime: Date.now() - this.startTime,
              processes: this.processes.getCounts(),
              docker: this.containers.isDockerAvailable(),
              containers: this.containers.getAll().length,
              gpu: this.containers.isGPUAvailable(),
              gpuCount: this.containers.getGPUs().length,
            },
          });
          break;
        }

        case 'kernel.shutdown': {
          await this.shutdown();
          events.push({ type: 'response.ok', id: cmd.id });
          break;
        }

        // ----- Skill Commands -----
        case 'skill.list': {
          const category = (cmd as any).category;
          const skills = this.skills.list(category);
          events.push({ type: 'response.ok', id: cmd.id, data: skills });
          break;
        }
        case 'skill.get': {
          const skill = this.skills.get((cmd as any).skillId);
          if (skill) {
            events.push({ type: 'response.ok', id: cmd.id, data: skill });
          } else {
            events.push({ type: 'response.error', id: cmd.id, error: 'Skill not found' });
          }
          break;
        }
        case 'skill.register': {
          try {
            const registered = this.skills.register((cmd as any).definition);
            events.push({ type: 'response.ok', id: cmd.id, data: registered });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }
        case 'skill.unregister': {
          const removed = this.skills.unregister((cmd as any).skillId);
          events.push({ type: 'response.ok', id: cmd.id, data: { removed } });
          break;
        }
        case 'skill.execute': {
          try {
            const result = await this.skills.execute(
              (cmd as any).skillId,
              (cmd as any).inputs || {},
              (cmd as any).context || { agentUid: 'system', pid: 0, fsRoot: this.fs.getRealRoot() },
            );
            events.push({ type: 'response.ok', id: cmd.id, data: result });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        // ----- Remote Access Commands -----
        case 'remote.tunnel.list': {
          const tunnels = this.remoteAccess.listTunnels();
          events.push({ type: 'response.ok', id: cmd.id, data: tunnels });
          break;
        }
        case 'remote.tunnel.create': {
          try {
            const tunnel = this.remoteAccess.createTunnel((cmd as any).config);
            events.push({ type: 'response.ok', id: cmd.id, data: tunnel });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }
        case 'remote.tunnel.destroy': {
          const destroyed = this.remoteAccess.destroyTunnel((cmd as any).tunnelId);
          events.push({ type: 'response.ok', id: cmd.id, data: { destroyed } });
          break;
        }
        case 'remote.tailscale.status': {
          const status = this.remoteAccess.tailscaleStatus();
          events.push({ type: 'response.ok', id: cmd.id, data: status });
          break;
        }
        case 'remote.tailscale.up': {
          try {
            const result = await this.remoteAccess.tailscaleUp((cmd as any).config);
            events.push({ type: 'response.ok', id: cmd.id, data: result });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }
        case 'remote.tailscale.down': {
          try {
            const result = await this.remoteAccess.tailscaleDown();
            events.push({ type: 'response.ok', id: cmd.id, data: result });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }
        case 'remote.tailscale.devices': {
          const devices = this.remoteAccess.tailscaleDevices();
          events.push({ type: 'response.ok', id: cmd.id, data: devices });
          break;
        }
        case 'remote.tailscale.serve': {
          try {
            const result = await this.remoteAccess.tailscaleServe(
              (cmd as any).port,
              (cmd as any).options,
            );
            events.push({ type: 'response.ok', id: cmd.id, data: result });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }
        case 'remote.keys.list': {
          const keys = this.remoteAccess.listAuthorizedKeys();
          events.push({ type: 'response.ok', id: cmd.id, data: keys });
          break;
        }
        case 'remote.keys.add': {
          try {
            const key = this.remoteAccess.addAuthorizedKey((cmd as any).key, (cmd as any).label);
            events.push({ type: 'response.ok', id: cmd.id, data: key });
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }
        case 'remote.keys.remove': {
          const removed = this.remoteAccess.removeAuthorizedKey((cmd as any).keyId);
          events.push({ type: 'response.ok', id: cmd.id, data: { removed } });
          break;
        }

        // ----- Resource Governor Commands (v0.5) -----
        case 'resource.getQuota': {
          const quota = this.resources.getQuota(cmd.pid);
          events.push({ type: 'response.ok', id: cmd.id, data: quota });
          events.push({ type: 'resource.quota', pid: cmd.pid, quota } as KernelEvent);
          break;
        }

        case 'resource.setQuota': {
          const quota = this.resources.setQuota(cmd.pid, cmd.quota);
          events.push({ type: 'response.ok', id: cmd.id, data: quota });
          events.push({ type: 'resource.quota', pid: cmd.pid, quota } as KernelEvent);
          break;
        }

        case 'resource.getUsage': {
          const usage = this.resources.getUsage(cmd.pid);
          if (usage) {
            events.push({ type: 'response.ok', id: cmd.id, data: usage });
            events.push({ type: 'resource.usage', pid: cmd.pid, usage } as KernelEvent);
          } else {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: `No usage data for PID ${cmd.pid}`,
            });
          }
          break;
        }

        case 'resource.getSummary': {
          const summary = this.resources.getSummary();
          events.push({ type: 'response.ok', id: cmd.id, data: summary });
          break;
        }

        // ----- Priority Scheduling Commands (v0.5 Phase 2) -----
        case 'process.setPriority': {
          const isAdmin = !user || user.role === 'admin';
          if (!this.processes.isOwner(cmd.pid, user?.id, isAdmin)) {
            events.push({
              type: 'response.error',
              id: cmd.id,
              error: 'Permission denied: you do not own this process',
            });
            break;
          }
          try {
            const success = this.processes.setPriority(cmd.pid, cmd.priority);
            if (success) {
              events.push({
                type: 'response.ok',
                id: cmd.id,
                data: { pid: cmd.pid, priority: cmd.priority },
              });
            } else {
              events.push({
                type: 'response.error',
                id: cmd.id,
                error: `Process ${cmd.pid} not found`,
              });
            }
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'process.getQueue': {
          const queue = this.processes.getQueue();
          events.push({ type: 'response.ok', id: cmd.id, data: queue });
          break;
        }

        // ----- Permission Policy Commands (v0.5 Phase 4) -----
        case 'permission.grant': {
          try {
            const policy = this.auth.grantPermission({
              subject: (cmd as any).subject,
              action: (cmd as any).action,
              resource: (cmd as any).resource,
              effect: (cmd as any).effect,
              created_by: user?.id,
            });
            events.push({ type: 'response.ok', id: cmd.id, data: policy });
            events.push({ type: 'permission.granted', policy } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'permission.revoke': {
          try {
            const deleted = this.auth.revokePermission((cmd as any).policyId);
            if (deleted) {
              events.push({ type: 'response.ok', id: cmd.id });
              events.push({
                type: 'permission.revoked',
                policyId: (cmd as any).policyId,
              } as KernelEvent);
            } else {
              events.push({ type: 'response.error', id: cmd.id, error: 'Policy not found' });
            }
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'permission.list': {
          const policies = this.auth.listPolicies((cmd as any).subject);
          events.push({ type: 'response.ok', id: cmd.id, data: policies });
          events.push({ type: 'permission.list', policies } as KernelEvent);
          break;
        }

        case 'permission.check': {
          const allowed = this.auth.checkPermission(
            (cmd as any).userId,
            (cmd as any).action,
            (cmd as any).resource,
          );
          events.push({ type: 'response.ok', id: cmd.id, data: { allowed } });
          break;
        }

        // ----- Audit Logger Commands (v0.5) -----
        case 'audit.query': {
          const result = this.audit.query(cmd.filters || {});
          events.push({ type: 'response.ok', id: cmd.id, data: result });
          events.push({ type: 'audit.entries', entries: result.entries } as KernelEvent);
          break;
        }

        // ----- Tool Compatibility Layer Commands (v0.5 Phase 4) -----
        case 'tools.import': {
          try {
            const imported = this.toolCompat.importTools(cmd.tools, cmd.format);
            events.push({ type: 'response.ok', id: cmd.id, data: imported });
            events.push({
              type: 'tools.imported',
              count: imported.length,
              format: cmd.format,
              names: imported.map((t: any) => t.name),
            } as KernelEvent);
          } catch (err: any) {
            events.push({ type: 'response.error', id: cmd.id, error: err.message });
          }
          break;
        }

        case 'tools.export': {
          const exported = this.toolCompat.exportTools(cmd.format);
          events.push({ type: 'response.ok', id: cmd.id, data: exported });
          events.push({
            type: 'tools.exported',
            count: exported.length,
            format: cmd.format,
          } as KernelEvent);
          break;
        }

        case 'tools.list': {
          const toolsList = this.toolCompat.listTools();
          events.push({ type: 'response.ok', id: cmd.id, data: toolsList });
          events.push({
            type: 'tools.list',
            tools: toolsList,
          } as KernelEvent);
          break;
        }

        default:
          events.push({
            type: 'response.error',
            id: (cmd as any).id || 'unknown',
            error: `Unknown command type: ${(cmd as any).type}`,
          });
      }
    } catch (err) {
      events.push({
        type: 'response.error',
        id: (cmd as any).id || 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return events;
  }

  /**
   * Get kernel uptime in milliseconds.
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Print a boot banner summarizing subsystem status.
   */
  private printBootBanner(): void {
    const G = '\x1b[32m'; // green
    const Y = '\x1b[33m'; // yellow
    const C = '\x1b[36m'; // cyan
    const B = '\x1b[1m'; // bold
    const D = '\x1b[2m'; // dim
    const R = '\x1b[0m'; // reset

    const ok = `${G}\u2713${R}`;
    const warn = `${Y}\u25CB${R}`;

    const dockerUp = this.containers.isDockerAvailable();
    const playwrightUp = this.browser.isAvailable();
    const gpuUp = this.containers.isGPUAvailable();
    const gpuCount = this.containers.getGPUs().length;

    // Subsystem pairs: [name, isFullyAvailable]
    const left: [string, boolean][] = [
      ['EventBus', true],
      ['ProcessManager', true],
      ['VirtualFS', true],
      ['PTYManager', true],
      ['ContainerManager', dockerUp],
      ['BrowserManager', playwrightUp],
    ];

    const right: [string, boolean][] = [
      ['StateStore', true],
      ['MemoryManager', true],
      ['CronManager', true],
      ['PluginManager', true],
      ['SnapshotManager', true],
      ['AuthManager', true],
      ['VNCManager', true],
      ['ClusterManager', true],
      ['AppManager', true],
      ['WebhookManager', true],
      ['PluginRegistry', true],
      ['IntegrationMgr', true],
      ['TemplateMktplace', true],
      ['SkillManager', true],
      ['RemoteAccessMgr', true],
      ['ResourceGovernor', true],
      ['AuditLogger', true],
      ['ModelRouter', true],
      ['MetricsExporter', true],
      ['ToolCompatLayer', true],
    ];

    const port = process.env.AETHER_PORT || String(DEFAULT_PORT);
    const fsRoot = this.fs.getRealRoot();
    const role = this.cluster.getRole();
    const total = left.length + right.length;

    console.log('');
    console.log(
      `  ${B}\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510${R}`,
    );
    console.log(
      `  ${B}\u2502${R}        ${C}${B}Aether Kernel${R}  v${this.version}          ${B}\u2502${R}`,
    );
    console.log(
      `  ${B}\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518${R}`,
    );
    console.log('');

    const maxRows = Math.max(left.length, right.length);
    for (let i = 0; i < maxRows; i++) {
      const lPart = left[i];
      const rPart = right[i];
      const lStr = lPart ? `${lPart[1] ? ok : warn} ${lPart[0].padEnd(20)}` : ''.padEnd(22);
      const rStr = rPart ? `${rPart[1] ? ok : warn} ${rPart[0]}` : '';
      console.log(`    ${lStr}${rStr}`);
    }

    console.log('');
    const gpuStr = gpuUp ? `  ${D}GPU:${R} ${gpuCount}` : '';
    console.log(
      `    ${D}Port:${R} ${port}  ${D}FS root:${R} ${fsRoot}  ${D}Cluster:${R} ${role}${gpuStr}`,
    );
    console.log('');
    console.log(`  ${G}Kernel ready${R} ${D}\u2014${R} ${total} subsystems online`);
    console.log('');
  }

  /**
   * Shutdown the kernel. Clean up all resources.
   */
  async shutdown(): Promise<void> {
    if (!this.running) return;
    console.log('[Kernel] Shutting down...');

    this.running = false;

    // Record final metrics before shutdown
    try {
      const counts = this.processes.getCounts();
      this.state.recordMetric({
        timestamp: Date.now(),
        processCount: counts.running + counts.sleeping + counts.created,
        cpuPercent: 0,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        containerCount: this.containers.getAll().length,
      });
    } catch {
      /* ignore metric errors during shutdown */
    }

    await this.remoteAccess.shutdown();
    this.toolCompat.shutdown();
    this.metrics.shutdown();
    this.audit.shutdown();
    this.modelRouter.shutdown();
    this.resources.shutdown();
    this.skills.shutdown();
    this.webhooks.shutdown();
    this.apps.shutdown();
    this.pluginRegistry.shutdown();
    this.integrations.shutdown();
    this.templateMarketplace.shutdown();
    this.cron.stop();
    await this.cluster.shutdown();
    await this.browser.shutdown();
    await this.vnc.shutdown();
    await this.pty.shutdown();
    await this.containers.shutdown();
    await this.processes.shutdown();
    await this.fs.shutdown();
    this.state.close();
    this.bus.off();

    console.log('[Kernel] Shutdown complete');
  }
}
