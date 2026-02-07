/**
 * Aether Runtime - LLM Provider Registry
 *
 * Central registry for all LLM providers. Handles provider selection,
 * model string parsing ("provider:model"), and availability checking.
 */

export type { LLMProvider, ChatMessage, LLMResponse, ToolDefinition, ToolCall } from './LLMProvider.js';

import type { LLMProvider } from './LLMProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OllamaProvider } from './OllamaProvider.js';

export { GeminiProvider } from './GeminiProvider.js';
export { OpenAIProvider } from './OpenAIProvider.js';
export { AnthropicProvider } from './AnthropicProvider.js';
export { OllamaProvider } from './OllamaProvider.js';

/**
 * Parse a model string in the format "provider:model" or just "model".
 * Returns the provider name and model name separately.
 */
export function parseModelString(modelStr?: string): { provider?: string; model?: string } {
  if (!modelStr) return {};
  const colonIdx = modelStr.indexOf(':');
  if (colonIdx === -1) {
    // No provider prefix — just a model name
    return { model: modelStr };
  }
  return {
    provider: modelStr.substring(0, colonIdx),
    model: modelStr.substring(colonIdx + 1),
  };
}

/**
 * Get a provider by name, optionally with a specific model.
 * Falls back to the first available provider if no name is specified.
 */
export function getProvider(name?: string, model?: string): LLMProvider | null {
  if (name) {
    switch (name.toLowerCase()) {
      case 'gemini':
        return new GeminiProvider(model);
      case 'openai':
        return new OpenAIProvider(model);
      case 'anthropic':
        return new AnthropicProvider(model);
      case 'ollama':
        return new OllamaProvider(model);
    }
  }

  // Auto-detect: return first available provider
  const gemini = new GeminiProvider(model);
  if (gemini.isAvailable()) return gemini;

  const openai = new OpenAIProvider(model);
  if (openai.isAvailable()) return openai;

  const anthropic = new AnthropicProvider(model);
  if (anthropic.isAvailable()) return anthropic;

  // Ollama is always "potentially" available, try it last
  return new OllamaProvider(model);
}

/**
 * Get a provider based on a model string like "gemini:flash" or "openai:gpt-4o".
 */
export function getProviderFromModelString(modelStr?: string): LLMProvider | null {
  const { provider, model } = parseModelString(modelStr);
  return getProvider(provider, model);
}

/**
 * List all providers and their availability status.
 */
export function listProviders(): Array<{
  name: string;
  available: boolean;
  models: string[];
}> {
  return [
    {
      name: 'gemini',
      available: new GeminiProvider().isAvailable(),
      models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    },
    {
      name: 'openai',
      available: new OpenAIProvider().isAvailable(),
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    },
    {
      name: 'anthropic',
      available: new AnthropicProvider().isAvailable(),
      models: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
    },
    {
      name: 'ollama',
      available: true, // Always potentially available
      models: [process.env.OLLAMA_MODEL || 'llama3.1'],
    },
  ];
}
