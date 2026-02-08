/**
 * Aether Kernel - Seed Templates Tests
 *
 * Validates the 16 default agent templates have correct structure,
 * unique IDs, valid categories, and sufficient goals/tags.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultTemplates } from '../seedTemplates.js';
import type { SeedTemplate } from '../seedTemplates.js';

describe('getDefaultTemplates', () => {
  const templates = getDefaultTemplates();

  it('returns an array of 16 templates', () => {
    expect(templates).toHaveLength(16);
  });

  it('all templates have required fields', () => {
    for (const t of templates) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('icon');
      expect(t).toHaveProperty('category');
      expect(t).toHaveProperty('config');
      expect(t).toHaveProperty('suggestedGoals');
      expect(t).toHaveProperty('author');
      expect(t).toHaveProperty('tags');
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.icon).toBe('string');
      expect(typeof t.author).toBe('string');
    }
  });

  it('all IDs are unique', () => {
    const ids = templates.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all categories are valid', () => {
    const validCategories = ['development', 'research', 'data', 'creative', 'ops'];
    for (const t of templates) {
      expect(validCategories).toContain(t.category);
    }
  });

  it('all IDs use kebab-case', () => {
    for (const t of templates) {
      expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('config has role, model, tools, and maxSteps', () => {
    for (const t of templates) {
      expect(typeof t.config.role).toBe('string');
      expect(typeof t.config.model).toBe('string');
      expect(Array.isArray(t.config.tools)).toBe(true);
      expect(t.config.tools.length).toBeGreaterThan(0);
      expect(typeof t.config.maxSteps).toBe('number');
      expect(t.config.maxSteps).toBeGreaterThan(0);
    }
  });

  it('all config.model values are "auto"', () => {
    for (const t of templates) {
      expect(t.config.model).toBe('auto');
    }
  });

  it('each template has at least 3 suggested goals', () => {
    for (const t of templates) {
      expect(t.suggestedGoals.length).toBeGreaterThanOrEqual(3);
      for (const goal of t.suggestedGoals) {
        expect(typeof goal).toBe('string');
        expect(goal.length).toBeGreaterThan(0);
      }
    }
  });

  it('each template has at least 3 tags', () => {
    for (const t of templates) {
      expect(t.tags.length).toBeGreaterThanOrEqual(3);
      for (const tag of t.tags) {
        expect(typeof tag).toBe('string');
        expect(tag.length).toBeGreaterThan(0);
      }
    }
  });

  it('includes specific known template IDs', () => {
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('full-stack-developer');
    expect(ids).toContain('python-developer');
    expect(ids).toContain('devops-engineer');
    expect(ids).toContain('security-auditor');
    expect(ids).toContain('data-scientist');
    expect(ids).toContain('technical-writer');
    expect(ids).toContain('ui-ux-designer');
    expect(ids).toContain('database-admin');
    expect(ids).toContain('ml-engineer');
    expect(ids).toContain('incident-responder');
    expect(ids).toContain('code-reviewer');
    expect(ids).toContain('api-developer');
    expect(ids).toContain('research-analyst');
    expect(ids).toContain('content-creator');
    expect(ids).toContain('test-engineer');
    expect(ids).toContain('system-administrator');
  });
});
