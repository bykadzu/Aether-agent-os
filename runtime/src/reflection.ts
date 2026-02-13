/**
 * Aether Runtime - Self-Reflection System (v0.3 Wave 2, Feature #5)
 *
 * After an agent completes a task, the reflection system:
 * 1. Sends the task summary to the LLM for self-evaluation
 * 2. Parses a quality rating (1-5) and justification from the response
 * 3. Stores the reflection as procedural memory (importance=0.8)
 * 4. Persists the reflection record to the database
 *
 * Reflection runs after the `complete` tool, before process exit.
 * It is async and fire-and-forget with a timeout to avoid blocking shutdown.
 */

import * as crypto from 'node:crypto';
import type { Kernel } from '@aether/kernel';
import type { PID, AgentConfig, ReflectionRecord } from '@aether/shared';
import type { LLMProvider, ChatMessage } from './llm/index.js';

/** Timeout for the reflection LLM call (15 seconds) */
const REFLECTION_TIMEOUT_MS = 15_000;

/**
 * The hardcoded reflection prompt template.
 * The LLM should respond with a structured JSON block.
 */
const REFLECTION_PROMPT = `You are a reflective AI agent evaluating your own performance on a task.

Given the task details below, provide an honest self-assessment.

IMPORTANT: Respond ONLY with a valid JSON object in this exact format:
{
  "quality_rating": <number 1-5>,
  "justification": "<why you gave this rating>",
  "lessons_learned": "<what you would do differently next time>",
  "summary": "<brief summary of what you did>",
  "reusable_pattern": "<describe the reusable procedure if one exists, or null if not>",
  "skill_suggestion": {
    "name": "<skill-identifier-lowercase-hyphens>",
    "description": "<one-line description>",
    "instructions": "<step-by-step markdown instructions>",
    "tools_used": ["<tool1>", "<tool2>"]
  }
}

Rating scale:
1 = Failed completely, did not achieve the goal
2 = Partially completed with significant issues
3 = Completed adequately but with room for improvement
4 = Completed well with minor issues
5 = Completed excellently, efficient and thorough

If you identified a reusable procedure that could help with similar future tasks, describe it in "reusable_pattern" and provide a skill suggestion. If not, set both to null.

Task details:
- Role: {role}
- Goal: {goal}
- Steps taken: {steps}
- Final observation: {lastObservation}
`;

export interface ReflectionInput {
  pid: PID;
  agentUid: string;
  config: AgentConfig;
  steps: number;
  lastObservation: string;
}

export interface SkillSuggestion {
  name: string;
  description: string;
  instructions: string;
  tools_used: string[];
}

export interface ReflectionResult {
  quality_rating: number;
  justification: string;
  lessons_learned: string;
  summary: string;
  reusable_pattern: string | null;
  skill_suggestion: SkillSuggestion | null;
}

/**
 * Parse a reflection response from the LLM.
 * Attempts to extract JSON from the response, with fallback defaults.
 */
export function parseReflectionResponse(content: string): ReflectionResult {
  // Try to parse as JSON directly
  try {
    const parsed = JSON.parse(content);
    return validateReflectionResult(parsed);
  } catch {
    // Not direct JSON — try to extract JSON from markdown code block or text
  }

  // Try to extract JSON from code blocks
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      return validateReflectionResult(parsed);
    } catch {
      // Continue to fallback
    }
  }

  // Try to find JSON object in the text
  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      return validateReflectionResult(parsed);
    } catch {
      // Continue to fallback
    }
  }

  // Fallback: couldn't parse, return a default reflection
  return {
    quality_rating: 3,
    justification: 'Unable to parse structured reflection from LLM response.',
    lessons_learned: content.substring(0, 500),
    summary: 'Task completed but reflection parsing failed.',
    reusable_pattern: null,
    skill_suggestion: null,
  };
}

/**
 * Validate a skill suggestion object from parsed reflection JSON.
 */
function validateSkillSuggestion(raw: any): SkillSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.name || !raw.description || !raw.instructions) return null;
  return {
    name: String(raw.name),
    description: String(raw.description),
    instructions: String(raw.instructions),
    tools_used: Array.isArray(raw.tools_used) ? raw.tools_used.map(String) : [],
  };
}

/**
 * Validate and normalize a parsed reflection result.
 */
function validateReflectionResult(parsed: any): ReflectionResult {
  const rating = Number(parsed.quality_rating);
  return {
    quality_rating: isNaN(rating) ? 3 : Math.max(1, Math.min(5, Math.round(rating))),
    justification: String(parsed.justification || 'No justification provided.'),
    lessons_learned: String(parsed.lessons_learned || ''),
    summary: String(parsed.summary || 'Task completed.'),
    reusable_pattern: typeof parsed.reusable_pattern === 'string' ? parsed.reusable_pattern : null,
    skill_suggestion: validateSkillSuggestion(parsed.skill_suggestion),
  };
}

/**
 * Build the reflection prompt with task details filled in.
 */
export function buildReflectionPrompt(input: ReflectionInput, config: AgentConfig): string {
  return REFLECTION_PROMPT.replace('{role}', config.role || 'Agent')
    .replace('{goal}', config.goal || 'Unknown')
    .replace('{steps}', String(input.steps))
    .replace('{lastObservation}', (input.lastObservation || 'None').substring(0, 500));
}

/**
 * Run self-reflection after task completion.
 * This is called by AgentLoop after the `complete` tool executes.
 *
 * Fire-and-forget with timeout — should not block process exit.
 */
export async function runReflection(
  kernel: Kernel,
  provider: LLMProvider | null,
  input: ReflectionInput,
  config: AgentConfig,
): Promise<ReflectionRecord | null> {
  if (!provider || !provider.isAvailable()) {
    // No LLM available — store a basic reflection without LLM evaluation
    return storeReflection(kernel, input, config, {
      quality_rating: 3,
      justification: 'No LLM available for self-evaluation.',
      lessons_learned: '',
      summary: `Completed task: ${config.goal}`,
      reusable_pattern: null,
      skill_suggestion: null,
    });
  }

  try {
    // Create an abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REFLECTION_TIMEOUT_MS);

    const prompt = buildReflectionPrompt(input, config);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a self-reflective AI agent.' },
      { role: 'user', content: prompt },
    ];

    const response = await Promise.race([
      provider.chat(messages, []),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Reflection timeout')));
      }),
    ]);

    clearTimeout(timeoutId);

    const result = parseReflectionResponse(response.content || '');
    return storeReflection(kernel, input, config, result);
  } catch (err: any) {
    console.warn(`[Reflection] Failed for PID ${input.pid}: ${err.message}`);

    // Store a fallback reflection on error
    return storeReflection(kernel, input, config, {
      quality_rating: 3,
      justification: `Reflection failed: ${err.message}`,
      lessons_learned: '',
      summary: `Completed task: ${config.goal}`,
      reusable_pattern: null,
      skill_suggestion: null,
    });
  }
}

/**
 * Store a reflection record in the database and as procedural memory.
 */
function storeReflection(
  kernel: Kernel,
  input: ReflectionInput,
  config: AgentConfig,
  result: ReflectionResult,
): ReflectionRecord {
  const id = crypto.randomUUID();
  const now = Date.now();

  const record: ReflectionRecord = {
    id,
    agent_uid: input.agentUid,
    pid: input.pid,
    goal: config.goal,
    summary: result.summary,
    quality_rating: result.quality_rating,
    justification: result.justification,
    lessons_learned: result.lessons_learned,
    created_at: now,
  };

  // Store in agent_reflections table
  kernel.state.insertReflection({
    id: record.id,
    agent_uid: record.agent_uid,
    pid: record.pid,
    goal: record.goal,
    summary: record.summary,
    quality_rating: record.quality_rating,
    justification: record.justification,
    lessons_learned: record.lessons_learned,
    created_at: record.created_at,
  });

  // Also store as procedural memory for cross-session learning
  if (kernel.memory) {
    try {
      kernel.memory.store({
        agent_uid: input.agentUid,
        layer: 'procedural',
        content: `[Reflection] Task: ${config.goal}\nRating: ${result.quality_rating}/5\n${result.justification}\nLessons: ${result.lessons_learned}`,
        tags: ['reflection', 'post-task'],
        importance: 0.8,
        source_pid: input.pid,
      });
    } catch (err) {
      console.warn(`[Reflection] Failed to store procedural memory:`, err);
    }
  }

  // Emit event
  kernel.bus.emit('reflection.stored', { reflection: record });

  // Auto-propose skill from reflection (v0.7 Sprint 3)
  if (
    result.reusable_pattern &&
    result.quality_rating >= 4 &&
    result.skill_suggestion &&
    kernel.skillForge
  ) {
    try {
      const { proposalId } = kernel.skillForge.propose(result.skill_suggestion, input.agentUid);
      kernel.bus.emit('reflection.skill.proposed', {
        proposalId,
        agentUid: input.agentUid,
        skillName: result.skill_suggestion.name,
      });
    } catch (err) {
      console.warn(`[Reflection] Failed to propose skill:`, err);
    }
  }

  // Update agent profile with task outcome (v0.3 Wave 4)
  if (kernel.memory) {
    try {
      kernel.memory.updateProfileAfterTask(input.agentUid, {
        success: result.quality_rating >= 3,
        steps: input.steps,
        quality_rating: result.quality_rating,
        goal: config.goal,
        tags: config.goal
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 5),
      });
    } catch (err) {
      console.warn(`[Reflection] Failed to update profile:`, err);
    }
  }

  return record;
}
