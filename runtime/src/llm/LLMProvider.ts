/**
 * Aether Runtime - LLM Provider Interface
 *
 * Defines the contract that all LLM providers must implement.
 * This abstraction allows agents to use different LLM backends
 * (Gemini, OpenAI, Anthropic, Ollama) interchangeably.
 */

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;
  isAvailable(): boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}
