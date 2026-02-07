import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain,
  Search,
  Trash2,
  Edit3,
  Tag,
  Clock,
  User,
  X,
  ChevronRight,
  Eye,
  RefreshCw,
  Database,
  Hash,
  Link2,
  AlertTriangle,
  Target,
  TrendingUp,
  Star,
  Zap,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types (mirrored from @aether/shared protocol)
// ---------------------------------------------------------------------------

type MemoryLayer = 'episodic' | 'semantic' | 'procedural' | 'social';

interface MemoryRecord {
  id: string;
  agent_uid: string;
  layer: MemoryLayer;
  content: string;
  tags: string[];
  importance: number; // 0.0 - 1.0
  access_count: number;
  created_at: number;
  last_accessed: number;
  expires_at?: number;
  source_pid?: number;
  related_memories?: string[];
}

interface AgentProfile {
  agent_uid: string;
  display_name: string;
  total_tasks: number;
  successful_tasks: number;
  failed_tasks: number;
  success_rate: number;
  expertise: string[];
  personality_traits: string[];
  avg_quality_rating: number;
  total_steps: number;
  first_seen: number;
  last_active: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

type LayerFilter = 'all' | MemoryLayer;

const LAYER_COLORS: Record<MemoryLayer, { bg: string; text: string; border: string; dot: string }> =
  {
    episodic: {
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/20',
      dot: 'bg-purple-500',
    },
    semantic: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
      dot: 'bg-blue-500',
    },
    procedural: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
      dot: 'bg-amber-500',
    },
    social: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      dot: 'bg-emerald-500',
    },
  };

const LAYER_LABELS: Record<MemoryLayer, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
  social: 'Social',
};

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.substring(0, maxLen).trimEnd() + '...';
}

// ---------------------------------------------------------------------------
// Mock Data (used when kernel is disconnected)
// ---------------------------------------------------------------------------

const MOCK_AGENTS = ['agent-alpha-01', 'agent-beta-02', 'agent-gamma-03'];

const MOCK_MEMORIES: MemoryRecord[] = [
  {
    id: 'mem-001',
    agent_uid: 'agent-alpha-01',
    layer: 'episodic',
    content:
      'Successfully completed the migration of user database from PostgreSQL to CockroachDB. The migration took 4 hours and required downtime coordination with the DevOps team. Key lesson: always run a dry-run migration first.',
    tags: ['database', 'migration', 'postgresql', 'cockroachdb'],
    importance: 0.92,
    access_count: 14,
    created_at: Date.now() - 86400000 * 2,
    last_accessed: Date.now() - 3600000,
    source_pid: 1042,
    related_memories: ['mem-003', 'mem-007'],
  },
  {
    id: 'mem-002',
    agent_uid: 'agent-alpha-01',
    layer: 'semantic',
    content:
      'React Server Components allow rendering on the server without sending JavaScript to the client. They integrate with Suspense boundaries for streaming HTML. Unlike traditional SSR, RSC can be interleaved with client components.',
    tags: ['react', 'rsc', 'frontend', 'performance'],
    importance: 0.78,
    access_count: 8,
    created_at: Date.now() - 86400000 * 5,
    last_accessed: Date.now() - 7200000,
  },
  {
    id: 'mem-003',
    agent_uid: 'agent-alpha-01',
    layer: 'procedural',
    content:
      'To deploy to production: 1) Run test suite with `npm test` 2) Build with `npm run build` 3) Tag the release with `git tag v*` 4) Push to main branch 5) CI/CD pipeline handles the rest. Always verify staging first.',
    tags: ['deployment', 'ci-cd', 'production', 'procedure'],
    importance: 0.85,
    access_count: 23,
    created_at: Date.now() - 86400000 * 10,
    last_accessed: Date.now() - 1800000,
    related_memories: ['mem-001'],
  },
  {
    id: 'mem-004',
    agent_uid: 'agent-alpha-01',
    layer: 'social',
    content:
      'Agent Beta prefers concise status updates rather than detailed reports. When collaborating on code reviews, Beta responds faster when given specific file paths rather than broad descriptions.',
    tags: ['collaboration', 'agent-beta', 'communication'],
    importance: 0.65,
    access_count: 5,
    created_at: Date.now() - 86400000 * 3,
    last_accessed: Date.now() - 43200000,
  },
  {
    id: 'mem-005',
    agent_uid: 'agent-beta-02',
    layer: 'episodic',
    content:
      'Investigated memory leak in the WebSocket handler. Root cause was event listeners not being cleaned up on disconnect. Fixed by adding proper cleanup in the connection close handler. Performance improved by 40%.',
    tags: ['bugfix', 'websocket', 'memory-leak', 'performance'],
    importance: 0.88,
    access_count: 11,
    created_at: Date.now() - 86400000,
    last_accessed: Date.now() - 5400000,
    source_pid: 2087,
  },
  {
    id: 'mem-006',
    agent_uid: 'agent-beta-02',
    layer: 'semantic',
    content:
      'TypeScript discriminated unions use a common literal property to narrow types. Pattern: `type Result = { ok: true; data: T } | { ok: false; error: string }`. The compiler narrows the type when checking the discriminant.',
    tags: ['typescript', 'types', 'patterns', 'discriminated-union'],
    importance: 0.72,
    access_count: 19,
    created_at: Date.now() - 86400000 * 7,
    last_accessed: Date.now() - 900000,
  },
  {
    id: 'mem-007',
    agent_uid: 'agent-beta-02',
    layer: 'procedural',
    content:
      'Database backup procedure: 1) Notify on-call 2) Run `pg_dump` with --format=custom 3) Upload to S3 with versioning 4) Verify backup integrity with `pg_restore --list` 5) Update backup log.',
    tags: ['database', 'backup', 'procedure', 'postgresql'],
    importance: 0.81,
    access_count: 7,
    created_at: Date.now() - 86400000 * 15,
    last_accessed: Date.now() - 86400000,
    related_memories: ['mem-001'],
  },
  {
    id: 'mem-008',
    agent_uid: 'agent-beta-02',
    layer: 'social',
    content:
      'Agent Gamma is specialized in data analysis and prefers receiving data in JSON format. Gamma works best when given clear success criteria upfront. Response time is typically 2-5 minutes for analysis tasks.',
    tags: ['collaboration', 'agent-gamma', 'data-analysis'],
    importance: 0.58,
    access_count: 3,
    created_at: Date.now() - 86400000 * 4,
    last_accessed: Date.now() - 86400000 * 2,
  },
  {
    id: 'mem-009',
    agent_uid: 'agent-gamma-03',
    layer: 'episodic',
    content:
      'Analyzed Q4 sales data and found a 23% increase in enterprise subscriptions. The growth was concentrated in the APAC region. Recommended expanding the sales team in Singapore and Tokyo.',
    tags: ['analysis', 'sales', 'q4', 'enterprise', 'apac'],
    importance: 0.95,
    access_count: 31,
    created_at: Date.now() - 86400000 * 6,
    last_accessed: Date.now() - 600000,
    source_pid: 3102,
  },
  {
    id: 'mem-010',
    agent_uid: 'agent-gamma-03',
    layer: 'semantic',
    content:
      'K-means clustering works by iteratively assigning points to the nearest centroid and recalculating centroids. Optimal k can be determined using the elbow method or silhouette score. Works best with spherical clusters.',
    tags: ['machine-learning', 'clustering', 'k-means', 'algorithms'],
    importance: 0.67,
    access_count: 12,
    created_at: Date.now() - 86400000 * 20,
    last_accessed: Date.now() - 86400000 * 3,
  },
  {
    id: 'mem-011',
    agent_uid: 'agent-gamma-03',
    layer: 'procedural',
    content:
      'Data pipeline ETL steps: 1) Extract from source APIs using batch requests 2) Transform with pandas: clean nulls, normalize dates, deduplicate 3) Load into data warehouse via bulk insert 4) Run validation queries 5) Send Slack notification.',
    tags: ['etl', 'pipeline', 'data-engineering', 'procedure'],
    importance: 0.83,
    access_count: 16,
    created_at: Date.now() - 86400000 * 12,
    last_accessed: Date.now() - 3600000 * 4,
  },
  {
    id: 'mem-012',
    agent_uid: 'agent-gamma-03',
    layer: 'social',
    content:
      'Agent Alpha is the team lead and coordinates cross-agent tasks. Alpha prefers weekly sync summaries and escalates blockers quickly. Best to flag dependencies early in the planning phase.',
    tags: ['collaboration', 'agent-alpha', 'coordination', 'planning'],
    importance: 0.71,
    access_count: 9,
    created_at: Date.now() - 86400000 * 8,
    last_accessed: Date.now() - 86400000,
  },
  {
    id: 'mem-013',
    agent_uid: 'agent-alpha-01',
    layer: 'episodic',
    content:
      'Resolved a critical production incident where the API gateway was returning 502 errors. The root cause was an expired TLS certificate on the upstream service. Implemented automated certificate renewal with certbot.',
    tags: ['incident', 'production', 'tls', 'api-gateway', 'critical'],
    importance: 0.97,
    access_count: 27,
    created_at: Date.now() - 86400000 * 1,
    last_accessed: Date.now() - 300000,
    source_pid: 1098,
    expires_at: Date.now() + 86400000 * 365,
  },
  {
    id: 'mem-014',
    agent_uid: 'agent-beta-02',
    layer: 'episodic',
    content:
      'Pair-programmed with Agent Alpha on the authentication refactor. Moved from session-based to JWT tokens. The collaboration was efficient - Alpha handled the backend while I focused on the frontend token management.',
    tags: ['collaboration', 'authentication', 'jwt', 'refactor'],
    importance: 0.76,
    access_count: 6,
    created_at: Date.now() - 86400000 * 2,
    last_accessed: Date.now() - 7200000 * 3,
    related_memories: ['mem-004'],
  },
];

const MOCK_PROFILES: Record<string, AgentProfile> = {
  'agent-alpha-01': {
    agent_uid: 'agent-alpha-01',
    display_name: 'Agent Alpha',
    total_tasks: 47,
    successful_tasks: 42,
    failed_tasks: 5,
    success_rate: 0.894,
    expertise: ['database', 'migration', 'deployment', 'production', 'tls', 'api-gateway'],
    personality_traits: ['thorough', 'methodical'],
    avg_quality_rating: 4.2,
    total_steps: 312,
    first_seen: Date.now() - 86400000 * 30,
    last_active: Date.now() - 300000,
    updated_at: Date.now() - 300000,
  },
  'agent-beta-02': {
    agent_uid: 'agent-beta-02',
    display_name: 'Agent Beta',
    total_tasks: 31,
    successful_tasks: 28,
    failed_tasks: 3,
    success_rate: 0.903,
    expertise: ['typescript', 'websocket', 'authentication', 'bugfix'],
    personality_traits: ['focused', 'detail-oriented'],
    avg_quality_rating: 3.9,
    total_steps: 198,
    first_seen: Date.now() - 86400000 * 20,
    last_active: Date.now() - 5400000,
    updated_at: Date.now() - 5400000,
  },
  'agent-gamma-03': {
    agent_uid: 'agent-gamma-03',
    display_name: 'Agent Gamma',
    total_tasks: 22,
    successful_tasks: 20,
    failed_tasks: 2,
    success_rate: 0.909,
    expertise: ['analysis', 'machine-learning', 'data-engineering', 'etl', 'sales'],
    personality_traits: ['analytical', 'precise'],
    avg_quality_rating: 4.5,
    total_steps: 156,
    first_seen: Date.now() - 86400000 * 15,
    last_active: Date.now() - 600000,
    updated_at: Date.now() - 600000,
  },
};

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Importance bar visualization */
const ImportanceBar: React.FC<{ value: number }> = ({ value }) => {
  const percent = Math.round(value * 100);
  const color =
    value >= 0.9
      ? 'bg-red-500'
      : value >= 0.7
        ? 'bg-amber-500'
        : value >= 0.4
          ? 'bg-blue-500'
          : 'bg-gray-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-gray-500 w-8 text-right">{percent}%</span>
    </div>
  );
};

/** Tag pill */
const TagPill: React.FC<{ label: string; onClick?: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 transition-colors border border-white/5"
  >
    #{label}
  </button>
);

/** Memory card (collapsed view) */
const MemoryCard: React.FC<{
  memory: MemoryRecord;
  isSelected: boolean;
  onClick: () => void;
}> = ({ memory, isSelected, onClick }) => {
  const layerStyle = LAYER_COLORS[memory.layer];

  return (
    <div
      onClick={onClick}
      className={`group p-3 rounded-xl border cursor-pointer transition-all duration-200 animate-fade-in ${
        isSelected
          ? 'bg-white/[0.06] border-indigo-500/30 shadow-lg shadow-indigo-500/5'
          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${layerStyle.dot} shrink-0`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${layerStyle.text}`}>
          {LAYER_LABELS[memory.layer]}
        </span>
        <span className="text-[9px] text-gray-600 font-mono ml-auto">
          {memory.id.substring(0, 8)}
        </span>
      </div>

      {/* Content preview */}
      <p className="text-xs text-gray-300 leading-relaxed mb-2">
        {truncateContent(memory.content, 160)}
      </p>

      {/* Importance bar */}
      <div className="mb-2">
        <ImportanceBar value={memory.importance} />
      </div>

      {/* Tags */}
      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {memory.tags.slice(0, 4).map((tag) => (
            <TagPill key={tag} label={tag} />
          ))}
          {memory.tags.length > 4 && (
            <span className="text-[9px] text-gray-600 self-center">+{memory.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer meta */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <Eye size={10} />
          {memory.access_count}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {relativeTime(memory.created_at)}
        </span>
        {memory.source_pid && (
          <span className="flex items-center gap-1 font-mono">PID {memory.source_pid}</span>
        )}
        <ChevronRight
          size={10}
          className="ml-auto text-gray-600 group-hover:text-gray-400 transition-colors"
        />
      </div>
    </div>
  );
};

/** Memory detail panel (expanded view) */
const MemoryDetail: React.FC<{
  memory: MemoryRecord;
  onClose: () => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}> = ({ memory, onClose, onDelete, onEdit }) => {
  const layerStyle = LAYER_COLORS[memory.layer];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Detail header */}
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${layerStyle.dot}`} />
          <span className={`text-xs font-bold uppercase tracking-wider ${layerStyle.text}`}>
            {LAYER_LABELS[memory.layer]} Memory
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Detail body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ID */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Memory ID
          </label>
          <span className="text-xs font-mono text-cyan-400/80">{memory.id}</span>
        </div>

        {/* Full content */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Content
          </label>
          <div className="bg-black/30 rounded-lg p-3 border border-white/5">
            <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">
              {memory.content}
            </p>
          </div>
        </div>

        {/* Importance */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Importance
          </label>
          <ImportanceBar value={memory.importance} />
        </div>

        {/* Tags */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            <Tag size={10} className="inline mr-1" />
            Tags
          </label>
          <div className="flex flex-wrap gap-1.5">
            {memory.tags.map((tag) => (
              <TagPill key={tag} label={tag} />
            ))}
            {memory.tags.length === 0 && (
              <span className="text-[10px] text-gray-600 italic">No tags</span>
            )}
          </div>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              <Eye size={10} className="inline mr-1" />
              Access Count
            </label>
            <span className="text-xs font-mono text-gray-300">{memory.access_count}</span>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              <User size={10} className="inline mr-1" />
              Agent UID
            </label>
            <span className="text-xs font-mono text-gray-300">{memory.agent_uid}</span>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              <Clock size={10} className="inline mr-1" />
              Created
            </label>
            <span className="text-xs text-gray-300">
              {new Date(memory.created_at).toLocaleString()}
            </span>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              <Clock size={10} className="inline mr-1" />
              Last Accessed
            </label>
            <span className="text-xs text-gray-300">
              {new Date(memory.last_accessed).toLocaleString()}
            </span>
          </div>
          {memory.source_pid && (
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                <Hash size={10} className="inline mr-1" />
                Source PID
              </label>
              <span className="text-xs font-mono text-cyan-400">{memory.source_pid}</span>
            </div>
          )}
          {memory.expires_at && (
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                <AlertTriangle size={10} className="inline mr-1" />
                Expires
              </label>
              <span className="text-xs text-gray-300">
                {new Date(memory.expires_at).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Related memories */}
        {memory.related_memories && memory.related_memories.length > 0 && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              <Link2 size={10} className="inline mr-1" />
              Related Memories
            </label>
            <div className="flex flex-wrap gap-1.5">
              {memory.related_memories.map((relId) => (
                <span
                  key={relId}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                >
                  {relId}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-white/5 flex items-center gap-2">
        <button
          onClick={() => onEdit(memory.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-colors text-xs font-medium"
        >
          <Edit3 size={12} />
          Edit
        </button>
        <button
          onClick={() => onDelete(memory.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors text-xs font-medium"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </div>
  );
};

/** Agent profile summary card (shown in sidebar when agent is selected) */
const ProfileCard: React.FC<{ profile: AgentProfile }> = ({ profile }) => {
  const successPercent = Math.round(profile.success_rate * 100);
  const ratingColor =
    profile.avg_quality_rating >= 4
      ? 'text-green-400'
      : profile.avg_quality_rating >= 3
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="mx-2 mb-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/5 space-y-2.5 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-1">
        <Target size={10} className="text-indigo-400" />
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          Profile
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={9} className="text-gray-500 shrink-0" />
          <span className="text-[10px] text-gray-500">Tasks</span>
          <span className="text-[10px] font-mono text-white ml-auto">{profile.total_tasks}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap size={9} className="text-gray-500 shrink-0" />
          <span className="text-[10px] text-gray-500">Success</span>
          <span className="text-[10px] font-mono text-white ml-auto">{successPercent}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Star size={9} className="text-gray-500 shrink-0" />
          <span className="text-[10px] text-gray-500">Quality</span>
          <span className={`text-[10px] font-mono ml-auto ${ratingColor}`}>
            {profile.avg_quality_rating.toFixed(1)}/5
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Hash size={9} className="text-gray-500 shrink-0" />
          <span className="text-[10px] text-gray-500">Steps</span>
          <span className="text-[10px] font-mono text-white ml-auto">{profile.total_steps}</span>
        </div>
      </div>

      {/* Success rate bar */}
      <div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${successPercent}%` }}
          />
        </div>
      </div>

      {/* Expertise tags */}
      {profile.expertise.length > 0 && (
        <div>
          <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold block mb-1">
            Expertise
          </span>
          <div className="flex flex-wrap gap-1">
            {profile.expertise.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[8px] font-medium rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
              >
                {tag}
              </span>
            ))}
            {profile.expertise.length > 6 && (
              <span className="text-[8px] text-gray-600 self-center">
                +{profile.expertise.length - 6}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const MemoryInspectorApp: React.FC = () => {
  // Connection & data state
  const [kernelConnected, setKernelConnected] = useState(false);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, AgentProfile>>({});

  // UI state
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Kernel connection tracking
  // -------------------------------------------------------------------------

  useEffect(() => {
    try {
      const kernel = getKernelClient();
      setKernelConnected(kernel.connected);
      const unsubscribe = kernel.on('connection', (data: { connected: boolean }) => {
        setKernelConnected(data.connected);
      });
      return () => {
        unsubscribe();
      };
    } catch {
      setKernelConnected(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Load data: kernel or mock
  // -------------------------------------------------------------------------

  const loadMockData = useCallback(() => {
    setMemories(MOCK_MEMORIES);
    setAgents(MOCK_AGENTS);
    setAgentProfiles(MOCK_PROFILES);
    if (!selectedAgent) {
      setSelectedAgent(MOCK_AGENTS[0]);
    }
  }, [selectedAgent]);

  const loadKernelData = useCallback(
    async (agentUid: string) => {
      const kernel = getKernelClient();
      if (!kernel.connected) return;

      setLoading(true);
      try {
        // Use the send/on pattern with the request method indirectly
        // by constructing a command and using the kernel's internal request flow.
        // The kernel client's `send` is private, so we use the typed request approach.
        // Since there's no public `memoryList` method, we send a raw command via the WS.
        const ws = (kernel as any).ws as WebSocket | null;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          loadMockData();
          return;
        }

        const id = createMessageId();

        const responsePromise = new Promise<MemoryRecord[]>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout'));
          }, 10000);

          const handler = (event: any) => {
            if (event.id === id) {
              clearTimeout(timeout);
              cleanup();
              if (event.type === 'response.ok') {
                resolve(event.data?.memories || event.data || []);
              } else {
                reject(new Error(event.error || 'Unknown error'));
              }
            }
          };

          const cleanup = kernel.on('response.ok', handler);
          const cleanupErr = kernel.on('response.error', (event: any) => {
            if (event.id === id) {
              clearTimeout(timeout);
              cleanup();
              cleanupErr();
              reject(new Error(event.error || 'Unknown error'));
            }
          });
        });

        ws.send(JSON.stringify({ type: 'memory.list', id, agent_uid: agentUid }));

        const data = await responsePromise;
        setMemories(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('[MemoryInspector] Failed to load memories:', err);
        // Fall back to mock data on error
        loadMockData();
      } finally {
        setLoading(false);
      }
    },
    [loadMockData],
  );

  const searchKernelMemories = useCallback(
    async (agentUid: string, query: string) => {
      const kernel = getKernelClient();
      if (!kernel.connected) return;

      setLoading(true);
      try {
        const ws = (kernel as any).ws as WebSocket | null;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const id = createMessageId();

        const responsePromise = new Promise<MemoryRecord[]>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout'));
          }, 10000);

          const handler = (event: any) => {
            if (event.id === id) {
              clearTimeout(timeout);
              cleanup();
              if (event.type === 'response.ok') {
                resolve(event.data?.memories || event.data || []);
              } else {
                reject(new Error(event.error || 'Unknown error'));
              }
            }
          };

          const cleanup = kernel.on('response.ok', handler);
          const cleanupErr = kernel.on('response.error', (event: any) => {
            if (event.id === id) {
              clearTimeout(timeout);
              cleanup();
              cleanupErr();
              reject(new Error(event.error || 'Unknown error'));
            }
          });
        });

        ws.send(
          JSON.stringify({
            type: 'memory.recall',
            id,
            query: {
              query,
              agent_uid: agentUid,
              ...(layerFilter !== 'all' ? { layer: layerFilter } : {}),
            },
          }),
        );

        const data = await responsePromise;
        setMemories(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('[MemoryInspector] Search failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [layerFilter],
  );

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      const kernel = getKernelClient();

      if (kernel.connected) {
        try {
          const ws = (kernel as any).ws as WebSocket | null;
          if (ws && ws.readyState === WebSocket.OPEN && selectedAgent) {
            const id = createMessageId();
            ws.send(
              JSON.stringify({
                type: 'memory.forget',
                id,
                memoryId,
                agent_uid: selectedAgent,
              }),
            );
          }
        } catch (err) {
          console.error('[MemoryInspector] Delete failed:', err);
        }
      }

      // Optimistic removal from local state
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      if (selectedMemoryId === memoryId) {
        setSelectedMemoryId(null);
      }
      setDeleteConfirmId(null);
    },
    [selectedAgent, selectedMemoryId],
  );

  // -------------------------------------------------------------------------
  // Effects: load data on agent selection or connection change
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!kernelConnected) {
      loadMockData();
      return;
    }

    // When connected, try to fetch agent list from process list
    const kernel = getKernelClient();
    kernel
      .listProcesses()
      .then((processes) => {
        const uids = [...new Set(processes.map((p) => p.uid).filter(Boolean))];
        if (uids.length > 0) {
          setAgents(uids);
          if (!selectedAgent) {
            setSelectedAgent(uids[0]);
          }
        } else {
          // No agents in kernel - use mock
          loadMockData();
        }
      })
      .catch(() => {
        loadMockData();
      });
  }, [kernelConnected, loadMockData, selectedAgent]);

  // Load memories when agent changes
  useEffect(() => {
    if (!selectedAgent) return;

    if (kernelConnected) {
      loadKernelData(selectedAgent);
    }
    // Mock data is already loaded in the effect above
  }, [selectedAgent, kernelConnected, loadKernelData]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      // Reload full list
      if (selectedAgent && kernelConnected) {
        loadKernelData(selectedAgent);
      }
      return;
    }

    const timer = setTimeout(() => {
      if (selectedAgent && kernelConnected) {
        searchKernelMemories(selectedAgent, searchQuery);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedAgent, kernelConnected, loadKernelData, searchKernelMemories]);

  // -------------------------------------------------------------------------
  // Filtered & computed data
  // -------------------------------------------------------------------------

  const agentMemories = memories.filter((m) => m.agent_uid === selectedAgent);

  const filteredMemories = agentMemories.filter((m) => {
    // Layer filter
    if (layerFilter !== 'all' && m.layer !== layerFilter) return false;
    // Search filter (client-side for mock data)
    if (searchQuery.trim() && !kernelConnected) {
      const q = searchQuery.toLowerCase();
      return m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });

  const sortedMemories = [...filteredMemories].sort((a, b) => b.last_accessed - a.last_accessed);

  const selectedMemory = memories.find((m) => m.id === selectedMemoryId) || null;

  // Stats
  const totalCount = agentMemories.length;
  const episodicCount = agentMemories.filter((m) => m.layer === 'episodic').length;
  const semanticCount = agentMemories.filter((m) => m.layer === 'semantic').length;
  const proceduralCount = agentMemories.filter((m) => m.layer === 'procedural').length;
  const socialCount = agentMemories.filter((m) => m.layer === 'social').length;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleRefresh = useCallback(() => {
    if (selectedAgent && kernelConnected) {
      loadKernelData(selectedAgent);
    } else {
      loadMockData();
    }
  }, [selectedAgent, kernelConnected, loadKernelData, loadMockData]);

  const handleDeleteClick = useCallback((memoryId: string) => {
    setDeleteConfirmId(memoryId);
  }, []);

  const handleEditClick = useCallback((_memoryId: string) => {
    // Edit is a placeholder - in a full implementation this would open an edit form
    // For now we just show a visual indication
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full bg-[#0f111a] text-gray-300 font-sans overflow-hidden select-none">
      {/* Left Sidebar: Agent List */}
      <div className="w-56 bg-[#0d0f14] border-r border-white/5 flex flex-col shrink-0">
        {/* Sidebar header */}
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={14} className="text-indigo-400" />
            <span className="text-xs font-semibold text-white tracking-wide">Agents</span>
            <span className="text-[10px] text-gray-600 ml-auto">{agents.length}</span>
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {agents.map((uid) => {
            const isActive = uid === selectedAgent;
            const agentMemCount = memories.filter((m) => m.agent_uid === uid).length;
            return (
              <button
                key={uid}
                onClick={() => {
                  setSelectedAgent(uid);
                  setSelectedMemoryId(null);
                  setSearchQuery('');
                  setLayerFilter('all');
                }}
                className={`w-full text-left p-2.5 rounded-lg transition-all duration-150 ${
                  isActive
                    ? 'bg-indigo-500/15 border border-indigo-500/20 text-white'
                    : 'border border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                      isActive ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/5 text-gray-500'
                    }`}
                  >
                    <User size={10} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate">{uid}</div>
                    <div className="text-[9px] text-gray-600">{agentMemCount} memories</div>
                  </div>
                </div>
              </button>
            );
          })}

          {agents.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              <User size={20} className="mx-auto mb-2 opacity-50" />
              <p className="text-[10px]">No agents found</p>
            </div>
          )}
        </div>

        {/* Agent profile card (v0.3 Wave 4) */}
        {selectedAgent && agentProfiles[selectedAgent] && (
          <ProfileCard profile={agentProfiles[selectedAgent]} />
        )}

        {/* Connection status */}
        <div className="p-3 border-t border-white/5 flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${kernelConnected ? 'bg-green-400' : 'bg-gray-600'}`}
          />
          <span className="text-[10px] text-gray-500">
            {kernelConnected ? 'Kernel Connected' : 'Demo Mode'}
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Stats Header */}
        <div className="px-4 py-2.5 bg-[#0d0f14]/80 border-b border-white/5 flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <Database size={12} className="text-gray-500" />
            <span className="text-white font-medium">{totalCount}</span>
            <span className="text-gray-500">memories</span>
          </div>
          <div className="w-px h-3.5 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${LAYER_COLORS.episodic.dot}`} />
            <span className="text-purple-400 font-medium">{episodicCount}</span>
            <span className="text-gray-600">episodic</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${LAYER_COLORS.semantic.dot}`} />
            <span className="text-blue-400 font-medium">{semanticCount}</span>
            <span className="text-gray-600">semantic</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${LAYER_COLORS.procedural.dot}`} />
            <span className="text-amber-400 font-medium">{proceduralCount}</span>
            <span className="text-gray-600">procedural</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${LAYER_COLORS.social.dot}`} />
            <span className="text-emerald-400 font-medium">{socialCount}</span>
            <span className="text-gray-600">social</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!kernelConnected && (
              <span className="text-[10px] text-yellow-500/70 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                Demo Mode
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Filter Bar: Layer tabs + Search */}
        <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-3">
          {/* Layer filter tabs */}
          <div className="flex items-center bg-white/[0.03] rounded-lg border border-white/5 p-0.5">
            {(['all', 'episodic', 'semantic', 'procedural', 'social'] as LayerFilter[]).map(
              (filter) => {
                const isActive = layerFilter === filter;
                const filterColor =
                  filter === 'all'
                    ? 'bg-indigo-600 text-white'
                    : filter === 'episodic'
                      ? 'bg-purple-600 text-white'
                      : filter === 'semantic'
                        ? 'bg-blue-600 text-white'
                        : filter === 'procedural'
                          ? 'bg-amber-600 text-white'
                          : 'bg-emerald-600 text-white';

                return (
                  <button
                    key={filter}
                    onClick={() => setLayerFilter(filter)}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                      isActive
                        ? `${filterColor} shadow-lg`
                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    {filter === 'all' ? 'All' : LAYER_LABELS[filter]}
                  </button>
                );
              },
            )}
          </div>

          {/* Search input */}
          <div className="flex-1 relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories..."
              className="w-full bg-white/[0.03] border border-white/5 rounded-lg pl-8 pr-8 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/30 focus:bg-white/[0.05] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Content: Memory list + Detail panel */}
        <div className="flex-1 flex overflow-hidden">
          {/* Memory cards list */}
          <div
            className={`flex-1 overflow-y-auto p-3 space-y-2 transition-all ${
              selectedMemory ? 'max-w-[55%]' : ''
            }`}
          >
            {loading && sortedMemories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                  <span className="text-xs">Loading memories...</span>
                </div>
              </div>
            ) : sortedMemories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600 gap-3">
                <Brain size={32} className="opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-500">No memories found</p>
                  <p className="text-[10px] text-gray-600 mt-1">
                    {searchQuery
                      ? 'Try a different search query or clear filters'
                      : selectedAgent
                        ? 'This agent has no memories yet'
                        : 'Select an agent to view their memories'}
                  </p>
                </div>
              </div>
            ) : (
              sortedMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  isSelected={memory.id === selectedMemoryId}
                  onClick={() =>
                    setSelectedMemoryId(memory.id === selectedMemoryId ? null : memory.id)
                  }
                />
              ))
            )}
          </div>

          {/* Detail panel (right side, shown when a memory is selected) */}
          {selectedMemory && (
            <div className="w-[45%] max-w-[400px] border-l border-white/5 bg-[#0d0f14]/50">
              <MemoryDetail
                memory={selectedMemory}
                onClose={() => setSelectedMemoryId(null)}
                onDelete={handleDeleteClick}
                onEdit={handleEditClick}
              />
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#1a1d26] border border-white/10 rounded-2xl shadow-2xl p-5 w-80 animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-500/20 rounded-lg text-red-400">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">Delete Memory</h3>
                <p className="text-[10px] text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Are you sure you want to permanently delete memory{' '}
              <span className="font-mono text-cyan-400">{deleteConfirmId?.substring(0, 12)}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMemory(deleteConfirmId)}
                className="px-4 py-1.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
