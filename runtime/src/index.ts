export { runAgentLoop } from './AgentLoop.js';
export { createToolSet, getToolsForAgent } from './tools.js';
export type { ToolDefinition, ToolResult, ToolContext } from './tools.js';

// LLM provider exports
export { getProvider, getProviderFromModelString, listProviders, parseModelString } from './llm/index.js';
export type { LLMProvider, ChatMessage, LLMResponse, ToolCall } from './llm/index.js';
export { GeminiProvider } from './llm/GeminiProvider.js';
export { OpenAIProvider } from './llm/OpenAIProvider.js';
export { AnthropicProvider } from './llm/AnthropicProvider.js';
export { OllamaProvider } from './llm/OllamaProvider.js';

// Agent templates
export { AGENT_TEMPLATES, getTemplate, getTemplatesByCategory } from './templates.js';
export type { AgentTemplate } from './templates.js';
