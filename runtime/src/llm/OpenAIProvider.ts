/**
 * Aether Runtime - OpenAI LLM Provider
 *
 * Wraps the OpenAI API to implement the LLMProvider interface.
 * Supports gpt-4o, gpt-4o-mini, gpt-3.5-turbo via function calling.
 */

import type { LLMProvider, ChatMessage, LLMResponse, ToolDefinition, ToolCall } from './LLMProvider.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private model: string;

  constructor(model?: string) {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = model || 'gpt-4o';
  }

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    // Map messages to OpenAI format
    const openaiMessages = messages.map(msg => this.toOpenAIMessage(msg));

    // Map tools to OpenAI function calling format
    const openaiTools = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const response = await client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        });
      }
    }

    return {
      content: choice.message.content || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  }

  private toOpenAIMessage(msg: ChatMessage): any {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId || 'unknown',
      };
    }
    if (msg.role === 'assistant' && msg.toolCalls) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  }
}
