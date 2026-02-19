/**
 * Aether Kernel - Seed Skills Tests
 *
 * Validates the 5 reference skill definitions returned by getDefaultSkills()
 * have correct structure, unique IDs, expected categories, required inputs,
 * and well-formed steps.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultSkills } from '../seedSkills.js';

describe('getDefaultSkills', () => {
  const skills = getDefaultSkills();

  // -----------------------------------------------------------------------
  // 1. Returns exactly 5 skills
  // -----------------------------------------------------------------------
  it('returns exactly 5 skills', () => {
    expect(skills).toHaveLength(5);
  });

  // -----------------------------------------------------------------------
  // 2. Each skill has a unique id
  // -----------------------------------------------------------------------
  it('each skill has a unique id', () => {
    const ids = skills.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // -----------------------------------------------------------------------
  // 3. Each skill has required fields
  // -----------------------------------------------------------------------
  it('each skill has all required SkillDefinition fields', () => {
    for (const skill of skills) {
      expect(typeof skill.id).toBe('string');
      expect(skill.id.length).toBeGreaterThan(0);

      expect(typeof skill.name).toBe('string');
      expect(skill.name.length).toBeGreaterThan(0);

      expect(typeof skill.version).toBe('string');
      expect(skill.version.length).toBeGreaterThan(0);

      expect(typeof skill.description).toBe('string');
      expect(skill.description.length).toBeGreaterThan(0);

      expect(typeof skill.author).toBe('string');
      expect(skill.author!.length).toBeGreaterThan(0);

      expect(typeof skill.category).toBe('string');
      expect(skill.category!.length).toBeGreaterThan(0);

      expect(Array.isArray(skill.tags)).toBe(true);
      expect(skill.tags!.length).toBeGreaterThan(0);

      expect(skill.inputs).toBeDefined();
      expect(typeof skill.inputs).toBe('object');

      expect(Array.isArray(skill.steps)).toBe(true);

      expect(typeof skill.output).toBe('string');
      expect(skill.output.length).toBeGreaterThan(0);
    }
  });

  // -----------------------------------------------------------------------
  // 4. Each skill has at least one step
  // -----------------------------------------------------------------------
  it('each skill has at least one step', () => {
    for (const skill of skills) {
      expect(skill.steps.length).toBeGreaterThanOrEqual(1);
    }
  });

  // -----------------------------------------------------------------------
  // 5. Each step has id, action, and params
  // -----------------------------------------------------------------------
  it('each step has id, action, and params', () => {
    for (const skill of skills) {
      for (const step of skill.steps) {
        expect(typeof step.id).toBe('string');
        expect(step.id.length).toBeGreaterThan(0);

        expect(typeof step.action).toBe('string');
        expect(step.action.length).toBeGreaterThan(0);

        expect(step.params).toBeDefined();
        expect(typeof step.params).toBe('object');
      }
    }
  });

  // -----------------------------------------------------------------------
  // 6. Each skill has at least one required input or input with default
  // -----------------------------------------------------------------------
  it('each skill has at least one required input or input with a default value', () => {
    for (const skill of skills) {
      const inputEntries = Object.values(skill.inputs);
      expect(inputEntries.length).toBeGreaterThanOrEqual(1);

      const hasRequiredOrDefault = inputEntries.some(
        (input) => input.required === true || input.default !== undefined,
      );
      expect(hasRequiredOrDefault).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // 7. Specific skill validation: summarize-url and code-review inputs
  // -----------------------------------------------------------------------
  describe('specific skill validation', () => {
    it('summarize-url has a url input', () => {
      const skill = skills.find((s) => s.id === 'summarize-url');
      expect(skill).toBeDefined();
      expect(skill!.inputs.url).toBeDefined();
      expect(skill!.inputs.url.type).toBe('string');
      expect(skill!.inputs.url.required).toBe(true);
    });

    it('code-review has a file_path input', () => {
      const skill = skills.find((s) => s.id === 'code-review');
      expect(skill).toBeDefined();
      expect(skill!.inputs.file_path).toBeDefined();
      expect(skill!.inputs.file_path.type).toBe('string');
      expect(skill!.inputs.file_path.required).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Categories cover the expected set
  // -----------------------------------------------------------------------
  it('categories cover the expected set (research, development, data, ops)', () => {
    const categories = new Set(skills.map((s) => s.category));
    expect(categories).toContain('research');
    expect(categories).toContain('development');
    expect(categories).toContain('data');
    expect(categories).toContain('ops');
  });

  // -----------------------------------------------------------------------
  // 9. Returns a new array each call (not a shared reference)
  // -----------------------------------------------------------------------
  it('returns a new array each call (not a shared reference)', () => {
    const first = getDefaultSkills();
    const second = getDefaultSkills();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  // -----------------------------------------------------------------------
  // Additional structural validations
  // -----------------------------------------------------------------------
  it('has the expected skill IDs', () => {
    const ids = skills.map((s) => s.id);
    expect(ids).toContain('summarize-url');
    expect(ids).toContain('code-review');
    expect(ids).toContain('data-transform');
    expect(ids).toContain('health-check');
    expect(ids).toContain('git-changelog');
  });

  it('all versions are 1.0.0', () => {
    for (const skill of skills) {
      expect(skill.version).toBe('1.0.0');
    }
  });

  it('all authors are Aether OS Team', () => {
    for (const skill of skills) {
      expect(skill.author).toBe('Aether OS Team');
    }
  });
});
