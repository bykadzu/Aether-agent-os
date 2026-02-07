import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal,
  AlertTriangle,
  Check,
  StopCircle,
  Github,
  ChevronRight,
  ChevronDown,
  Layout,
  Cpu,
  HardDrive,
  Activity,
  Clock,
  Download,
  GitBranch,
  Circle,
  Loader,
  CheckCircle,
  XCircle,
  MinusCircle,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { Agent } from '../../types';
import { VirtualDesktop } from '../os/VirtualDesktop';
import { getKernelClient } from '../../services/kernelClient';
import { XTerminal } from '../os/XTerminal';
import { AgentTimeline } from './AgentTimeline';
import { exportLogsAsJson, exportLogsAsText } from '../../services/agentLogExport';

// ---------------------------------------------------------------------------
// Plan Types
// ---------------------------------------------------------------------------

type PlanNodeStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

interface PlanNode {
  id: string;
  title: string;
  description?: string;
  status: PlanNodeStatus;
  estimated_steps: number;
  actual_steps: number;
  children: PlanNode[];
}

interface PlanRecord {
  id: string;
  agent_uid: string;
  pid: number;
  goal: string;
  root_nodes: PlanNode[];
  status: 'active' | 'completed' | 'abandoned';
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Mock Plan Data
// ---------------------------------------------------------------------------

const MOCK_PLAN: PlanRecord = {
  id: 'plan-mock-1',
  agent_uid: 'agent-1',
  pid: 1,
  goal: 'Build a REST API with user authentication',
  root_nodes: [
    {
      id: 'n1',
      title: 'Set up project structure',
      description: 'Initialize Node.js project with TypeScript',
      status: 'completed',
      estimated_steps: 3,
      actual_steps: 2,
      children: [
        {
          id: 'n1a',
          title: 'Initialize package.json',
          status: 'completed',
          estimated_steps: 1,
          actual_steps: 1,
          children: [],
        },
        {
          id: 'n1b',
          title: 'Configure TypeScript',
          status: 'completed',
          estimated_steps: 1,
          actual_steps: 1,
          children: [],
        },
      ],
    },
    {
      id: 'n2',
      title: 'Implement auth system',
      description: 'JWT-based authentication',
      status: 'active',
      estimated_steps: 5,
      actual_steps: 2,
      children: [
        {
          id: 'n2a',
          title: 'Create user model',
          status: 'completed',
          estimated_steps: 2,
          actual_steps: 1,
          children: [],
        },
        {
          id: 'n2b',
          title: 'Implement login endpoint',
          status: 'active',
          estimated_steps: 2,
          actual_steps: 1,
          children: [],
        },
        {
          id: 'n2c',
          title: 'Add JWT middleware',
          status: 'pending',
          estimated_steps: 1,
          actual_steps: 0,
          children: [],
        },
      ],
    },
    {
      id: 'n3',
      title: 'Write tests',
      status: 'pending',
      estimated_steps: 4,
      actual_steps: 0,
      children: [],
    },
  ],
  status: 'active',
  created_at: Date.now() - 300000,
  updated_at: Date.now() - 60000,
};

// ---------------------------------------------------------------------------
// Plan Helpers
// ---------------------------------------------------------------------------

function countPlanNodes(nodes: PlanNode[]): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  for (const node of nodes) {
    total++;
    if (node.status === 'completed') completed++;
    const childCounts = countPlanNodes(node.children);
    total += childCounts.total;
    completed += childCounts.completed;
  }
  return { total, completed };
}

function getStatusIcon(status: PlanNodeStatus) {
  switch (status) {
    case 'pending':
      return <Circle size={12} className="text-gray-500" />;
    case 'active':
      return <Loader size={12} className="text-blue-400 animate-spin" />;
    case 'completed':
      return <CheckCircle size={12} className="text-green-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    case 'skipped':
      return <MinusCircle size={12} className="text-gray-500" />;
  }
}

function getPlanStatusBadge(status: PlanRecord['status']) {
  switch (status) {
    case 'active':
      return (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 uppercase">
          Active
        </span>
      );
    case 'completed':
      return (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 uppercase">
          Completed
        </span>
      );
    case 'abandoned':
      return (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 uppercase">
          Abandoned
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// PlanTreeNode Component (recursive)
// ---------------------------------------------------------------------------

const PlanTreeNode: React.FC<{ node: PlanNode; depth?: number }> = ({ node, depth = 0 }) => {
  const [expanded, setExpanded] = useState(node.status === 'active' || node.status === 'completed');
  const hasChildren = node.children.length > 0;

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-white/5 cursor-pointer transition-colors group"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/collapse chevron */}
        <span className="w-3 shrink-0 flex items-center justify-center">
          {hasChildren ? (
            expanded ? (
              <ChevronDown size={10} className="text-gray-500" />
            ) : (
              <ChevronRight size={10} className="text-gray-500" />
            )
          ) : (
            <span className="w-2.5" />
          )}
        </span>

        {/* Status icon */}
        <span className="shrink-0">{getStatusIcon(node.status)}</span>

        {/* Title */}
        <span
          className={`text-[10px] truncate ${
            node.status === 'completed'
              ? 'text-gray-500 line-through'
              : node.status === 'active'
                ? 'text-white font-medium'
                : node.status === 'failed'
                  ? 'text-red-300'
                  : 'text-gray-400'
          }`}
        >
          {node.title}
        </span>

        {/* Steps badge */}
        {node.estimated_steps > 0 && (
          <span className="text-[8px] text-gray-600 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            {node.actual_steps}/{node.estimated_steps} steps
          </span>
        )}
      </div>

      {/* Description (shown when expanded and node has description) */}
      {expanded && node.description && (
        <div
          className="text-[9px] text-gray-600 italic pb-1"
          style={{ paddingLeft: `${depth * 14 + 36}px` }}
        >
          {node.description}
        </div>
      )}

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <PlanTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AgentVM Component
// ---------------------------------------------------------------------------

interface AgentVMProps {
  agent: Agent;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onStop: (id: string) => void;
  onSyncGithub: (id: string) => void;
}

export const AgentVM: React.FC<AgentVMProps> = ({
  agent,
  onApprove,
  onReject,
  onStop,
  onSyncGithub,
}) => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'logs' | 'terminal' | 'timeline' | 'plan'>('logs');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [feedbackRatings, setFeedbackRatings] = useState<Record<number, 1 | -1>>({});
  const [feedbackComment, setFeedbackComment] = useState<{ idx: number; text: string } | null>(
    null,
  );
  const [planData, setPlanData] = useState<PlanRecord | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.logs.length]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  // Load plan data from kernel or use mock
  useEffect(() => {
    const kernel = getKernelClient();

    if (agent.pid && kernel.connected) {
      // Fetch plan from kernel
      const msgId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const handleResponse = (event: any) => {
        if (event.id === msgId && event.type === 'response.ok' && event.data) {
          setPlanData(event.data);
        }
      };
      const unsubOk = kernel.on('response.ok', handleResponse);

      // Send plan.get command
      (kernel as any).send?.({ type: 'plan.get', id: msgId, pid: agent.pid });

      // Subscribe to live plan updates
      const unsubCreated = kernel.on('plan.created', (event: any) => {
        if (event.plan && (event.plan.pid === agent.pid || event.plan.agent_uid === agent.id)) {
          setPlanData(event.plan);
        }
      });
      const unsubUpdated = kernel.on('plan.updated', (event: any) => {
        if (event.plan && (event.plan.pid === agent.pid || event.plan.agent_uid === agent.id)) {
          setPlanData(event.plan);
        }
      });

      return () => {
        unsubOk();
        unsubCreated();
        unsubUpdated();
      };
    } else {
      // Use mock data when disconnected or no PID — deferred to avoid sync setState in effect
      const t = setTimeout(() => setPlanData(MOCK_PLAN), 0);
      return () => clearTimeout(t);
    }
  }, [agent.pid, agent.id]);

  const handleExportJson = useCallback(() => {
    exportLogsAsJson(agent);
    setShowExportMenu(false);
  }, [agent]);

  const handleExportText = useCallback(() => {
    exportLogsAsText(agent);
    setShowExportMenu(false);
  }, [agent]);

  const submitFeedback = async (logIdx: number, rating: 1 | -1, comment?: string) => {
    setFeedbackRatings((prev) => ({ ...prev, [logIdx]: rating }));
    try {
      await fetch('http://localhost:3001/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pid: agent.pid || 0,
          step: logIdx,
          rating,
          comment,
          agent_uid: agent.id,
        }),
      });
    } catch {
      // Feedback is fire-and-forget
    }
  };

  const statusColor =
    agent.status === 'working'
      ? 'bg-green-500'
      : agent.status === 'thinking'
        ? 'bg-blue-500'
        : agent.status === 'waiting_approval'
          ? 'bg-yellow-500'
          : agent.status === 'completed'
            ? 'bg-emerald-500'
            : agent.status === 'error'
              ? 'bg-red-500'
              : 'bg-gray-500';

  const phaseLabel = agent.phase || agent.status;

  // Compute plan progress
  const planCounts = planData ? countPlanNodes(planData.root_nodes) : { total: 0, completed: 0 };
  const planProgressPct =
    planCounts.total > 0 ? Math.round((planCounts.completed / planCounts.total) * 100) : 0;

  return (
    <div className="flex h-full bg-[#000] text-gray-300 font-sans overflow-hidden relative">
      {/* Main Area: The Virtual Desktop */}
      <div className="flex-1 relative transition-all duration-300 ease-in-out">
        <VirtualDesktop agent={agent} interactive={false} />

        {/* Floating Control Bar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-xl border border-white/10 rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl z-[100] hover:bg-black/70 transition-colors">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${statusColor} ${agent.status === 'working' ? 'animate-pulse' : ''}`}
            ></div>
            <span className="text-xs font-bold text-white tracking-wide uppercase">
              {phaseLabel}
            </span>
          </div>

          {/* PID Badge (when connected to real kernel) */}
          {agent.pid && (
            <div className="text-[10px] text-gray-400 bg-white/5 px-1.5 py-0.5 rounded font-mono">
              PID {agent.pid}
            </div>
          )}

          <div className="w-[1px] h-4 bg-white/20"></div>
          <button
            onClick={() => onSyncGithub(agent.id)}
            className={`p-1.5 rounded-full transition-colors ${agent.githubSync ? 'bg-white text-black' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
            title="GitHub Sync"
          >
            <Github size={14} />
          </button>

          {/* Export Logs Button */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Export Logs"
            >
              <Download size={14} />
            </button>
            {showExportMenu && (
              <div className="absolute top-full mt-2 right-0 bg-[#1a1d26]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden z-[200] min-w-[160px]">
                <button
                  onClick={handleExportJson}
                  className="w-full px-3 py-2 text-left text-[11px] text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                >
                  <span className="text-indigo-400 font-mono text-[9px] bg-indigo-500/10 px-1.5 py-0.5 rounded">
                    JSON
                  </span>
                  <span>Export as JSON</span>
                </button>
                <div className="h-[1px] bg-white/5" />
                <button
                  onClick={handleExportText}
                  className="w-full px-3 py-2 text-left text-[11px] text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                >
                  <span className="text-emerald-400 font-mono text-[9px] bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    TXT
                  </span>
                  <span>Export as Text</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => onStop(agent.id)}
            className="p-1.5 rounded-full text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
            title="Emergency Stop (SIGTERM)"
          >
            <StopCircle size={14} />
          </button>
          <div className="w-[1px] h-4 bg-white/20"></div>
          <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Toggle Debug Console"
          >
            <Layout size={14} />
          </button>
        </div>

        {/* Approval Modal (Overlay on VM) */}
        {agent.status === 'waiting_approval' && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[200] animate-slide-up">
            <div className="bg-[#1a1d26]/90 backdrop-blur-xl border border-yellow-500/50 rounded-2xl shadow-2xl p-4 w-[400px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-yellow-500/20 rounded-lg text-yellow-400">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-white font-medium">Permission Request</h3>
                  <p className="text-xs text-gray-400">Agent needs authorization to proceed.</p>
                </div>
              </div>

              <div className="bg-black/50 p-3 rounded-lg border border-white/5 font-mono text-[10px] text-yellow-100">
                {agent.logs[agent.logs.length - 1]?.message}
              </div>

              <div className="flex justify-end gap-2 mt-1">
                <button
                  onClick={() => onReject(agent.id)}
                  className="px-4 py-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors text-xs font-medium"
                >
                  Deny
                </button>
                <button
                  onClick={() => onApprove(agent.id)}
                  className="bg-white text-black hover:bg-gray-200 px-4 py-1.5 rounded-lg font-bold text-xs transition-colors flex items-center gap-2"
                >
                  <Check size={12} /> Approve
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar: Debug Console */}
      <div
        className={`bg-[#0f111a] border-l border-white/10 flex flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-80' : 'w-0 opacity-0 pointer-events-none'}`}
      >
        {/* Tab Bar */}
        <div className="flex border-b border-white/10 bg-[#1a1d26]">
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'logs'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Activity size={10} /> Logs
          </button>
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'terminal'
                ? 'text-white border-b-2 border-green-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Terminal size={10} /> Terminal
            {agent.ttyId && <div className="w-1 h-1 rounded-full bg-green-500" />}
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'timeline'
                ? 'text-white border-b-2 border-orange-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Clock size={10} /> Timeline
          </button>
          <button
            onClick={() => setActiveTab('plan')}
            className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'plan'
                ? 'text-white border-b-2 border-purple-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <GitBranch size={10} /> Plan
          </button>
        </div>

        {/* Sidebar close button */}
        <div className="absolute top-12 right-1 z-10">
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-gray-600 hover:text-white p-1"
          >
            <ChevronRight size={12} />
          </button>
        </div>

        {/* Agent Logs Tab */}
        {activeTab === 'logs' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[10px]">
            {agent.logs.map((log, idx) => (
              <div
                key={idx}
                className="flex gap-2 animate-fade-in pb-2 border-b border-white/5 last:border-0"
              >
                <span className="text-gray-600 shrink-0 select-none">
                  {new Date(log.timestamp).toLocaleTimeString([], {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={`flex-1 ${
                    log.type === 'thought'
                      ? 'text-purple-300'
                      : log.type === 'action'
                        ? 'text-blue-300'
                        : log.type === 'observation'
                          ? 'text-cyan-300'
                          : 'text-gray-400'
                  }`}
                >
                  {log.type === 'thought' && (
                    <span className="text-purple-500 font-bold block mb-0.5">THOUGHT</span>
                  )}
                  {log.type === 'action' && (
                    <span className="text-blue-500 font-bold block mb-0.5">ACTION</span>
                  )}
                  {log.type === 'observation' && (
                    <span className="text-cyan-500 font-bold block mb-0.5">OBSERVE</span>
                  )}
                  {log.message}
                  {log.type === 'action' && (
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        onClick={() => submitFeedback(idx, 1)}
                        className={`p-0.5 rounded transition-colors ${
                          feedbackRatings[idx] === 1
                            ? 'text-green-400 bg-green-500/20'
                            : 'text-gray-600 hover:text-green-400 hover:bg-green-500/10'
                        }`}
                        title="Good action"
                      >
                        <ThumbsUp size={10} />
                      </button>
                      <button
                        onClick={() => {
                          if (feedbackRatings[idx] === -1) return;
                          setFeedbackComment({ idx, text: '' });
                        }}
                        className={`p-0.5 rounded transition-colors ${
                          feedbackRatings[idx] === -1
                            ? 'text-red-400 bg-red-500/20'
                            : 'text-gray-600 hover:text-red-400 hover:bg-red-500/10'
                        }`}
                        title="Bad action"
                      >
                        <ThumbsDown size={10} />
                      </button>
                    </div>
                  )}
                  {feedbackComment?.idx === idx && (
                    <div className="mt-1 flex gap-1">
                      <input
                        type="text"
                        value={feedbackComment.text}
                        onChange={(e) =>
                          setFeedbackComment({ ...feedbackComment, text: e.target.value })
                        }
                        placeholder="What went wrong?"
                        className="flex-1 bg-black/30 border border-red-500/30 rounded px-2 py-0.5 text-[10px] text-gray-300 focus:outline-none focus:border-red-500/50"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            submitFeedback(idx, -1, feedbackComment.text);
                            setFeedbackComment(null);
                          }
                          if (e.key === 'Escape') setFeedbackComment(null);
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          submitFeedback(idx, -1, feedbackComment.text);
                          setFeedbackComment(null);
                        }}
                        className="text-[9px] text-red-400 hover:text-red-300 px-1"
                      >
                        Send
                      </button>
                      <button
                        onClick={() => setFeedbackComment(null)}
                        className="text-[9px] text-gray-500 hover:text-gray-300 px-1"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Terminal Tab */}
        {activeTab === 'terminal' && (
          <div className="flex-1 overflow-hidden bg-[#0a0b12]">
            {agent.ttyId ? (
              <XTerminal ttyId={agent.ttyId} className="h-full" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-3">
                <Terminal size={24} />
                <span className="text-[10px]">No terminal session</span>
                <span className="text-[9px]">Connect to kernel for live terminal</span>
              </div>
            )}
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div className="flex-1 overflow-hidden relative">
            {agent.pid ? (
              <AgentTimeline pid={agent.pid} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-3">
                <Clock size={24} />
                <span className="text-[10px]">No timeline available</span>
                <span className="text-[9px]">Connect to kernel for agent history</span>
              </div>
            )}
          </div>
        )}

        {/* Plan Tab */}
        {activeTab === 'plan' && (
          <div className="flex-1 overflow-y-auto">
            {planData ? (
              <div className="flex flex-col h-full">
                {/* Plan Header */}
                <div className="p-3 border-b border-white/5 bg-[#12141d]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <GitBranch size={12} className="text-purple-400" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-wide">
                        Plan
                      </span>
                    </div>
                    {getPlanStatusBadge(planData.status)}
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed mb-2">{planData.goal}</p>
                  <div className="text-[9px] text-gray-600 mb-2">
                    Created{' '}
                    {new Date(planData.created_at).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' | '}
                    Updated{' '}
                    {new Date(planData.updated_at).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${planProgressPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-gray-500 font-mono shrink-0">
                      {planCounts.completed}/{planCounts.total} ({planProgressPct}%)
                    </span>
                  </div>
                </div>

                {/* Plan Tree */}
                <div className="flex-1 overflow-y-auto p-2">
                  {planData.root_nodes.map((node) => (
                    <PlanTreeNode key={node.id} node={node} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-3">
                <GitBranch size={24} />
                <span className="text-[10px]">No plan available</span>
                <span className="text-[9px]">Agent has not created a plan yet</span>
              </div>
            )}
          </div>
        )}

        {/* Process Info Footer */}
        {agent.pid && (
          <div className="p-2 border-t border-white/10 bg-[#1a1d26] text-[9px] text-gray-500 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Cpu size={8} /> PID {agent.pid}
            </span>
            <span className="flex items-center gap-1">
              <HardDrive size={8} /> {agent.phase}
            </span>
            <span className="flex items-center gap-1">
              <Activity size={8} /> Step {agent.progress}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
