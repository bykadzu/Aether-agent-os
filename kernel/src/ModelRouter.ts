/**
 * Aether Kernel - Model Router (v0.5 Phase 2)
 *
 * Smart routing of LLM requests to the appropriate model family
 * based on the tools being used, step count, and task complexity.
 *
 * Model families:
 * - flash: fast, cheap models for simple tasks (file I/O, queries)
 * - standard: balanced models for general-purpose work
 * - frontier: most capable models for complex reasoning (code gen, browser)
 *
 * The router does NOT import or instantiate LLM providers — it only
 * returns a ModelFamily string for the caller to resolve.
 */

import type {
  ModelFamily,
  ModelRoutingRule,
  ModelRouterConfig,
  ModelRoutingContext,
} from '@aether/shared';

/** Tools that indicate simple, low-complexity work */
const FLASH_TOOLS = new Set([
  'file_read',
  'file_write',
  'memory_query',
  'file_list',
  'list_files',
  'read_file',
  'write_file',
  'think',
  'recall',
  'remember',
]);

/** Tools that indicate complex reasoning is needed */
const FRONTIER_CODE_TOOLS = new Set(['code_generate', 'code_analyze', 'code_review']);

/** Tools that indicate browser automation (complex) */
const FRONTIER_BROWSER_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_extract',
  'browser_screenshot',
]);

const DEFAULT_RULES: ModelRoutingRule[] = [
  {
    pattern: 'flash-only-tools',
    tools: [...FLASH_TOOLS],
    family: 'flash',
  },
  {
    pattern: 'code-tools',
    tools: [...FRONTIER_CODE_TOOLS],
    family: 'frontier',
  },
  {
    pattern: 'browser-tools',
    tools: [...FRONTIER_BROWSER_TOOLS],
    family: 'frontier',
  },
  {
    pattern: 'early-steps-simple',
    maxSteps: 5,
    family: 'flash',
  },
];

export class ModelRouter {
  private rules: ModelRoutingRule[];
  private defaultFamily: ModelFamily;

  constructor(config?: ModelRouterConfig) {
    this.rules = config?.rules ?? [...DEFAULT_RULES];
    this.defaultFamily = config?.defaultFamily ?? 'standard';
  }

  /**
   * Determine the best model family for the given context.
   */
  route(context: ModelRoutingContext): ModelFamily {
    const toolSet = new Set(context.tools);

    for (const rule of this.rules) {
      if (this.matchesRule(rule, toolSet, context)) {
        return rule.family;
      }
    }

    return this.defaultFamily;
  }

  private matchesRule(
    rule: ModelRoutingRule,
    toolSet: Set<string>,
    context: ModelRoutingContext,
  ): boolean {
    // Rule with tools: check if all agent tools are a subset of the rule's tool list
    if (rule.tools && rule.tools.length > 0) {
      if (toolSet.size === 0) return false;

      const ruleToolSet = new Set(rule.tools);

      // For flash rules, all tools must be in the flash set
      if (rule.family === 'flash') {
        for (const tool of toolSet) {
          if (!ruleToolSet.has(tool)) return false;
        }
        return true;
      }

      // For frontier rules, at least one tool must match
      for (const tool of toolSet) {
        if (ruleToolSet.has(tool)) return true;
      }
      return false;
    }

    // Rule with maxSteps: only apply when step count is below threshold
    if (rule.maxSteps !== undefined) {
      if (context.stepCount < rule.maxSteps) {
        // For early-steps rules, also check there are no complex tools
        const hasComplexTool = [...toolSet].some(
          (t) => FRONTIER_CODE_TOOLS.has(t) || FRONTIER_BROWSER_TOOLS.has(t),
        );
        if (!hasComplexTool) return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Add a custom routing rule (appended to the end).
   */
  addRule(rule: ModelRoutingRule): void {
    this.rules.push(rule);
  }

  /**
   * Get all current routing rules.
   */
  getRules(): ModelRoutingRule[] {
    return [...this.rules];
  }

  /**
   * Shutdown — no-op for stateless router.
   */
  shutdown(): void {
    // No resources to clean up
  }
}
