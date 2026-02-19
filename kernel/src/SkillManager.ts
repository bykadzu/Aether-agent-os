/**
 * Aether Kernel - Skill Manager (v0.4)
 *
 * Manages lightweight, declarative tool definitions (skills) that agents
 * can load without full plugin infrastructure. Skills are defined via
 * YAML manifests with a step-based execution pipeline.
 *
 * Think of skills as "micro-plugins": a YAML manifest declares inputs,
 * a sequence of steps (actions), and an output template. The SkillManager
 * parses these definitions, validates inputs at execution time, runs
 * steps sequentially, and interpolates template expressions.
 *
 * Built-in actions:
 *   http.get, http.post    — HTTP requests
 *   llm.complete            — LLM text completion (stubbed)
 *   fs.read, fs.write       — Filesystem operations
 *   shell.exec              — Shell command execution
 *   transform.json          — JSON transformations (jq-like)
 *   transform.text          — Text transformations (regex, slice)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { StateStore } from './StateStore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInput {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: any;
}

export interface SkillStep {
  id: string;
  action: string;
  params: Record<string, any>;
  condition?: string; // optional: only run if expression is truthy
}

export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  inputs: Record<string, SkillInput>;
  steps: SkillStep[];
  output: string; // template expression
}

export interface SkillContext {
  agentUid: string;
  pid: number;
  fsRoot: string;
}

export interface SkillStepResult {
  id: string;
  action: string;
  duration: number;
  success: boolean;
  output: any;
}

export interface SkillExecutionResult {
  success: boolean;
  output: any;
  steps: SkillStepResult[];
  totalDuration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

/**
 * Recursively resolve `{{inputs.x}}` and `{{steps.id.field}}` references
 * in a value (string, object, or array).
 */
export function interpolate(
  value: any,
  scope: { inputs: Record<string, any>; steps: Record<string, any> },
): any {
  if (typeof value === 'string') {
    // Full-replacement case: the entire value is a single template expression
    const fullMatch = value.match(/^\{\{(.+?)\}\}$/);
    if (fullMatch) {
      const resolved = resolvePath(fullMatch[1].trim(), scope);
      return resolved;
    }

    // Inline replacement: replace each {{...}} occurrence within the string
    return value.replace(/\{\{(.+?)\}\}/g, (_match, expr) => {
      const resolved = resolvePath(expr.trim(), scope);
      return resolved === undefined ? '' : String(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, scope));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolate(v, scope);
    }
    return result;
  }

  return value;
}

/**
 * Resolve a dotted path like `inputs.url` or `steps.fetch.body` against
 * the scope object.
 */
function resolvePath(expr: string, scope: Record<string, any>): any {
  const parts = expr.split('.');
  let current: any = scope;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Built-in action handlers
// ---------------------------------------------------------------------------

type ActionHandler = (params: Record<string, any>, context: SkillContext) => Promise<any>;

function createBuiltinActions(): Record<string, ActionHandler> {
  return {
    'http.get': async (params) => {
      const url = params.url;
      const headers = params.headers || {};
      const response = await fetch(url, { method: 'GET', headers });
      const contentType = response.headers.get('content-type') || '';
      let body: any;
      if (contentType.includes('application/json')) {
        body = await response.json();
      } else {
        body = await response.text();
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    },

    'http.post': async (params) => {
      const url = params.url;
      const headers = params.headers || {};
      const requestBody = params.body;
      const isJson = typeof requestBody === 'object' && requestBody !== null;
      if (isJson && !headers['content-type'] && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: isJson ? JSON.stringify(requestBody) : String(requestBody),
      });
      const contentType = response.headers.get('content-type') || '';
      let body: any;
      if (contentType.includes('application/json')) {
        body = await response.json();
      } else {
        body = await response.text();
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    },

    'llm.complete': async (params) => {
      // In a production system this would call an LLM API.
      // For now, return a stub so the pipeline completes.
      const prompt = params.prompt || '';
      const model = params.model || 'default';
      return {
        text: `[LLM completion stub] model=${model} prompt_length=${prompt.length}`,
        model,
        tokens: 0,
      };
    },

    'fs.read': async (params, context) => {
      const filePath = params.path;
      const fullPath = filePath.startsWith('/') ? filePath : join(context.fsRoot, filePath);
      const content = readFileSync(fullPath, 'utf-8');
      return { path: filePath, content };
    },

    'fs.write': async (params, context) => {
      const filePath = params.path;
      const fullPath = filePath.startsWith('/') ? filePath : join(context.fsRoot, filePath);
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, params.content, 'utf-8');
      return { path: filePath, written: true, bytes: Buffer.byteLength(params.content) };
    },

    'shell.exec': async (params) => {
      const command = params.command;
      const timeout = params.timeout || 30_000;
      try {
        const stdout = execSync(command, {
          encoding: 'utf-8',
          timeout,
          maxBuffer: 1024 * 1024,
        });
        return { command, exitCode: 0, stdout: stdout.trim(), stderr: '' };
      } catch (err: unknown) {
        return {
          command,
          exitCode: err.status ?? 1,
          stdout: (err.stdout || '').trim(),
          stderr: (err.stderr || '').trim(),
        };
      }
    },

    'transform.json': async (params) => {
      const input = params.input;
      const operation = params.operation || 'identity';

      switch (operation) {
        case 'pick': {
          const fields: string[] = params.fields || [];
          if (typeof input !== 'object' || input === null) return input;
          const result: Record<string, any> = {};
          for (const field of fields) {
            if (field in input) result[field] = input[field];
          }
          return result;
        }
        case 'pluck': {
          const field: string = params.field;
          if (!Array.isArray(input)) return [];
          return input.map((item: any) => item?.[field]);
        }
        case 'filter': {
          const field: string = params.field;
          const value: any = params.value;
          if (!Array.isArray(input)) return [];
          return input.filter((item: any) => item?.[field] === value);
        }
        case 'count': {
          if (Array.isArray(input)) return input.length;
          if (typeof input === 'object' && input !== null) return Object.keys(input).length;
          return 0;
        }
        case 'flatten': {
          if (Array.isArray(input)) return input.flat();
          return input;
        }
        case 'stringify': {
          return JSON.stringify(input, null, params.indent || 2);
        }
        case 'parse': {
          if (typeof input === 'string') return JSON.parse(input);
          return input;
        }
        case 'identity':
        default:
          return input;
      }
    },

    'transform.text': async (params) => {
      const input: string = String(params.input || '');
      const operation = params.operation || 'identity';

      switch (operation) {
        case 'uppercase':
          return input.toUpperCase();
        case 'lowercase':
          return input.toLowerCase();
        case 'trim':
          return input.trim();
        case 'split': {
          const delimiter = params.delimiter || '\n';
          return input.split(delimiter);
        }
        case 'join': {
          if (!Array.isArray(params.input)) return input;
          const sep = params.separator || '\n';
          return (params.input as string[]).join(sep);
        }
        case 'replace': {
          const pattern = params.pattern || '';
          const replacement = params.replacement || '';
          if (params.regex) {
            const flags = params.flags || 'g';
            return input.replace(new RegExp(pattern, flags), replacement);
          }
          return input.replaceAll(pattern, replacement);
        }
        case 'slice': {
          const start = params.start || 0;
          const end = params.end;
          return end !== undefined ? input.slice(start, end) : input.slice(start);
        }
        case 'lines': {
          return input.split('\n');
        }
        case 'identity':
        default:
          return input;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Skill Manager
// ---------------------------------------------------------------------------

export class SkillManager {
  private skills = new Map<string, SkillDefinition>();
  private bus: EventBus;
  private state: StateStore;
  private actions: Record<string, ActionHandler>;

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
    this.actions = createBuiltinActions();
  }

  /**
   * Initialize the skill manager. Creates the skills table in StateStore
   * if it doesn't exist.
   */
  async init(): Promise<void> {
    this.state.ensureSkillsTable();
    // Load persisted skills from the database
    const rows = this.state.getAllSkills();
    for (const row of rows) {
      try {
        const def: SkillDefinition = JSON.parse(row.definition);
        this.skills.set(def.id, def);
      } catch {
        console.error(`[SkillManager] Failed to parse persisted skill: ${row.id}`);
      }
    }
  }

  /**
   * Register a new skill definition.
   */
  register(skillDef: SkillDefinition): SkillDefinition {
    // Validate required fields
    if (!skillDef.id || !skillDef.name || !skillDef.version) {
      throw new Error('Skill must have id, name, and version');
    }
    if (!skillDef.steps || !Array.isArray(skillDef.steps) || skillDef.steps.length === 0) {
      throw new Error('Skill must have at least one step');
    }
    if (!skillDef.output) {
      throw new Error('Skill must have an output template');
    }
    if (!skillDef.inputs) {
      skillDef.inputs = {};
    }

    // Validate step IDs are unique
    const stepIds = new Set<string>();
    for (const step of skillDef.steps) {
      if (!step.id || !step.action) {
        throw new Error(`Each step must have an id and action`);
      }
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step id: ${step.id}`);
      }
      stepIds.add(step.id);
    }

    this.skills.set(skillDef.id, skillDef);

    // Persist to database
    this.state.upsertSkill({
      id: skillDef.id,
      name: skillDef.name,
      version: skillDef.version,
      description: skillDef.description || '',
      author: skillDef.author || '',
      category: skillDef.category || '',
      tags: JSON.stringify(skillDef.tags || []),
      definition: JSON.stringify(skillDef),
      created_at: Date.now(),
    });

    this.bus.emit('skill.registered', {
      id: skillDef.id,
      name: skillDef.name,
      version: skillDef.version,
    });

    return skillDef;
  }

  /**
   * Unregister a skill by id.
   */
  unregister(skillId: string): boolean {
    const existed = this.skills.delete(skillId);
    if (existed) {
      this.state.deleteSkill(skillId);
      this.bus.emit('skill.unregistered', { id: skillId });
    }
    return existed;
  }

  /**
   * List all registered skills, optionally filtered by category.
   */
  list(category?: string): SkillDefinition[] {
    const all = Array.from(this.skills.values());
    if (category) {
      return all.filter((s) => s.category === category);
    }
    return all;
  }

  /**
   * Get a single skill definition by id.
   */
  get(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Execute a skill by running its steps sequentially.
   */
  async execute(
    skillId: string,
    inputs: Record<string, any>,
    context: SkillContext,
  ): Promise<SkillExecutionResult> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        output: null,
        steps: [],
        totalDuration: 0,
        error: `Skill not found: ${skillId}`,
      };
    }

    const startTime = Date.now();
    const stepResults: SkillStepResult[] = [];
    const stepOutputs: Record<string, any> = {};

    // Validate and apply default inputs
    const resolvedInputs = this.resolveInputs(skill, inputs);

    const scope = {
      inputs: resolvedInputs,
      steps: stepOutputs,
    };

    this.bus.emit('skill.execution.started', {
      skillId,
      agentUid: context.agentUid,
      pid: context.pid,
    });

    for (const step of skill.steps) {
      // Check condition
      if (step.condition) {
        const conditionValue = interpolate(step.condition, scope);
        if (!conditionValue || conditionValue === 'false' || conditionValue === '0') {
          stepResults.push({
            id: step.id,
            action: step.action,
            duration: 0,
            success: true,
            output: null,
          });
          stepOutputs[step.id] = null;
          continue;
        }
      }

      // Interpolate params
      const resolvedParams = interpolate(step.params, scope);

      const stepStart = Date.now();
      try {
        const handler = this.actions[step.action];
        if (!handler) {
          throw new Error(`Unknown action: ${step.action}`);
        }

        const output = await handler(resolvedParams, context);
        const duration = Date.now() - stepStart;

        stepOutputs[step.id] = output;
        stepResults.push({
          id: step.id,
          action: step.action,
          duration,
          success: true,
          output,
        });
      } catch (err: unknown) {
        const duration = Date.now() - stepStart;
        stepResults.push({
          id: step.id,
          action: step.action,
          duration,
          success: false,
          output: null,
        });

        const totalDuration = Date.now() - startTime;
        const error = `Step "${step.id}" (${step.action}) failed: ${errMsg(err)}`;

        this.bus.emit('skill.execution.failed', {
          skillId,
          stepId: step.id,
          error: errMsg(err),
          agentUid: context.agentUid,
        });

        return {
          success: false,
          output: null,
          steps: stepResults,
          totalDuration,
          error,
        };
      }
    }

    // Resolve output template
    const output = interpolate(skill.output, scope);
    const totalDuration = Date.now() - startTime;

    this.bus.emit('skill.execution.completed', {
      skillId,
      agentUid: context.agentUid,
      pid: context.pid,
      totalDuration,
    });

    return {
      success: true,
      output,
      steps: stepResults,
      totalDuration,
    };
  }

  /**
   * Scan a directory for skill.yaml files and register them.
   * Returns the number of skills loaded.
   */
  loadFromDirectory(dirPath: string): number {
    if (!existsSync(dirPath)) {
      return 0;
    }

    let count = 0;
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      // Accept both .yaml and .yml extensions
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
        continue;
      }

      const filePath = join(dirPath, entry);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const skillDef = parseSkillYaml(content);
        this.register(skillDef);
        count++;
      } catch (err: unknown) {
        console.error(`[SkillManager] Failed to load skill from ${filePath}: ${errMsg(err)}`);
        this.bus.emit('skill.load.error', {
          file: filePath,
          error: errMsg(err),
        });
      }
    }

    return count;
  }

  /**
   * Register a custom action handler that skills can reference.
   */
  registerAction(name: string, handler: ActionHandler): void {
    this.actions[name] = handler;
  }

  /**
   * Shutdown the skill manager.
   */
  shutdown(): void {
    this.skills.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Validate inputs against the skill definition and apply defaults.
   */
  private resolveInputs(skill: SkillDefinition, inputs: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [name, def] of Object.entries(skill.inputs)) {
      if (inputs[name] !== undefined) {
        resolved[name] = inputs[name];
      } else if (def.default !== undefined) {
        resolved[name] = def.default;
      } else if (def.required) {
        throw new Error(`Missing required input: ${name}`);
      }
    }

    // Pass through any extra inputs not in the definition
    for (const [name, value] of Object.entries(inputs)) {
      if (!(name in resolved)) {
        resolved[name] = value;
      }
    }

    return resolved;
  }
}

// ---------------------------------------------------------------------------
// YAML Parser (lightweight — no dependency required)
// ---------------------------------------------------------------------------

/**
 * Parse a skill YAML file into a SkillDefinition.
 *
 * This is a lightweight YAML parser that handles the subset of YAML
 * used by skill definitions (scalars, maps, sequences, string templates).
 * For production use with complex YAML, consider js-yaml.
 */
export function parseSkillYaml(content: string): SkillDefinition {
  // We use a simple line-based parser that handles the skill YAML format.
  const lines = content.split('\n');
  const result: any = {};
  const stack: Array<{ indent: number; obj: any; key?: string }> = [{ indent: -1, obj: result }];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;

    // Skip empty lines and comments
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Determine indent level
    const indent = line.length - line.trimStart().length;

    // Pop stack to find parent at correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    // Handle list items
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2).trim();
      const parentObj = parent.obj;

      // Determine which array to add to
      let targetArray: any[];
      if (Array.isArray(parentObj)) {
        targetArray = parentObj;
      } else if (parent.key && Array.isArray(parentObj[parent.key])) {
        targetArray = parentObj[parent.key];
      } else if (parent.key) {
        parentObj[parent.key] = [];
        targetArray = parentObj[parent.key];
      } else {
        continue;
      }

      // Check if this is a mapping item (has colon)
      if (itemContent.includes(':')) {
        const mapItem: any = {};
        const [firstKey, ...restParts] = itemContent.split(':');
        const firstValue = restParts.join(':').trim();
        mapItem[firstKey.trim()] = parseYamlValue(firstValue);
        targetArray.push(mapItem);

        // Read continuation lines for this map item
        const itemIndent = indent + 2;
        stack.push({ indent: indent + 1, obj: mapItem });

        while (i < lines.length) {
          const nextLine = lines[i];
          const nextTrimmed = nextLine.trimStart();
          if (nextTrimmed === '' || nextTrimmed.startsWith('#')) {
            i++;
            continue;
          }
          const nextIndent = nextLine.length - nextTrimmed.length;
          if (nextIndent < itemIndent) break;
          if (nextTrimmed.startsWith('- ')) break;

          // Parse key: value
          const colonIdx = nextTrimmed.indexOf(':');
          if (colonIdx > 0) {
            const key = nextTrimmed.slice(0, colonIdx).trim();
            const val = nextTrimmed.slice(colonIdx + 1).trim();
            mapItem[key] = parseYamlValue(val);

            // Check if next lines are nested under this key
            if (val === '' || val === '|' || val === '>') {
              if (val === '|' || val === '>') {
                // Multi-line string
                let multiline = '';
                const blockIndent = nextIndent + 2;
                while (i + 1 < lines.length) {
                  const blockLine = lines[i + 1];
                  const blockTrimmed = blockLine.trimStart();
                  const blockLineIndent = blockLine.length - blockTrimmed.length;
                  if (blockTrimmed === '') {
                    if (val === '|') multiline += '\n';
                    i++;
                    continue;
                  }
                  if (blockLineIndent < blockIndent) break;
                  multiline += (multiline ? (val === '|' ? '\n' : ' ') : '') + blockTrimmed;
                  i++;
                }
                mapItem[key] = multiline;
              }
            }
          }
          i++;
        }
      } else {
        // Simple scalar list item
        targetArray.push(parseYamlValue(itemContent));
      }
      continue;
    }

    // Handle key: value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();

      if (rawValue === '' || rawValue === '|' || rawValue === '>') {
        if (rawValue === '|' || rawValue === '>') {
          // Multi-line string
          let multiline = '';
          const blockIndent = indent + 2;
          while (i < lines.length) {
            const blockLine = lines[i];
            const blockTrimmed = blockLine.trimStart();
            const blockLineIndent = blockLine.length - blockTrimmed.length;
            if (blockTrimmed === '') {
              if (rawValue === '|') multiline += '\n';
              i++;
              continue;
            }
            if (blockLineIndent < blockIndent) break;
            multiline += (multiline ? (rawValue === '|' ? '\n' : ' ') : '') + blockTrimmed;
            i++;
          }
          parent.obj[key] = multiline;
        } else {
          // Nested object or array — peek at next non-empty line
          let nextNonEmpty = i;
          while (nextNonEmpty < lines.length) {
            const peekTrimmed = lines[nextNonEmpty].trimStart();
            if (peekTrimmed !== '' && !peekTrimmed.startsWith('#')) break;
            nextNonEmpty++;
          }

          if (nextNonEmpty < lines.length && lines[nextNonEmpty].trimStart().startsWith('- ')) {
            parent.obj[key] = [];
            stack.push({ indent, obj: parent.obj, key });
          } else {
            parent.obj[key] = {};
            stack.push({ indent, obj: parent.obj[key] });
          }
        }
      } else {
        parent.obj[key] = parseYamlValue(rawValue);
      }
    }
  }

  // Transform the parsed result into a SkillDefinition
  return normalizeSkillDef(result);
}

/**
 * Parse a simple YAML scalar value.
 */
function parseYamlValue(raw: string): any {
  if (raw === '' || raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Remove surrounding quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Try numeric
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);

  return raw;
}

/**
 * Normalize raw parsed YAML into a proper SkillDefinition.
 */
function normalizeSkillDef(raw: any): SkillDefinition {
  const def: SkillDefinition = {
    id: raw.id || raw.name || '',
    name: raw.name || '',
    version: raw.version || '1.0.0',
    description: raw.description || '',
    author: raw.author,
    category: raw.category,
    tags: raw.tags || [],
    inputs: {},
    steps: [],
    output: raw.output || '',
  };

  // Normalize inputs
  if (raw.inputs && typeof raw.inputs === 'object') {
    for (const [name, inputDef] of Object.entries(raw.inputs as Record<string, any>)) {
      if (typeof inputDef === 'object' && inputDef !== null) {
        def.inputs[name] = {
          type: inputDef.type || 'string',
          description: inputDef.description || '',
          required: inputDef.required === true || inputDef.required === 'true',
          default: inputDef.default,
        };
      }
    }
  }

  // Normalize steps
  if (Array.isArray(raw.steps)) {
    def.steps = raw.steps.map((step: any) => {
      const normalized: SkillStep = {
        id: step.id || '',
        action: step.action || '',
        params: {},
      };
      if (step.condition) {
        normalized.condition = step.condition;
      }
      // Collect params — everything other than id, action, condition
      if (step.params && typeof step.params === 'object') {
        normalized.params = step.params;
      } else {
        // Some YAML formats inline params as top-level step keys
        for (const [k, v] of Object.entries(step)) {
          if (k !== 'id' && k !== 'action' && k !== 'condition' && k !== 'params') {
            normalized.params[k] = v;
          }
        }
      }
      return normalized;
    });
  }

  return def;
}
