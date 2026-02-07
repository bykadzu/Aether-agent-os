/**
 * Aether OS - React Kernel Hook
 *
 * Provides React components with access to the kernel's state and operations.
 * Manages the WebSocket connection lifecycle and keeps process state in sync.
 *
 * This is the primary interface between the React UI and the real kernel.
 * Components use this hook instead of the old simulated agent state.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { KernelClient, KernelProcessInfo, KernelAgentConfig, UserInfo, ClusterInfo, getKernelClient } from './kernelClient';

export interface AgentProcess {
  pid: number;
  name: string;
  role: string;
  goal: string;
  state: string;       // ProcessState
  phase: string;       // AgentPhase
  ttyId?: string;
  createdAt: number;
  logs: AgentLog[];
  currentUrl?: string;
  currentCode?: string;
  progress: { step: number; maxSteps: number; summary: string };
  vncInfo?: { wsPort: number; display: string } | null;
  gpuIds?: number[];
}

export interface AgentLog {
  timestamp: number;
  type: 'thought' | 'action' | 'observation' | 'system';
  message: string;
}

interface KernelState {
  connected: boolean;
  reconnecting: boolean;
  version: string;
  processes: AgentProcess[];
  metrics: { processCount: number; cpuPercent: number; memoryMB: number };
  user: UserInfo | null;
  clusterInfo: ClusterInfo | null;
}

export function useKernel(wsUrl?: string) {
  const clientRef = useRef<KernelClient | null>(null);
  const [state, setState] = useState<KernelState>({
    connected: false,
    reconnecting: false,
    version: '',
    processes: [],
    metrics: { processCount: 0, cpuPercent: 0, memoryMB: 0 },
    user: null,
    clusterInfo: null,
  });

  // Initialize client and connect
  useEffect(() => {
    const client = getKernelClient(wsUrl);
    clientRef.current = client;

    // Connection state with reconnect handling
    let wasConnected = false;
    const unsubConnection = client.on('connection', (data: any) => {
      const isConnected = data.connected;

      if (!isConnected && wasConnected) {
        // Connection dropped — show reconnecting state
        setState(prev => ({ ...prev, connected: false, reconnecting: true }));
      } else if (isConnected && !wasConnected && wasConnected !== undefined) {
        // Reconnected — refresh process list to sync state
        setState(prev => ({ ...prev, connected: true, reconnecting: false, version: client.version }));
        client.listProcesses().catch(() => {});
      } else {
        setState(prev => ({ ...prev, connected: isConnected, reconnecting: false, version: client.version }));
      }

      wasConnected = isConnected;
    });

    // Process events
    const unsubSpawned = client.on('process.spawned', (data: any) => {
      const info: KernelProcessInfo = data.info;
      const proc: AgentProcess = {
        pid: info.pid,
        name: info.name,
        role: info.env?.AETHER_ROLE || 'Agent',
        goal: info.env?.AETHER_GOAL || '',
        state: info.state,
        phase: info.agentPhase || 'booting',
        ttyId: info.ttyId,
        createdAt: info.createdAt,
        logs: [{ timestamp: Date.now(), type: 'system', message: `Process ${info.pid} spawned.` }],
        progress: { step: 0, maxSteps: 50, summary: 'Initializing...' },
      };
      setState(prev => ({
        ...prev,
        processes: [...prev.processes, proc],
      }));
    });

    const unsubStateChange = client.on('process.stateChange', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, state: data.state, phase: data.agentPhase || p.phase }
            : p
        ),
      }));
    });

    const unsubExit = client.on('process.exit', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? {
                ...p,
                state: 'zombie',
                phase: data.code === 0 ? 'completed' : 'failed',
                logs: [...p.logs, {
                  timestamp: Date.now(),
                  type: 'system' as const,
                  message: `Process exited with code ${data.code}${data.signal ? ` (${data.signal})` : ''}`,
                }],
              }
            : p
        ),
      }));
    });

    // Agent-specific events
    const unsubThought = client.on('agent.thought', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, logs: [...p.logs, { timestamp: Date.now(), type: 'thought' as const, message: data.thought }] }
            : p
        ),
      }));
    });

    const unsubAction = client.on('agent.action', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? {
                ...p,
                logs: [...p.logs, {
                  timestamp: Date.now(),
                  type: 'action' as const,
                  message: `${data.tool}(${JSON.stringify(data.args).substring(0, 100)})`,
                }],
              }
            : p
        ),
      }));
    });

    const unsubObservation = client.on('agent.observation', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? {
                ...p,
                logs: [...p.logs, {
                  timestamp: Date.now(),
                  type: 'observation' as const,
                  message: data.result,
                }],
              }
            : p
        ),
      }));
    });

    const unsubProgress = client.on('agent.progress', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, progress: { step: data.step, maxSteps: data.maxSteps, summary: data.summary } }
            : p
        ),
      }));
    });

    const unsubFileCreated = client.on('agent.file_created', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? {
                ...p,
                currentCode: data.content,
                logs: [...p.logs, {
                  timestamp: Date.now(),
                  type: 'action' as const,
                  message: `Created file: ${data.path}`,
                }],
              }
            : p
        ),
      }));
    });

    const unsubBrowsing = client.on('agent.browsing', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, currentUrl: data.url }
            : p
        ),
      }));
    });

    const unsubApproval = client.on('process.approval_required', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? {
                ...p,
                phase: 'waiting',
                logs: [...p.logs, {
                  timestamp: Date.now(),
                  type: 'system' as const,
                  message: `Awaiting approval: ${data.action} - ${data.details}`,
                }],
              }
            : p
        ),
      }));
    });

    // VNC events
    const unsubVncStarted = client.on('vnc.started', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, vncInfo: { wsPort: data.wsPort, display: data.display } }
            : p
        ),
      }));
    });

    const unsubVncStopped = client.on('vnc.stopped', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, vncInfo: null }
            : p
        ),
      }));
    });

    // GPU events
    const unsubGpuAllocated = client.on('gpu.allocated', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, gpuIds: data.gpuIds }
            : p
        ),
      }));
    });

    const unsubGpuReleased = client.on('gpu.released', (data: any) => {
      setState(prev => ({
        ...prev,
        processes: prev.processes.map(p =>
          p.pid === data.pid
            ? { ...p, gpuIds: undefined }
            : p
        ),
      }));
    });

    // Metrics
    const unsubMetrics = client.on('kernel.metrics', (data: any) => {
      setState(prev => ({
        ...prev,
        metrics: {
          processCount: data.processCount,
          cpuPercent: data.cpuPercent,
          memoryMB: data.memoryMB,
        },
      }));
    });

    // Process list (on initial connect)
    const unsubList = client.on('process.list', (data: any) => {
      if (data.processes) {
        const procs: AgentProcess[] = data.processes.map((info: KernelProcessInfo) => ({
          pid: info.pid,
          name: info.name,
          role: info.env?.AETHER_ROLE || 'Agent',
          goal: info.env?.AETHER_GOAL || '',
          state: info.state,
          phase: info.agentPhase || 'idle',
          ttyId: info.ttyId,
          createdAt: info.createdAt,
          logs: [],
          progress: { step: 0, maxSteps: 50, summary: '' },
        }));
        setState(prev => ({
          ...prev,
          processes: procs,
        }));
      }
    });

    // Listen for cluster events
    const unsubClusterJoined = client.on('cluster.nodeJoined', () => {
      client.getClusterInfo().then(info => {
        setState(prev => ({ ...prev, clusterInfo: info }));
      }).catch(() => {});
    });

    const unsubClusterLeft = client.on('cluster.nodeLeft', () => {
      client.getClusterInfo().then(info => {
        setState(prev => ({ ...prev, clusterInfo: info }));
      }).catch(() => {});
    });

    const unsubClusterOffline = client.on('cluster.nodeOffline', () => {
      client.getClusterInfo().then(info => {
        setState(prev => ({ ...prev, clusterInfo: info }));
      }).catch(() => {});
    });

    // Fetch cluster info on connect
    const unsubReady = client.on('kernel.ready', () => {
      // Set user from client if already authenticated
      const currentUser = client.getCurrentUser();
      if (currentUser) {
        setState(prev => ({ ...prev, user: currentUser }));
      }

      client.getClusterInfo().then(info => {
        setState(prev => ({ ...prev, clusterInfo: info }));
      }).catch(() => {});
    });

    // Connect
    client.connect();

    // Cleanup
    return () => {
      unsubConnection();
      unsubSpawned();
      unsubStateChange();
      unsubExit();
      unsubThought();
      unsubAction();
      unsubObservation();
      unsubProgress();
      unsubFileCreated();
      unsubBrowsing();
      unsubApproval();
      unsubVncStarted();
      unsubVncStopped();
      unsubGpuAllocated();
      unsubGpuReleased();
      unsubMetrics();
      unsubList();
      unsubClusterJoined();
      unsubClusterLeft();
      unsubClusterOffline();
      unsubReady();
    };
  }, [wsUrl]);

  // Actions
  const spawnAgent = useCallback(async (config: KernelAgentConfig) => {
    const client = clientRef.current;
    if (!client) throw new Error('Kernel not connected');
    return client.spawnAgent(config);
  }, []);

  const killProcess = useCallback(async (pid: number) => {
    const client = clientRef.current;
    if (!client) throw new Error('Kernel not connected');
    return client.killProcess(pid);
  }, []);

  const approveAction = useCallback(async (pid: number) => {
    const client = clientRef.current;
    if (!client) throw new Error('Kernel not connected');
    return client.approveAction(pid);
  }, []);

  const rejectAction = useCallback(async (pid: number, reason?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('Kernel not connected');
    return client.rejectAction(pid, reason);
  }, []);

  const sendTerminalInput = useCallback((ttyId: string, data: string) => {
    const client = clientRef.current;
    if (!client) return;
    client.sendTerminalInput(ttyId, data);
  }, []);

  return {
    ...state,
    client: clientRef.current,
    spawnAgent,
    killProcess,
    approveAction,
    rejectAction,
    sendTerminalInput,
  };
}
