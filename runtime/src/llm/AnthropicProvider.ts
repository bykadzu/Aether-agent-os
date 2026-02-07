/**
 * Aether Runtime - Anthropic LLM Provider
 *
 * Wraps the Anthropic API to implement the LLMProvider interface.
 * Supports Claude models via tool_use content blocks.
 */

import type {
  LLMProvider,
  ChatMessage,
  LLMResponse,
  ToolDefinition,
  ToolCall,
} from './LLMProvider.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private model: string;

  constructor(model?: string) {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.model = model || 'claude-sonnet-4-5-20250929';
  }

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  supportsVision(): boolean {
    return true; // Claude models support vision
  }

  async analyzeImage(imageBase64: string, prompt: string): Promise<LLMResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model || 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: prompt || 'Describe what you see in this image in detail.',
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || data.error.type);

    const textContent = data.content?.find((c: any) => c.type === 'text');
    return {
      content: textContent?.text || 'No description generated.',
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens || 0,
            outputTokens: data.usage.output_tokens || 0,
          }
        : undefined,
    };
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    // Extract system message
    let systemPrompt = '';
    const anthropicMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
      } else if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const content: any[] = [];
          if (msg.content) content.push({ type: 'text', text: msg.content });
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          anthropicMessages.push({ role: 'assistant', content });
        } else {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || 'unknown',
              content: msg.content,
            },
          ],
        });
      }
    }

    // Ensure messages alternate correctly - Anthropic requires user first
    if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
      anthropicMessages.unshift({ role: 'user', content: 'Begin.' });
    }

    // Map tools to Anthropic format
    const anthropicTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, any>,
        });
      }
    }

    return {
      content: content || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
