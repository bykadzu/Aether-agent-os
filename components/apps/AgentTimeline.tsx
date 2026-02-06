import React, { useState, useEffect, useRef } from 'react';
import { Clock, Eye, Zap, MessageCircle, ChevronDown } from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

interface TimelineEntry {
  id: number;
  pid: number;
  step: number;
  phase: string;
  tool?: string;
  content: string;
  timestamp: number;
}

interface AgentTimelineProps {
  pid: number;
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({ pid }) => {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load initial history
  useEffect(() => {
    const client = getKernelClient();
    let mounted = true;

    const loadHistory = async () => {
      try {
        const logs = await client.getAgentHistory(pid);
        if (mounted) {
          setEntries(logs);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    };

    loadHistory();

    // Subscribe to live events
    const unsubs: Array<() => void> = [];

    unsubs.push(client.on('agent.thought', (data: any) => {
      if (data.pid !== pid) return;
      setEntries(prev => [...prev, {
        id: Date.now(),
        pid: data.pid,
        step: -1,
        phase: 'thought',
        content: data.thought,
        timestamp: Date.now(),
      }]);
    }));

    unsubs.push(client.on('agent.action', (data: any) => {
      if (data.pid !== pid) return;
      setEntries(prev => [...prev, {
        id: Date.now(),
        pid: data.pid,
        step: -1,
        phase: 'action',
        tool: data.tool,
        content: JSON.stringify(data.args),
        timestamp: Date.now(),
      }]);
    }));

    unsubs.push(client.on('agent.observation', (data: any) => {
      if (data.pid !== pid) return;
      setEntries(prev => [...prev, {
        id: Date.now(),
        pid: data.pid,
        step: -1,
        phase: 'observation',
        content: data.result,
        timestamp: Date.now(),
      }]);
    }));

    return () => {
      mounted = false;
      unsubs.forEach(fn => fn());
    };
  }, [pid]);

  // Auto-scroll to latest
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const getPhaseIcon = (phase: string) => {
    switch (phase) {
      case 'thought': return <MessageCircle size={14} />;
      case 'action': return <Zap size={14} />;
      case 'observation': return <Eye size={14} />;
      default: return <Clock size={14} />;
    }
  };

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'thought': return {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        text: 'text-blue-400',
        dot: 'bg-blue-500',
        label: 'Thought',
      };
      case 'action': return {
        bg: 'bg-orange-500/10',
        border: 'border-orange-500/30',
        text: 'text-orange-400',
        dot: 'bg-orange-500',
        label: 'Action',
      };
      case 'observation': return {
        bg: 'bg-green-500/10',
        border: 'border-green-500/30',
        text: 'text-green-400',
        dot: 'bg-green-500',
        label: 'Observation',
      };
      default: return {
        bg: 'bg-gray-500/10',
        border: 'border-gray-500/30',
        text: 'text-gray-400',
        dot: 'bg-gray-500',
        label: phase,
      };
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatContent = (entry: TimelineEntry) => {
    if (entry.phase === 'action' && entry.tool) {
      try {
        const args = JSON.parse(entry.content);
        const argStr = Object.entries(args)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 80) : JSON.stringify(v)}`)
          .join(', ');
        return `${entry.tool}(${argStr})`;
      } catch {
        return `${entry.tool}: ${entry.content}`;
      }
    }
    return entry.content;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          <span className="text-[10px]">Loading timeline...</span>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-3">
        <Clock size={24} />
        <span className="text-[10px]">No timeline entries yet</span>
        <span className="text-[9px]">Agent activity will appear here</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Timeline entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3"
      >
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[19px] top-2 bottom-2 w-[1px] bg-white/10" />

          {entries.map((entry, idx) => {
            const colors = getPhaseColor(entry.phase);
            return (
              <div key={entry.id || idx} className="relative pl-10 pb-4 animate-fade-in">
                {/* Dot on timeline */}
                <div className={`absolute left-[15px] top-1.5 w-[9px] h-[9px] rounded-full ${colors.dot} ring-2 ring-[#0f111a] z-10`} />

                {/* Entry card */}
                <div className={`${colors.bg} border ${colors.border} rounded-lg p-2.5`}>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`${colors.text}`}>
                      {getPhaseIcon(entry.phase)}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${colors.text}`}>
                      {colors.label}
                    </span>
                    {entry.tool && (
                      <span className="text-[9px] font-mono bg-white/5 px-1.5 py-0.5 rounded text-gray-400">
                        {entry.tool}
                      </span>
                    )}
                    <span className="text-[9px] text-gray-600 ml-auto font-mono">
                      {formatTime(entry.timestamp)}
                    </span>
                    {entry.step >= 0 && (
                      <span className="text-[9px] text-gray-600 font-mono">
                        #{entry.step}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="text-[11px] text-gray-300 leading-relaxed break-words whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {formatContent(entry)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Scroll-to-bottom indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-indigo-600/80 backdrop-blur-sm text-white text-[10px] px-3 py-1 rounded-full flex items-center gap-1 hover:bg-indigo-500 transition-colors shadow-lg"
        >
          <ChevronDown size={10} /> Latest
        </button>
      )}
    </div>
  );
};
