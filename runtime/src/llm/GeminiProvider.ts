/**
 * Aether Runtime - Gemini LLM Provider
 *
 * Wraps the Google Gemini API (@google/genai) to implement the LLMProvider interface.
 * This is the original LLM backend that was previously hardcoded in AgentLoop.ts.
 */

import type { LLMProvider, ChatMessage, LLMResponse, ToolDefinition, ToolCall } from './LLMProvider.js';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private apiKey: string;
  private model: string;

  constructor(model?: string) {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    this.model = model || 'gemini-2.5-flash';
  }

  isAvailable(): boolean {
    return !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    // Build prompt from messages
    const prompt = this.buildPrompt(messages, tools);

    const response = await ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object' as any,
          properties: {
            reasoning: { type: 'string' as any, description: 'Your step-by-step reasoning' },
            tool: { type: 'string' as any, description: 'The tool to use' },
            args: { type: 'object' as any, description: 'Arguments for the tool' },
          },
          required: ['reasoning', 'tool', 'args'],
        },
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);

    return {
      content: parsed.reasoning || text,
      toolCalls: parsed.tool ? [{
        id: `call_${Date.now()}`,
        name: parsed.tool,
        arguments: parsed.args || {},
      }] : undefined,
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  private buildPrompt(messages: ChatMessage[], tools: ToolDefinition[]): string {
    let prompt = '';
    for (const msg of messages) {
      if (msg.role === 'system') {
        prompt += `${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        prompt += `Previous action: ${msg.content}\n\n`;
      } else if (msg.role === 'tool') {
        prompt += `Tool result: ${msg.content}\n\n`;
      } else {
        prompt += `User: ${msg.content}\n\n`;
      }
    }
    prompt += `What tool should you use next? Respond with JSON: { "reasoning": "...", "tool": "...", "args": {...} }`;
    return prompt;
  }
}
