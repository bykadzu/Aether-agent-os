import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Save,
  Download,
  Upload,
  Plus,
  Trash2,
  FileSpreadsheet,
  Check,
  ChevronDown,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CellData = {
  value: string;
  formula?: string;
};

type SpreadsheetData = Record<string, CellData>;

interface SheetFile {
  name: string;
  path: string;
}

interface SheetDocument {
  name: string;
  data: SpreadsheetData;
  columnWidths: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHEETS_DIR = '/home/root/Documents/sheets';
const TOTAL_COLS = 26;
const TOTAL_ROWS = 1000;
const DEFAULT_COL_WIDTH = 80;
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 28;
const ROW_NUMBER_WIDTH = 50;
const VISIBLE_ROW_BUFFER = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert 0-based column index to letter (0='A', 25='Z') */
function colIndexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Convert column letter to 0-based index ('A'=0, 'Z'=25) */
function letterToColIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 65;
}

/** Parse cell reference like "A1" into { col: 0, row: 0 } (0-based) */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const clean = ref.replace(/\$/g, '').toUpperCase().trim();
  const match = clean.match(/^([A-Z])(\d+)$/);
  if (!match) return null;
  return {
    col: letterToColIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

/** Build cell key from col/row indices (0-based) */
function cellKey(col: number, row: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

/** Expand a range like "A1:A10" into an array of cell keys */
function expandRange(rangeStr: string): string[] {
  const parts = rangeStr.split(':');
  if (parts.length !== 2) return [];
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return [];

  const keys: string[] = [];
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      keys.push(cellKey(c, r));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Formula Engine
// ---------------------------------------------------------------------------

function evaluateFormula(
  formula: string,
  data: SpreadsheetData,
  visitedCells: Set<string>,
  currentCellKey: string
): string {
  // Mark the current cell as being visited for circular reference detection
  if (visitedCells.has(currentCellKey)) {
    return '#CIRCULAR!';
  }
  visitedCells.add(currentCellKey);

  try {
    const expr = formula.startsWith('=') ? formula.substring(1).trim() : formula.trim();

    // Handle empty formula
    if (!expr) return '';

    // Check for function calls: SUM, AVERAGE, COUNT, MIN, MAX, IF
    const result = evaluateExpression(expr, data, visitedCells);

    visitedCells.delete(currentCellKey);
    return result;
  } catch {
    visitedCells.delete(currentCellKey);
    return '#ERROR!';
  }
}

function evaluateExpression(
  expr: string,
  data: SpreadsheetData,
  visitedCells: Set<string>
): string {
  expr = expr.trim();

  // Handle IF function: =IF(condition, trueVal, falseVal)
  const ifMatch = expr.match(/^IF\s*\((.*)\)$/i);
  if (ifMatch) {
    const args = splitTopLevelCommas(ifMatch[1]);
    if (args.length < 2 || args.length > 3) return '#ERROR!';
    const conditionResult = evaluateExpression(args[0], data, visitedCells);
    const condNum = parseFloat(conditionResult);
    const isTruthy = !isNaN(condNum) ? condNum !== 0 : conditionResult.length > 0 && conditionResult !== 'false' && conditionResult !== 'FALSE';
    if (isTruthy) {
      return evaluateExpression(args[1], data, visitedCells);
    } else {
      return args.length === 3 ? evaluateExpression(args[2], data, visitedCells) : '0';
    }
  }

  // Handle SUM
  const sumMatch = expr.match(/^SUM\s*\((.*)\)$/i);
  if (sumMatch) {
    const values = resolveRangeOrValues(sumMatch[1], data, visitedCells);
    const sum = values.reduce((acc, v) => acc + (isNaN(v) ? 0 : v), 0);
    return formatNumber(sum);
  }

  // Handle AVERAGE
  const avgMatch = expr.match(/^AVERAGE\s*\((.*)\)$/i);
  if (avgMatch) {
    const values = resolveRangeOrValues(avgMatch[1], data, visitedCells);
    const nums = values.filter((v) => !isNaN(v));
    if (nums.length === 0) return '#DIV/0!';
    const avg = nums.reduce((acc, v) => acc + v, 0) / nums.length;
    return formatNumber(avg);
  }

  // Handle COUNT
  const countMatch = expr.match(/^COUNT\s*\((.*)\)$/i);
  if (countMatch) {
    const values = resolveRangeOrValues(countMatch[1], data, visitedCells);
    const count = values.filter((v) => !isNaN(v)).length;
    return count.toString();
  }

  // Handle MIN
  const minMatch = expr.match(/^MIN\s*\((.*)\)$/i);
  if (minMatch) {
    const values = resolveRangeOrValues(minMatch[1], data, visitedCells);
    const nums = values.filter((v) => !isNaN(v));
    if (nums.length === 0) return '#N/A!';
    return formatNumber(Math.min(...nums));
  }

  // Handle MAX
  const maxMatch = expr.match(/^MAX\s*\((.*)\)$/i);
  if (maxMatch) {
    const values = resolveRangeOrValues(maxMatch[1], data, visitedCells);
    const nums = values.filter((v) => !isNaN(v));
    if (nums.length === 0) return '#N/A!';
    return formatNumber(Math.max(...nums));
  }

  // If it's a simple string literal wrapped in quotes
  if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr.slice(1, -1);
  }

  // Replace cell references with their numeric values for math evaluation
  const mathExpr = expr.replace(/\$?[A-Z]\$?\d+/gi, (ref) => {
    const cleaned = ref.replace(/\$/g, '').toUpperCase();
    const val = getCellNumericValue(cleaned, data, visitedCells);
    return val.toString();
  });

  // Evaluate the mathematical expression safely
  return formatNumber(safeMathEval(mathExpr));
}

/** Split by commas but respect nested parentheses */
function splitTopLevelCommas(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/** Resolve a range argument like "A1:A10" or comma-separated values into number array */
function resolveRangeOrValues(
  arg: string,
  data: SpreadsheetData,
  visitedCells: Set<string>
): number[] {
  const values: number[] = [];

  // Check if it contains a colon for range
  const parts = splitTopLevelCommas(arg);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes(':')) {
      // Range reference
      const keys = expandRange(trimmed);
      for (const key of keys) {
        values.push(getCellNumericValue(key, data, visitedCells));
      }
    } else {
      // Could be a cell reference or a literal number
      const cellRef = parseCellRef(trimmed);
      if (cellRef) {
        values.push(getCellNumericValue(trimmed.replace(/\$/g, '').toUpperCase(), data, visitedCells));
      } else {
        const num = parseFloat(trimmed);
        if (!isNaN(num)) values.push(num);
      }
    }
  }
  return values;
}

/** Get the numeric value of a cell, evaluating its formula if necessary */
function getCellNumericValue(
  key: string,
  data: SpreadsheetData,
  visitedCells: Set<string>
): number {
  const cell = data[key.toUpperCase()];
  if (!cell) return 0;

  if (cell.formula) {
    const result = evaluateFormula(cell.formula, data, new Set(visitedCells), key.toUpperCase());
    if (result === '#CIRCULAR!' || result === '#ERROR!' || result === '#DIV/0!' || result === '#N/A!') {
      return NaN;
    }
    const num = parseFloat(result);
    return isNaN(num) ? 0 : num;
  }

  const num = parseFloat(cell.value);
  return isNaN(num) ? 0 : num;
}

/** Safe math evaluation supporting +, -, *, /, ^, parentheses */
function safeMathEval(expr: string): number {
  // Tokenize the expression
  const tokens = tokenize(expr);
  if (tokens.length === 0) return NaN;
  const result = parseAddSub(tokens, { pos: 0 });
  return result;
}

interface TokenPos {
  pos: number;
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    if (s[i] === ' ') {
      i++;
      continue;
    }
    if ('+-*/^()'.includes(s[i])) {
      tokens.push(s[i]);
      i++;
    } else if (/[0-9.]/.test(s[i])) {
      let num = '';
      while (i < s.length && /[0-9.eE]/.test(s[i])) {
        num += s[i];
        i++;
      }
      tokens.push(num);
    } else {
      // Unknown char, skip
      i++;
    }
  }
  return tokens;
}

function parseAddSub(tokens: string[], tp: TokenPos): number {
  let left = parseMulDiv(tokens, tp);
  while (tp.pos < tokens.length && (tokens[tp.pos] === '+' || tokens[tp.pos] === '-')) {
    const op = tokens[tp.pos];
    tp.pos++;
    const right = parseMulDiv(tokens, tp);
    if (op === '+') left += right;
    else left -= right;
  }
  return left;
}

function parseMulDiv(tokens: string[], tp: TokenPos): number {
  let left = parsePower(tokens, tp);
  while (tp.pos < tokens.length && (tokens[tp.pos] === '*' || tokens[tp.pos] === '/')) {
    const op = tokens[tp.pos];
    tp.pos++;
    const right = parsePower(tokens, tp);
    if (op === '*') left *= right;
    else left = right !== 0 ? left / right : NaN;
  }
  return left;
}

function parsePower(tokens: string[], tp: TokenPos): number {
  let base = parseUnary(tokens, tp);
  while (tp.pos < tokens.length && tokens[tp.pos] === '^') {
    tp.pos++;
    const exp = parseUnary(tokens, tp);
    base = Math.pow(base, exp);
  }
  return base;
}

function parseUnary(tokens: string[], tp: TokenPos): number {
  if (tp.pos < tokens.length && tokens[tp.pos] === '-') {
    tp.pos++;
    return -parseAtom(tokens, tp);
  }
  if (tp.pos < tokens.length && tokens[tp.pos] === '+') {
    tp.pos++;
  }
  return parseAtom(tokens, tp);
}

function parseAtom(tokens: string[], tp: TokenPos): number {
  if (tp.pos >= tokens.length) return NaN;
  if (tokens[tp.pos] === '(') {
    tp.pos++;
    const val = parseAddSub(tokens, tp);
    if (tp.pos < tokens.length && tokens[tp.pos] === ')') {
      tp.pos++;
    }
    return val;
  }
  const val = parseFloat(tokens[tp.pos]);
  tp.pos++;
  return val;
}

function formatNumber(n: number): string {
  if (isNaN(n)) return '#ERROR!';
  if (!isFinite(n)) return '#DIV/0!';
  // Remove trailing zeroes after decimal point
  const s = n.toPrecision(12);
  return parseFloat(s).toString();
}

/** Get the display value for a cell (evaluate formula if needed) */
function getDisplayValue(
  key: string,
  data: SpreadsheetData
): string {
  const cell = data[key];
  if (!cell) return '';
  if (cell.formula) {
    return evaluateFormula(cell.formula, data, new Set(), key);
  }
  return cell.value;
}

// ---------------------------------------------------------------------------
// CSV Helpers
// ---------------------------------------------------------------------------

function dataToCSV(data: SpreadsheetData): string {
  // Find the bounding box of data
  let maxCol = 0;
  let maxRow = 0;
  for (const key of Object.keys(data)) {
    const parsed = parseCellRef(key);
    if (parsed) {
      maxCol = Math.max(maxCol, parsed.col);
      maxRow = Math.max(maxRow, parsed.row);
    }
  }

  const rows: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const cols: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const key = cellKey(c, r);
      const display = getDisplayValue(key, data);
      // Escape commas and quotes in CSV
      if (display.includes(',') || display.includes('"') || display.includes('\n')) {
        cols.push(`"${display.replace(/"/g, '""')}"`);
      } else {
        cols.push(display);
      }
    }
    rows.push(cols.join(','));
  }
  return rows.join('\n');
}

function csvToData(csv: string): SpreadsheetData {
  const data: SpreadsheetData = {};
  const lines = parseCSVLines(csv);

  for (let r = 0; r < lines.length; r++) {
    const cols = lines[r];
    for (let c = 0; c < cols.length && c < TOTAL_COLS; c++) {
      const val = cols[c].trim();
      if (val) {
        const key = cellKey(c, r);
        if (val.startsWith('=')) {
          data[key] = { value: '', formula: val };
        } else {
          data[key] = { value: val };
        }
      }
    }
  }
  return data;
}

/** Parse CSV respecting quoted fields */
function parseCSVLines(csv: string): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < csv.length) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        current.push(field);
        field = '';
        result.push(current);
        current = [];
        if (ch === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push last field and row
  if (field || current.length > 0) {
    current.push(field);
    result.push(current);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SheetsApp: React.FC = () => {
  // Data
  const [data, setData] = useState<SpreadsheetData>({});
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [sheetName, setSheetName] = useState('Untitled Spreadsheet');

  // Selection
  const [selectedCol, setSelectedCol] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  // Scroll / virtual rendering
  const [scrollTop, setScrollTop] = useState(0);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persistence
  const [useKernel, setUseKernel] = useState(false);
  const [sheets, setSheets] = useState<SheetFile[]>([]);
  const [activeSheetPath, setActiveSheetPath] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showSheetList, setShowSheetList] = useState(false);

  // Column resize
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // ---------------------------------------------------------------------------
  // Initialize: check kernel, load sheets list
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
      loadSheetsList();
    } else {
      const saved = localStorage.getItem('aether_sheets_current');
      if (saved) {
        try {
          const doc: SheetDocument = JSON.parse(saved);
          setData(doc.data || {});
          setColumnWidths(doc.columnWidths || {});
          setSheetName(doc.name || 'Untitled Spreadsheet');
        } catch {
          // ignore
        }
      }
      const savedList = localStorage.getItem('aether_sheets_list');
      if (savedList) {
        try {
          setSheets(JSON.parse(savedList));
        } catch {
          // ignore
        }
      }
    }
  }, []);

  const loadSheetsList = async () => {
    const client = getKernelClient();
    try {
      await client.mkdir(SHEETS_DIR).catch(() => {});
      const entries = await client.listDir(SHEETS_DIR);
      const jsonFiles = entries
        .filter((e: any) => e.type === 'file' && e.name.endsWith('.json'))
        .map((e: any) => ({ name: e.name.replace('.json', ''), path: e.path || `${SHEETS_DIR}/${e.name}` }));
      setSheets(jsonFiles);
    } catch (err) {
      console.error('[SheetsApp] Failed to load sheets list:', err);
    }
  };

  const loadSheet = async (path: string, name: string) => {
    if (useKernel) {
      const client = getKernelClient();
      try {
        const { content } = await client.readFile(path);
        const doc: SheetDocument = JSON.parse(content);
        setData(doc.data || {});
        setColumnWidths(doc.columnWidths || {});
        setSheetName(doc.name || name);
        setActiveSheetPath(path);
      } catch (err) {
        console.error('[SheetsApp] Failed to load sheet:', err);
      }
    } else {
      const saved = localStorage.getItem(`aether_sheet_${name}`);
      if (saved) {
        try {
          const doc: SheetDocument = JSON.parse(saved);
          setData(doc.data || {});
          setColumnWidths(doc.columnWidths || {});
          setSheetName(doc.name || name);
          setActiveSheetPath(path);
        } catch {
          // ignore
        }
      }
    }
    setShowSheetList(false);
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    const doc: SheetDocument = { name: sheetName, data, columnWidths };
    const json = JSON.stringify(doc, null, 2);

    if (useKernel) {
      const client = getKernelClient();
      try {
        await client.mkdir(SHEETS_DIR).catch(() => {});
        const path = activeSheetPath || `${SHEETS_DIR}/${sheetName}.json`;
        await client.writeFile(path, json);
        setActiveSheetPath(path);
        await loadSheetsList();
      } catch (err) {
        console.error('[SheetsApp] Failed to save sheet:', err);
      }
    } else {
      localStorage.setItem('aether_sheets_current', json);
      localStorage.setItem(`aether_sheet_${sheetName}`, json);
      // Update sheets list
      const listStr = localStorage.getItem('aether_sheets_list');
      let list: SheetFile[] = [];
      try {
        list = listStr ? JSON.parse(listStr) : [];
      } catch {
        list = [];
      }
      const path = `${SHEETS_DIR}/${sheetName}.json`;
      if (!list.find((s) => s.name === sheetName)) {
        list.push({ name: sheetName, path });
      }
      localStorage.setItem('aether_sheets_list', JSON.stringify(list));
      setSheets(list);
      setActiveSheetPath(path);
    }

    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, [data, columnWidths, sheetName, useKernel, activeSheetPath]);

  // Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // ---------------------------------------------------------------------------
  // New sheet
  // ---------------------------------------------------------------------------

  const handleNewSheet = () => {
    setData({});
    setColumnWidths({});
    setSheetName('Untitled Spreadsheet');
    setActiveSheetPath(null);
    setSelectedCol(0);
    setSelectedRow(0);
    setEditing(false);
  };

  // ---------------------------------------------------------------------------
  // Delete sheet
  // ---------------------------------------------------------------------------

  const handleDeleteSheet = async (path: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (useKernel) {
      const client = getKernelClient();
      try {
        await client.rm(path);
        await loadSheetsList();
      } catch {
        // ignore
      }
    } else {
      localStorage.removeItem(`aether_sheet_${name}`);
      const list = sheets.filter((s) => s.path !== path);
      setSheets(list);
      localStorage.setItem('aether_sheets_list', JSON.stringify(list));
    }
    if (activeSheetPath === path) {
      handleNewSheet();
    }
  };

  // ---------------------------------------------------------------------------
  // Cell operations
  // ---------------------------------------------------------------------------

  const selectedKey = cellKey(selectedCol, selectedRow);

  const getCellDisplayValue = useCallback(
    (key: string): string => {
      return getDisplayValue(key, data);
    },
    [data]
  );

  const getCellEditValue = useCallback(
    (key: string): string => {
      const cell = data[key];
      if (!cell) return '';
      return cell.formula || cell.value;
    },
    [data]
  );

  const setCellValue = useCallback(
    (key: string, rawValue: string) => {
      setData((prev) => {
        const next = { ...prev };
        if (!rawValue) {
          delete next[key];
        } else if (rawValue.startsWith('=')) {
          next[key] = { value: '', formula: rawValue };
        } else {
          next[key] = { value: rawValue };
        }
        return next;
      });
    },
    []
  );

  const startEditing = useCallback(
    (col: number, row: number) => {
      setSelectedCol(col);
      setSelectedRow(row);
      setEditing(true);
      const key = cellKey(col, row);
      setEditValue(getCellEditValue(key));
    },
    [getCellEditValue]
  );

  const commitEdit = useCallback(() => {
    if (editing) {
      setCellValue(selectedKey, editValue);
      setEditing(false);
    }
  }, [editing, editValue, selectedKey, setCellValue]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditValue('');
  }, []);

  // Focus the edit input whenever entering edit mode
  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editing]);

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return; // handled by input

      const { key, shiftKey } = e;

      switch (key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedRow((r) => Math.max(0, r - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedRow((r) => Math.min(TOTAL_ROWS - 1, r + 1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setSelectedCol((c) => Math.max(0, c - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setSelectedCol((c) => Math.min(TOTAL_COLS - 1, c + 1));
          break;
        case 'Tab':
          e.preventDefault();
          if (shiftKey) {
            setSelectedCol((c) => Math.max(0, c - 1));
          } else {
            setSelectedCol((c) => {
              if (c < TOTAL_COLS - 1) return c + 1;
              // Wrap to next row
              setSelectedRow((r) => Math.min(TOTAL_ROWS - 1, r + 1));
              return 0;
            });
          }
          break;
        case 'Enter':
          e.preventDefault();
          startEditing(selectedCol, selectedRow);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          setCellValue(selectedKey, '');
          break;
        case 'F2':
          e.preventDefault();
          startEditing(selectedCol, selectedRow);
          break;
        default:
          // Start typing to enter edit mode
          if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            setEditing(true);
            setEditValue(key);
          }
          break;
      }
    },
    [editing, selectedCol, selectedRow, selectedKey, startEditing, setCellValue]
  );

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          commitEdit();
          setSelectedRow((r) => Math.min(TOTAL_ROWS - 1, r + 1));
          break;
        case 'Tab':
          e.preventDefault();
          commitEdit();
          if (e.shiftKey) {
            setSelectedCol((c) => Math.max(0, c - 1));
          } else {
            setSelectedCol((c) => Math.min(TOTAL_COLS - 1, c + 1));
          }
          break;
        case 'Escape':
          e.preventDefault();
          cancelEdit();
          break;
      }
    },
    [commitEdit, cancelEdit]
  );

  // ---------------------------------------------------------------------------
  // Formula bar
  // ---------------------------------------------------------------------------

  const handleFormulaBarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditValue(e.target.value);
      if (!editing) {
        setEditing(true);
      }
    },
    [editing]
  );

  const handleFormulaBarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
        // Return focus to grid
        gridContainerRef.current?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        gridContainerRef.current?.focus();
      }
    },
    [commitEdit, cancelEdit]
  );

  // Sync editValue when selection changes (not editing)
  useEffect(() => {
    if (!editing) {
      setEditValue(getCellEditValue(selectedKey));
    }
  }, [selectedKey, editing, getCellEditValue]);

  // ---------------------------------------------------------------------------
  // Virtual scrolling
  // ---------------------------------------------------------------------------

  const totalHeight = TOTAL_ROWS * ROW_HEIGHT;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const containerHeight = gridContainerRef.current?.clientHeight || 600;
  const visibleStartRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_ROW_BUFFER);
  const visibleEndRow = Math.min(
    TOTAL_ROWS - 1,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + VISIBLE_ROW_BUFFER
  );

  // Auto-scroll to keep selected cell visible
  useEffect(() => {
    if (!gridContainerRef.current) return;
    const container = gridContainerRef.current;
    const cellTop = selectedRow * ROW_HEIGHT;
    const cellBottom = cellTop + ROW_HEIGHT;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (cellTop < viewTop) {
      container.scrollTop = cellTop;
    } else if (cellBottom > viewBottom) {
      container.scrollTop = cellBottom - container.clientHeight;
    }
  }, [selectedRow]);

  // ---------------------------------------------------------------------------
  // Column widths
  // ---------------------------------------------------------------------------

  const getColWidth = useCallback(
    (colIndex: number): number => {
      return columnWidths[colIndex] || DEFAULT_COL_WIDTH;
    },
    [columnWidths]
  );

  const totalGridWidth = useMemo(() => {
    let w = 0;
    for (let c = 0; c < TOTAL_COLS; c++) {
      w += getColWidth(c);
    }
    return w;
  }, [getColWidth]);

  const colLeftOffsets = useMemo(() => {
    const offsets: number[] = [];
    let x = 0;
    for (let c = 0; c < TOTAL_COLS; c++) {
      offsets.push(x);
      x += getColWidth(c);
    }
    return offsets;
  }, [getColWidth]);

  // Column resize handlers
  const handleResizeMouseDown = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizingCol(colIndex);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = getColWidth(colIndex);
    },
    [getColWidth]
  );

  useEffect(() => {
    if (resizingCol === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(40, resizeStartWidth.current + delta);
      setColumnWidths((prev) => ({ ...prev, [resizingCol]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizingCol(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol]);

  // ---------------------------------------------------------------------------
  // CSV Import / Export
  // ---------------------------------------------------------------------------

  const handleExportCSV = useCallback(() => {
    const csv = dataToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sheetName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [data, sheetName]);

  const handleImportCSV = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (text) {
          const imported = csvToData(text);
          setData(imported);
          setSheetName(file.name.replace(/\.csv$/i, ''));
          setSelectedCol(0);
          setSelectedRow(0);
        }
      };
      reader.readAsText(file);

      // Reset input so the same file can be re-imported
      e.target.value = '';
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Click outside to close sheet list
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!showSheetList) return;
    const handler = (_e: MouseEvent) => {
      setShowSheetList(false);
    };
    // Delay adding the listener so the click that opened it doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener('click', handler, { once: true });
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handler);
    };
  }, [showSheetList]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Build visible rows
  const visibleRows: React.ReactNode[] = [];
  for (let r = visibleStartRow; r <= visibleEndRow; r++) {
    const rowTop = r * ROW_HEIGHT;

    const cells: React.ReactNode[] = [];
    for (let c = 0; c < TOTAL_COLS; c++) {
      const key = cellKey(c, r);
      const isSelected = c === selectedCol && r === selectedRow;
      const w = getColWidth(c);
      const left = colLeftOffsets[c];

      const displayVal = getCellDisplayValue(key);

      cells.push(
        <div
          key={key}
          className={`absolute border-r border-b border-gray-200 box-border overflow-hidden whitespace-nowrap text-ellipsis px-1 text-sm leading-[28px] cursor-cell select-none ${
            isSelected
              ? 'z-10 ring-2 ring-blue-500 ring-inset bg-white'
              : 'bg-white hover:bg-blue-50/30'
          }`}
          style={{
            left: left,
            top: 0,
            width: w,
            height: ROW_HEIGHT,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (editing) commitEdit();
            setSelectedCol(c);
            setSelectedRow(r);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditing(c, r);
          }}
        >
          {isSelected && editing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={commitEdit}
              className="w-full h-full bg-white outline-none text-sm border-none p-0 m-0"
              style={{ lineHeight: `${ROW_HEIGHT}px` }}
            />
          ) : (
            <span
              className={`${
                displayVal.startsWith('#') ? 'text-red-500 font-medium' : 'text-gray-800'
              }`}
            >
              {displayVal}
            </span>
          )}
        </div>
      );
    }

    visibleRows.push(
      <div
        key={`row-${r}`}
        className="absolute left-0 flex"
        style={{
          top: rowTop,
          height: ROW_HEIGHT,
          width: totalGridWidth,
        }}
      >
        {cells}
      </div>
    );
  }

  // Build row number gutter for visible rows
  const rowNumbers: React.ReactNode[] = [];
  for (let r = visibleStartRow; r <= visibleEndRow; r++) {
    const rowTop = r * ROW_HEIGHT;
    const isSelectedRow = r === selectedRow;
    rowNumbers.push(
      <div
        key={`rn-${r}`}
        className={`absolute left-0 border-b border-r border-gray-200 text-center text-xs font-medium select-none leading-[28px] ${
          isSelectedRow ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-50 text-gray-500'
        }`}
        style={{
          top: rowTop,
          width: ROW_NUMBER_WIDTH,
          height: ROW_HEIGHT,
        }}
        onClick={() => {
          if (editing) commitEdit();
          setSelectedRow(r);
        }}
      >
        {r + 1}
      </div>
    );
  }

  // Column headers
  const colHeaders: React.ReactNode[] = [];
  for (let c = 0; c < TOTAL_COLS; c++) {
    const w = getColWidth(c);
    const left = colLeftOffsets[c];
    const isSelectedCol = c === selectedCol;

    colHeaders.push(
      <div
        key={`ch-${c}`}
        className={`absolute border-r border-b border-gray-300 text-center text-xs font-bold select-none leading-[28px] ${
          isSelectedCol ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
        }`}
        style={{
          left: left,
          top: 0,
          width: w,
          height: HEADER_HEIGHT,
        }}
        onClick={() => {
          if (editing) commitEdit();
          setSelectedCol(c);
        }}
      >
        {colIndexToLetter(c)}
        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 w-[5px] h-full cursor-col-resize hover:bg-blue-400 z-20"
          onMouseDown={(e) => handleResizeMouseDown(c, e)}
        />
      </div>
    );
  }

  const cellCount = Object.keys(data).length;

  return (
    <div className="flex flex-col h-full bg-[#1a1d26] text-white overflow-hidden">
      {/* Top toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-[#1a1d26] border-b border-[#2a2d3a] shrink-0">
        {/* Sheet name */}
        <div className="relative">
          <button
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[#2a2d3a] transition-colors text-sm font-medium"
            onClick={(e) => {
              e.stopPropagation();
              setShowSheetList(!showSheetList);
            }}
          >
            <FileSpreadsheet size={14} className="text-green-400" />
            <span className="max-w-[160px] truncate">{sheetName}</span>
            <ChevronDown size={12} className="text-gray-400" />
          </button>
          {showSheetList && (
            <div
              className="absolute top-full left-0 mt-1 w-64 bg-[#252836] border border-[#3a3d4a] rounded-lg shadow-xl z-50 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-2 border-b border-[#3a3d4a] flex items-center justify-between">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Spreadsheets</span>
                <button
                  onClick={handleNewSheet}
                  className="p-1 hover:bg-[#3a3d4a] rounded transition-colors text-gray-400 hover:text-white"
                  title="New Spreadsheet"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-1">
                {sheets.length === 0 && (
                  <div className="text-xs text-gray-500 p-3 text-center">
                    No saved spreadsheets.
                  </div>
                )}
                {sheets.map((sheet) => (
                  <button
                    key={sheet.path}
                    onClick={() => loadSheet(sheet.path, sheet.name)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 group transition-colors ${
                      activeSheetPath === sheet.path
                        ? 'bg-blue-500/20 text-blue-300 font-medium'
                        : 'text-gray-300 hover:bg-[#3a3d4a]'
                    }`}
                  >
                    <FileSpreadsheet size={14} className="shrink-0 text-green-400" />
                    <span className="truncate flex-1">{sheet.name}</span>
                    <button
                      onClick={(e) => handleDeleteSheet(sheet.path, sheet.name, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Editable sheet name */}
        <input
          type="text"
          value={sheetName}
          onChange={(e) => setSheetName(e.target.value)}
          className="bg-transparent border border-transparent hover:border-[#3a3d4a] focus:border-blue-500 rounded px-2 py-0.5 text-sm text-gray-300 outline-none w-40 transition-colors"
          title="Rename spreadsheet"
        />

        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-300 hover:bg-[#2a2d3a] hover:text-white transition-colors"
          title="Import CSV"
        >
          <Upload size={13} />
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleImportCSV}
          className="hidden"
        />

        <button
          onClick={handleExportCSV}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-300 hover:bg-[#2a2d3a] hover:text-white transition-colors"
          title="Export CSV"
        >
          <Download size={13} />
          Export
        </button>

        <button
          onClick={handleNewSheet}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-300 hover:bg-[#2a2d3a] hover:text-white transition-colors"
          title="New Sheet"
        >
          <Plus size={13} />
          New
        </button>

        <button
          onClick={handleSave}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
        >
          {showSaved ? <Check size={13} /> : <Save size={13} />}
          {showSaved ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Formula bar */}
      <div className="flex items-center gap-0 bg-[#f8f9fa] border-b border-gray-300 shrink-0 h-8">
        {/* Cell reference indicator */}
        <div className="w-[80px] h-full flex items-center justify-center border-r border-gray-300 bg-gray-100 text-gray-700 font-medium text-sm select-none shrink-0">
          {selectedKey}
        </div>
        {/* fx label */}
        <div className="w-8 h-full flex items-center justify-center text-gray-400 text-sm italic font-serif shrink-0">
          fx
        </div>
        {/* Formula / value input */}
        <input
          ref={formulaInputRef}
          type="text"
          value={editing ? editValue : getCellEditValue(selectedKey)}
          onChange={handleFormulaBarChange}
          onKeyDown={handleFormulaBarKeyDown}
          onFocus={() => {
            if (!editing) {
              setEditing(true);
              setEditValue(getCellEditValue(selectedKey));
            }
          }}
          className="flex-1 h-full px-2 text-sm text-gray-800 bg-white outline-none border-none focus:ring-1 focus:ring-blue-400 focus:ring-inset"
          placeholder="Enter value or formula (e.g., =SUM(A1:A10))"
        />
      </div>

      {/* Grid area */}
      <div className="flex-1 flex overflow-hidden bg-white">
        {/* Row number gutter + corner */}
        <div className="shrink-0 relative" style={{ width: ROW_NUMBER_WIDTH }}>
          {/* Corner cell (top-left) */}
          <div
            className="sticky top-0 z-30 bg-gray-100 border-r border-b border-gray-300"
            style={{ width: ROW_NUMBER_WIDTH, height: HEADER_HEIGHT }}
          />
          {/* Row numbers container - scrolls with grid vertically */}
          <div
            className="relative overflow-hidden"
            style={{ height: `calc(100% - ${HEADER_HEIGHT}px)` }}
          >
            <div
              style={{
                height: totalHeight,
                position: 'relative',
                transform: `translateY(-${scrollTop}px)`,
              }}
            >
              {rowNumbers}
            </div>
          </div>
        </div>

        {/* Main grid section */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Column headers (horizontally scrollable, vertically fixed) */}
          <div
            className="shrink-0 overflow-hidden"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              className="relative"
              style={{
                width: totalGridWidth,
                height: HEADER_HEIGHT,
                marginLeft: 0,
                transform: gridContainerRef.current
                  ? `translateX(-${gridContainerRef.current.scrollLeft}px)`
                  : undefined,
              }}
            >
              {colHeaders}
            </div>
          </div>

          {/* Scrollable cell grid */}
          <div
            ref={gridContainerRef}
            className="flex-1 overflow-auto outline-none focus:outline-none"
            tabIndex={0}
            onScroll={(e) => {
              handleScroll(e);
              // Also sync column headers horizontal scroll
              const scrollLeft = e.currentTarget.scrollLeft;
              const headerContainer = e.currentTarget.previousElementSibling?.firstChild as HTMLElement;
              if (headerContainer) {
                headerContainer.style.transform = `translateX(-${scrollLeft}px)`;
              }
              // Sync row number vertical scroll
              const rowNumContainer = e.currentTarget.parentElement?.previousElementSibling;
              if (rowNumContainer) {
                const inner = rowNumContainer.children[1]?.firstChild as HTMLElement;
                if (inner) {
                  inner.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
                }
              }
            }}
            onKeyDown={handleGridKeyDown}
            onClick={() => {
              // Click on empty area keeps focus on grid
            }}
          >
            <div
              style={{
                width: totalGridWidth,
                height: totalHeight,
                position: 'relative',
              }}
            >
              {visibleRows}
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#1a1d26] border-t border-[#2a2d3a] text-xs text-gray-400 shrink-0 select-none">
        <div className="flex items-center gap-4">
          <span>{cellCount} cell{cellCount !== 1 ? 's' : ''} with data</span>
          <span>Selected: {selectedKey}</span>
          {editing && <span className="text-blue-400">Editing</span>}
        </div>
        <div className="flex items-center gap-4">
          <span>{TOTAL_COLS} cols x {TOTAL_ROWS} rows</span>
          <span className="text-gray-500">{useKernel ? 'Kernel FS' : 'localStorage'}</span>
        </div>
      </div>
    </div>
  );
};
