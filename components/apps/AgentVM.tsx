import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import {
  Terminal,
  AlertTriangle,
  Check,
  StopCircle,
  Github,
  ChevronLeft,
  ChevronRight,
  Activity,
  Clock,
  Download,
  Pause,
  Play,
  Send,
  PanelRightClose,
  PanelRightOpen,
  Brain,
  Wrench,
  Database,
  Radio,
  ArrowDownToLine,
  Monitor,
} from 'lucide-react';
import { Agent } from '../../types';
import { getKernelClient } from '../../services/kernelClient';
import { XTerminal } from '../os/XTerminal';
import { AgentTimeline } from './AgentTimeline';
import { exportLogsAsJson, exportLogsAsText } from '../../services/agentLogExport';

const AgentDesktopView = React.lazy(() =>
  import('../os/AgentDesktopView').then((m) => ({ default: m.AgentDesktopView })),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogLine {
  ts: number;
  source: 'stdout' | 'stderr' | 'agent' | 'system' | 'thought' | 'action' | 'observation';
  text: string;
}

interface ToolCall {
  name: string;
  ts: number;
}

type SidebarTab = 'terminal' | 'timeline' | 'activity';
type MainTab = 'screen' | 'logs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runtimeBadge(agent: Agent): { label: string; color: string } | null {
  const rt = agent.runtime;
  if (!rt) return null;
  switch (rt) {
    case 'claude-code':
      return { label: 'Claude Code', color: 'bg-violet-500/20 text-violet-300' };
    case 'openclaw':
      return { label: 'OpenClaw', color: 'bg-orange-500/20 text-orange-300' };
    case 'builtin':
      return { label: 'Built-in', color: 'bg-cyan-500/20 text-cyan-300' };
    default:
      return { label: rt, color: 'bg-gray-500/20 text-gray-300' };
  }
}

function sourceColor(source: LogLine['source']): string {
  switch (source) {
    case 'thought':
      return 'text-purple-300';
    case 'action':
      return 'text-blue-300';
    case 'observation':
      return 'text-cyan-300';
    case 'stderr':
      return 'text-red-400';
    case 'system':
      return 'text-yellow-400';
    case 'stdout':
    default:
      return 'text-gray-300';
  }
}

function sourceTag(source: LogLine['source']): string {
  switch (source) {
    case 'thought':
      return 'THINK';
    case 'action':
      return 'ACT  ';
    case 'observation':
      return 'OBS  ';
    case 'stderr':
      return 'ERR  ';
    case 'system':
      return 'SYS  ';
    case 'agent':
      return 'AGENT';
    case 'stdout':
    default:
      return 'OUT  ';
  }
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// AgentVM Component
// ---------------------------------------------------------------------------

interface AgentVMProps {
  agent: Agent;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onStop: (id: string) => void;
  onSyncGithub: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onSendMessage?: (id: string, message: string) => void;
}

export const AgentVM: React.FC<AgentVMProps> = React.memo(
  ({ agent, onApprove, onReject, onStop, onSyncGithub, onPause, onResume, onSendMessage }) => {
    // ---- State ----
    const [mainTab, setMainTab] = useState<MainTab>('screen');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarTab, setSidebarTab] = useState<SidebarTab>('terminal');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [messageText, setMessageText] = useState('');
    const [logLines, setLogLines] = useState<LogLine[]>([]);
    const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
    const [memoryCount, setMemoryCount] = useState(0);
    const [skillCount, setSkillCount] = useState(0);
    const [ipcCount, setIpcCount] = useState(0);
    const [autoScroll, setAutoScroll] = useState(true);

    const logEndRef = useRef<HTMLDivElement>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    // ---- Seed logs from agent.logs (legacy/initial data) ----
    useEffect(() => {
      const seeded: LogLine[] = agent.logs.map((log) => ({
        ts: log.timestamp,
        source: log.type === 'system' ? 'system' : (log.type as LogLine['source']),
        text: log.message,
      }));
      setLogLines(seeded);
    }, [agent.logs]);

    // ---- Subscribe to real-time kernel events ----
    useEffect(() => {
      const kernel = getKernelClient();
      if (!kernel.connected || !agent.pid) return;

      const unsubs: Array<() => void> = [];

      // subprocess.output - raw process stdout/stderr
      unsubs.push(
        kernel.on('subprocess.output', (event: any) => {
          if (event.pid !== agent.pid) return;
          const line: LogLine = {
            ts: event.timestamp || Date.now(),
            source: event.stream === 'stderr' ? 'stderr' : 'stdout',
            text: event.data || event.text || '',
          };
          setLogLines((prev) => [...prev, line]);
        }),
      );

      // agent.log - structured agent log events
      unsubs.push(
        kernel.on('agent.log', (event: any) => {
          if (event.pid !== agent.pid) return;
          const line: LogLine = {
            ts: event.timestamp || Date.now(),
            source: event.phase || event.logType || 'agent',
            text: event.content || event.message || '',
          };
          setLogLines((prev) => [...prev, line]);
        }),
      );

      // agent.thought / agent.action / agent.observation
      for (const phase of ['thought', 'action', 'observation'] as const) {
        unsubs.push(
          kernel.on(`agent.${phase}`, (event: any) => {
            if (event.pid !== agent.pid) return;
            const line: LogLine = {
              ts: event.timestamp || Date.now(),
              source: phase,
              text: event.content || event.message || '',
            };
            setLogLines((prev) => [...prev, line]);
          }),
        );
      }

      // aether-mcp.tool.called - skill/memory tracking
      unsubs.push(
        kernel.on('aether-mcp.tool.called', (event: any) => {
          if (event.pid !== agent.pid) return;
          const toolName = event.tool || event.name || 'unknown';
          setToolCalls((prev) => [...prev, { name: toolName, ts: Date.now() }]);

          // Categorize tool calls
          if (
            toolName.includes('memory') ||
            toolName.includes('store') ||
            toolName.includes('recall')
          ) {
            setMemoryCount((c) => c + 1);
          } else if (toolName.includes('skill') || toolName.includes('execute')) {
            setSkillCount((c) => c + 1);
          }
        }),
      );

      // IPC events
      unsubs.push(
        kernel.on('ipc.message', (event: any) => {
          if (event.pid !== agent.pid && event.targetPid !== agent.pid) return;
          setIpcCount((c) => c + 1);
        }),
      );

      return () => unsubs.forEach((u) => u());
    }, [agent.pid]);

    // ---- Auto-scroll logic ----
    useEffect(() => {
      if (autoScroll) {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, [logLines.length, autoScroll]);

    const handleLogScroll = useCallback(() => {
      const el = logContainerRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      setAutoScroll(atBottom);
    }, []);

    // ---- Close export menu on outside click ----
    useEffect(() => {
      if (!showExportMenu) return;
      const handler = (e: MouseEvent) => {
        if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
          setShowExportMenu(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [showExportMenu]);

    // ---- Handlers ----
    const handleExportJson = useCallback(() => {
      exportLogsAsJson(agent);
      setShowExportMenu(false);
    }, [agent]);

    const handleExportText = useCallback(() => {
      exportLogsAsText(agent);
      setShowExportMenu(false);
    }, [agent]);

    const handleSendMessage = useCallback(() => {
      if (!messageText.trim()) return;
      const kernel = getKernelClient();
      const rt = agent.runtime;

      if ((rt === 'claude-code' || rt === 'openclaw') && agent.pid && kernel.connected) {
        kernel.sendAgentMessage(agent.pid, messageText.trim()).catch(() => {
          // Fallback to onSendMessage if REST fails
          onSendMessage?.(agent.id, messageText.trim());
        });
      } else {
        onSendMessage?.(agent.id, messageText.trim());
      }

      // Add user message to log stream
      setLogLines((prev) => [
        ...prev,
        { ts: Date.now(), source: 'system', text: `[USER] ${messageText.trim()}` },
      ]);
      setMessageText('');
    }, [messageText, agent, onSendMessage]);

    // ---- Derived values ----
    const statusColor =
      agent.status === 'working'
        ? 'bg-green-500'
        : agent.status === 'thinking'
          ? 'bg-blue-500'
          : agent.status === 'waiting_approval'
            ? 'bg-yellow-500'
            : agent.status === 'paused'
              ? 'bg-amber-500'
              : agent.status === 'completed'
                ? 'bg-emerald-500'
                : agent.status === 'error'
                  ? 'bg-red-500'
                  : 'bg-gray-500';

    const phaseLabel = agent.phase || agent.status;
    const rtBadge = runtimeBadge(agent);
    const isRunning = ['working', 'thinking'].includes(agent.status);
    const kernel = getKernelClient();
    const kernelConnected = kernel.connected;
    const canSendMessage =
      isRunning || agent.status === 'paused' || agent.status === 'waiting_approval';

    return (
      <div className="flex h-full bg-[#0a0b10] text-gray-300 font-sans overflow-hidden">
        {/* ===== Main Area ===== */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* -- Control Bar -- */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[#12141d] border-b border-white/10 shrink-0">
            {/* Status */}
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${statusColor} ${isRunning ? 'animate-pulse' : ''}`}
              />
              <span className="text-[11px] font-bold text-white uppercase tracking-wide">
                {phaseLabel}
              </span>
            </div>

            {/* Runtime badge */}
            {rtBadge && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${rtBadge.color}`}>
                {rtBadge.label}
              </span>
            )}

            {/* PID */}
            {agent.pid && (
              <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-mono">
                PID {agent.pid}
              </span>
            )}

            <div className="flex-1" />

            {/* Activity counters */}
            <div className="hidden sm:flex items-center gap-3 text-[9px] text-gray-500 mr-2">
              <span className="flex items-center gap-1" title="Memory operations">
                <Database size={10} /> {memoryCount}
              </span>
              <span className="flex items-center gap-1" title="Skills used">
                <Wrench size={10} /> {skillCount}
              </span>
              <span className="flex items-center gap-1" title="IPC messages">
                <Radio size={10} /> {ipcCount}
              </span>
            </div>

            <div className="w-[1px] h-4 bg-white/10" />

            {/* GitHub sync */}
            <button
              onClick={() => onSyncGithub(agent.id)}
              className={`p-1.5 rounded transition-colors ${
                agent.githubSync
                  ? 'bg-white text-black'
                  : 'text-gray-500 hover:text-white hover:bg-white/10'
              }`}
              title="GitHub Sync"
            >
              <Github size={14} />
            </button>

            {/* Export */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                title="Export Logs"
              >
                <Download size={14} />
              </button>
              {showExportMenu && (
                <div className="absolute top-full mt-1 right-0 bg-[#1a1d26] border border-white/10 rounded-lg shadow-2xl overflow-hidden z-[200] min-w-[150px]">
                  <button
                    onClick={handleExportJson}
                    className="w-full px-3 py-2 text-left text-[11px] text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2"
                  >
                    <span className="text-indigo-400 font-mono text-[9px] bg-indigo-500/10 px-1.5 py-0.5 rounded">
                      JSON
                    </span>
                    Export as JSON
                  </button>
                  <div className="h-[1px] bg-white/5" />
                  <button
                    onClick={handleExportText}
                    className="w-full px-3 py-2 text-left text-[11px] text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-2"
                  >
                    <span className="text-emerald-400 font-mono text-[9px] bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      TXT
                    </span>
                    Export as Text
                  </button>
                </div>
              )}
            </div>

            <div className="w-[1px] h-4 bg-white/10" />

            {/* Pause / Resume */}
            {isRunning && onPause && (
              <button
                onClick={() => onPause(agent.id)}
                className="p-1.5 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
                title="Pause Agent"
              >
                <Pause size={14} />
              </button>
            )}
            {(agent.status === 'paused' || agent.status === 'idle') && onResume && (
              <button
                onClick={() => onResume(agent.id)}
                className="p-1.5 rounded text-green-400 hover:bg-green-500/20 transition-colors"
                title="Resume Agent"
              >
                <Play size={14} />
              </button>
            )}

            {/* Stop */}
            <button
              onClick={() => onStop(agent.id)}
              className="p-1.5 rounded text-red-400 hover:bg-red-500/20 transition-colors"
              title="Stop (SIGTERM)"
            >
              <StopCircle size={14} />
            </button>

            <div className="w-[1px] h-4 bg-white/10" />

            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
              title="Toggle sidebar"
            >
              {sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
          </div>

          {/* -- Main Tab Bar -- */}
          <div className="flex border-b border-white/10 bg-[#12141d] shrink-0">
            <button
              onClick={() => setMainTab('screen')}
              className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                mainTab === 'screen'
                  ? 'text-white border-b-2 border-indigo-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Monitor size={10} /> Screen
            </button>
            <button
              onClick={() => setMainTab('logs')}
              className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                mainTab === 'logs'
                  ? 'text-white border-b-2 border-green-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Terminal size={10} /> Logs
            </button>
          </div>

          {/* -- Screen Tab -- */}
          {mainTab === 'screen' && (
            <div className="flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-gray-600">
                    <Monitor size={24} className="animate-pulse" />
                  </div>
                }
              >
                <AgentDesktopView agent={agent} kernelConnected={kernelConnected} />
              </Suspense>
            </div>
          )}

          {/* -- Logs Tab (existing log stream) -- */}
          {mainTab === 'logs' && (
            <div
              ref={logContainerRef}
              onScroll={handleLogScroll}
              className="flex-1 overflow-y-auto bg-[#0a0b10] font-mono text-[11px] leading-[1.6] select-text"
            >
              {logLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
                  <Terminal size={32} className="opacity-40" />
                  <span className="text-sm">Waiting for agent output...</span>
                  {agent.pid && (
                    <span className="text-xs text-gray-700">Listening on PID {agent.pid}</span>
                  )}
                </div>
              ) : (
                <div className="p-3 pb-1">
                  {logLines.map((line, i) => (
                    <div key={i} className="flex gap-0 hover:bg-white/[0.02] py-[1px]">
                      {/* Line number */}
                      <span className="text-gray-700 w-10 text-right pr-3 shrink-0 select-none">
                        {i + 1}
                      </span>
                      {/* Timestamp */}
                      <span className="text-gray-600 w-[70px] shrink-0 select-none">
                        {formatTs(line.ts)}
                      </span>
                      {/* Source tag */}
                      <span
                        className={`w-[50px] shrink-0 font-bold ${sourceColor(line.source)} opacity-70`}
                      >
                        {sourceTag(line.source)}
                      </span>
                      {/* Message */}
                      <span
                        className={`flex-1 whitespace-pre-wrap break-all ${sourceColor(line.source)}`}
                      >
                        {line.text}
                      </span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}

              {/* Auto-scroll indicator */}
              {!autoScroll && logLines.length > 0 && (
                <button
                  onClick={() => {
                    setAutoScroll(true);
                    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-indigo-600/90 hover:bg-indigo-500 text-white text-[10px] px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg transition-colors"
                >
                  <ArrowDownToLine size={12} /> Scroll to bottom
                </button>
              )}
            </div>
          )}

          {/* -- Approval Overlay -- */}
          {agent.status === 'waiting_approval' && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[200]">
              <div className="bg-[#1a1d26]/95 backdrop-blur-xl border border-yellow-500/50 rounded-xl shadow-2xl p-4 w-[400px] flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-yellow-500/20 rounded-lg text-yellow-400">
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium text-sm">Permission Request</h3>
                    <p className="text-[11px] text-gray-400">
                      Agent needs authorization to proceed.
                    </p>
                  </div>
                </div>
                <div className="bg-black/50 p-3 rounded-lg border border-white/5 font-mono text-[10px] text-yellow-100 max-h-32 overflow-y-auto">
                  {agent.logs[agent.logs.length - 1]?.message}
                </div>
                <div className="flex justify-end gap-2">
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

          {/* -- Message Input Bar (always visible when agent can receive messages) -- */}
          {canSendMessage && onSendMessage && (
            <div className="shrink-0 border-t border-white/10 bg-[#12141d] px-3 py-2">
              <div className="flex items-center gap-2">
                {agent.status === 'paused' && (
                  <span className="text-[9px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded shrink-0">
                    PAUSED
                  </span>
                )}
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder={
                    agent.status === 'paused'
                      ? 'Inject instructions before resuming...'
                      : 'Send message to agent...'
                  }
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!messageText.trim()}
                  className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors shrink-0"
                  title="Send message (Enter)"
                >
                  <Send size={14} />
                </button>
                {agent.status === 'paused' && onResume && (
                  <button
                    onClick={() => onResume(agent.id)}
                    className="p-2 rounded-lg bg-green-600/80 hover:bg-green-500 text-white transition-colors shrink-0"
                    title="Resume agent"
                  >
                    <Play size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ===== Collapsible Right Sidebar ===== */}
        <div
          className={`bg-[#0f111a] border-l border-white/10 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${
            sidebarOpen ? 'w-80' : 'w-0'
          }`}
        >
          {sidebarOpen && (
            <>
              {/* Sidebar tab bar */}
              <div className="flex border-b border-white/10 bg-[#1a1d26] shrink-0">
                <button
                  onClick={() => setSidebarTab('terminal')}
                  className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                    sidebarTab === 'terminal'
                      ? 'text-white border-b-2 border-green-500'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Terminal size={10} /> Terminal
                  {agent.ttyId && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                </button>
                <button
                  onClick={() => setSidebarTab('timeline')}
                  className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                    sidebarTab === 'timeline'
                      ? 'text-white border-b-2 border-orange-500'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Clock size={10} /> Timeline
                </button>
                <button
                  onClick={() => setSidebarTab('activity')}
                  className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                    sidebarTab === 'activity'
                      ? 'text-white border-b-2 border-purple-500'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Activity size={10} /> Activity
                </button>
              </div>

              {/* Terminal tab */}
              {sidebarTab === 'terminal' && (
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

              {/* Timeline tab */}
              {sidebarTab === 'timeline' && (
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

              {/* Activity / Skills / Memory tab */}
              {sidebarTab === 'activity' && (
                <div className="flex-1 overflow-y-auto p-3">
                  {/* Counters */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-white/5 rounded-lg p-2.5 text-center">
                      <Database size={14} className="mx-auto mb-1 text-cyan-400" />
                      <div className="text-lg font-bold text-white">{memoryCount}</div>
                      <div className="text-[9px] text-gray-500 uppercase">Memory</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5 text-center">
                      <Wrench size={14} className="mx-auto mb-1 text-violet-400" />
                      <div className="text-lg font-bold text-white">{skillCount}</div>
                      <div className="text-[9px] text-gray-500 uppercase">Skills</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5 text-center">
                      <Radio size={14} className="mx-auto mb-1 text-orange-400" />
                      <div className="text-lg font-bold text-white">{ipcCount}</div>
                      <div className="text-[9px] text-gray-500 uppercase">IPC</div>
                    </div>
                  </div>

                  {/* Recent tool calls */}
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Recent Tool Calls
                  </h4>
                  {toolCalls.length === 0 ? (
                    <div className="text-[10px] text-gray-600 text-center py-6">
                      No tool calls recorded yet.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {toolCalls
                        .slice(-30)
                        .reverse()
                        .map((tc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 transition-colors"
                          >
                            <Brain size={10} className="text-purple-400 shrink-0" />
                            <span className="text-[10px] text-gray-300 truncate flex-1 font-mono">
                              {tc.name}
                            </span>
                            <span className="text-[9px] text-gray-600 shrink-0">
                              {formatTs(tc.ts)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Sidebar footer - process info */}
              {agent.pid && (
                <div className="p-2 border-t border-white/10 bg-[#1a1d26] text-[9px] text-gray-500 flex items-center gap-3 shrink-0">
                  <span>PID {agent.pid}</span>
                  {agent.phase && <span>{agent.phase}</span>}
                  <span>Step {agent.progress}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  },
);
