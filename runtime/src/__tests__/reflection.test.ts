import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus, StateStore, MemoryManager } from '@aether/kernel';
import { parseReflectionResponse, buildReflectionPrompt, runReflection } from '../reflection.js';
import type { ReflectionInput } from '../reflection.js';
import type { AgentConfig } from '@aether/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('Self-Reflection System', () => {
  let bus: EventBus;
  let store: StateStore;
  let memory: MemoryManager;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join(
      '/tmp',
      `aether-reflection-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    memory = new MemoryManager(bus, store);
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // parseReflectionResponse
  // ---------------------------------------------------------------------------

  describe('parseReflectionResponse', () => {
    it('parses valid JSON response', () => {
      const json = JSON.stringify({
        quality_rating: 4,
        justification: 'Task completed efficiently.',
        lessons_learned: 'Could optimize the search step.',
        summary: 'Analyzed data and produced report.',
      });

      const result = parseReflectionResponse(json);
      expect(result.quality_rating).toBe(4);
      expect(result.justification).toBe('Task completed efficiently.');
      expect(result.lessons_learned).toBe('Could optimize the search step.');
      expect(result.summary).toBe('Analyzed data and produced report.');
    });

    it('parses JSON inside markdown code block', () => {
      const response =
        '```json\n{"quality_rating": 5, "justification": "Excellent work.", "lessons_learned": "None", "summary": "Done"}\n```';
      const result = parseReflectionResponse(response);
      expect(result.quality_rating).toBe(5);
      expect(result.justification).toBe('Excellent work.');
    });

    it('parses JSON embedded in surrounding text', () => {
      const response =
        'Here is my reflection:\n{"quality_rating": 2, "justification": "Struggled with the API.", "lessons_learned": "Read docs first.", "summary": "Partial completion."}\nEnd of reflection.';
      const result = parseReflectionResponse(response);
      expect(result.quality_rating).toBe(2);
      expect(result.justification).toBe('Struggled with the API.');
    });

    it('clamps rating to [1, 5] range', () => {
      const json = JSON.stringify({
        quality_rating: 10,
        justification: 'Over-rated',
        lessons_learned: '',
        summary: 'Done',
      });
      const result = parseReflectionResponse(json);
      expect(result.quality_rating).toBe(5);

      const json2 = JSON.stringify({
        quality_rating: -2,
        justification: 'Under-rated',
        lessons_learned: '',
        summary: 'Done',
      });
      const result2 = parseReflectionResponse(json2);
      expect(result2.quality_rating).toBe(1);
    });

    it('rounds non-integer ratings', () => {
      const json = JSON.stringify({
        quality_rating: 3.7,
        justification: 'OK',
        lessons_learned: '',
        summary: 'Done',
      });
      const result = parseReflectionResponse(json);
      expect(result.quality_rating).toBe(4);
    });

    it('returns fallback for completely unparseable response', () => {
      const result = parseReflectionResponse('This is just plain text with no JSON at all.');
      expect(result.quality_rating).toBe(3);
      expect(result.justification).toContain('Unable to parse');
    });

    it('handles missing fields with defaults', () => {
      const json = JSON.stringify({ quality_rating: 4 });
      const result = parseReflectionResponse(json);
      expect(result.quality_rating).toBe(4);
      expect(result.justification).toBe('No justification provided.');
      expect(result.summary).toBe('Task completed.');
    });

    it('handles NaN quality_rating', () => {
      const json = JSON.stringify({
        quality_rating: 'excellent',
        justification: 'Great',
        lessons_learned: '',
        summary: 'Done',
      });
      const result = parseReflectionResponse(json);
      expect(result.quality_rating).toBe(3); // fallback
    });
  });

  // ---------------------------------------------------------------------------
  // buildReflectionPrompt
  // ---------------------------------------------------------------------------

  describe('buildReflectionPrompt', () => {
    it('fills in template variables', () => {
      const input: ReflectionInput = {
        pid: 1,
        agentUid: 'agent_1',
        config: { role: 'Researcher', goal: 'Find papers on AI' } as AgentConfig,
        steps: 5,
        lastObservation: 'Found 3 relevant papers.',
      };

      const prompt = buildReflectionPrompt(input, input.config);
      expect(prompt).toContain('Researcher');
      expect(prompt).toContain('Find papers on AI');
      expect(prompt).toContain('5');
      expect(prompt).toContain('Found 3 relevant papers.');
    });

    it('handles missing values gracefully', () => {
      const input: ReflectionInput = {
        pid: 1,
        agentUid: 'agent_1',
        config: { role: '', goal: '' } as AgentConfig,
        steps: 0,
        lastObservation: '',
      };

      const prompt = buildReflectionPrompt(input, input.config);
      expect(prompt).toContain('None'); // lastObservation fallback
    });

    it('truncates long last observation', () => {
      const longObs = 'x'.repeat(1000);
      const input: ReflectionInput = {
        pid: 1,
        agentUid: 'agent_1',
        config: { role: 'Coder', goal: 'Code task' } as AgentConfig,
        steps: 3,
        lastObservation: longObs,
      };

      const prompt = buildReflectionPrompt(input, input.config);
      // The observation should be truncated to 500 chars within the prompt.
      // The full 1000-char string should NOT appear in the prompt.
      expect(prompt).not.toContain(longObs);
      // But 500 chars of it should be present
      expect(prompt).toContain('x'.repeat(500));
    });
  });

  // ---------------------------------------------------------------------------
  // runReflection — integration with StateStore + MemoryManager
  // ---------------------------------------------------------------------------

  describe('runReflection', () => {
    const mockConfig: AgentConfig = {
      role: 'Coder',
      goal: 'Build a REST API',
    };

    const mockInput: ReflectionInput = {
      pid: 42,
      agentUid: 'agent_coder',
      config: mockConfig,
      steps: 8,
      lastObservation: 'All tests passing. API deployed.',
    };

    // Mock kernel-like object with real StateStore and MemoryManager
    function createMockKernel() {
      return {
        state: store,
        memory: memory,
        bus: bus,
      } as any;
    }

    it('stores reflection when no LLM provider is available', async () => {
      const kernel = createMockKernel();
      const result = await runReflection(kernel, null, mockInput, mockConfig);

      expect(result).not.toBeNull();
      expect(result!.agent_uid).toBe('agent_coder');
      expect(result!.pid).toBe(42);
      expect(result!.goal).toBe('Build a REST API');
      expect(result!.quality_rating).toBe(3); // default when no LLM
      expect(result!.justification).toContain('No LLM available');
    });

    it('persists reflection to database', async () => {
      const kernel = createMockKernel();
      const result = await runReflection(kernel, null, mockInput, mockConfig);

      // Verify it's in the database
      const stored = store.getReflection(result!.id);
      expect(stored).toBeDefined();
      expect(stored.agent_uid).toBe('agent_coder');
      expect(stored.quality_rating).toBe(3);
    });

    it('stores reflection as procedural memory', async () => {
      const kernel = createMockKernel();
      await runReflection(kernel, null, mockInput, mockConfig);

      // Verify procedural memory was created
      const memories = memory.recall({
        agent_uid: 'agent_coder',
        layer: 'procedural',
        tags: ['reflection'],
      });
      expect(memories.length).toBeGreaterThan(0);
      expect(memories[0].tags).toContain('reflection');
      expect(memories[0].tags).toContain('post-task');
      expect(memories[0].importance).toBe(0.8);
    });

    it('emits reflection.stored event', async () => {
      const events: any[] = [];
      bus.on('reflection.stored', (data: any) => events.push(data));

      const kernel = createMockKernel();
      await runReflection(kernel, null, mockInput, mockConfig);

      expect(events).toHaveLength(1);
      expect(events[0].reflection.agent_uid).toBe('agent_coder');
    });

    it('uses LLM provider when available', async () => {
      const kernel = createMockKernel();

      // Create a mock LLM provider
      const mockProvider = {
        name: 'mock',
        isAvailable: () => true,
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            quality_rating: 5,
            justification: 'Excellent implementation.',
            lessons_learned: 'Test coverage was key.',
            summary: 'Built REST API with full test suite.',
          }),
        }),
      };

      const result = await runReflection(kernel, mockProvider as any, mockInput, mockConfig);

      expect(result).not.toBeNull();
      expect(result!.quality_rating).toBe(5);
      expect(result!.justification).toBe('Excellent implementation.');
      expect(result!.lessons_learned).toBe('Test coverage was key.');
      expect(mockProvider.chat).toHaveBeenCalledOnce();
    });

    it('handles LLM errors gracefully', async () => {
      const kernel = createMockKernel();

      const failingProvider = {
        name: 'failing',
        isAvailable: () => true,
        chat: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      };

      const result = await runReflection(kernel, failingProvider as any, mockInput, mockConfig);

      expect(result).not.toBeNull();
      expect(result!.quality_rating).toBe(3); // fallback
      expect(result!.justification).toContain('Reflection failed');
    });

    it('can retrieve reflections by agent_uid', async () => {
      const kernel = createMockKernel();
      await runReflection(kernel, null, mockInput, mockConfig);

      const reflections = store.getReflectionsByAgent('agent_coder');
      expect(reflections).toHaveLength(1);
      expect(reflections[0].agent_uid).toBe('agent_coder');
    });

    it('can retrieve reflections by PID', async () => {
      const kernel = createMockKernel();
      await runReflection(kernel, null, mockInput, mockConfig);

      const reflections = store.getReflectionsByPid(42);
      expect(reflections).toHaveLength(1);
      expect(reflections[0].pid).toBe(42);
    });

    it('stores multiple reflections for the same agent', async () => {
      const kernel = createMockKernel();
      await runReflection(kernel, null, mockInput, mockConfig);
      await runReflection(kernel, null, { ...mockInput, pid: 43 }, mockConfig);

      const reflections = store.getReflectionsByAgent('agent_coder');
      expect(reflections).toHaveLength(2);
    });
  });
});
