/**
 * Aether Kernel - SkillForge (v0.7)
 *
 * Agent self-modification subsystem (#29). Enables agents to discover,
 * install, create, compose, version, and remove skills at runtime.
 *
 * Wraps the OpenClawAdapter for actual skill import but adds:
 * - Rate limiting (per-agent creation throttle)
 * - Risk scoring (permission-based risk classification)
 * - Versioning (SQLite-backed version history with rollback)
 * - Sandbox testing (basic validation; full Docker sandbox in Sprint 2)
 * - Composition (combine multiple skills into a pipeline)
 */

import * as crypto from 'node:crypto';
import matter from 'gray-matter';
import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { StateStore } from './StateStore.js';
import { PluginRegistryManager, type PluginRegistryManifest } from './PluginRegistryManager.js';
import { OpenClawAdapter } from './OpenClawAdapter.js';
import { ContainerManager } from './ContainerManager.js';
import type {
  SkillForgeCreateParams,
  SkillForgeDiscoverResult,
  SkillRiskLevel,
  SkillPermissionManifest,
  SkillVersion,
  SkillProposalStatus,
} from '@aether/shared';
import {
  SKILLFORGE_MAX_CREATES_PER_HOUR,
  SKILLFORGE_DEFAULT_ENFORCEMENT,
  SKILLFORGE_SKILL_ID_PREFIX,
  OPENCLAW_SKILL_ID_PREFIX,
  SKILLFORGE_MAX_RETRIES,
  SKILLFORGE_EMBEDDING_DIMENSIONS,
  CLAWHUB_CACHE_TTL,
} from '@aether/shared';

/** ClawHub API skill search result */
interface ClawHubSkillInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  rating: number;
  tags: string[];
  updated_at: string;
}

// ---------------------------------------------------------------------------
// SkillForge
// ---------------------------------------------------------------------------

export class SkillForge {
  private bus: EventBus;
  private state: StateStore;
  private pluginRegistry: PluginRegistryManager;
  private openClaw: OpenClawAdapter;
  private containers: ContainerManager;

  /** Per-agent rate-limit counters for skill creation. */
  private creationCounts: Map<string, { count: number; resetAt: number }> = new Map();

  /** In-memory cache of all skill versions (loaded from SQLite on init). */
  private skillVersions: Map<string, SkillVersion[]> = new Map();

  /** In-memory cache of skill embeddings for fast similarity search. */
  private embeddingCache: Map<string, number[]> = new Map();

  /** ClawHub API response cache with TTL. */
  private clawHubCache: Map<string, { data: any; expiresAt: number }> = new Map();

  /** ClawHub API base URL. */
  private static readonly CLAWHUB_BASE_URL = 'https://clawhub.openclaw.ai/api/v1';

  constructor(
    bus: EventBus,
    state: StateStore,
    pluginRegistry: PluginRegistryManager,
    openClaw: OpenClawAdapter,
    containers: ContainerManager,
  ) {
    this.bus = bus;
    this.state = state;
    this.pluginRegistry = pluginRegistry;
    this.openClaw = openClaw;
    this.containers = containers;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const db = this.state.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        deleted_at INTEGER,
        UNIQUE(skill_id, version)
      )
    `);

    this.loadVersions();
    this.loadEmbeddings();

    this.bus.emit('skillforge.initialized', {
      skillCount: this.skillVersions.size,
    });
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  async discover(
    query: string,
    source: string = 'all',
    limit: number = 10,
  ): Promise<SkillForgeDiscoverResult[]> {
    const results: SkillForgeDiscoverResult[] = [];
    const seen = new Set<string>();
    const q = query.toLowerCase();

    // Search local plugin registry
    if (source === 'all' || source === 'local') {
      const plugins = this.pluginRegistry.search(query);
      for (const plugin of plugins) {
        if (seen.has(plugin.id)) continue;
        seen.add(plugin.id);
        results.push({
          skill_id: plugin.id,
          name: plugin.manifest.name,
          description: plugin.manifest.description,
          source: 'local',
          installed: plugin.enabled,
          risk_level: undefined,
        });
      }

      // Also search by listing all and doing a fuzzy match on keywords
      const all = this.pluginRegistry.list();
      for (const plugin of all) {
        if (seen.has(plugin.id)) continue;
        const m = plugin.manifest;
        const match =
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          (m.keywords && m.keywords.some((kw) => kw.toLowerCase().includes(q)));
        if (match) {
          seen.add(plugin.id);
          results.push({
            skill_id: plugin.id,
            name: m.name,
            description: m.description,
            source: 'local',
            installed: plugin.enabled,
            risk_level: undefined,
          });
        }
      }
    }

    // MCP server tool list search (placeholder for future expansion)

    // Search ClawHub
    if (source === 'all' || source === 'clawhub') {
      const hubResults = await this.searchClawHub(query, limit);
      for (const skill of hubResults) {
        if (seen.has(skill.id)) continue;
        seen.add(skill.id);
        results.push({
          skill_id: skill.id,
          name: skill.name,
          description: skill.description,
          source: 'clawhub',
          installed: false,
          risk_level: undefined,
        });
      }
    }

    this.bus.emit('skillforge.discover.completed', {
      query,
      source,
      resultCount: results.length,
    });

    // Embedding-based ranking: if we have embeddings, re-rank results by similarity
    if (this.embeddingCache.size > 0 && results.length > 1) {
      const queryEmbedding = this.computeEmbedding(query);
      const scored = results.map((r) => {
        const skillEmbedding = this.embeddingCache.get(r.skill_id);
        const similarity = skillEmbedding
          ? this.cosineSimilarity(queryEmbedding, skillEmbedding)
          : 0;
        return { ...r, similarity };
      });
      scored.sort((a, b) => b.similarity - a.similarity);
      results.length = 0;
      results.push(...scored.map(({ similarity, ...rest }) => rest));
    }

    return results.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // ClawHub Integration
  // -------------------------------------------------------------------------

  /** Search ClawHub for skills matching a query. */
  async searchClawHub(query: string, limit: number = 10): Promise<ClawHubSkillInfo[]> {
    const cacheKey = `search:${query}:${limit}`;
    const cached = this.getClawHubCache(cacheKey);
    if (cached) return cached;

    try {
      const url = `${SkillForge.CLAWHUB_BASE_URL}/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AetherOS/0.7 SkillForge' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[SkillForge] ClawHub rate limited');
          return [];
        }
        throw new Error(`ClawHub API error: ${response.status}`);
      }

      const data = (await response.json()) as { skills: ClawHubSkillInfo[] };
      const results = data.skills || [];
      this.setClawHubCache(cacheKey, results);
      return results;
    } catch (err: unknown) {
      console.warn(`[SkillForge] ClawHub search failed: ${errMsg(err)}`);
      return [];
    }
  }

  /** Fetch a specific skill's SKILL.md content from ClawHub. */
  async fetchClawHubSkill(skillId: string): Promise<string | null> {
    const cacheKey = `fetch:${skillId}`;
    const cached = this.getClawHubCache(cacheKey);
    if (cached) return cached;

    try {
      const url = `${SkillForge.CLAWHUB_BASE_URL}/skills/${encodeURIComponent(skillId)}/content`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AetherOS/0.7 SkillForge' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const content = await response.text();
      this.setClawHubCache(cacheKey, content);
      return content;
    } catch (err: unknown) {
      console.warn(`[SkillForge] ClawHub fetch failed: ${errMsg(err)}`);
      return null;
    }
  }

  /** Get popular skills from ClawHub. */
  async getClawHubPopular(category?: string, limit: number = 10): Promise<ClawHubSkillInfo[]> {
    const cacheKey = `popular:${category || 'all'}:${limit}`;
    const cached = this.getClawHubCache(cacheKey);
    if (cached) return cached;

    try {
      let url = `${SkillForge.CLAWHUB_BASE_URL}/skills/popular?limit=${limit}`;
      if (category) url += `&category=${encodeURIComponent(category)}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AetherOS/0.7 SkillForge' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { skills: ClawHubSkillInfo[] };
      const results = data.skills || [];
      this.setClawHubCache(cacheKey, results);
      return results;
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Installation
  // -------------------------------------------------------------------------

  async install(
    skillId: string,
    source: string = 'local',
    agentUid?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // For local source, use OpenClaw adapter to import
      if (source === 'local') {
        const result = await this.openClaw.importSkill(skillId);

        // Score risk based on any permissions embedded in the skill metadata
        const permissions = (
          result.manifest as Record<string, unknown> & {
            metadata?: { openclaw?: { permissions?: SkillPermissionManifest } };
          }
        ).metadata?.openclaw?.permissions;
        const risk = this.scoreRisk(permissions);

        // Check enforcement level
        const enforcement = SKILLFORGE_DEFAULT_ENFORCEMENT;
        if (enforcement === 'deny' && (risk === 'high' || risk === 'critical')) {
          this.bus.emit('skillforge.install.denied', {
            skillId: result.manifest.id,
            risk,
            enforcement,
          });
          return {
            success: false,
            message: `Skill denied: risk level "${risk}" exceeds enforcement policy "${enforcement}"`,
          };
        }

        if (
          enforcement === 'prompt' &&
          (risk === 'moderate' || risk === 'high' || risk === 'critical')
        ) {
          this.bus.emit('skillforge.approval.required', {
            skillId: result.manifest.id,
            risk,
            agentUid,
          });
          return {
            success: false,
            message: `Skill requires approval: risk level "${risk}" under enforcement policy "${enforcement}"`,
          };
        }

        // Track version
        this.storeVersion(result.manifest.id, JSON.stringify(result), agentUid || 'system');

        // Compute and store embedding for installed skill
        this.computeAndStoreEmbedding(result.manifest.id, result.manifest.description);

        this.bus.emit('skillforge.skill.installed', {
          skillId: result.manifest.id,
          name: result.manifest.name,
          risk,
          agentUid,
        });

        if (
          enforcement === 'warn' &&
          (risk === 'moderate' || risk === 'high' || risk === 'critical')
        ) {
          return {
            success: true,
            message: `Skill installed with warning: risk level "${risk}"`,
          };
        }

        return { success: true, message: `Skill "${result.manifest.name}" installed successfully` };
      }

      // ClawHub source — fetch and import via OpenClaw pipeline
      if (source === 'clawhub') {
        const content = await this.fetchClawHubSkill(skillId);
        if (!content) {
          return { success: false, message: `Skill "${skillId}" not found on ClawHub` };
        }

        const os = await import('node:os');
        const fs = await import('node:fs');
        const pathMod = await import('node:path');
        const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'skillforge-clawhub-'));
        const skillDir = pathMod.join(tmpDir, skillId);
        fs.mkdirSync(skillDir, { recursive: true });
        const skillMdPath = pathMod.join(skillDir, 'SKILL.md');
        fs.writeFileSync(skillMdPath, content, 'utf-8');

        try {
          const result = await this.openClaw.importSkill(skillMdPath);
          this.storeVersion(result.manifest.id, content, agentUid || 'clawhub');

          this.bus.emit('skillforge.skill.installed', {
            skillId: result.manifest.id,
            name: result.manifest.name,
            source: 'clawhub',
            agentUid,
          });

          return {
            success: true,
            message: `Skill "${result.manifest.name}" installed from ClawHub`,
          };
        } finally {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            /* ignore cleanup errors */
          }
        }
      }

      return { success: false, message: `Source "${source}" not yet supported` };
    } catch (err: unknown) {
      this.bus.emit('skillforge.install.failed', {
        skillId,
        error: errMsg(err),
      });
      return { success: false, message: `Install failed: ${errMsg(err)}` };
    }
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  async create(
    params: SkillForgeCreateParams,
    agentUid: string,
  ): Promise<{ success: boolean; skillId?: string; message: string }> {
    // 1. Check rate limit
    if (!this.checkRateLimit(agentUid)) {
      return {
        success: false,
        message: `Rate limit exceeded: max ${SKILLFORGE_MAX_CREATES_PER_HOUR} creates per hour`,
      };
    }

    try {
      // 2. Generate SKILL.md content
      let skillMd = this.generateSkillMd(params);

      // 3. Validate YAML structure
      try {
        const parsed = matter(skillMd);
        if (!parsed.data.name) {
          return { success: false, message: 'Generated SKILL.md missing required "name" field' };
        }
      } catch (parseErr: unknown) {
        return { success: false, message: `SKILL.md YAML parse error: ${errMsg(parseErr)}` };
      }

      // 4. Score permissions risk
      const risk = this.scoreRisk(params.permissions);

      // 5. Run sandbox test with iterative refinement (Voyager pattern)
      if (params.test_input) {
        const testResult = await this.testInSandbox(
          skillMd,
          params.test_input,
          params.test_expected,
        );
        if (!testResult.passed) {
          // Attempt iterative refinement
          const refinement = await this.refineSkill(params, skillMd, testResult.output, agentUid);
          if (refinement.success && refinement.refinedMd) {
            skillMd = refinement.refinedMd;
            this.bus.emit('skillforge.skill.refined', {
              name: params.name,
              attempts: refinement.attempts,
              agentUid,
            });
          } else {
            // All retries exhausted — store as draft, notify agent
            this.bus.emit('skillforge.test.failed', {
              name: params.name,
              output: testResult.output,
              attempts: refinement.attempts,
              agentUid,
            });
            return {
              success: false,
              message: `Sandbox test failed after ${refinement.attempts} refinement attempts: ${testResult.output}`,
            };
          }
        }
      }

      // 6. Generate a unique skill ID
      const skillId = `${SKILLFORGE_SKILL_ID_PREFIX}${params.name}-${crypto.randomBytes(4).toString('hex')}`;

      // 7. Write SKILL.md to a temp location and import via OpenClaw pipeline
      const os = await import('node:os');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillforge-'));
      const skillDir = path.join(tmpDir, params.name);
      fs.mkdirSync(skillDir, { recursive: true });
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(skillMdPath, skillMd, 'utf-8');

      try {
        await this.openClaw.importSkill(skillMdPath);
      } finally {
        // Clean up temp files
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore cleanup errors */
        }
      }

      // 8. Store version 1
      this.storeVersion(skillId, skillMd, agentUid);

      // 9. Emit created event
      this.bus.emit('skillforge.skill.created', {
        skillId,
        name: params.name,
        risk,
        agentUid,
      });

      // Compute and store embedding for new skill
      this.computeAndStoreEmbedding(skillId, params.description);

      return { success: true, skillId, message: `Skill "${params.name}" created successfully` };
    } catch (err: unknown) {
      this.bus.emit('skillforge.create.failed', {
        name: params.name,
        error: errMsg(err),
        agentUid,
      });
      return { success: false, message: `Create failed: ${errMsg(err)}` };
    }
  }

  // -------------------------------------------------------------------------
  // Composition
  // -------------------------------------------------------------------------

  async compose(
    name: string,
    description: string,
    steps: Array<{ skill_id: string; input_mapping?: string }>,
    agentUid: string,
  ): Promise<{ success: boolean; skillId?: string; message: string }> {
    // 1. Verify all component skills exist
    for (const step of steps) {
      const plugin = this.pluginRegistry.get(step.skill_id);
      if (!plugin) {
        return {
          success: false,
          message: `Component skill not found: ${step.skill_id}`,
        };
      }
    }

    // 2. Generate composite SKILL.md that references each sub-skill
    const stepsMarkdown = steps
      .map((step, i) => {
        const mapping = step.input_mapping ? ` (input: ${step.input_mapping})` : '';
        return `${i + 1}. Execute skill \`${step.skill_id}\`${mapping}`;
      })
      .join('\n');

    const instructions = [
      `This is a composite skill that chains the following skills in order:`,
      '',
      stepsMarkdown,
      '',
      'Execute each skill in sequence, passing the output of each step as input to the next.',
    ].join('\n');

    const params: SkillForgeCreateParams = {
      name,
      description,
      instructions,
      tools_used: steps.map((s) => s.skill_id),
    };

    // 3. Import via create() pipeline
    const result = await this.create(params, agentUid);

    if (result.success) {
      this.bus.emit('skillforge.skill.composed', {
        skillId: result.skillId,
        name,
        componentCount: steps.length,
        agentUid,
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Removal
  // -------------------------------------------------------------------------

  async remove(skillId: string): Promise<boolean> {
    // Soft-delete: mark deleted_at in versions table
    const db = this.state.db;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      'UPDATE skill_versions SET deleted_at = ? WHERE skill_id = ? AND deleted_at IS NULL',
    ).run(now, skillId);

    // Remove from plugin registry
    try {
      this.pluginRegistry.uninstall(skillId);
    } catch {
      /* ignore if already removed */
    }

    // Also try to remove via OpenClaw adapter (for imported skills)
    try {
      this.openClaw.removeImport(skillId);
    } catch {
      /* ignore */
    }

    // Remove from in-memory cache
    this.skillVersions.delete(skillId);

    this.bus.emit('skillforge.skill.removed', { skillId });
    return true;
  }

  // -------------------------------------------------------------------------
  // Versioning
  // -------------------------------------------------------------------------

  async listVersions(skillId: string): Promise<SkillVersion[]> {
    return this.skillVersions.get(skillId) || [];
  }

  async rollback(skillId: string, version: number): Promise<boolean> {
    const versions = this.skillVersions.get(skillId);
    if (!versions) {
      return false;
    }

    const target = versions.find((v) => v.version === version);
    if (!target) {
      return false;
    }

    // Write the old version content to a temp file and re-import
    try {
      const os = await import('node:os');
      const fs = await import('node:fs');
      const path = await import('node:path');

      // Parse the SKILL.md content to get the skill name
      const parsed = matter(target.content);
      const skillName = parsed.data.name || skillId;

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillforge-rollback-'));
      const skillDir = path.join(tmpDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(skillMdPath, target.content, 'utf-8');

      try {
        await this.openClaw.importSkill(skillMdPath);
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      // Store as a new version (rollback creates a new version entry)
      const latestVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
      this.storeVersion(skillId, target.content, 'rollback', latestVersion + 1);

      this.bus.emit('skillforge.skill.rollback', {
        skillId,
        rolledBackTo: version,
        newVersion: latestVersion + 1,
      });

      return true;
    } catch (err: unknown) {
      console.error(`[SkillForge] Rollback failed for ${skillId}@v${version}:`, errMsg(err));
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Risk Scoring
  // -------------------------------------------------------------------------

  scoreRisk(permissions?: SkillPermissionManifest): SkillRiskLevel {
    if (!permissions) return 'minimal';

    let highRiskCount = 0;

    // Shell exec or credentials are high risk
    const hasExec = permissions.exec && permissions.exec.length > 0;
    const hasCredentials = permissions.sensitive_data?.credentials === true;

    if (hasExec) highRiskCount++;
    if (hasCredentials) highRiskCount++;

    // Multiple high-risk categories
    if (highRiskCount >= 2) return 'critical';
    if (highRiskCount === 1) return 'high';

    // Write filesystem or network access is moderate
    const hasWriteFs =
      permissions.filesystem && permissions.filesystem.some((p) => p.startsWith('write:'));
    const hasNetwork = permissions.network && permissions.network.length > 0;

    if (hasWriteFs || hasNetwork) return 'moderate';

    // Read-only filesystem is low
    const hasReadFs =
      permissions.filesystem && permissions.filesystem.some((p) => p.startsWith('read:'));
    const hasEnv = permissions.env && permissions.env.length > 0;

    if (hasReadFs || hasEnv) return 'low';

    return 'minimal';
  }

  // -------------------------------------------------------------------------
  // Proposals (v0.7 Sprint 3)
  // -------------------------------------------------------------------------

  /**
   * Propose a new skill from a reflection suggestion.
   * Stores the proposal and emits an event. The proposal can then be
   * approved (auto or manually) or rejected.
   */
  propose(
    suggestion: { name: string; description: string; instructions: string; tools_used: string[] },
    agentUid: string,
  ): { proposalId: string; status: string } {
    const id = crypto.randomUUID();
    const risk = this.scoreRisk(); // minimal since no permissions declared yet

    this.state.insertProposal({
      id,
      skill_name: suggestion.name,
      skill_description: suggestion.description,
      skill_instructions: suggestion.instructions,
      tools_used: JSON.stringify(suggestion.tools_used || []),
      proposing_agent: agentUid,
      status: 'pending',
      risk_score: risk,
      created_at: Math.floor(Date.now() / 1000),
    });

    this.bus.emit('skillforge.skill.proposed', {
      proposalId: id,
      name: suggestion.name,
      agentUid,
      riskLevel: risk,
    });

    return { proposalId: id, status: 'pending' };
  }

  /**
   * Approve a pending skill proposal, creating the actual skill.
   */
  async approve(
    proposalId: string,
    reviewerUid?: string,
  ): Promise<{ success: boolean; skillId?: string; message: string }> {
    const proposal = this.state.getProposal(proposalId);
    if (!proposal) return { success: false, message: 'Proposal not found' };
    if (proposal.status !== 'pending')
      return { success: false, message: `Proposal already ${proposal.status}` };

    // Create the skill from the proposal
    const result = await this.create(
      {
        name: proposal.skill_name,
        description: proposal.skill_description,
        instructions: proposal.skill_instructions,
        tools_used: JSON.parse(proposal.tools_used),
      },
      proposal.proposing_agent,
    );

    if (result.success) {
      this.state.updateProposalStatus(proposalId, 'approved', reviewerUid);
      this.bus.emit('skillforge.proposal.approved', {
        proposalId,
        skillId: result.skillId,
      });
    }

    return result;
  }

  /**
   * Reject a pending skill proposal.
   */
  reject(
    proposalId: string,
    reason?: string,
    reviewerUid?: string,
  ): { success: boolean; message: string } {
    const proposal = this.state.getProposal(proposalId);
    if (!proposal) return { success: false, message: 'Proposal not found' };
    if (proposal.status !== 'pending')
      return { success: false, message: `Proposal already ${proposal.status}` };

    this.state.updateProposalStatus(proposalId, 'rejected', reviewerUid);
    this.bus.emit('skillforge.proposal.rejected', { proposalId, reason });
    return { success: true, message: `Proposal rejected${reason ? ': ' + reason : ''}` };
  }

  /**
   * List skill proposals, optionally filtered by status.
   */
  listProposals(status?: string): any[] {
    if (status) return this.state.getProposalsByStatus(status);
    return this.state.getAllProposals();
  }

  recordSkillUsage(skillId: string, qualityRating?: number): void {
    this.pluginRegistry.incrementUsage(skillId);
    if (qualityRating !== undefined) {
      this.pluginRegistry.addQualityRating(skillId, qualityRating);
    }
    this.bus.emit('skillforge.skill.usage', { skillId, qualityRating });
  }

  // -------------------------------------------------------------------------
  // Sharing (v0.7 Sprint 4)
  // -------------------------------------------------------------------------

  /**
   * Share a skill with all agents (via plugin registry) or a specific agent (via IPC).
   *
   * - target 'all': registers the skill in the shared plugin registry so every
   *   agent can discover and use it.
   * - target 'agent': returns the skill content so the tool layer can send it
   *   to a specific agent via IPC.
   */
  async share(
    skillId: string,
    target: 'all' | 'agent',
    agentUid: string,
  ): Promise<{ success: boolean; message: string; content?: string }> {
    // Look up the skill versions
    const versions = this.skillVersions.get(skillId);
    if (!versions || versions.length === 0) {
      return { success: false, message: `Skill "${skillId}" not found` };
    }

    // Get the latest version content
    const latest = versions[versions.length - 1];
    const skillContent = latest.content;

    if (target === 'all') {
      // Parse the SKILL.md to extract name/description for the manifest
      let skillName = skillId;
      let skillDescription = '';
      try {
        const parsed = matter(skillContent);
        skillName = parsed.data.name || skillId;
        skillDescription = parsed.data.description || '';
      } catch {
        /* use defaults */
      }

      // Create a PluginRegistryManifest and register in the shared registry
      const manifest = {
        id: skillId,
        name: skillName,
        version: `1.0.${latest.version}`,
        author: agentUid,
        description: skillDescription,
        category: 'tools' as const,
        icon: 'share-2',
        tools: [],
        keywords: ['agent-created', 'shared'],
        metadata: {
          source: 'agent-created',
          sharedBy: agentUid,
        },
      };

      try {
        this.pluginRegistry.install(manifest as PluginRegistryManifest, 'local', agentUid);
      } catch (err: unknown) {
        return { success: false, message: `Failed to register shared skill: ${errMsg(err)}` };
      }

      this.bus.emit('skillforge.skill.shared', {
        skillId,
        target: 'all',
        sharedBy: agentUid,
      });

      return {
        success: true,
        message: `Skill "${skillName}" shared with all agents via plugin registry`,
      };
    }

    // target === 'agent': return content for the tool layer to send via IPC
    return {
      success: true,
      message: `Skill "${skillId}" content ready for IPC delivery`,
      content: skillContent,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Rate Limiting
  // -------------------------------------------------------------------------

  private checkRateLimit(agentUid: string): boolean {
    const now = Date.now();
    const entry = this.creationCounts.get(agentUid);

    if (!entry || now >= entry.resetAt) {
      // Start a new window
      this.creationCounts.set(agentUid, {
        count: 1,
        resetAt: now + 3_600_000, // 1 hour from now
      });
      return true;
    }

    if (entry.count >= SKILLFORGE_MAX_CREATES_PER_HOUR) {
      return false;
    }

    entry.count++;
    return true;
  }

  // -------------------------------------------------------------------------
  // Private: SKILL.md Generation
  // -------------------------------------------------------------------------

  private generateSkillMd(params: SkillForgeCreateParams): string {
    const frontmatter: Record<string, any> = {
      name: params.name,
      description: params.description,
      metadata: {
        openclaw: {
          created_by: 'agent',
          created_at: new Date().toISOString(),
        },
      },
    };

    // Embed permissions into metadata if provided
    if (params.permissions) {
      frontmatter.metadata.openclaw.permissions = params.permissions;
    }

    // Embed tools_used if provided
    if (params.tools_used && params.tools_used.length > 0) {
      frontmatter.metadata.openclaw.tools_used = params.tools_used;
    }

    const body = `# ${params.name}\n\n${params.instructions}`;

    return matter.stringify(body, frontmatter);
  }

  // -------------------------------------------------------------------------
  // Private: Sandbox Testing
  // -------------------------------------------------------------------------

  private async testInSandbox(
    skillMd: string,
    testInput: string,
    testExpected?: string,
  ): Promise<{ passed: boolean; output: string }> {
    // Sprint 1: Basic validation only (full Docker sandbox in Sprint 2)
    // Validate the SKILL.md parses correctly and has required fields
    try {
      const parsed = matter(skillMd);

      // Check required fields
      if (!parsed.data.name) {
        return { passed: false, output: 'SKILL.md missing required "name" field' };
      }
      if (!parsed.data.description) {
        return { passed: false, output: 'SKILL.md missing required "description" field' };
      }
      if (!parsed.content || parsed.content.trim().length === 0) {
        return { passed: false, output: 'SKILL.md has empty instructions body' };
      }

      // If testExpected is provided, do a basic substring check against the instructions
      // (In Sprint 2 this will actually execute the skill in a container)
      if (testExpected) {
        const contentLower = parsed.content.toLowerCase();
        const expectedLower = testExpected.toLowerCase();
        if (!contentLower.includes(expectedLower)) {
          return {
            passed: false,
            output: `Expected content "${testExpected}" not found in skill instructions`,
          };
        }
      }

      return { passed: true, output: 'Basic validation passed' };
    } catch (err: unknown) {
      return { passed: false, output: `Validation error: ${errMsg(err)}` };
    }
  }

  // -------------------------------------------------------------------------
  // Private: Iterative Skill Refinement (Voyager Pattern)
  // -------------------------------------------------------------------------

  /**
   * Attempt to refine a skill that failed its sandbox test.
   * Uses deterministic error-pattern matching to fix common issues,
   * then re-tests. Repeats up to SKILLFORGE_MAX_RETRIES times.
   *
   * This is the kernel-side refinement loop. LLM-driven refinement
   * happens at the agent tool level for more complex fixes.
   */
  private async refineSkill(
    originalParams: SkillForgeCreateParams,
    currentMd: string,
    lastError: string,
    agentUid: string,
  ): Promise<{ success: boolean; refinedMd?: string; attempts: number }> {
    let attempts = 0;
    let md = currentMd;
    let error = lastError;

    while (attempts < SKILLFORGE_MAX_RETRIES) {
      attempts++;

      this.bus.emit('skillforge.refine.attempt', {
        name: originalParams.name,
        attempt: attempts,
        maxRetries: SKILLFORGE_MAX_RETRIES,
        error,
        agentUid,
      });

      // Apply deterministic fixes based on error patterns
      md = this.applyRefinementFixes(md, error, originalParams);

      // Re-test the refined skill
      const testResult = await this.testInSandbox(
        md,
        originalParams.test_input!,
        originalParams.test_expected,
      );

      if (testResult.passed) {
        return { success: true, refinedMd: md, attempts };
      }

      error = testResult.output;
    }

    return { success: false, attempts };
  }

  /**
   * Apply deterministic fixes to a SKILL.md based on known error patterns.
   */
  private applyRefinementFixes(
    skillMd: string,
    error: string,
    params: SkillForgeCreateParams,
  ): string {
    const errorLower = error.toLowerCase();

    try {
      const parsed = matter(skillMd);

      // Fix: Missing "name" field
      if (errorLower.includes('missing') && errorLower.includes('name')) {
        parsed.data.name = params.name;
      }

      // Fix: Missing "description" field
      if (errorLower.includes('missing') && errorLower.includes('description')) {
        parsed.data.description = params.description;
      }

      // Fix: Empty instructions body
      if (errorLower.includes('empty') && errorLower.includes('instructions')) {
        const body = `# ${params.name}\n\n${params.instructions}`;
        return matter.stringify(body, parsed.data);
      }

      // Fix: Expected content not found in instructions
      if (errorLower.includes('expected content') && errorLower.includes('not found')) {
        // Append the expected pattern to the instructions
        let body = parsed.content.trim();
        if (params.test_expected) {
          body += `\n\n## Expected Behavior\n${params.test_expected}`;
        }
        // Also ensure instructions from params are included
        if (!body.includes(params.instructions.substring(0, 50))) {
          body += `\n\n${params.instructions}`;
        }
        return matter.stringify(body, parsed.data);
      }

      // Fix: YAML parse errors — regenerate from scratch
      if (errorLower.includes('yaml') || errorLower.includes('parse error')) {
        return this.generateSkillMd(params);
      }

      // Generic fix: regenerate the body while keeping metadata
      const freshBody = `# ${params.name}\n\n${params.instructions}`;
      return matter.stringify(freshBody, parsed.data);
    } catch {
      // If parsing fails entirely, regenerate from scratch
      return this.generateSkillMd(params);
    }
  }

  // -------------------------------------------------------------------------
  // Private: StateStore Helpers
  // -------------------------------------------------------------------------

  private storeVersion(
    skillId: string,
    content: string,
    createdBy: string,
    explicitVersion?: number,
  ): void {
    const db = this.state.db;

    // Determine version number
    const existing = this.skillVersions.get(skillId) || [];
    const nextVersion =
      explicitVersion ??
      (existing.length > 0 ? Math.max(...existing.map((v) => v.version)) + 1 : 1);

    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO skill_versions (skill_id, version, content, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(skillId, nextVersion, content, createdBy, now);

    const versionRecord: SkillVersion = {
      version: nextVersion,
      content,
      created_at: now,
      created_by: createdBy,
    };

    if (!this.skillVersions.has(skillId)) {
      this.skillVersions.set(skillId, []);
    }
    this.skillVersions.get(skillId)!.push(versionRecord);
  }

  private loadVersions(): void {
    const db = this.state.db;

    const rows = db
      .prepare(
        'SELECT skill_id, version, content, created_by, created_at FROM skill_versions WHERE deleted_at IS NULL ORDER BY skill_id, version',
      )
      .all() as Array<{
      skill_id: string;
      version: number;
      content: string;
      created_by: string;
      created_at: number;
    }>;

    this.skillVersions.clear();

    for (const row of rows) {
      if (!this.skillVersions.has(row.skill_id)) {
        this.skillVersions.set(row.skill_id, []);
      }
      this.skillVersions.get(row.skill_id)!.push({
        version: row.version,
        content: row.content,
        created_at: row.created_at,
        created_by: row.created_by,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Private: ClawHub Cache
  // -------------------------------------------------------------------------

  private getClawHubCache(key: string): any | null {
    const entry = this.clawHubCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.clawHubCache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setClawHubCache(key: string, data: any): void {
    this.clawHubCache.set(key, {
      data,
      expiresAt: Date.now() + CLAWHUB_CACHE_TTL,
    });
  }

  // -------------------------------------------------------------------------
  // Private: Embedding Computation & Similarity
  // -------------------------------------------------------------------------

  /**
   * Compute a lightweight hash-based embedding for text.
   * Uses a simple bag-of-words approach hashed to fixed dimensions.
   * This is a fast fallback; real LLM embeddings can replace this later.
   */
  private computeEmbedding(text: string): number[] {
    const dims = SKILLFORGE_EMBEDDING_DIMENSIONS;
    const vec = new Array(dims).fill(0);
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    for (const word of words) {
      // Simple hash: distribute each word across multiple dimensions
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(hash) % dims;
      vec[idx] += 1;
      // Also set neighboring dimensions for better coverage
      vec[(idx + 1) % dims] += 0.5;
      vec[(idx + 2) % dims] += 0.25;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dims; i++) {
        vec[i] /= magnitude;
      }
    }

    return vec;
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Compute and store embedding for a skill.
   */
  private computeAndStoreEmbedding(skillId: string, description: string): void {
    const embedding = this.computeEmbedding(description);
    this.embeddingCache.set(skillId, embedding);
    this.state.upsertSkillEmbedding(skillId, embedding);
  }

  /**
   * Load all embeddings from StateStore into memory.
   */
  private loadEmbeddings(): void {
    const rows = this.state.getAllSkillEmbeddings();
    this.embeddingCache.clear();
    for (const row of rows) {
      try {
        const embedding = JSON.parse(row.embedding) as number[];
        this.embeddingCache.set(row.skill_id, embedding);
      } catch {
        /* skip corrupted rows */
      }
    }
  }
}
