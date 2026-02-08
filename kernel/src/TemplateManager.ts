/**
 * Aether Kernel - Template Manager (v0.4 Wave 2)
 *
 * Manages the agent template marketplace:
 * - Publish / unpublish templates
 * - Browse and filter templates by category / tags
 * - Rate and review templates
 * - Fork templates for customization
 * - Track download counts
 *
 * Uses StateStore's public API for persistence (tables created by StateStore).
 */

import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import * as crypto from 'node:crypto';

export interface TemplateMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'development' | 'research' | 'data' | 'creative' | 'ops';
  config: Record<string, any>;
  suggestedGoals: string[];
  author: string;
  tags: string[];
  download_count: number;
  rating_avg: number;
  rating_count: number;
  published_at: number;
  updated_at: number;
  enabled: boolean;
}

export class TemplateManager {
  private getRatingSums!: any;

  constructor(
    private bus: EventBus,
    private state: StateStore,
  ) {}

  async init(): Promise<void> {
    const db = (this.state as any).db;
    this.getRatingSums = db.prepare(`
      SELECT COALESCE(SUM(rating), 0) as total, COUNT(*) as count
      FROM template_ratings WHERE template_id = ?
    `);
  }

  publish(
    template: Omit<
      TemplateMarketplaceEntry,
      'download_count' | 'rating_avg' | 'rating_count' | 'published_at' | 'updated_at' | 'enabled'
    >,
  ): TemplateMarketplaceEntry {
    const now = Date.now();
    const entry: TemplateMarketplaceEntry = {
      ...template,
      download_count: 0,
      rating_avg: 0,
      rating_count: 0,
      published_at: now,
      updated_at: now,
      enabled: true,
    };

    this.state.insertTemplate({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      category: entry.category,
      config: JSON.stringify(entry.config),
      suggested_goals: JSON.stringify(entry.suggestedGoals),
      author: entry.author,
      tags: JSON.stringify(entry.tags),
      download_count: 0,
      rating_avg: 0,
      rating_count: 0,
      published_at: now,
      updated_at: now,
      enabled: 1,
    });

    this.bus.emit('template.published', {
      templateId: entry.id,
      name: entry.name,
      author: entry.author,
    });
    return entry;
  }

  unpublish(templateId: string): void {
    this.state.deleteTemplate(templateId);
    this.bus.emit('template.unpublished', { templateId });
  }

  list(category?: string, tags?: string[]): TemplateMarketplaceEntry[] {
    let rows: any[];
    if (category) {
      rows = this.state.getTemplatesByCategory(category);
    } else {
      rows = this.state.getAllTemplates();
    }

    let entries = rows.map((row: any) => this.rowToEntry(row));

    if (tags && tags.length > 0) {
      entries = entries.filter((e) => tags.some((tag) => e.tags.includes(tag)));
    }

    return entries;
  }

  get(templateId: string): TemplateMarketplaceEntry | null {
    const row = this.state.getTemplate(templateId);
    if (!row) return null;
    return this.rowToEntry(row);
  }

  rate(templateId: string, userId: string, rating: number, review?: string): { newAvg: number } {
    this.state.insertTemplateRating({
      template_id: templateId,
      user_id: userId,
      rating,
      review: review || null,
      created_at: Date.now(),
    });

    const sums = this.getRatingSums.get(templateId) as { total: number; count: number };
    const newAvg = sums.count > 0 ? sums.total / sums.count : 0;

    this.state.updateTemplateRating(templateId, newAvg, sums.count);

    this.bus.emit('template.rated', { templateId, userId, rating, newAvg });
    return { newAvg };
  }

  fork(templateId: string, userId: string): TemplateMarketplaceEntry {
    const original = this.get(templateId);
    if (!original) {
      throw new Error(`Template ${templateId} not found`);
    }

    this.incrementDownloads(templateId);

    const forkedEntry = this.publish({
      id: crypto.randomUUID(),
      name: `${original.name} (fork)`,
      description: original.description,
      icon: original.icon,
      category: original.category,
      config: { ...original.config },
      suggestedGoals: [...original.suggestedGoals],
      author: userId,
      tags: [...original.tags],
    });

    this.bus.emit('template.forked', { originalId: templateId, forkedId: forkedEntry.id, userId });
    return forkedEntry;
  }

  incrementDownloads(templateId: string): void {
    this.state.incrementTemplateDownloads(templateId);
  }

  shutdown(): void {
    // No-op
  }

  private rowToEntry(row: any): TemplateMarketplaceEntry {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      config: JSON.parse(row.config),
      suggestedGoals: JSON.parse(row.suggested_goals),
      author: row.author,
      tags: JSON.parse(row.tags),
      download_count: row.download_count,
      rating_avg: row.rating_avg,
      rating_count: row.rating_count,
      published_at: row.published_at,
      updated_at: row.updated_at,
      enabled: row.enabled === 1,
    };
  }
}
