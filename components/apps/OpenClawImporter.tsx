import React, { useState, useCallback } from 'react';
import {
  FolderSearch,
  Import,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Package,
  Loader2,
  Trash2,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportedSkill {
  manifest: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    category: string;
    keywords: string[];
    tools: Array<{ name: string; description: string }>;
  };
  instructions: string;
  warnings: string[];
  dependenciesMet: boolean;
  sourcePath: string;
}

interface BatchImportResult {
  imported: ImportedSkill[];
  failed: Array<{ path: string; error: string }>;
  totalScanned: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const OpenClawImporter: React.FC = () => {
  // Scan state
  const [scanPath, setScanPath] = useState('~/.openclaw/workspace/skills');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<BatchImportResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Imported skills state
  const [importedSkills, setImportedSkills] = useState<ImportedSkill[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Single import
  const [singlePath, setSinglePath] = useState('');
  const [importing, setImporting] = useState(false);

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  const getHeaders = useCallback(() => {
    const kc = getKernelClient();
    const token = (kc as any).token || localStorage.getItem('aether_token') || '';
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, []);

  const getBase = useCallback(() => {
    const kc = getKernelClient();
    return (kc as any).httpBase || `http://localhost:3001`;
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const loadImported = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getBase()}/api/v1/openclaw/skills`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setImportedSkills(json.data || []);
      }
    } catch {
      // Silently fail — user may not have skills yet
    } finally {
      setLoading(false);
    }
  }, [getBase, getHeaders]);

  // Load imported skills on mount
  React.useEffect(() => {
    loadImported();
  }, [loadImported]);

  const handleScanDirectory = useCallback(async () => {
    if (!scanPath.trim()) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const res = await fetch(`${getBase()}/api/v1/openclaw/import-directory`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ dirPath: scanPath.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setScanResult(json.data);
        // Reload imported list
        await loadImported();
      } else {
        setScanError(json.error?.message || 'Import failed');
      }
    } catch (err: any) {
      setScanError(err.message || 'Network error');
    } finally {
      setScanning(false);
    }
  }, [scanPath, getBase, getHeaders, loadImported]);

  const handleImportSingle = useCallback(async () => {
    if (!singlePath.trim()) return;
    setImporting(true);
    try {
      const res = await fetch(`${getBase()}/api/v1/openclaw/import`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ path: singlePath.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setSinglePath('');
        await loadImported();
      } else {
        setScanError(json.error?.message || 'Import failed');
      }
    } catch (err: any) {
      setScanError(err.message || 'Network error');
    } finally {
      setImporting(false);
    }
  }, [singlePath, getBase, getHeaders, loadImported]);

  const handleRemove = useCallback(
    async (skillId: string) => {
      try {
        const res = await fetch(
          `${getBase()}/api/v1/openclaw/skills/${encodeURIComponent(skillId)}`,
          {
            method: 'DELETE',
            headers: getHeaders(),
          },
        );
        if (res.ok) {
          setImportedSkills((prev) => prev.filter((s) => s.manifest.id !== skillId));
        }
      } catch {
        // Silently fail
      }
    },
    [getBase, getHeaders],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col bg-gray-50/80 backdrop-blur-xl overflow-y-auto">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-gray-200/50">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white shadow-lg">
            <Package size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">OpenClaw Skill Importer</h1>
            <p className="text-xs text-gray-500">
              Import SKILL.md files from the OpenClaw ecosystem into Aether
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6">
        {/* Scan Directory */}
        <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
              <FolderSearch size={14} className="text-orange-500" /> Batch Import from Directory
            </h3>
            <p className="text-xs text-gray-400">
              Scan a directory of OpenClaw skills and import all valid SKILL.md files
            </p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
                placeholder="Path to skills directory"
                className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-orange-400 transition-colors"
              />
              <button
                onClick={handleScanDirectory}
                disabled={scanning || !scanPath.trim()}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <Import size={14} />}
                {scanning ? 'Scanning...' : 'Scan & Import'}
              </button>
            </div>

            {/* Scan results */}
            {scanResult && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-500">
                    Scanned: <strong>{scanResult.totalScanned}</strong>
                  </span>
                  <span className="text-green-600 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Imported:{' '}
                    <strong>{scanResult.imported.length}</strong>
                  </span>
                  {scanResult.failed.length > 0 && (
                    <span className="text-red-500 flex items-center gap-1">
                      <XCircle size={12} /> Failed: <strong>{scanResult.failed.length}</strong>
                    </span>
                  )}
                </div>

                {/* Failures */}
                {scanResult.failed.length > 0 && (
                  <div className="space-y-1">
                    {scanResult.failed.map((f, i) => (
                      <div
                        key={i}
                        className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 flex items-start gap-1.5"
                      >
                        <XCircle size={12} className="shrink-0 mt-0.5" />
                        <span>
                          <span className="font-mono">{f.path.split(/[/\\]/).pop()}</span>:{' '}
                          {f.error}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {scanError && (
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {scanError}
              </div>
            )}
          </div>
        </div>

        {/* Single Skill Import */}
        <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
              <FileText size={14} className="text-orange-500" /> Import Single Skill
            </h3>
            <p className="text-xs text-gray-400">
              Import a specific SKILL.md file by its full path
            </p>
          </div>
          <div className="p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={singlePath}
                onChange={(e) => setSinglePath(e.target.value)}
                placeholder="Path to SKILL.md file"
                className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-orange-400 transition-colors"
              />
              <button
                onClick={handleImportSingle}
                disabled={importing || !singlePath.trim()}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Import size={14} />}
                Import
              </button>
            </div>
          </div>
        </div>

        {/* Imported Skills List */}
        <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
              <Package size={14} className="text-orange-500" /> Imported Skills
              {importedSkills.length > 0 && (
                <span className="text-xs font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                  {importedSkills.length}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-400">
              Skills imported from OpenClaw and registered in the plugin registry
            </p>
          </div>

          {loading ? (
            <div className="p-4 flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : importedSkills.length > 0 ? (
            importedSkills.map((skill) => (
              <div key={skill.manifest.id} className="border-b border-gray-100 last:border-b-0">
                <div className="p-4 flex items-center justify-between">
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                    onClick={() =>
                      setExpandedSkill(
                        expandedSkill === skill.manifest.id ? null : skill.manifest.id,
                      )
                    }
                  >
                    {expandedSkill === skill.manifest.id ? (
                      <ChevronDown size={14} className="text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-400 shrink-0" />
                    )}
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        skill.dependenciesMet ? 'bg-green-500' : 'bg-amber-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-700 truncate">
                        {skill.manifest.name}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{skill.manifest.description}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {!skill.dependenciesMet && (
                      <span
                        className="text-amber-500 flex items-center gap-1 text-[10px]"
                        title={skill.warnings.join('\n')}
                      >
                        <AlertTriangle size={12} /> Deps missing
                      </span>
                    )}
                    <span className="text-[10px] text-gray-300 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                      {skill.manifest.tools.length} tool
                      {skill.manifest.tools.length !== 1 ? 's' : ''}
                    </span>
                    {skill.manifest.keywords
                      .filter((k) => k !== 'openclaw' && k !== 'imported')
                      .slice(0, 2)
                      .map((kw) => (
                        <span
                          key={kw}
                          className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded"
                        >
                          {kw}
                        </span>
                      ))}
                    <button
                      onClick={() => handleRemove(skill.manifest.id)}
                      className="p-1 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove imported skill"
                    >
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {expandedSkill === skill.manifest.id && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Warnings */}
                    {skill.warnings.length > 0 && (
                      <div className="space-y-1">
                        {skill.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 flex items-start gap-1.5"
                          >
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                            {w}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tools */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Tools
                      </h4>
                      <div className="space-y-1.5">
                        {skill.manifest.tools.map((tool) => (
                          <div key={tool.name} className="flex items-start gap-2 text-xs">
                            <span className="font-mono text-orange-600 shrink-0 bg-orange-50 px-1.5 py-0.5 rounded">
                              {tool.name}
                            </span>
                            <span className="text-gray-500 truncate">{tool.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="text-xs text-gray-400 space-y-1">
                      <div>
                        Source: <span className="font-mono">{skill.sourcePath}</span>
                      </div>
                      <div>
                        ID: <span className="font-mono">{skill.manifest.id}</span>
                      </div>
                      <div>Keywords: {skill.manifest.keywords.join(', ')}</div>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="p-4 text-sm text-gray-400">
              No OpenClaw skills imported yet. Use the forms above to import skills.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
