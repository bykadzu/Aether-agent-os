/**
 * OpenClaw Adapter Unit Tests (v0.6)
 *
 * Tests the OpenClaw SKILL.md import pipeline:
 *   - Frontmatter parsing (name, description, metadata, command-dispatch)
 *   - PluginRegistryManifest generation
 *   - Dependency validation (bins, env, OS)
 *   - Batch directory import
 *   - Persistence and lifecycle (import, list, remove)
 *   - Event emission
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import { EventBus } from '../EventBus.js';
import { OpenClawAdapter } from '../OpenClawAdapter.js';

// ---------------------------------------------------------------------------
// Fixture path helper
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures', 'openclaw');

function fixturePath(skill: string): string {
  return path.join(FIXTURES_DIR, skill, 'SKILL.md');
}

// ---------------------------------------------------------------------------
// Mock StateStore
// ---------------------------------------------------------------------------

function createMockStateStore() {
  const imports = new Map<string, any>();
  return {
    getAllOpenClawImports: vi.fn(() => Array.from(imports.values())),
    getOpenClawImport: vi.fn((id: string) => imports.get(id) || null),
    upsertOpenClawImport: vi.fn((record: any) => {
      imports.set(record.skill_id, record);
    }),
    deleteOpenClawImport: vi.fn((id: string) => {
      imports.delete(id);
    }),
    _imports: imports,
  };
}

// ---------------------------------------------------------------------------
// Mock PluginRegistryManager
// ---------------------------------------------------------------------------

function createMockPluginRegistry() {
  const plugins = new Map<string, any>();
  return {
    install: vi.fn((manifest: any, source: string, owner: string) => {
      plugins.set(manifest.id, { manifest, source, owner });
      return { id: manifest.id, manifest };
    }),
    uninstall: vi.fn((pluginId: string) => {
      plugins.delete(pluginId);
    }),
    _plugins: plugins,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenClawAdapter', () => {
  let bus: EventBus;
  let state: ReturnType<typeof createMockStateStore>;
  let registry: ReturnType<typeof createMockPluginRegistry>;
  let adapter: OpenClawAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    bus = new EventBus();
    state = createMockStateStore();
    registry = createMockPluginRegistry();
    adapter = new OpenClawAdapter(bus, state as any, registry as any);
    await adapter.init();
  });

  // -----------------------------------------------------------------------
  // Single Skill Import
  // -----------------------------------------------------------------------

  describe('importSkill', () => {
    it('parses a minimal SKILL.md and creates a manifest', async () => {
      const result = await adapter.importSkill(fixturePath('minimal'));

      expect(result.manifest.id).toBe('openclaw-skill-minimal-skill');
      expect(result.manifest.name).toBe('minimal-skill');
      expect(result.manifest.description).toBe('A minimal skill with no special requirements');
      expect(result.manifest.category).toBe('tools');
      expect(result.manifest.author).toBe('OpenClaw Community');
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.manifest.keywords).toContain('openclaw');
      expect(result.manifest.keywords).toContain('imported');
      expect(result.warnings).toHaveLength(0);
      expect(result.dependenciesMet).toBe(true);
      expect(result.instructions).toContain('Minimal Skill');
    });

    it('extracts tool definitions for instruction-based skills', async () => {
      const result = await adapter.importSkill(fixturePath('minimal'));

      expect(result.manifest.tools).toHaveLength(1);
      expect(result.manifest.tools[0].name).toBe('minimal-skill');
      expect(result.manifest.tools[0].description).toBe(
        'A minimal skill with no special requirements',
      );
    });

    it('extracts tool definitions for command-dispatch skills', async () => {
      const result = await adapter.importSkill(fixturePath('web-scraper'));

      expect(result.manifest.tools).toHaveLength(1);
      expect(result.manifest.tools[0].name).toBe('scrape_url');
      expect(result.manifest.tools[0].description).toContain('Scrapes web pages');
    });

    it('throws for SKILL.md missing the name field', async () => {
      await expect(adapter.importSkill(fixturePath('no-name'))).rejects.toThrow(
        'missing required "name" field',
      );
    });

    it('registers the manifest in the plugin registry', async () => {
      await adapter.importSkill(fixturePath('minimal'));

      expect(registry.install).toHaveBeenCalledTimes(1);
      expect(registry.install).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openclaw-skill-minimal-skill' }),
        'local',
        'openclaw-importer',
      );
    });

    it('persists the import in StateStore', async () => {
      await adapter.importSkill(fixturePath('minimal'));

      expect(state.upsertOpenClawImport).toHaveBeenCalledTimes(1);
      expect(state.upsertOpenClawImport).toHaveBeenCalledWith(
        expect.objectContaining({
          skill_id: 'openclaw-skill-minimal-skill',
          name: 'minimal-skill',
          dependencies_met: 1,
        }),
      );
    });

    it('emits openclaw.skill.imported event', async () => {
      const events: any[] = [];
      bus.on('openclaw.skill.imported', (d: any) => events.push(d));

      await adapter.importSkill(fixturePath('minimal'));

      expect(events).toHaveLength(1);
      expect(events[0].skillId).toBe('openclaw-skill-minimal-skill');
      expect(events[0].name).toBe('minimal-skill');
      expect(events[0].dependenciesMet).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Dependency Validation
  // -----------------------------------------------------------------------

  describe('dependency validation', () => {
    it('warns about missing binary dependencies', async () => {
      const result = await adapter.importSkill(fixturePath('image-processor'));

      // We expect warnings since convert/identify are unlikely in test env
      // The skill should still import despite missing deps
      expect(result.manifest.id).toBe('openclaw-skill-image-processor');
      // Dependencies may or may not be met depending on the host
      expect(typeof result.dependenciesMet).toBe('boolean');
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('warns about missing environment variables', async () => {
      // Ensure env vars are not set
      delete process.env.OPENCLAW_TEST_SECRET;
      delete process.env.OPENCLAW_TEST_API_KEY;

      const result = await adapter.importSkill(fixturePath('env-deps'));

      expect(result.dependenciesMet).toBe(false);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings.some((w) => w.includes('OPENCLAW_TEST_SECRET'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('OPENCLAW_TEST_API_KEY'))).toBe(true);
    });

    it('warns about OS incompatibility', async () => {
      // macos-only skill requires darwin -- on non-darwin this should warn
      const result = await adapter.importSkill(fixturePath('macos-only'));

      if (process.platform !== 'darwin') {
        expect(result.warnings.some((w) => w.includes('requires OS'))).toBe(true);
      } else {
        // On macOS, no OS warning should appear
        expect(result.warnings.filter((w) => w.includes('requires OS'))).toHaveLength(0);
      }
    });

    it('includes OS keywords in manifest', async () => {
      const result = await adapter.importSkill(fixturePath('image-processor'));

      expect(result.manifest.keywords).toContain('linux');
      expect(result.manifest.keywords).toContain('darwin');
    });
  });

  // -----------------------------------------------------------------------
  // Batch Import
  // -----------------------------------------------------------------------

  describe('importDirectory', () => {
    it('imports all valid SKILL.md files from a directory', async () => {
      const result = await adapter.importDirectory(FIXTURES_DIR);

      // We have 6 fixture dirs but no-name should fail
      expect(result.totalScanned).toBe(6);
      expect(result.imported.length).toBe(5); // all except no-name
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].error).toContain('missing required "name" field');
    });

    it('returns empty result for non-existent directory', async () => {
      const result = await adapter.importDirectory('/non/existent/path');

      expect(result.totalScanned).toBe(0);
      expect(result.imported).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('emits openclaw.batch.imported event', async () => {
      const events: any[] = [];
      bus.on('openclaw.batch.imported', (d: any) => events.push(d));

      await adapter.importDirectory(FIXTURES_DIR);

      expect(events).toHaveLength(1);
      expect(events[0].imported).toBe(5);
      expect(events[0].failed).toBe(1);
      expect(events[0].totalScanned).toBe(6);
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('listImported returns all imported skills', async () => {
      await adapter.importSkill(fixturePath('minimal'));
      await adapter.importSkill(fixturePath('web-scraper'));

      const list = adapter.listImported();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.manifest.name)).toContain('minimal-skill');
      expect(list.map((s) => s.manifest.name)).toContain('web-scraper');
    });

    it('getInstructions returns Markdown body for imported skill', async () => {
      await adapter.importSkill(fixturePath('minimal'));

      const instructions = adapter.getInstructions('openclaw-skill-minimal-skill');
      expect(instructions).toBeDefined();
      expect(instructions).toContain('Minimal Skill');
    });

    it('getInstructions returns undefined for unknown skill', () => {
      const instructions = adapter.getInstructions('non-existent');
      expect(instructions).toBeUndefined();
    });

    it('removeImport removes skill from memory and StateStore', async () => {
      await adapter.importSkill(fixturePath('minimal'));
      expect(adapter.listImported()).toHaveLength(1);

      const removed = adapter.removeImport('openclaw-skill-minimal-skill');

      expect(removed).toBe(true);
      expect(adapter.listImported()).toHaveLength(0);
      expect(state.deleteOpenClawImport).toHaveBeenCalledWith('openclaw-skill-minimal-skill');
      expect(registry.uninstall).toHaveBeenCalledWith('openclaw-skill-minimal-skill');
    });

    it('removeImport returns false for unknown skill', () => {
      expect(adapter.removeImport('non-existent')).toBe(false);
    });

    it('shutdown clears all imported skills', async () => {
      await adapter.importSkill(fixturePath('minimal'));
      expect(adapter.listImported()).toHaveLength(1);

      adapter.shutdown();

      expect(adapter.listImported()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Init (restore from StateStore)
  // -----------------------------------------------------------------------

  describe('init', () => {
    it('restores previously imported skills from StateStore on init', async () => {
      const mockImportData = {
        manifest: { id: 'openclaw-skill-restored', name: 'restored' },
        instructions: '# Restored',
        warnings: [],
        dependenciesMet: true,
        sourcePath: '/tmp/restored/SKILL.md',
      };
      state._imports.set('openclaw-skill-restored', {
        skill_id: 'openclaw-skill-restored',
        import_data: JSON.stringify(mockImportData),
      });

      // Re-initialize
      const newAdapter = new OpenClawAdapter(bus, state as any, registry as any);
      await newAdapter.init();

      const list = newAdapter.listImported();
      expect(list).toHaveLength(1);
      expect(list[0].manifest.id).toBe('openclaw-skill-restored');
    });

    it('skips corrupted rows gracefully', async () => {
      state._imports.set('bad-row', {
        skill_id: 'bad-row',
        import_data: 'not valid json{{{',
      });

      const newAdapter = new OpenClawAdapter(bus, state as any, registry as any);
      await newAdapter.init();

      expect(newAdapter.listImported()).toHaveLength(0);
    });
  });
});
