import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { GeminiModel, Agent } from "../types";

export { GeminiModel };

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generate text content using Gemini.
 * Uses Flash for speed, Pro for reasoning.
 */
export const generateText = async (
  prompt: string,
  model: GeminiModel = GeminiModel.FLASH,
  systemInstruction?: string
): Promise<string> => {
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
      },
    });
    
    return response.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Sorry, I encountered an error communicating with the AI service.";
  }
};

/**
 * Analyze an image using Gemini Multimodal capabilities.
 */
export const analyzeImage = async (
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<string> => {
  try {
    const cleanBase64 = base64Data.split(',')[1] || base64Data;
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GeminiModel.FLASH,
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: cleanBase64 } },
          { text: prompt },
        ],
      },
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    return "Failed to analyze the image.";
  }
};

/**
 * Stream text response for chat interface
 */
export const streamChat = async function* (
  history: { role: string; parts: { text: string }[] }[],
  newMessage: string,
  model: GeminiModel = GeminiModel.FLASH
) {
  try {
    const chat = ai.chats.create({ model: model, history: history });
    const result = await chat.sendMessageStream({ message: newMessage });
    for await (const chunk of result) {
      const c = chunk as GenerateContentResponse;
      if (c.text) yield c.text;
    }
  } catch (error) {
    console.error("Stream Error:", error);
    yield "Error connecting to AI.";
  }
};

/**
 * Core Agent Intelligence
 * Uses JSON Schema to force structured decision making.
 */
export interface AgentDecision {
    action: 'think' | 'create_file' | 'browse' | 'complete';
    thought: string;
    fileName?: string;
    fileContent?: string;
    url?: string;
    webSummary?: string;
}

export const getAgentDecision = async (
    agent: Agent,
    existingFiles: string[]
): Promise<AgentDecision> => {
    try {
        const prompt = `
            You are an autonomous AI agent running in a web OS.
            
            My Role: ${agent.role}
            My Goal: ${agent.goal}
            
            Current File System:
            ${existingFiles.join(', ')}
            
            Recent History:
            ${agent.logs.slice(-5).map(l => `[${l.type}] ${l.message}`).join('\n')}
            
            Decide the next step. 
            - If you need to write code, use 'create_file'.
            - If you need to research, use 'browse' (simulated).
            - If you are just planning, use 'think'.
            - If the goal is done, use 'complete'.
        `;

        const response = await ai.models.generateContent({
            model: GeminiModel.FLASH,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        action: { type: Type.STRING, enum: ["think", "create_file", "browse", "complete"] },
                        thought: { type: Type.STRING, description: "Brief reasoning for the log." },
                        fileName: { type: Type.STRING, description: "Filename if creating a file (e.g. script.js)" },
                        fileContent: { type: Type.STRING, description: "Full code content if creating a file." },
                        url: { type: Type.STRING, description: "URL if browsing" },
                        webSummary: { type: Type.STRING, description: "Simulated content found at the URL." }
                    },
                    required: ["action", "thought"]
                }
            }
        });

        const text = response.text;
        if (!text) throw new Error("No response from agent brain");
        return JSON.parse(text) as AgentDecision;

    } catch (e) {
        console.error("Agent Decision Error", e);
        return { action: 'think', thought: 'I encountered an error processing my next step. I will retry.' };
    }
}