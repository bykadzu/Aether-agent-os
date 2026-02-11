import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../ModelRouter.js';

describe('ModelRouter', () => {
  describe('default routing rules', () => {
    const router = new ModelRouter();

    it('routes simple file tools to flash', () => {
      const result = router.route({
        tools: ['file_read', 'file_write'],
        stepCount: 0,
        maxSteps: 50,
      });
      expect(result).toBe('flash');
    });

    it('routes memory-only tools to flash', () => {
      const result = router.route({
        tools: ['memory_query', 'file_list'],
        stepCount: 0,
        maxSteps: 50,
      });
      expect(result).toBe('flash');
    });

    it('routes code tools to frontier', () => {
      const result = router.route({
        tools: ['code_generate', 'file_read'],
        stepCount: 5,
        maxSteps: 50,
      });
      expect(result).toBe('frontier');
    });

    it('routes code_analyze to frontier', () => {
      const result = router.route({
        tools: ['code_analyze'],
        stepCount: 10,
        maxSteps: 50,
      });
      expect(result).toBe('frontier');
    });

    it('routes browser tools to frontier', () => {
      const result = router.route({
        tools: ['browser_navigate', 'browser_click', 'browser_extract'],
        stepCount: 10,
        maxSteps: 50,
      });
      expect(result).toBe('frontier');
    });

    it('routes early steps with no complex tools to flash', () => {
      const result = router.route({
        tools: ['some_custom_tool'],
        stepCount: 2,
        maxSteps: 50,
      });
      expect(result).toBe('flash');
    });

    it('does NOT route early steps to flash if complex tools present', () => {
      const result = router.route({
        tools: ['code_generate'],
        stepCount: 2,
        maxSteps: 50,
      });
      // code_generate matches frontier rule first
      expect(result).toBe('frontier');
    });

    it('defaults to standard for mixed/unknown tools past early steps', () => {
      const result = router.route({
        tools: ['custom_tool', 'another_tool'],
        stepCount: 10,
        maxSteps: 50,
      });
      expect(result).toBe('standard');
    });

    it('defaults to standard when no tools provided and past early steps', () => {
      const result = router.route({
        tools: [],
        stepCount: 10,
        maxSteps: 50,
      });
      expect(result).toBe('standard');
    });
  });

  describe('custom config', () => {
    it('respects custom default family', () => {
      const router = new ModelRouter({
        rules: [],
        defaultFamily: 'frontier',
      });
      const result = router.route({
        tools: ['anything'],
        stepCount: 10,
        maxSteps: 50,
      });
      expect(result).toBe('frontier');
    });

    it('respects custom rules', () => {
      const router = new ModelRouter({
        rules: [{ pattern: 'custom-rule', tools: ['my_tool'], family: 'flash' }],
        defaultFamily: 'standard',
      });
      // 'my_tool' alone should get flash (since it's the only tool and flash rule checks subset)
      // But since it's a frontier-style match (at least one match), it works
      const result = router.route({
        tools: ['my_tool'],
        stepCount: 10,
        maxSteps: 50,
      });
      // Custom rule: tools=['my_tool'], family='flash'
      // For flash family, all tools must be in rule set -> 'my_tool' is in set -> match
      expect(result).toBe('flash');
    });
  });

  describe('addRule()', () => {
    it('adds a rule that is used in routing', () => {
      const router = new ModelRouter({ rules: [], defaultFamily: 'standard' });
      router.addRule({
        pattern: 'special',
        tools: ['special_tool'],
        family: 'frontier',
      });

      const result = router.route({
        tools: ['special_tool'],
        stepCount: 10,
        maxSteps: 50,
      });
      expect(result).toBe('frontier');
    });
  });

  describe('getRules()', () => {
    it('returns a copy of rules', () => {
      const router = new ModelRouter();
      const rules = router.getRules();
      expect(rules.length).toBeGreaterThan(0);

      // Modifying returned array should not affect internal state
      rules.push({ pattern: 'extra', family: 'flash' });
      expect(router.getRules().length).toBeLessThan(rules.length);
    });
  });

  describe('goal-based routing', () => {
    it('accepts goal in context without error', () => {
      const router = new ModelRouter();
      const result = router.route({
        goal: 'Write a complex algorithm',
        tools: ['file_read'],
        stepCount: 0,
        maxSteps: 50,
      });
      // Should still route based on tools, goal is for future use
      expect(result).toBe('flash');
    });
  });
});
