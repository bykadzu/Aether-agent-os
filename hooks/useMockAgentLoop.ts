import { useEffect, useRef } from 'react';
import { Agent, RuntimeMode } from '../types';
import { FileSystemItem } from '../data/mockFileSystem';
import { getAgentDecision } from '../services/geminiService';

/**
 * Mock AI agent loop — runs only when the kernel is not connected.
 *
 * Key performance fix: uses refs for agents/files so the interval callback
 * always reads current state without causing the effect to tear down and
 * recreate on every state change.
 */
export function useMockAgentLoop(
  mockAgents: Agent[],
  setMockAgents: React.Dispatch<React.SetStateAction<Agent[]>>,
  files: FileSystemItem[],
  setFiles: React.Dispatch<React.SetStateAction<FileSystemItem[]>>,
  runtimeMode: RuntimeMode,
) {
  const agentsRef = useRef(mockAgents);
  const filesRef = useRef(files);

  // Keep refs in sync with latest state
  useEffect(() => {
    agentsRef.current = mockAgents;
  }, [mockAgents]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (runtimeMode === 'kernel') return;

    const runAgentStep = async (agent: Agent) => {
      if (agent.isWaiting) return;

      setMockAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, isWaiting: true } : a)));

      const fileNames = filesRef.current.map((f) => f.name);
      const decision = await getAgentDecision(agent, fileNames);

      setMockAgents((prev) =>
        prev.map((a) => {
          if (a.id !== agent.id) return a;

          const newLogs = [...a.logs];
          let newStatus = a.status;
          let newUrl = a.currentUrl;
          let newCode = a.currentCode;

          newLogs.push({ timestamp: Date.now(), type: 'thought', message: decision.thought });

          if (decision.action === 'create_file' && decision.fileName && decision.fileContent) {
            const newFile: FileSystemItem = {
              id: `file_${Date.now()}`,
              parentId: 'root',
              name: decision.fileName,
              type: 'file',
              kind:
                decision.fileName.endsWith('png') || decision.fileName.endsWith('jpg')
                  ? 'image'
                  : 'code',
              date: 'Just now',
              size: `${(decision.fileContent.length / 1024).toFixed(1)} KB`,
              content: decision.fileContent,
            };

            setFiles((currentFiles) => {
              if (currentFiles.some((f) => f.name === decision.fileName)) return currentFiles;
              return [...currentFiles, newFile];
            });

            newLogs.push({
              timestamp: Date.now(),
              type: 'action',
              message: `Created file: ${decision.fileName}`,
            });
            newCode = decision.fileContent;
          } else if (decision.action === 'browse' && decision.url) {
            newUrl = decision.url;
            newLogs.push({
              timestamp: Date.now(),
              type: 'action',
              message: `Browsing ${decision.url}... ${decision.webSummary ? `Found: ${decision.webSummary.substring(0, 50)}...` : ''}`,
            });
          } else if (decision.action === 'complete') {
            newStatus = 'completed';
            newLogs.push({
              timestamp: Date.now(),
              type: 'system',
              message: 'Goal achieved. Task complete.',
            });
          }

          if (a.githubSync && decision.action !== 'think') {
            newLogs.push({
              timestamp: Date.now(),
              type: 'system',
              message: 'Synced changes to GitHub repository [main].',
            });
          }

          return {
            ...a,
            status: newStatus,
            currentUrl: newUrl,
            currentCode: newCode,
            logs: newLogs,
            isWaiting: false,
          };
        }),
      );
    };

    const interval = setInterval(() => {
      const currentAgents = agentsRef.current;
      currentAgents.forEach((agent) => {
        if (agent.status === 'working' || agent.status === 'thinking') {
          runAgentStep(agent);
        }
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [runtimeMode, setMockAgents, setFiles]);
}
