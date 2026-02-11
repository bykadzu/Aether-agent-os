/**
 * Aether Kernel - Tool Compatibility Layer (v0.5 Phase 4)
 *
 * Provides import/export of tool definitions in LangChain and OpenAI
 * function-calling formats. This is a schema translation layer that
 * enables Aether OS to interoperate with the broader AI tool ecosystem.
 *
 * Supported formats:
 * - LangChain: { name, description, parameters: { type: 'object', properties, required? } }
 * - OpenAI:    { type: 'function', function: { name, description, parameters: { type: 'object', properties, required? } } }
 *
 * Imported tools are persisted to SQLite so they survive kernel restarts.
 * Native Aether tools (from runtime/src/tools.ts) can be exported in either format.
 */

import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** LangChain-style tool definition */
export interface LangChainTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/** OpenAI function-calling tool definition */
export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/** Internal representation of an imported tool */
export interface ImportedTool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  sourceFormat: 'langchain' | 'openai';
  createdAt: number;
}

/** Tool listing entry (native + imported) */
export interface ToolListEntry {
  name: string;
  source: 'native' | 'imported';
  description: string;
}

/** Minimal native tool shape (matches ToolDefinition from runtime/src/tools.ts) */
interface NativeToolDef {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// ToolCompatLayer
// ---------------------------------------------------------------------------

export class ToolCompatLayer {
  private bus: EventBus;
  private state: StateStore;
  private imported: Map<string, ImportedTool> = new Map();

  /** Reference to the native tool definitions (set externally or lazily) */
  private nativeTools: NativeToolDef[] = [];

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  /**
   * Initialize the compatibility layer.
   * Ensures the SQLite table exists and loads persisted imported tools.
   */
  async init(): Promise<void> {
    this.state.ensureImportedToolsTable();
    const rows = this.state.getAllImportedTools();
    for (const row of rows) {
      const tool: ImportedTool = {
        id: row.id,
        name: row.name,
        description: row.description,
        parameters: JSON.parse(row.parameters),
        sourceFormat: row.source_format as 'langchain' | 'openai',
        createdAt: row.created_at,
      };
      this.imported.set(tool.name, tool);
    }
  }

  /**
   * Shut down the compatibility layer. No-op currently; here for lifecycle symmetry.
   */
  shutdown(): void {
    // nothing to tear down
  }

  /**
   * Set the native Aether tool definitions for export purposes.
   * Typically called once after the runtime tool set is built.
   */
  setNativeTools(tools: NativeToolDef[]): void {
    this.nativeTools = tools;
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Import tools from an external format and persist them.
   */
  importTools(tools: any[], format: 'langchain' | 'openai'): ImportedTool[] {
    const imported: ImportedTool[] = [];

    if (format !== 'langchain' && format !== 'openai') {
      throw new Error(`Unsupported format: ${format}`);
    }

    for (const raw of tools) {
      let name: string;
      let description: string;
      let parameters: { type: 'object'; properties: Record<string, any>; required?: string[] };

      if (format === 'langchain') {
        const lc = raw as LangChainTool;
        if (!lc.name || !lc.description) {
          throw new Error(`Invalid LangChain tool: missing name or description`);
        }
        name = lc.name;
        description = lc.description;
        parameters = lc.parameters || { type: 'object', properties: {} };
      } else if (format === 'openai') {
        const oai = raw as OpenAIFunctionTool;
        if (!oai.function?.name || !oai.function?.description) {
          throw new Error(`Invalid OpenAI tool: missing function.name or function.description`);
        }
        name = oai.function.name;
        description = oai.function.description;
        parameters = oai.function.parameters || { type: 'object', properties: {} };
      } else {
        throw new Error(`Unsupported format: ${format}`);
      }

      const id = `imported_${name}_${Date.now()}`;
      const now = Date.now();

      const tool: ImportedTool = {
        id,
        name,
        description,
        parameters,
        sourceFormat: format,
        createdAt: now,
      };

      // Store in memory
      this.imported.set(name, tool);

      // Persist to SQLite
      this.state.upsertImportedTool({
        id,
        name,
        description,
        parameters: JSON.stringify(parameters),
        source_format: format,
        created_at: now,
      });

      imported.push(tool);
    }

    // Emit event
    this.bus.emit('tools.imported', {
      count: imported.length,
      format,
      names: imported.map((t) => t.name),
    });

    return imported;
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Export ALL tools (native Aether + imported) in the requested format.
   */
  exportTools(format: 'langchain' | 'openai'): any[] {
    const allTools = this.getAllToolDefinitions();

    const exported = allTools.map((t) => {
      if (format === 'langchain') {
        return {
          name: t.name,
          description: t.description,
          parameters: t.parameters || { type: 'object', properties: {} },
        } satisfies LangChainTool;
      } else {
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters || { type: 'object', properties: {} },
          },
        } satisfies OpenAIFunctionTool;
      }
    });

    // Emit event
    this.bus.emit('tools.exported', {
      count: exported.length,
      format,
    });

    return exported;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Return all imported tools (for agent loop integration).
   */
  getImportedTools(): ImportedTool[] {
    return Array.from(this.imported.values());
  }

  /**
   * List all tools (native + imported) with source metadata.
   */
  listTools(): ToolListEntry[] {
    const list: ToolListEntry[] = [];

    // Native tools
    for (const nt of this.nativeTools) {
      list.push({
        name: nt.name,
        source: 'native',
        description: nt.description,
      });
    }

    // Imported tools
    for (const it of this.imported.values()) {
      list.push({
        name: it.name,
        source: 'imported',
        description: it.description,
      });
    }

    return list;
  }

  /**
   * Remove an imported tool by name. Returns true if found and removed.
   */
  removeImportedTool(name: string): boolean {
    const tool = this.imported.get(name);
    if (!tool) return false;

    this.imported.delete(name);
    this.state.deleteImportedTool(name);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a unified list of tool definitions combining native + imported.
   */
  private getAllToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, any>; required?: string[] };
  }> {
    const result: Array<{
      name: string;
      description: string;
      parameters: { type: 'object'; properties: Record<string, any>; required?: string[] };
    }> = [];

    // Native tools (they don't carry full JSON Schema parameters, so we use empty properties)
    for (const nt of this.nativeTools) {
      result.push({
        name: nt.name,
        description: nt.description,
        parameters: { type: 'object', properties: {} },
      });
    }

    // Imported tools (already have full parameters)
    for (const it of this.imported.values()) {
      result.push({
        name: it.name,
        description: it.description,
        parameters: it.parameters,
      });
    }

    return result;
  }
}
