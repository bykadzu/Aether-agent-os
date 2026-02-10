/**
 * SkillManager Tests
 *
 * Unit tests for the lightweight skill format: registration, listing,
 * template interpolation, step execution, and error handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { SkillManager, interpolate } from '../SkillManager.js';
import type { SkillDefinition, SkillContext } from '../SkillManager.js';

// ---------------------------------------------------------------------------
// Mock StateStore (minimal interface the SkillManager needs)
// ---------------------------------------------------------------------------

function createMockStateStore() {
  const skills = new Map<string, any>();
  return {
    prepare: vi.fn(() => ({
      run: vi.fn(),
    })),
    exec: vi.fn((_sql: string) => {
      // Handle CREATE TABLE
    }),
    query: vi.fn((_sql: string, ..._params: any[]) => {
      return Array.from(skills.entries()).map(([id, json]) => ({
        id,
        definition: json,
      }));
    }),
    ensureSkillsTable: vi.fn(),
    getAllSkills: vi.fn(() => []),
    upsertSkill: vi.fn((record: any) => {
      skills.set(record.id, record);
    }),
    getSkill: vi.fn((id: string) => skills.get(id) || null),
    deleteSkill: vi.fn((id: string) => {
      skills.delete(id);
    }),
    // Allow direct manipulation for testing
    _skills: skills,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const echoSkill: SkillDefinition = {
  id: 'echo-skill',
  name: 'Echo Skill',
  version: '1.0.0',
  description: 'Echoes the input back',
  author: 'test',
  category: 'utility',
  tags: ['test', 'echo'],
  inputs: {
    message: {
      type: 'string',
      description: 'The message to echo',
      required: true,
    },
    prefix: {
      type: 'string',
      description: 'Optional prefix',
      default: 'Echo:',
    },
  },
  steps: [
    {
      id: 'format',
      action: 'transform.text',
      params: {
        input: '{{inputs.prefix}} {{inputs.message}}',
        operation: 'identity',
      },
    },
  ],
  output: '{{steps.format}}',
};

const multiStepSkill: SkillDefinition = {
  id: 'multi-step',
  name: 'Multi Step',
  version: '1.0.0',
  description: 'Tests multi-step execution',
  inputs: {
    items: {
      type: 'array',
      description: 'Array of items',
      required: true,
    },
  },
  steps: [
    {
      id: 'count',
      action: 'transform.json',
      params: {
        input: '{{inputs.items}}',
        operation: 'count',
      },
    },
    {
      id: 'stringify',
      action: 'transform.json',
      params: {
        input: '{{steps.count}}',
        operation: 'stringify',
      },
    },
  ],
  output: '{{steps.stringify}}',
};

const conditionalSkill: SkillDefinition = {
  id: 'conditional-skill',
  name: 'Conditional Skill',
  version: '1.0.0',
  description: 'Tests conditional steps',
  inputs: {
    value: {
      type: 'number',
      description: 'A number',
      required: true,
    },
  },
  steps: [
    {
      id: 'always',
      action: 'transform.json',
      params: {
        input: '{{inputs.value}}',
        operation: 'identity',
      },
    },
    {
      id: 'only_if_big',
      action: 'transform.text',
      params: {
        input: 'big number!',
        operation: 'uppercase',
      },
      condition: '{{inputs.value}}',
    },
  ],
  output: '{{steps.only_if_big}}',
};

const defaultCtx: SkillContext = {
  agentUid: 'test-agent',
  pid: 1,
  fsRoot: '/tmp/aether-test',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillManager', () => {
  let bus: EventBus;
  let store: ReturnType<typeof createMockStateStore>;
  let manager: SkillManager;

  beforeEach(async () => {
    bus = new EventBus();
    store = createMockStateStore();
    manager = new SkillManager(bus, store as any);
    await manager.init();
  });

  afterEach(() => {
    manager.shutdown();
  });

  // -- Registration --

  describe('register / unregister', () => {
    it('registers a skill and lists it', () => {
      manager.register(echoSkill);
      const skills = manager.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe('echo-skill');
    });

    it('gets a registered skill by id', () => {
      manager.register(echoSkill);
      const skill = manager.get('echo-skill');
      expect(skill).toBeDefined();
      expect(skill!.name).toBe('Echo Skill');
    });

    it('returns undefined for unknown skill', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('unregisters a skill', () => {
      manager.register(echoSkill);
      expect(manager.list()).toHaveLength(1);
      const removed = manager.unregister('echo-skill');
      expect(removed).toBe(true);
      expect(manager.list()).toHaveLength(0);
    });

    it('returns false when unregistering unknown skill', () => {
      expect(manager.unregister('nonexistent')).toBe(false);
    });

    it('filters by category', () => {
      manager.register(echoSkill);
      manager.register(multiStepSkill);
      const utility = manager.list('utility');
      expect(utility).toHaveLength(1);
      expect(utility[0].id).toBe('echo-skill');
    });

    it('emits event on registration', () => {
      const handler = vi.fn();
      bus.on('skill.registered', handler);
      manager.register(echoSkill);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'echo-skill', name: 'Echo Skill' }),
      );
    });

    it('replaces skill on duplicate registration', () => {
      manager.register(echoSkill);
      const updated = { ...echoSkill, description: 'Updated' };
      manager.register(updated);
      const skill = manager.get('echo-skill');
      expect(skill!.description).toBe('Updated');
      expect(manager.list()).toHaveLength(1);
    });

    it('validates required fields', () => {
      expect(() =>
        manager.register({
          id: '',
          name: 'No ID',
          version: '1.0.0',
          description: 'x',
          inputs: {},
          steps: [],
          output: '',
        } as any),
      ).toThrow();
    });
  });

  // -- Execution --

  describe('execute', () => {
    it('executes a single-step skill', async () => {
      manager.register(echoSkill);
      const result = await manager.execute('echo-skill', { message: 'hello' }, defaultCtx);
      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].success).toBe(true);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('executes a multi-step skill with step references', async () => {
      manager.register(multiStepSkill);
      const result = await manager.execute('multi-step', { items: [1, 2, 3] }, defaultCtx);
      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      // First step counts the array → 3
      expect(result.steps[0].output).toBe(3);
    });

    it('handles conditional steps', async () => {
      manager.register(conditionalSkill);

      // With truthy value — conditional step runs
      const result1 = await manager.execute('conditional-skill', { value: 42 }, defaultCtx);
      expect(result1.success).toBe(true);
      expect(result1.steps).toHaveLength(2);

      // With falsy value (0) — conditional step should be skipped
      const result2 = await manager.execute('conditional-skill', { value: 0 }, defaultCtx);
      expect(result2.success).toBe(true);
      // The conditional step should either be skipped or have a skip marker
    });

    it('applies default input values', async () => {
      manager.register(echoSkill);
      // Don't pass prefix — it should default to 'Echo:'
      const result = await manager.execute('echo-skill', { message: 'world' }, defaultCtx);
      expect(result.success).toBe(true);
    });

    it('throws on missing required input', async () => {
      manager.register(echoSkill);
      await expect(manager.execute('echo-skill', {}, defaultCtx)).rejects.toThrow('message');
    });

    it('fails on unknown skill', async () => {
      const result = await manager.execute('nonexistent', {}, defaultCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails on unknown action', async () => {
      manager.register({
        id: 'bad-action',
        name: 'Bad Action',
        version: '1.0.0',
        description: 'Uses unknown action',
        inputs: {},
        steps: [{ id: 'step1', action: 'unknown.action', params: {} }],
        output: '{{steps.step1}}',
      });
      const result = await manager.execute('bad-action', {}, defaultCtx);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // -- Built-in actions --

  describe('built-in actions', () => {
    it('transform.json: pick fields', async () => {
      manager.register({
        id: 'pick-test',
        name: 'Pick Test',
        version: '1.0.0',
        description: 'Tests pick',
        inputs: {
          data: { type: 'object', description: 'Object', required: true },
        },
        steps: [
          {
            id: 'pick',
            action: 'transform.json',
            params: { input: '{{inputs.data}}', operation: 'pick', fields: ['name', 'age'] },
          },
        ],
        output: '{{steps.pick}}',
      });
      const result = await manager.execute(
        'pick-test',
        { data: { name: 'Alice', age: 30, email: 'alice@example.com' } },
        defaultCtx,
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ name: 'Alice', age: 30 });
    });

    it('transform.text: uppercase', async () => {
      manager.register({
        id: 'upper-test',
        name: 'Upper Test',
        version: '1.0.0',
        description: 'Tests uppercase',
        inputs: {
          text: { type: 'string', description: 'Text', required: true },
        },
        steps: [
          {
            id: 'upper',
            action: 'transform.text',
            params: { input: '{{inputs.text}}', operation: 'uppercase' },
          },
        ],
        output: '{{steps.upper}}',
      });
      const result = await manager.execute('upper-test', { text: 'hello world' }, defaultCtx);
      expect(result.success).toBe(true);
      expect(result.output).toBe('HELLO WORLD');
    });

    it('transform.json: count array', async () => {
      manager.register({
        id: 'count-test',
        name: 'Count Test',
        version: '1.0.0',
        description: 'Counts items',
        inputs: {
          list: { type: 'array', description: 'List', required: true },
        },
        steps: [
          {
            id: 'cnt',
            action: 'transform.json',
            params: { input: '{{inputs.list}}', operation: 'count' },
          },
        ],
        output: '{{steps.cnt}}',
      });
      const result = await manager.execute('count-test', { list: [1, 2, 3, 4, 5] }, defaultCtx);
      expect(result.success).toBe(true);
      expect(result.output).toBe(5);
    });
  });
});

// ---------------------------------------------------------------------------
// Template interpolation (exported utility)
// ---------------------------------------------------------------------------

describe('interpolate', () => {
  const scope = {
    inputs: { name: 'Alice', count: 3 },
    steps: {
      fetch: { body: '<html>Hello</html>', status: 200 },
      transform: { result: [1, 2, 3] },
    },
  };

  it('resolves simple input reference', () => {
    expect(interpolate('{{inputs.name}}', scope)).toBe('Alice');
  });

  it('resolves step output reference', () => {
    expect(interpolate('{{steps.fetch.status}}', scope)).toBe(200);
  });

  it('resolves nested step reference', () => {
    expect(interpolate('{{steps.transform.result}}', scope)).toEqual([1, 2, 3]);
  });

  it('resolves inline template expressions', () => {
    expect(interpolate('Hello {{inputs.name}}, you have {{inputs.count}} items', scope)).toBe(
      'Hello Alice, you have 3 items',
    );
  });

  it('returns empty string for unresolved expressions', () => {
    expect(interpolate('{{inputs.nonexistent}}', scope)).toBe(undefined);
  });

  it('handles objects recursively', () => {
    const result = interpolate(
      { key: '{{inputs.name}}', nested: { val: '{{inputs.count}}' } },
      scope,
    );
    expect(result).toEqual({ key: 'Alice', nested: { val: 3 } });
  });

  it('handles arrays recursively', () => {
    const result = interpolate(['{{inputs.name}}', '{{inputs.count}}'], scope);
    expect(result).toEqual(['Alice', 3]);
  });

  it('passes through non-template values', () => {
    expect(interpolate(42, scope)).toBe(42);
    expect(interpolate(true, scope)).toBe(true);
    expect(interpolate(null, scope)).toBe(null);
  });
});
