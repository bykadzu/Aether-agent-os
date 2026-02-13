/**
 * Aether Kernel - Memory Manager (v0.3 Wave 1)
 *
 * Provides cross-session memory persistence for agents. Implements a
 * four-layer cognitive memory architecture:
 *
 * - Episodic: experiences and events (what happened)
 * - Semantic: facts and knowledge (what I know)
 * - Procedural: skills and how-to (how I do things)
 * - Social: relationships and interactions (who I know)
 *
 * Uses SQLite FTS5 for full-text search (no external dependencies).
 * Memory importance decays over time: effective_importance = importance * (0.99 ^ days_since_access)
 *
 * Design: Thin kernel wrapper. Intelligence (when to remember, what to recall)
 * lives in the runtime layer. The kernel just stores and retrieves.
 */

import * as crypto from 'node:crypto';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import type {
  MemoryRecord,
  MemoryLayer,
  MemoryQuery,
  MemoryStoreRequest,
  AgentProfile,
} from '@aether/shared';

/** Maximum memories per agent per layer (configurable) */
const DEFAULT_MAX_PER_LAYER = 1000;

/** Decay rate per day: effective_importance = importance * (DECAY_RATE ^ days) */
const DECAY_RATE = 0.99;

export class MemoryManager {
  private bus: EventBus;
  private state: StateStore;
  private maxPerLayer: number;

  constructor(bus: EventBus, state: StateStore, options: { maxPerLayer?: number } = {}) {
    this.bus = bus;
    this.state = state;
    this.maxPerLayer = options.maxPerLayer ?? DEFAULT_MAX_PER_LAYER;
  }

  // ---------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------

  /**
   * Store a new memory for an agent.
   * Enforces per-layer limits by evicting lowest-importance memories.
   */
  store(request: MemoryStoreRequest): MemoryRecord {
    const id = crypto.randomUUID();
    const now = Date.now();

    const record: MemoryRecord = {
      id,
      agent_uid: request.agent_uid,
      layer: request.layer,
      content: request.content,
      tags: request.tags || [],
      importance: Math.max(0, Math.min(1, request.importance ?? 0.5)),
      access_count: 0,
      created_at: now,
      last_accessed: now,
      expires_at: request.expires_at,
      source_pid: request.source_pid,
      related_memories: request.related_memories || [],
    };

    // Enforce per-layer limit — evict lowest importance if at capacity
    const count = this.state.getMemoryCount(request.agent_uid, request.layer);
    if (count >= this.maxPerLayer) {
      const toEvict = count - this.maxPerLayer + 1;
      const oldest = this.state.getOldestMemories(request.agent_uid, request.layer, toEvict);
      for (const m of oldest) {
        this.state.deleteMemory(m.id, request.agent_uid);
      }
    }

    this.state.insertMemory({
      id: record.id,
      agent_uid: record.agent_uid,
      layer: record.layer,
      content: record.content,
      tags: JSON.stringify(record.tags),
      importance: record.importance,
      access_count: record.access_count,
      created_at: record.created_at,
      last_accessed: record.last_accessed,
      expires_at: record.expires_at ?? null,
      source_pid: record.source_pid ?? null,
      related_memories: JSON.stringify(record.related_memories),
    });

    this.bus.emit('memory.stored', {
      memoryId: id,
      agent_uid: request.agent_uid,
      layer: request.layer,
    });

    return record;
  }

  // ---------------------------------------------------------------------------
  // Recall
  // ---------------------------------------------------------------------------

  /**
   * Recall memories for an agent.
   * If query.query is provided, uses FTS5 full-text search.
   * Results are ranked by: FTS5 relevance × importance × recency.
   */
  recall(query: MemoryQuery): MemoryRecord[] {
    const now = Date.now();
    let rawResults: any[];

    if (query.query) {
      // Full-text search path
      rawResults = this.state.searchMemories(
        query.agent_uid,
        query.query,
        (query.limit ?? 20) * 2, // Over-fetch for post-filter
      );
    } else if (query.layer) {
      rawResults = this.state.getMemoriesByAgentLayer(query.agent_uid, query.layer);
    } else {
      rawResults = this.state.getMemoriesByAgent(query.agent_uid);
    }

    // Parse JSON fields and hydrate records
    let memories = rawResults.map((row) => this.hydrateRecord(row));

    // Filter expired memories
    memories = memories.filter((m) => !m.expires_at || m.expires_at > now);

    // Filter by layer if specified (FTS results may include all layers)
    if (query.layer) {
      memories = memories.filter((m) => m.layer === query.layer);
    }

    // Filter by tags if specified
    if (query.tags && query.tags.length > 0) {
      memories = memories.filter((m) => query.tags!.some((tag) => m.tags.includes(tag)));
    }

    // Filter by minimum importance (with decay)
    if (query.min_importance !== undefined) {
      memories = memories.filter((m) => {
        const effective = this.getEffectiveImportance(m, now);
        return effective >= query.min_importance!;
      });
    }

    // Sort by effective importance (decayed) × recency
    memories.sort((a, b) => {
      const aScore = this.getEffectiveImportance(a, now);
      const bScore = this.getEffectiveImportance(b, now);
      return bScore - aScore;
    });

    // Apply limit
    const limit = query.limit ?? 20;
    memories = memories.slice(0, limit);

    // Update access counts for recalled memories
    for (const m of memories) {
      this.state.updateMemoryAccess(m.id);
    }

    this.bus.emit('memory.recalled', {
      agent_uid: query.agent_uid,
      memories,
    });

    return memories;
  }

  // ---------------------------------------------------------------------------
  // Forget
  // ---------------------------------------------------------------------------

  /**
   * Delete a specific memory.
   */
  forget(memoryId: string, agent_uid: string): boolean {
    const deleted = this.state.deleteMemory(memoryId, agent_uid);
    if (deleted) {
      this.bus.emit('memory.forgotten', { memoryId, agent_uid });
    }
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Share
  // ---------------------------------------------------------------------------

  /**
   * Share a memory from one agent to another.
   * Creates a copy in the target agent's memory with a reference back.
   */
  share(memoryId: string, from_uid: string, to_uid: string): MemoryRecord | null {
    const raw = this.state.getMemory(memoryId);
    if (!raw || raw.agent_uid !== from_uid) return null;

    const source = this.hydrateRecord(raw);

    const shared = this.store({
      agent_uid: to_uid,
      layer: source.layer,
      content: source.content,
      tags: [...source.tags, `shared_from:${from_uid}`],
      importance: source.importance * 0.8, // Slightly lower importance for shared memories
      source_pid: source.source_pid,
      related_memories: [memoryId],
    });

    this.bus.emit('memory.shared', {
      memoryId: shared.id,
      from_uid,
      to_uid,
    });

    return shared;
  }

  // ---------------------------------------------------------------------------
  // Context Loading
  // ---------------------------------------------------------------------------

  /**
   * Get relevant memories for an agent's current context.
   * Used by AgentLoop on startup to inject relevant memories into the system prompt.
   */
  getMemoriesForContext(agent_uid: string, goal: string, limit: number = 10): MemoryRecord[] {
    // First try FTS search with the goal text
    let memories: MemoryRecord[] = [];

    if (goal) {
      try {
        memories = this.recall({
          agent_uid,
          query: goal,
          limit: Math.ceil(limit / 2),
        });
      } catch {
        // FTS query may fail on special characters — fall back
      }
    }

    // Fill remaining slots with high-importance memories
    if (memories.length < limit) {
      const remaining = limit - memories.length;
      const allMemories = this.recall({
        agent_uid,
        limit: remaining + memories.length,
      });

      // Deduplicate
      const seen = new Set(memories.map((m) => m.id));
      for (const m of allMemories) {
        if (!seen.has(m.id) && memories.length < limit) {
          memories.push(m);
          seen.add(m.id);
        }
      }
    }

    return memories;
  }

  // ---------------------------------------------------------------------------
  // Consolidation
  // ---------------------------------------------------------------------------

  /**
   * Consolidate memories for an agent.
   * Removes expired memories and enforces per-layer limits.
   * Returns the number of memories removed.
   */
  consolidate(agent_uid: string): number {
    const now = Date.now();
    let removed = 0;

    // Remove expired memories
    const allMemories = this.state.getMemoriesByAgent(agent_uid);
    for (const raw of allMemories) {
      if (raw.expires_at && raw.expires_at <= now) {
        this.state.deleteMemory(raw.id, agent_uid);
        removed++;
      }
    }

    // Enforce per-layer limits
    const layers: MemoryLayer[] = ['episodic', 'semantic', 'procedural', 'social'];
    for (const layer of layers) {
      const count = this.state.getMemoryCount(agent_uid, layer);
      if (count > this.maxPerLayer) {
        const toEvict = count - this.maxPerLayer;
        const oldest = this.state.getOldestMemories(agent_uid, layer, toEvict);
        for (const m of oldest) {
          this.state.deleteMemory(m.id, agent_uid);
          removed++;
        }
      }
    }

    this.bus.emit('memory.consolidated', { agent_uid, removed });
    return removed;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  /**
   * Get memory statistics for an agent.
   */
  getStats(agent_uid: string): {
    total: number;
    episodic: number;
    semantic: number;
    procedural: number;
    social: number;
  } {
    return {
      total:
        this.state.getMemoryCount(agent_uid, 'episodic') +
        this.state.getMemoryCount(agent_uid, 'semantic') +
        this.state.getMemoryCount(agent_uid, 'procedural') +
        this.state.getMemoryCount(agent_uid, 'social'),
      episodic: this.state.getMemoryCount(agent_uid, 'episodic'),
      semantic: this.state.getMemoryCount(agent_uid, 'semantic'),
      procedural: this.state.getMemoryCount(agent_uid, 'procedural'),
      social: this.state.getMemoryCount(agent_uid, 'social'),
    };
  }

  // ---------------------------------------------------------------------------
  // Agent Profiles (v0.3 Wave 4)
  // ---------------------------------------------------------------------------

  /**
   * Get or create an agent profile.
   */
  getProfile(agent_uid: string): AgentProfile {
    const existing = this.state.getProfile(agent_uid);
    if (existing) {
      return {
        ...existing,
        expertise: JSON.parse(existing.expertise || '[]'),
        personality_traits: JSON.parse(existing.personality_traits || '[]'),
      };
    }
    // Create default profile
    const now = Date.now();
    const profile: AgentProfile = {
      agent_uid,
      display_name: agent_uid,
      total_tasks: 0,
      successful_tasks: 0,
      failed_tasks: 0,
      success_rate: 0,
      expertise: [],
      personality_traits: [],
      avg_quality_rating: 0,
      total_steps: 0,
      first_seen: now,
      last_active: now,
      updated_at: now,
    };
    this.state.upsertProfile({
      ...profile,
      expertise: '[]',
      personality_traits: '[]',
    });
    return profile;
  }

  /**
   * Update an agent's profile after task completion.
   * Called by the reflection system with task outcome data.
   */
  updateProfileAfterTask(
    agent_uid: string,
    outcome: {
      success: boolean;
      steps: number;
      quality_rating?: number;
      goal?: string;
      tags?: string[];
    },
  ): AgentProfile {
    const profile = this.getProfile(agent_uid);
    const now = Date.now();

    profile.total_tasks += 1;
    if (outcome.success) profile.successful_tasks += 1;
    else profile.failed_tasks += 1;
    profile.success_rate =
      profile.total_tasks > 0 ? profile.successful_tasks / profile.total_tasks : 0;
    profile.total_steps += outcome.steps;
    profile.last_active = now;
    profile.updated_at = now;

    // Update avg quality rating
    if (outcome.quality_rating) {
      const totalRated = profile.total_tasks - 1; // previous tasks
      profile.avg_quality_rating =
        totalRated > 0
          ? (profile.avg_quality_rating * totalRated + outcome.quality_rating) / profile.total_tasks
          : outcome.quality_rating;
    }

    // Update expertise from tags
    if (outcome.tags && outcome.tags.length > 0) {
      const existing = new Set(profile.expertise);
      for (const tag of outcome.tags) {
        existing.add(tag);
      }
      profile.expertise = [...existing].slice(0, 20); // cap at 20
    }

    this.state.upsertProfile({
      ...profile,
      expertise: JSON.stringify(profile.expertise),
      personality_traits: JSON.stringify(profile.personality_traits),
    });

    this.bus.emit('profile.updated', { agent_uid, profile });
    return profile;
  }

  // ---------------------------------------------------------------------------
  // Skill-to-Memory Integration (v0.7 Sprint 3)
  // ---------------------------------------------------------------------------

  /**
   * Register event listeners for cross-subsystem integration.
   * Called by Kernel after all subsystems are initialized.
   */
  registerEventListeners(): void {
    // Auto-store created skills as procedural memory for the creating agent
    this.bus.on('skillforge.skill.created', (data: any) => {
      if (data.agentUid) {
        try {
          this.storeSkillAsProceduralMemory(
            data.agentUid,
            data.name || data.skillId,
            `Auto-created skill: ${data.name}`,
            [],
          );
        } catch (err) {
          console.warn('[MemoryManager] Failed to store skill as procedural memory:', err);
        }
      }
    });
  }

  /**
   * Store a newly created skill as procedural memory with high importance.
   */
  storeSkillAsProceduralMemory(
    agentUid: string,
    skillName: string,
    skillDescription: string,
    toolsUsed: string[],
    taskCategory?: string,
  ): MemoryRecord {
    const tags = ['skill', 'auto-created', 'reflection-sourced'];
    if (taskCategory) tags.push(taskCategory);
    for (const tool of toolsUsed) tags.push(`tool:${tool}`);

    return this.store({
      agent_uid: agentUid,
      layer: 'procedural',
      content: `[Skill Created] ${skillName}: ${skillDescription}\nTools: ${toolsUsed.join(', ')}\nThis skill was auto-created from a successful task reflection.`,
      tags,
      importance: 0.9,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Calculate effective importance with time decay.
   * effective_importance = importance * (0.99 ^ days_since_last_access)
   */
  private getEffectiveImportance(memory: MemoryRecord, now: number): number {
    const daysSinceAccess = (now - memory.last_accessed) / (1000 * 60 * 60 * 24);
    return memory.importance * Math.pow(DECAY_RATE, daysSinceAccess);
  }

  /**
   * Hydrate a raw database row into a MemoryRecord with parsed JSON fields.
   */
  private hydrateRecord(row: any): MemoryRecord {
    return {
      id: row.id,
      agent_uid: row.agent_uid,
      layer: row.layer as MemoryLayer,
      content: row.content,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      importance: row.importance,
      access_count: row.access_count,
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      expires_at: row.expires_at || undefined,
      source_pid: row.source_pid || undefined,
      related_memories:
        typeof row.related_memories === 'string'
          ? JSON.parse(row.related_memories)
          : row.related_memories || [],
    };
  }
}
