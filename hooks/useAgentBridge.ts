import { useState, useMemo, useCallback } from 'react';
import { Agent, AgentStatus, RuntimeMode, phaseToStatus } from '../types';
import { FileSystemItem } from '../data/mockFileSystem';
import { useKernel, AgentProcess } from '../services/useKernel';
import { getKernelClient } from '../services/kernelClient';
import { useMockAgentLoop } from './useMockAgentLoop';

export interface UseAgentBridgeReturn {
  agents: Agent[];
  launchAgent: (role: string, goal: string) => Promise<void>;
  stopAgent: (id: string) => void;
  approveAgent: (id: string) => void;
  rejectAgent: (id: string) => void;
  syncGithub: (id: string) => void;
  showGithubModal: boolean;
  setShowGithubModal: React.Dispatch<React.SetStateAction<boolean>>;
  githubRepoUrl: string;
  setGithubRepoUrl: React.Dispatch<React.SetStateAction<string>>;
  githubCloneStatus: 'idle' | 'cloning' | 'done' | 'error';
  handleGithubClone: () => Promise<void>;
}

export function useAgentBridge(
  runtimeMode: RuntimeMode,
  kernel: ReturnType<typeof useKernel>,
  files: FileSystemItem[],
  setFiles: React.Dispatch<React.SetStateAction<FileSystemItem[]>>,
): UseAgentBridgeReturn {
  // Bridge kernel processes to Agent type for UI compatibility
  const kernelAgents: Agent[] = useMemo(() => {
    return kernel.processes.map(
      (proc: AgentProcess): Agent => ({
        id: `agent_${proc.pid}`,
        pid: proc.pid,
        name: proc.name,
        role: proc.role,
        goal: proc.goal,
        status: phaseToStatus(proc.phase, proc.state),
        phase: proc.phase,
        logs: proc.logs,
        currentUrl: proc.currentUrl,
        currentCode: proc.currentCode,
        progress: proc.progress.step,
        ttyId: proc.ttyId,
        isWaiting: false,
        vncWsUrl: proc.vncInfo ? `ws://localhost:${proc.vncInfo.wsPort}` : undefined,
        runtime: proc.runtime,
      }),
    );
  }, [kernel.processes]);

  // Agent System State (mock mode fallback)
  const [mockAgents, setMockAgents] = useState<Agent[]>([]);

  // Mock AI agent loop
  useMockAgentLoop(mockAgents, setMockAgents, files, setFiles, runtimeMode);

  // Unified agent list depending on runtime mode
  const agents = runtimeMode === 'kernel' ? kernelAgents : mockAgents;
  const setAgents = setMockAgents;

  // GitHub modal state
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubModalAgentId, setGithubModalAgentId] = useState<string | null>(null);
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubCloneStatus, setGithubCloneStatus] = useState<'idle' | 'cloning' | 'done' | 'error'>(
    'idle',
  );

  const launchAgent = useCallback(
    async (role: string, goal: string) => {
      if (runtimeMode === 'kernel') {
        try {
          let cleanGoal = goal;
          const sandbox: any = {};
          const metaMatch = goal.match(/\s*\[([^\]]+)\]\s*$/);
          if (metaMatch) {
            cleanGoal = goal.slice(0, metaMatch.index).trim();
            const pairs = metaMatch[1].split(',');
            let model: string | undefined;
            let runtime: 'builtin' | 'claude-code' | 'openclaw' | undefined;
            for (const pair of pairs) {
              const [key, val] = pair.split(':');
              if (key === 'graphical' && val === 'true') sandbox.graphical = true;
              if (key === 'gpu' && val === 'true') sandbox.gpu = { enabled: true };
              if (key === 'model') model = val;
              if (key === 'runtime' && (val === 'claude-code' || val === 'openclaw')) runtime = val;
            }
            await kernel.spawnAgent({
              role,
              goal: cleanGoal,
              sandbox: Object.keys(sandbox).length > 0 ? sandbox : undefined,
              model,
              runtime,
            });
          } else {
            await kernel.spawnAgent({ role, goal });
          }
        } catch (err) {
          console.error('Failed to spawn agent via kernel:', err);
        }
        return;
      }

      // Mock mode fallback
      const id = `agent_${Date.now()}`;
      const newAgent: Agent = {
        id,
        name: `${role} Alpha`,
        role,
        goal,
        status: 'thinking',
        progress: 0,
        currentUrl: 'https://www.wikipedia.org',
        logs: [{ timestamp: Date.now(), type: 'system', message: `Agent ${id} initialized.` }],
      };
      setAgents((prev) => [...prev, newAgent]);
      setTimeout(() => {
        setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'working' } : a)));
      }, 500);
    },
    [runtimeMode, kernel],
  );

  const stopAgent = useCallback(
    (id: string) => {
      if (runtimeMode === 'kernel') {
        const agent = agents.find((a) => a.id === id);
        if (agent?.pid) kernel.killProcess(agent.pid);
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: 'error' as AgentStatus,
                logs: [
                  ...a.logs,
                  { timestamp: Date.now(), type: 'system', message: 'Process terminated by user.' },
                ],
              }
            : a,
        ),
      );
    },
    [runtimeMode, agents, kernel],
  );

  const approveAgent = useCallback(
    (id: string) => {
      if (runtimeMode === 'kernel') {
        const agent = agents.find((a) => a.id === id);
        if (agent?.pid) kernel.approveAction(agent.pid);
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: 'working' as AgentStatus,
                logs: [
                  ...a.logs,
                  { timestamp: Date.now(), type: 'system', message: 'Action approved by user.' },
                ],
              }
            : a,
        ),
      );
    },
    [runtimeMode, agents, kernel],
  );

  const rejectAgent = useCallback(
    (id: string) => {
      if (runtimeMode === 'kernel') {
        const agent = agents.find((a) => a.id === id);
        if (agent?.pid) kernel.rejectAction(agent.pid);
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: 'thinking' as AgentStatus,
                logs: [
                  ...a.logs,
                  {
                    timestamp: Date.now(),
                    type: 'system',
                    message: 'Action denied. Re-evaluating strategy...',
                  },
                ],
              }
            : a,
        ),
      );
    },
    [runtimeMode, agents, kernel],
  );

  const syncGithub = useCallback(
    (id: string) => {
      const agent = agents.find((a) => a.id === id);
      if (!agent) return;

      if (agent.githubSync) {
        if (runtimeMode === 'kernel' && agent.pid && agent.ttyId) {
          const client = getKernelClient();
          client.sendTerminalInput(
            agent.ttyId,
            'git add . && git commit -m "Agent changes" && echo "Push requires approval. Run: git push"\n',
          );
          setAgents((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    logs: [
                      ...a.logs,
                      {
                        timestamp: Date.now(),
                        type: 'system',
                        message: 'Staging and committing changes...',
                      },
                    ],
                  }
                : a,
            ),
          );
        } else {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    githubSync: false,
                    logs: [
                      ...a.logs,
                      {
                        timestamp: Date.now(),
                        type: 'system',
                        message: 'Disconnected from GitHub.',
                      },
                    ],
                  }
                : a,
            ),
          );
        }
      } else {
        setGithubModalAgentId(id);
        setGithubRepoUrl('');
        setGithubCloneStatus('idle');
        setShowGithubModal(true);
      }
    },
    [agents, runtimeMode],
  );

  const handleGithubClone = useCallback(async () => {
    if (!githubRepoUrl.trim() || !githubModalAgentId) return;
    const agent = agents.find((a) => a.id === githubModalAgentId);
    if (!agent) return;

    setGithubCloneStatus('cloning');

    if (runtimeMode === 'kernel' && agent.pid) {
      try {
        const client = getKernelClient();
        const repoName = githubRepoUrl.split('/').pop()?.replace('.git', '') || 'repo';
        const homeDir = `/home/agent_${agent.pid}`;
        await client.writeFile(
          `${homeDir}/.clone_repo.sh`,
          `#!/bin/bash\ncd ${homeDir}\ngit clone ${githubRepoUrl}\necho "Clone complete: ${repoName}"\n`,
        );
        if (agent.ttyId) {
          client.sendTerminalInput(agent.ttyId, `cd ${homeDir} && git clone ${githubRepoUrl}\n`);
        }

        setAgents((prev) =>
          prev.map((a) =>
            a.id === githubModalAgentId
              ? {
                  ...a,
                  githubSync: true,
                  logs: [
                    ...a.logs,
                    {
                      timestamp: Date.now(),
                      type: 'system',
                      message: `Cloning ${githubRepoUrl} into workspace...`,
                    },
                  ],
                }
              : a,
          ),
        );

        setGithubCloneStatus('done');
        setTimeout(() => setShowGithubModal(false), 1500);
      } catch {
        setGithubCloneStatus('error');
      }
    } else {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === githubModalAgentId
            ? {
                ...a,
                githubSync: true,
                logs: [
                  ...a.logs,
                  {
                    timestamp: Date.now(),
                    type: 'system',
                    message: `Connected to GitHub: ${githubRepoUrl}`,
                  },
                ],
              }
            : a,
        ),
      );

      setGithubCloneStatus('done');
      setTimeout(() => setShowGithubModal(false), 1500);
    }
  }, [githubRepoUrl, githubModalAgentId, agents, runtimeMode]);

  return {
    agents,
    launchAgent,
    stopAgent,
    approveAgent,
    rejectAgent,
    syncGithub,
    showGithubModal,
    setShowGithubModal,
    githubRepoUrl,
    setGithubRepoUrl,
    githubCloneStatus,
    handleGithubClone,
  };
}
