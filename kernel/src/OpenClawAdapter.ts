/**
 * Aether Kernel - OpenClaw Skill Adapter (v0.6)
 *
 * Phase 1: Read-only import of OpenClaw SKILL.md files.
 *
 * OpenClaw skills are defined as Markdown files with YAML frontmatter:
 *   ---
 *   name: image-processor
 *   description: Processes images using ImageMagick
 *   metadata: {"openclaw": {"requires": {"bins": ["convert"]}}}
 *   ---
 *   # Image Processor
 *   Instructions for how the agent should use this skill...
 *
 * This adapter:
 *   1. Parses SKILL.md files (YAML frontmatter + Markdown body)
 *   2. Maps frontmatter to PluginRegistryManifest
 *   3. Validates dependencies (required bins, env vars, OS)
 *   4. Stores imported skills in the plugin registry
 *   5. Injects skill instructions into agent system prompts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { StateStore } from './StateStore.js';
import { PluginRegistryManager } from './PluginRegistryManager.js';
import type {
  OpenClawSkillFrontmatter,
  OpenClawImportResult,
  OpenClawBatchImportResult,
} from '@aether/shared';
import type { PluginRegistryManifest } from './PluginRegistryManager.js';

export class OpenClawAdapter {
  private bus: EventBus;
  private state: StateStore;
  private pluginRegistry: PluginRegistryManager;
  private importedSkills: Map<string, OpenClawImportResult> = new Map();

  constructor(bus: EventBus, state: StateStore, pluginRegistry: PluginRegistryManager) {
    this.bus = bus;
    this.state = state;
    this.pluginRegistry = pluginRegistry;
  }

  async init(): Promise<void> {
    // Load previously imported skill metadata from SQLite
    const rows = this.state.getAllOpenClawImports();
    for (const row of rows) {
      try {
        this.importedSkills.set(row.skill_id, JSON.parse(row.import_data));
      } catch {
        /* skip corrupted rows */
      }
    }
  }

  /**
   * Import a single SKILL.md file.
   */
  async importSkill(skillMdPath: string): Promise<OpenClawImportResult> {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);
    const fm = frontmatter as OpenClawSkillFrontmatter;

    // Validate required fields
    if (!fm.name) {
      throw new Error(`SKILL.md missing required "name" field: ${skillMdPath}`);
    }

    // Check dependencies
    const warnings: string[] = [];
    let dependenciesMet = true;

    // Check required binaries
    if (fm.metadata?.openclaw?.requires?.bins) {
      for (const bin of fm.metadata.openclaw.requires.bins) {
        if (!this.isBinaryAvailable(bin)) {
          warnings.push(`Required binary not found in PATH: ${bin}`);
          dependenciesMet = false;
        }
      }
    }

    // Check required environment variables
    if (fm.metadata?.openclaw?.requires?.env) {
      for (const envVar of fm.metadata.openclaw.requires.env) {
        if (!process.env[envVar]) {
          warnings.push(`Required environment variable not set: ${envVar}`);
          dependenciesMet = false;
        }
      }
    }

    // Check OS compatibility
    if (fm.metadata?.openclaw?.os) {
      const currentOs =
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
            ? 'darwin'
            : 'linux';
      if (!fm.metadata.openclaw.os.includes(currentOs)) {
        warnings.push(
          `Skill requires OS: ${fm.metadata.openclaw.os.join(', ')} (current: ${currentOs})`,
        );
      }
    }

    // Build PluginRegistryManifest
    const manifest: PluginRegistryManifest = {
      id: `openclaw-skill-${fm.name}`,
      name: fm.name,
      version: '1.0.0',
      author: 'OpenClaw Community',
      description: fm.description || `OpenClaw skill: ${fm.name}`,
      category: 'tools',
      icon: 'Plug',
      tools: this.extractTools(fm, body),
      keywords: ['openclaw', 'imported', ...(fm.metadata?.openclaw?.os || [])],
    };

    const result: OpenClawImportResult = {
      manifest,
      instructions: body.trim(),
      warnings,
      dependenciesMet,
      sourcePath: skillMdPath,
    };

    // Register in the plugin registry
    try {
      this.pluginRegistry.install(manifest, 'local', 'openclaw-importer');
    } catch (err: unknown) {
      // If already installed, update instead
      if (errMsg(err)?.includes('already')) {
        // Skip -- already imported
      } else {
        throw err;
      }
    }

    // Persist the import metadata
    this.importedSkills.set(manifest.id, result);
    this.state.upsertOpenClawImport({
      skill_id: manifest.id,
      name: fm.name,
      source_path: skillMdPath,
      instructions: body.trim(),
      warnings: JSON.stringify(warnings),
      dependencies_met: dependenciesMet ? 1 : 0,
      import_data: JSON.stringify(result),
      imported_at: Date.now(),
    });

    this.bus.emit('openclaw.skill.imported', {
      skillId: manifest.id,
      name: fm.name,
      warnings,
      dependenciesMet,
    });

    return result;
  }

  /**
   * Scan a directory for SKILL.md files and import all of them.
   * Follows OpenClaw convention: each skill is a subdirectory with SKILL.md.
   */
  async importDirectory(dirPath: string): Promise<OpenClawBatchImportResult> {
    const result: OpenClawBatchImportResult = {
      imported: [],
      failed: [],
      totalScanned: 0,
    };

    if (!fs.existsSync(dirPath)) {
      return result;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      result.totalScanned++;

      try {
        const imported = await this.importSkill(skillMdPath);
        result.imported.push(imported);
      } catch (err: unknown) {
        result.failed.push({ path: skillMdPath, error: errMsg(err) });
      }
    }

    this.bus.emit('openclaw.batch.imported', {
      imported: result.imported.length,
      failed: result.failed.length,
      totalScanned: result.totalScanned,
    });

    return result;
  }

  /**
   * Get the instructions (Markdown body) for an imported skill.
   * These are injected into the agent's system prompt when the skill is active.
   */
  getInstructions(skillId: string): string | undefined {
    return this.importedSkills.get(skillId)?.instructions;
  }

  /**
   * List all imported OpenClaw skills.
   */
  listImported(): OpenClawImportResult[] {
    return Array.from(this.importedSkills.values());
  }

  /**
   * Remove an imported skill.
   */
  removeImport(skillId: string): boolean {
    const existed = this.importedSkills.delete(skillId);
    if (existed) {
      this.state.deleteOpenClawImport(skillId);
      try {
        this.pluginRegistry.uninstall(skillId);
      } catch {
        /* ignore if already removed */
      }
    }
    return existed;
  }

  shutdown(): void {
    this.importedSkills.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract tool definitions from the SKILL.md frontmatter and body.
   */
  private extractTools(
    fm: OpenClawSkillFrontmatter,
    _body: string,
  ): PluginRegistryManifest['tools'] {
    const tools: PluginRegistryManifest['tools'] = [];

    if (fm['command-dispatch'] === 'tool' && fm['command-tool']) {
      // Skill defines a specific tool to dispatch to
      tools.push({
        name: fm['command-tool'],
        description: fm.description || `Execute the ${fm.name} skill`,
        parameters: {},
      });
    } else {
      // Skill is instruction-based (injected into prompt)
      // Create a virtual tool that represents "invoke this skill"
      tools.push({
        name: fm.name,
        description: fm.description || `Use the ${fm.name} skill`,
        parameters: {},
      });
    }

    return tools;
  }

  /**
   * Check if a binary is available in the system PATH.
   */
  private isBinaryAvailable(name: string): boolean {
    try {
      const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
      const { execSync } = require('node:child_process');
      execSync(cmd, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
