import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { TemplateManager, TemplateMarketplaceEntry } from '../TemplateManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

function makeTemplate(
  overrides: Partial<
    Omit<
      TemplateMarketplaceEntry,
      'download_count' | 'rating_avg' | 'rating_count' | 'published_at' | 'updated_at' | 'enabled'
    >
  > = {},
) {
  return {
    id: overrides.id || crypto.randomUUID(),
    name: overrides.name || 'Test Template',
    description: overrides.description || 'A test template',
    icon: overrides.icon || 'code',
    category: overrides.category || ('development' as const),
    config: overrides.config || { role: 'coder', goal: 'write code' },
    suggestedGoals: overrides.suggestedGoals || ['Write tests', 'Build features'],
    author: overrides.author || 'user_1',
    tags: overrides.tags || ['dev', 'test'],
  };
}

describe('TemplateManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let templates: TemplateManager;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-template-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    templates = new TemplateManager(bus, store);
    await templates.init();
  });

  afterEach(() => {
    templates.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // Publish / Unpublish
  // ---------------------------------------------------------------------------

  describe('publish / unpublish', () => {
    it('publish creates a new marketplace entry', () => {
      const entry = templates.publish(makeTemplate({ name: 'My Template' }));
      expect(entry.name).toBe('My Template');
      expect(entry.download_count).toBe(0);
      expect(entry.rating_avg).toBe(0);
      expect(entry.rating_count).toBe(0);
      expect(entry.enabled).toBe(true);
      expect(entry.published_at).toBeGreaterThan(0);
    });

    it('publish emits template.published event', () => {
      const events: any[] = [];
      bus.on('template.published', (data: any) => events.push(data));

      const tmpl = makeTemplate({ name: 'Event Template' });
      templates.publish(tmpl);

      expect(events).toHaveLength(1);
      expect(events[0].templateId).toBe(tmpl.id);
      expect(events[0].name).toBe('Event Template');
    });

    it('unpublish removes a template', () => {
      const tmpl = makeTemplate();
      templates.publish(tmpl);
      templates.unpublish(tmpl.id);

      const result = templates.get(tmpl.id);
      expect(result).toBeNull();
    });

    it('unpublish emits template.unpublished event', () => {
      const events: any[] = [];
      bus.on('template.unpublished', (data: any) => events.push(data));

      const tmpl = makeTemplate();
      templates.publish(tmpl);
      templates.unpublish(tmpl.id);

      expect(events).toHaveLength(1);
      expect(events[0].templateId).toBe(tmpl.id);
    });
  });

  // ---------------------------------------------------------------------------
  // List / Filter
  // ---------------------------------------------------------------------------

  describe('list / filter', () => {
    it('list returns all published templates', () => {
      templates.publish(makeTemplate({ name: 'T1' }));
      templates.publish(makeTemplate({ name: 'T2' }));

      const list = templates.list();
      expect(list).toHaveLength(2);
    });

    it('list filters by category', () => {
      templates.publish(makeTemplate({ name: 'Dev', category: 'development' }));
      templates.publish(makeTemplate({ name: 'Res', category: 'research' }));
      templates.publish(makeTemplate({ name: 'Data', category: 'data' }));

      const devOnly = templates.list('development');
      expect(devOnly).toHaveLength(1);
      expect(devOnly[0].name).toBe('Dev');
    });

    it('list filters by tags', () => {
      templates.publish(makeTemplate({ name: 'Tagged1', tags: ['ai', 'ml'] }));
      templates.publish(makeTemplate({ name: 'Tagged2', tags: ['web', 'api'] }));
      templates.publish(makeTemplate({ name: 'Tagged3', tags: ['ai', 'web'] }));

      const aiTemplates = templates.list(undefined, ['ai']);
      expect(aiTemplates).toHaveLength(2);
      const names = aiTemplates.map((t) => t.name);
      expect(names).toContain('Tagged1');
      expect(names).toContain('Tagged3');
    });

    it('list filters by both category and tags', () => {
      templates.publish(makeTemplate({ name: 'T1', category: 'development', tags: ['ai'] }));
      templates.publish(makeTemplate({ name: 'T2', category: 'research', tags: ['ai'] }));
      templates.publish(makeTemplate({ name: 'T3', category: 'development', tags: ['web'] }));

      const result = templates.list('development', ['ai']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('T1');
    });
  });

  // ---------------------------------------------------------------------------
  // Get
  // ---------------------------------------------------------------------------

  describe('get', () => {
    it('returns template by ID', () => {
      const tmpl = makeTemplate({ name: 'Specific' });
      templates.publish(tmpl);

      const result = templates.get(tmpl.id);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Specific');
      expect(result!.config).toEqual({ role: 'coder', goal: 'write code' });
    });

    it('returns null for unknown ID', () => {
      const result = templates.get('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Rating
  // ---------------------------------------------------------------------------

  describe('rate', () => {
    it('rate inserts a new rating', () => {
      const tmpl = makeTemplate();
      templates.publish(tmpl);

      const { newAvg } = templates.rate(tmpl.id, 'user_1', 5, 'Excellent!');
      expect(newAvg).toBe(5);

      const entry = templates.get(tmpl.id);
      expect(entry!.rating_count).toBe(1);
      expect(entry!.rating_avg).toBe(5);
    });

    it('rate computes average across multiple users', () => {
      const tmpl = makeTemplate();
      templates.publish(tmpl);

      templates.rate(tmpl.id, 'user_1', 5);
      templates.rate(tmpl.id, 'user_2', 3);

      const entry = templates.get(tmpl.id);
      expect(entry!.rating_count).toBe(2);
      expect(entry!.rating_avg).toBe(4);
    });

    it('rate updates existing rating from same user', () => {
      const tmpl = makeTemplate();
      templates.publish(tmpl);

      templates.rate(tmpl.id, 'user_1', 2);
      templates.rate(tmpl.id, 'user_1', 5); // Update

      const entry = templates.get(tmpl.id);
      expect(entry!.rating_count).toBe(1);
      expect(entry!.rating_avg).toBe(5);
    });

    it('rate emits template.rated event', () => {
      const events: any[] = [];
      bus.on('template.rated', (data: any) => events.push(data));

      const tmpl = makeTemplate();
      templates.publish(tmpl);
      templates.rate(tmpl.id, 'user_1', 4, 'Good');

      expect(events).toHaveLength(1);
      expect(events[0].templateId).toBe(tmpl.id);
      expect(events[0].rating).toBe(4);
      expect(events[0].newAvg).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Fork
  // ---------------------------------------------------------------------------

  describe('fork', () => {
    it('fork creates a new template based on original', () => {
      const tmpl = makeTemplate({ name: 'Original', author: 'creator' });
      templates.publish(tmpl);

      const forked = templates.fork(tmpl.id, 'forker');
      expect(forked.id).not.toBe(tmpl.id);
      expect(forked.name).toBe('Original (fork)');
      expect(forked.author).toBe('forker');
      expect(forked.config).toEqual(tmpl.config);
      expect(forked.tags).toEqual(tmpl.tags);
    });

    it('fork increments download_count on original', () => {
      const tmpl = makeTemplate();
      templates.publish(tmpl);

      templates.fork(tmpl.id, 'user_2');

      const original = templates.get(tmpl.id);
      expect(original!.download_count).toBe(1);
    });

    it('fork throws for nonexistent template', () => {
      expect(() => templates.fork('nonexistent', 'user_1')).toThrow(
        'Template nonexistent not found',
      );
    });

    it('fork emits template.forked event', () => {
      const events: any[] = [];
      bus.on('template.forked', (data: any) => events.push(data));

      const tmpl = makeTemplate();
      templates.publish(tmpl);
      const forked = templates.fork(tmpl.id, 'user_2');

      expect(events).toHaveLength(1);
      expect(events[0].originalId).toBe(tmpl.id);
      expect(events[0].forkedId).toBe(forked.id);
      expect(events[0].userId).toBe('user_2');
    });
  });

  // ---------------------------------------------------------------------------
  // Download Count
  // ---------------------------------------------------------------------------

  describe('download count', () => {
    it('incrementDownloads increases count', () => {
      const tmpl = makeTemplate();
      templates.publish(tmpl);

      templates.incrementDownloads(tmpl.id);
      templates.incrementDownloads(tmpl.id);
      templates.incrementDownloads(tmpl.id);

      const entry = templates.get(tmpl.id);
      expect(entry!.download_count).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('data survives store close and reopen', async () => {
      const tmpl = makeTemplate({ name: 'Persistent' });
      templates.publish(tmpl);
      templates.rate(tmpl.id, 'user_1', 4);
      templates.incrementDownloads(tmpl.id);
      templates.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const templates2 = new TemplateManager(bus, store2);
      await templates2.init();

      try {
        const list = templates2.list();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('Persistent');
        expect(list[0].download_count).toBe(1);
        expect(list[0].rating_count).toBe(1);
        expect(list[0].rating_avg).toBe(4);
      } finally {
        templates2.shutdown();
        store2.close();
      }
    });
  });
});
