/**
 * Aether Runtime - Ollama LLM Provider
 *
 * Connects to a local Ollama instance via HTTP (no external dependency).
 * Supports native tool calling for compatible models, with prompt-based
 * fallback for models that don't support tools natively.
 */

import type {
  LLMProvider,
  ChatMessage,
  LLMResponse,
  ToolDefinition,
  ToolCall,
} from './LLMProvider.js';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private host: string;
  private model: string;

  constructor(model?: string) {
    this.host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.model = model || process.env.OLLAMA_MODEL || 'llama3.1';
  }

  isAvailable(): boolean {
    // We'll do a synchronous check based on env var presence.
    // The actual ping happens in chat() with error handling.
    return true; // Ollama is always "potentially" available
  }

  /**
   * Ping the Ollama server to check if it's running.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  supportsVision(): boolean {
    // Ollama supports vision for models like llava, but not all models
    const visionModels = ['llava', 'bakllava', 'llava-llama3'];
    return visionModels.some((m) => this.model.includes(m));
  }

  async analyzeImage(imageBase64: string, prompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: prompt || 'Describe what you see in this image in detail.',
        images: [imageBase64],
        stream: false,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    return {
      content: data.response || 'No description generated.',
    };
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    // First try native tool calling
    const supportsTools = await this.checkToolSupport();

    if (supportsTools && tools.length > 0) {
      return this.chatWithTools(messages, tools);
    }

    // Fallback: embed tool descriptions in prompt
    return this.chatWithPromptTools(messages, tools);
  }

  private async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const ollamaMessages = messages.map((msg) => this.toOllamaMessage(msg));
    const ollamaTools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        tools: ollamaTools,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const toolCalls: ToolCall[] = [];

    if (data.message?.tool_calls) {
      for (const tc of data.message.tool_calls) {
        toolCalls.push({
          id: `ollama_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: tc.function.name,
          arguments: tc.function.arguments || {},
        });
      }
    }

    return {
      content: data.message?.content || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.eval_count
        ? {
            inputTokens: data.prompt_eval_count || 0,
            outputTokens: data.eval_count || 0,
          }
        : undefined,
    };
  }

  private async chatWithPromptTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    // Inject tool descriptions into the system prompt
    const toolDesc = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');

    const augmentedMessages = [...messages];

    // Add tool instructions to system prompt
    if (tools.length > 0) {
      const toolSystemMsg: ChatMessage = {
        role: 'system',
        content: [
          'You have the following tools available:',
          toolDesc,
          '',
          'To use a tool, respond with ONLY a JSON object:',
          '{"reasoning": "your reasoning", "tool": "tool_name", "args": {"key": "value"}}',
          '',
          'Respond with valid JSON only, no extra text.',
        ].join('\n'),
      };
      augmentedMessages.unshift(toolSystemMsg);
    }

    const ollamaMessages = augmentedMessages.map((msg) => this.toOllamaMessage(msg));

    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: false,
        format: 'json',
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const content = data.message?.content || '';

    // Try to parse as tool call
    try {
      const parsed = JSON.parse(content);
      if (parsed.tool) {
        return {
          content: parsed.reasoning || content,
          toolCalls: [
            {
              id: `ollama_${Date.now()}`,
              name: parsed.tool,
              arguments: parsed.args || {},
            },
          ],
          usage: data.eval_count
            ? {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0,
              }
            : undefined,
        };
      }
    } catch {
      // Not valid JSON, return as plain text
    }

    return {
      content,
      usage: data.eval_count
        ? {
            inputTokens: data.prompt_eval_count || 0,
            outputTokens: data.eval_count || 0,
          }
        : undefined,
    };
  }

  private async checkToolSupport(): Promise<boolean> {
    // Models known to support native tool calling in Ollama
    const toolCapableModels = [
      'llama3.1',
      'llama3.2',
      'llama3.3',
      'mistral',
      'mixtral',
      'qwen2',
      'qwen2.5',
      'command-r',
    ];
    return toolCapableModels.some((m) => this.model.startsWith(m));
  }

  private toOllamaMessage(msg: ChatMessage): any {
    return {
      role: msg.role === 'tool' ? 'tool' : msg.role,
      content: msg.content,
    };
  }
}
