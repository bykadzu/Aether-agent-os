export { runAgentLoop } from './AgentLoop.js';
export { createToolSet, getToolsForAgent } from './tools.js';
export type { ToolDefinition, ToolResult, ToolContext } from './tools.js';

// LLM provider exports
export {
  getProvider,
  getProviderFromModelString,
  listProviders,
  parseModelString,
} from './llm/index.js';
export type { LLMProvider, ChatMessage, LLMResponse, ToolCall } from './llm/index.js';
export { GeminiProvider } from './llm/GeminiProvider.js';
export { OpenAIProvider } from './llm/OpenAIProvider.js';
export { AnthropicProvider } from './llm/AnthropicProvider.js';
export { OllamaProvider } from './llm/OllamaProvider.js';

// Reflection (v0.3 Wave 2)
export { runReflection, parseReflectionResponse, buildReflectionPrompt } from './reflection.js';

// Planning (v0.3 Wave 2)
export {
  createPlan,
  getActivePlan,
  updatePlan,
  updateNodeStatus,
  renderPlanAsMarkdown,
  getPlanProgress,
} from './planner.js';

// Agent templates
export { AGENT_TEMPLATES, getTemplate, getTemplatesByCategory } from './templates.js';
export type { AgentTemplate } from './templates.js';
