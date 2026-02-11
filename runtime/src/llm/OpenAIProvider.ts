/**
 * Aether Runtime - OpenAI LLM Provider
 *
 * Wraps the OpenAI API to implement the LLMProvider interface.
 * Supports GPT-5.x, GPT-4o, and legacy models via function calling.
 */

import type {
  LLMProvider,
  ChatMessage,
  LLMResponse,
  ToolDefinition,
  ToolCall,
} from './LLMProvider.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private model: string;

  constructor(model?: string) {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.model = model || 'gpt-5.2';
  }

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    // Map messages to OpenAI format
    const openaiMessages = messages.map((msg) => this.toOpenAIMessage(msg));

    // Map tools to OpenAI function calling format
    const openaiTools = tools.map((tool) => ({
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
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  supportsVision(): boolean {
    return true; // GPT-5.x / GPT-4o models support vision
  }

  async analyzeImage(imageBase64: string, prompt: string): Promise<LLMResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model || 'gpt-5.2',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${imageBase64}` },
              },
              {
                type: 'text',
                text: prompt || 'Describe what you see in this image in detail.',
              },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || 'No description generated.',
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens || 0,
            outputTokens: data.usage.completion_tokens || 0,
          }
        : undefined,
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
        tool_calls: msg.toolCalls.map((tc) => ({
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
