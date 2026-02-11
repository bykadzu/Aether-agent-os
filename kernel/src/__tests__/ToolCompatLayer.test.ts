/**
 * ToolCompatLayer Tests (v0.5 Phase 4)
 *
 * Tests for importing/exporting tools in LangChain and OpenAI formats,
 * round-trip conversion, persistence, listing, and removal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { ToolCompatLayer } from '../ToolCompatLayer.js';
import type { LangChainTool, OpenAIFunctionTool, ImportedTool } from '../ToolCompatLayer.js';

// ---------------------------------------------------------------------------
// Mock StateStore (minimal interface the ToolCompatLayer needs)
// ---------------------------------------------------------------------------

function createMockStateStore() {
  const tools = new Map<string, any>();
  return {
    ensureImportedToolsTable: vi.fn(),
    getAllImportedTools: vi.fn(() => Array.from(tools.values())),
    upsertImportedTool: vi.fn((record: any) => {
      tools.set(record.name, record);
    }),
    getImportedTool: vi.fn((name: string) => tools.get(name) || null),
    deleteImportedTool: vi.fn((name: string) => {
      tools.delete(name);
    }),
    // For direct test manipulation
    _tools: tools,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const langchainTools: LangChainTool[] = [
  {
    name: 'web_search',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum results to return' },
      },
      required: ['query'],
    },
  },
  {
    name: 'calculator',
    description: 'Perform mathematical calculations',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression' },
      },
      required: ['expression'],
    },
  },
];

const openaiTools: OpenAIFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send an email message',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
];

const nativeTools = [
  { name: 'read_file', description: 'Read the contents of a file' },
  { name: 'write_file', description: 'Write content to a file (creates or overwrites)' },
  { name: 'run_command', description: 'Execute a shell command' },
  { name: 'complete', description: 'Mark the current task as complete with a summary' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolCompatLayer', () => {
  let bus: EventBus;
  let store: ReturnType<typeof createMockStateStore>;
  let layer: ToolCompatLayer;

  beforeEach(async () => {
    bus = new EventBus();
    store = createMockStateStore();
    layer = new ToolCompatLayer(bus, store as any);
    layer.setNativeTools(nativeTools);
    await layer.init();
  });

  afterEach(() => {
    layer.shutdown();
  });

  // -- Importing LangChain format --

  describe('importTools (LangChain)', () => {
    it('imports LangChain format tools', () => {
      const imported = layer.importTools(langchainTools, 'langchain');
      expect(imported).toHaveLength(2);
      expect(imported[0].name).toBe('web_search');
      expect(imported[0].description).toBe('Search the web for information');
      expect(imported[0].sourceFormat).toBe('langchain');
      expect(imported[0].parameters.properties.query).toBeDefined();
      expect(imported[0].parameters.required).toEqual(['query']);
    });

    it('persists imported LangChain tools to StateStore', () => {
      layer.importTools(langchainTools, 'langchain');
      expect(store.upsertImportedTool).toHaveBeenCalledTimes(2);
      const firstCall = store.upsertImportedTool.mock.calls[0][0];
      expect(firstCall.name).toBe('web_search');
      expect(firstCall.source_format).toBe('langchain');
      expect(JSON.parse(firstCall.parameters)).toEqual(langchainTools[0].parameters);
    });

    it('emits tools.imported event', () => {
      const handler = vi.fn();
      bus.on('tools.imported', handler);
      layer.importTools(langchainTools, 'langchain');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 2,
          format: 'langchain',
          names: ['web_search', 'calculator'],
        }),
      );
    });

    it('throws on invalid LangChain tool (missing name)', () => {
      expect(() =>
        layer.importTools(
          [{ description: 'no name', parameters: { type: 'object', properties: {} } }],
          'langchain',
        ),
      ).toThrow('missing name or description');
    });
  });

  // -- Importing OpenAI format --

  describe('importTools (OpenAI)', () => {
    it('imports OpenAI function calling format tools', () => {
      const imported = layer.importTools(openaiTools, 'openai');
      expect(imported).toHaveLength(2);
      expect(imported[0].name).toBe('get_weather');
      expect(imported[0].description).toBe('Get current weather for a location');
      expect(imported[0].sourceFormat).toBe('openai');
      expect(imported[0].parameters.properties.location).toBeDefined();
      expect(imported[0].parameters.required).toEqual(['location']);
    });

    it('persists imported OpenAI tools to StateStore', () => {
      layer.importTools(openaiTools, 'openai');
      expect(store.upsertImportedTool).toHaveBeenCalledTimes(2);
      const firstCall = store.upsertImportedTool.mock.calls[0][0];
      expect(firstCall.name).toBe('get_weather');
      expect(firstCall.source_format).toBe('openai');
    });

    it('throws on invalid OpenAI tool (missing function.name)', () => {
      expect(() =>
        layer.importTools(
          [
            {
              type: 'function',
              function: { description: 'no name', parameters: { type: 'object', properties: {} } },
            },
          ],
          'openai',
        ),
      ).toThrow('missing function.name or function.description');
    });
  });

  // -- Exporting native tools in LangChain format --

  describe('exportTools (LangChain)', () => {
    it('exports native tools in LangChain format', () => {
      const exported = layer.exportTools('langchain');
      expect(exported).toHaveLength(4); // 4 native tools
      expect(exported[0]).toEqual({
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: { type: 'object', properties: {} },
      });
    });

    it('exports native + imported tools in LangChain format', () => {
      layer.importTools(openaiTools, 'openai');
      const exported = layer.exportTools('langchain');
      expect(exported).toHaveLength(6); // 4 native + 2 imported
      const names = exported.map((t: any) => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('get_weather');
      expect(names).toContain('send_email');
      // LangChain format: top-level name, description, parameters
      const weather = exported.find((t: any) => t.name === 'get_weather');
      expect(weather.parameters.properties.location).toBeDefined();
    });

    it('emits tools.exported event', () => {
      const handler = vi.fn();
      bus.on('tools.exported', handler);
      layer.exportTools('langchain');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ count: 4, format: 'langchain' }),
      );
    });
  });

  // -- Exporting native tools in OpenAI format --

  describe('exportTools (OpenAI)', () => {
    it('exports native tools in OpenAI format', () => {
      const exported = layer.exportTools('openai');
      expect(exported).toHaveLength(4);
      expect(exported[0]).toEqual({
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the contents of a file',
          parameters: { type: 'object', properties: {} },
        },
      });
    });

    it('exports native + imported tools in OpenAI format', () => {
      layer.importTools(langchainTools, 'langchain');
      const exported = layer.exportTools('openai');
      expect(exported).toHaveLength(6); // 4 native + 2 imported
      const webSearch = exported.find((t: any) => t.function?.name === 'web_search');
      expect(webSearch).toBeDefined();
      expect(webSearch.type).toBe('function');
      expect(webSearch.function.parameters.properties.query).toBeDefined();
    });
  });

  // -- Round-trip tests --

  describe('round-trip conversion', () => {
    it('LangChain -> import -> export as OpenAI preserves schema', () => {
      layer.importTools(langchainTools, 'langchain');
      const exported = layer.exportTools('openai');
      const webSearch = exported.find((t: any) => t.function?.name === 'web_search');
      expect(webSearch).toBeDefined();
      expect(webSearch.type).toBe('function');
      expect(webSearch.function.name).toBe('web_search');
      expect(webSearch.function.description).toBe('Search the web for information');
      expect(webSearch.function.parameters.properties.query.type).toBe('string');
      expect(webSearch.function.parameters.required).toEqual(['query']);
    });

    it('OpenAI -> import -> export as LangChain preserves schema', () => {
      layer.importTools(openaiTools, 'openai');
      const exported = layer.exportTools('langchain');
      const weather = exported.find((t: any) => t.name === 'get_weather');
      expect(weather).toBeDefined();
      expect(weather.name).toBe('get_weather');
      expect(weather.description).toBe('Get current weather for a location');
      expect(weather.parameters.properties.location.type).toBe('string');
      expect(weather.parameters.required).toEqual(['location']);
    });

    it('LangChain -> import -> export as LangChain is identity', () => {
      layer.importTools(langchainTools, 'langchain');
      const exported = layer.exportTools('langchain');
      const webSearch = exported.find((t: any) => t.name === 'web_search');
      expect(webSearch.name).toBe(langchainTools[0].name);
      expect(webSearch.description).toBe(langchainTools[0].description);
      expect(webSearch.parameters.properties).toEqual(langchainTools[0].parameters.properties);
      expect(webSearch.parameters.required).toEqual(langchainTools[0].parameters.required);
    });

    it('OpenAI -> import -> export as OpenAI is identity', () => {
      layer.importTools(openaiTools, 'openai');
      const exported = layer.exportTools('openai');
      const weather = exported.find((t: any) => t.function?.name === 'get_weather');
      expect(weather.type).toBe('function');
      expect(weather.function.name).toBe(openaiTools[0].function.name);
      expect(weather.function.description).toBe(openaiTools[0].function.description);
      expect(weather.function.parameters.properties).toEqual(
        openaiTools[0].function.parameters.properties,
      );
      expect(weather.function.parameters.required).toEqual(
        openaiTools[0].function.parameters.required,
      );
    });
  });

  // -- Persistence --

  describe('persistence', () => {
    it('loads previously imported tools on init', async () => {
      // Simulate persisted data in the store
      store._tools.set('persisted_tool', {
        id: 'imported_persisted_tool_123',
        name: 'persisted_tool',
        description: 'A previously imported tool',
        parameters: JSON.stringify({
          type: 'object',
          properties: { arg1: { type: 'string' } },
          required: ['arg1'],
        }),
        source_format: 'langchain',
        created_at: 1000000,
      });

      // Create a new instance and init
      const layer2 = new ToolCompatLayer(bus, store as any);
      layer2.setNativeTools(nativeTools);
      await layer2.init();

      const imported = layer2.getImportedTools();
      expect(imported).toHaveLength(1);
      expect(imported[0].name).toBe('persisted_tool');
      expect(imported[0].description).toBe('A previously imported tool');
      expect(imported[0].parameters.properties.arg1).toEqual({ type: 'string' });
      layer2.shutdown();
    });

    it('import -> new instance -> tools still there', async () => {
      // Import tools on the first instance
      layer.importTools(langchainTools, 'langchain');

      // Create a new instance and init (reads from same mock store)
      const layer2 = new ToolCompatLayer(bus, store as any);
      layer2.setNativeTools(nativeTools);
      await layer2.init();

      const imported = layer2.getImportedTools();
      expect(imported).toHaveLength(2);
      expect(imported.map((t) => t.name).sort()).toEqual(['calculator', 'web_search']);
      layer2.shutdown();
    });
  });

  // -- listTools --

  describe('listTools', () => {
    it('returns both native and imported tools', () => {
      layer.importTools([langchainTools[0]], 'langchain');
      const all = layer.listTools();
      expect(all.length).toBe(5); // 4 native + 1 imported

      const nativeEntries = all.filter((t) => t.source === 'native');
      const importedEntries = all.filter((t) => t.source === 'imported');
      expect(nativeEntries).toHaveLength(4);
      expect(importedEntries).toHaveLength(1);
      expect(importedEntries[0].name).toBe('web_search');
    });

    it('returns only native tools when nothing imported', () => {
      const all = layer.listTools();
      expect(all).toHaveLength(4);
      expect(all.every((t) => t.source === 'native')).toBe(true);
    });
  });

  // -- removeImportedTool --

  describe('removeImportedTool', () => {
    it('removes an imported tool', () => {
      layer.importTools(langchainTools, 'langchain');
      expect(layer.getImportedTools()).toHaveLength(2);

      const removed = layer.removeImportedTool('web_search');
      expect(removed).toBe(true);
      expect(layer.getImportedTools()).toHaveLength(1);
      expect(layer.getImportedTools()[0].name).toBe('calculator');
    });

    it('returns false when removing a non-existent tool', () => {
      const removed = layer.removeImportedTool('nonexistent');
      expect(removed).toBe(false);
    });

    it('calls deleteImportedTool on StateStore', () => {
      layer.importTools([langchainTools[0]], 'langchain');
      layer.removeImportedTool('web_search');
      expect(store.deleteImportedTool).toHaveBeenCalledWith('web_search');
    });

    it('removed tool no longer appears in listTools', () => {
      layer.importTools(langchainTools, 'langchain');
      layer.removeImportedTool('web_search');
      const list = layer.listTools();
      const names = list.map((t) => t.name);
      expect(names).not.toContain('web_search');
      expect(names).toContain('calculator');
    });

    it('removed tool no longer appears in exports', () => {
      layer.importTools(langchainTools, 'langchain');
      layer.removeImportedTool('web_search');
      const exported = layer.exportTools('langchain');
      const names = exported.map((t: any) => t.name);
      expect(names).not.toContain('web_search');
    });
  });

  // -- getImportedTools --

  describe('getImportedTools', () => {
    it('returns empty array initially', () => {
      expect(layer.getImportedTools()).toHaveLength(0);
    });

    it('returns all imported tools', () => {
      layer.importTools(langchainTools, 'langchain');
      layer.importTools(openaiTools, 'openai');
      const imported = layer.getImportedTools();
      expect(imported).toHaveLength(4);
    });

    it('imported tools have correct structure', () => {
      layer.importTools(langchainTools, 'langchain');
      const [tool] = layer.getImportedTools();
      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('parameters');
      expect(tool).toHaveProperty('sourceFormat');
      expect(tool).toHaveProperty('createdAt');
      expect(typeof tool.createdAt).toBe('number');
    });
  });

  // -- Edge cases --

  describe('edge cases', () => {
    it('importing same tool name twice replaces it', () => {
      layer.importTools([langchainTools[0]], 'langchain');
      const updated: LangChainTool = {
        ...langchainTools[0],
        description: 'Updated web search description',
      };
      layer.importTools([updated], 'langchain');

      const imported = layer.getImportedTools();
      expect(imported).toHaveLength(1);
      expect(imported[0].description).toBe('Updated web search description');
    });

    it('throws on unsupported format', () => {
      expect(() => layer.importTools([], 'mcp' as any)).toThrow('Unsupported format');
    });

    it('handles tools with empty parameters', () => {
      const tools: LangChainTool[] = [
        {
          name: 'no_params',
          description: 'A tool with no parameters',
          parameters: { type: 'object', properties: {} },
        },
      ];
      const imported = layer.importTools(tools, 'langchain');
      expect(imported).toHaveLength(1);
      expect(imported[0].parameters.properties).toEqual({});
    });

    it('handles mixed import: some LangChain, some OpenAI', () => {
      layer.importTools(langchainTools, 'langchain');
      layer.importTools(openaiTools, 'openai');
      const all = layer.getImportedTools();
      expect(all).toHaveLength(4);
      const lcTools = all.filter((t) => t.sourceFormat === 'langchain');
      const oaiTools = all.filter((t) => t.sourceFormat === 'openai');
      expect(lcTools).toHaveLength(2);
      expect(oaiTools).toHaveLength(2);
    });
  });
});
