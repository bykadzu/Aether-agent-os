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
import { StateStore } from './StateStore.js';
import { PluginRegistryManager } from './PluginRegistryManager.js';
import { OpenClawAdapter } from './OpenClawAdapter.js';
import { ContainerManager } from './ContainerManager.js';
import type {
  SkillForgeCreateParams,
  SkillForgeDiscoverResult,
  SkillRiskLevel,
  SkillPermissionManifest,
  SkillVersion,
} from '@aether/shared';
import {
  SKILLFORGE_MAX_CREATES_PER_HOUR,
  SKILLFORGE_DEFAULT_ENFORCEMENT,
  SKILLFORGE_SKILL_ID_PREFIX,
  OPENCLAW_SKILL_ID_PREFIX,
} from '@aether/shared';

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
    const db = (this.state as any).db;

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
    // ClawHub HTTP search comes in Sprint 2

    this.bus.emit('skillforge.discover.completed', {
      query,
      source,
      resultCount: results.length,
    });

    return results.slice(0, limit);
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
        const permissions = (result.manifest as any).metadata?.openclaw?.permissions as
          | SkillPermissionManifest
          | undefined;
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

      // Other sources (clawhub, url) in Sprint 2
      return { success: false, message: `Source "${source}" not yet supported` };
    } catch (err: any) {
      this.bus.emit('skillforge.install.failed', {
        skillId,
        error: err.message,
      });
      return { success: false, message: `Install failed: ${err.message}` };
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
      const skillMd = this.generateSkillMd(params);

      // 3. Validate YAML structure
      try {
        const parsed = matter(skillMd);
        if (!parsed.data.name) {
          return { success: false, message: 'Generated SKILL.md missing required "name" field' };
        }
      } catch (parseErr: any) {
        return { success: false, message: `SKILL.md YAML parse error: ${parseErr.message}` };
      }

      // 4. Score permissions risk
      const risk = this.scoreRisk(params.permissions);

      // 5. Run sandbox test if test_input provided
      if (params.test_input) {
        const testResult = await this.testInSandbox(
          skillMd,
          params.test_input,
          params.test_expected,
        );
        if (!testResult.passed) {
          this.bus.emit('skillforge.test.failed', {
            name: params.name,
            output: testResult.output,
            agentUid,
          });
          return {
            success: false,
            message: `Sandbox test failed: ${testResult.output}`,
          };
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

      return { success: true, skillId, message: `Skill "${params.name}" created successfully` };
    } catch (err: any) {
      this.bus.emit('skillforge.create.failed', {
        name: params.name,
        error: err.message,
        agentUid,
      });
      return { success: false, message: `Create failed: ${err.message}` };
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
    const db = (this.state as any).db;
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
    } catch (err: any) {
      console.error(`[SkillForge] Rollback failed for ${skillId}@v${version}:`, err.message);
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
    } catch (err: any) {
      return { passed: false, output: `Validation error: ${err.message}` };
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
    const db = (this.state as any).db;

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
    const db = (this.state as any).db;

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
}
