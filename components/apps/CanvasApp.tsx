import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Pencil,
  Minus,
  Square,
  Circle,
  ArrowUpRight,
  Eraser,
  Type,
  MousePointer,
  Download,
  Save,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Trash2,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolType = 'select' | 'pen' | 'line' | 'rect' | 'circle' | 'arrow' | 'eraser' | 'text';

interface Shape {
  id: string;
  type: 'pen' | 'line' | 'rect' | 'circle' | 'arrow' | 'text';
  points?: { x: number; y: number }[];
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  text?: string;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fill: boolean;
}

interface CanvasState {
  shapes: Shape[];
  pan: { x: number; y: number };
  zoom: number;
}

type HandleDirection = 'nw' | 'ne' | 'sw' | 'se';

const CANVAS_DIR = '/home/root/Documents/canvas';
const STORAGE_KEY = 'aether_canvas_state';
const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function getShapeBounds(shape: Shape): { x: number; y: number; w: number; h: number } {
  switch (shape.type) {
    case 'pen': {
      if (!shape.points || shape.points.length === 0) {
        return { x: shape.x, y: shape.y, w: 0, h: 0 };
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'line':
    case 'arrow': {
      const x1 = shape.x;
      const y1 = shape.y;
      const x2 = shape.x2 ?? shape.x;
      const y2 = shape.y2 ?? shape.y;
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      return { x: minX, y: minY, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    case 'rect':
    case 'circle':
    case 'text': {
      return {
        x: shape.x,
        y: shape.y,
        w: shape.width ?? 0,
        h: shape.height ?? 0,
      };
    }
    default:
      return { x: shape.x, y: shape.y, w: 0, h: 0 };
  }
}

function pointInShape(px: number, py: number, shape: Shape, tolerance: number): boolean {
  const bounds = getShapeBounds(shape);
  const pad = tolerance + shape.strokeWidth / 2;

  switch (shape.type) {
    case 'pen': {
      if (!shape.points || shape.points.length < 2) {
        return Math.abs(px - shape.x) < pad && Math.abs(py - shape.y) < pad;
      }
      for (let i = 1; i < shape.points.length; i++) {
        const a = shape.points[i - 1];
        const b = shape.points[i];
        if (distToSegment(px, py, a.x, a.y, b.x, b.y) < pad) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow': {
      const x2 = shape.x2 ?? shape.x;
      const y2 = shape.y2 ?? shape.y;
      return distToSegment(px, py, shape.x, shape.y, x2, y2) < pad;
    }
    case 'rect': {
      if (shape.fill) {
        return (
          px >= bounds.x - pad &&
          px <= bounds.x + bounds.w + pad &&
          py >= bounds.y - pad &&
          py <= bounds.y + bounds.h + pad
        );
      }
      const inside =
        px >= bounds.x - pad &&
        px <= bounds.x + bounds.w + pad &&
        py >= bounds.y - pad &&
        py <= bounds.y + bounds.h + pad;
      const deepInside =
        px >= bounds.x + pad &&
        px <= bounds.x + bounds.w - pad &&
        py >= bounds.y + pad &&
        py <= bounds.y + bounds.h - pad;
      return inside && !deepInside;
    }
    case 'circle': {
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;
      const rx = bounds.w / 2;
      const ry = bounds.h / 2;
      if (rx === 0 || ry === 0) return false;
      const normDist = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
      if (shape.fill) {
        return normDist <= (1 + pad / Math.min(rx, ry)) ** 2;
      }
      return Math.abs(Math.sqrt(normDist) - 1) < pad / Math.min(rx, ry);
    }
    case 'text': {
      return (
        px >= bounds.x - pad &&
        px <= bounds.x + bounds.w + pad &&
        py >= bounds.y - pad &&
        py <= bounds.y + bounds.h + pad
      );
    }
    default:
      return false;
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CanvasApp: React.FC = () => {
  // -- Refs --
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // -- Drawing state --
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [fillColor, setFillColor] = useState('#3b82f6');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fillEnabled, setFillEnabled] = useState(false);

  // -- Pan / Zoom --
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // -- Selection --
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resizingHandle, setResizingHandle] = useState<HandleDirection | null>(null);

  // -- Interaction tracking --
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentShape, setCurrentShape] = useState<Shape | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [resizeAnchor, setResizeAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // -- Text input --
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

  // -- History --
  const [history, setHistory] = useState<Shape[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // -- Persistence --
  const [useKernel, setUseKernel] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [fileName, setFileName] = useState('canvas_01');

  // Stable refs for event handlers
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const historyRef = useRef(history);
  historyRef.current = history;
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;

  // -------------------------------------------------------------------------
  // Initialization: check kernel, load saved state
  // -------------------------------------------------------------------------

  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
      loadFromKernel();
    } else {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed: CanvasState = JSON.parse(raw);
          if (parsed.shapes) {
            setShapes(parsed.shapes);
            setHistory([parsed.shapes]);
            setHistoryIndex(0);
          }
          if (parsed.pan) setPan(parsed.pan);
          if (parsed.zoom) setZoom(parsed.zoom);
        } catch {
          // ignore parse errors
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFromKernel = async () => {
    const client = getKernelClient();
    try {
      await client.mkdir(CANVAS_DIR).catch(() => {});
      const { content } = await client.readFile(`${CANVAS_DIR}/${fileName}.json`);
      const parsed: CanvasState = JSON.parse(content);
      if (parsed.shapes) {
        setShapes(parsed.shapes);
        setHistory([parsed.shapes]);
        setHistoryIndex(0);
      }
      if (parsed.pan) setPan(parsed.pan);
      if (parsed.zoom) setZoom(parsed.zoom);
    } catch {
      // No saved file yet, start with empty canvas
    }
  };

  // -------------------------------------------------------------------------
  // History management
  // -------------------------------------------------------------------------

  const pushHistory = useCallback((newShapes: Shape[]) => {
    setHistory(prev => {
      const truncated = prev.slice(0, historyIndexRef.current + 1);
      const updated = [...truncated, newShapes];
      if (updated.length > MAX_HISTORY) {
        updated.shift();
        return updated;
      }
      return updated;
    });
    setHistoryIndex(prev => {
      const next = Math.min(prev + 1, MAX_HISTORY - 1);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const newIdx = historyIndexRef.current - 1;
      setHistoryIndex(newIdx);
      setShapes(historyRef.current[newIdx]);
      setSelectedId(null);
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const newIdx = historyIndexRef.current + 1;
      setHistoryIndex(newIdx);
      setShapes(historyRef.current[newIdx]);
      setSelectedId(null);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Save / Load
  // -------------------------------------------------------------------------

  const saveCanvas = useCallback(async () => {
    const state: CanvasState = {
      shapes: shapesRef.current,
      pan: panRef.current,
      zoom: zoomRef.current,
    };

    setSaveStatus('saving');

    const client = getKernelClient();
    if (client.connected) {
      try {
        await client.mkdir(CANVAS_DIR).catch(() => {});
        await client.writeFile(`${CANVAS_DIR}/${fileName}.json`, JSON.stringify(state, null, 2));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      } catch {
        // Fall through to localStorage
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [fileName]);

  // -------------------------------------------------------------------------
  // Screen <-> Canvas coordinate conversion
  // -------------------------------------------------------------------------

  const screenToCanvas = useCallback(
    (sx: number, sy: number): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: sx, y: sy };
      return {
        x: (sx - rect.left - panRef.current.x) / zoomRef.current,
        y: (sy - rect.top - panRef.current.y) / zoomRef.current,
      };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw grid pattern
    ctx.save();
    ctx.translate(panRef.current.x, panRef.current.y);
    ctx.scale(zoomRef.current, zoomRef.current);

    const gridSize = 40;
    const startX = Math.floor(-panRef.current.x / zoomRef.current / gridSize) * gridSize - gridSize;
    const startY = Math.floor(-panRef.current.y / zoomRef.current / gridSize) * gridSize - gridSize;
    const endX = startX + rect.width / zoomRef.current + gridSize * 2;
    const endY = startY + rect.height / zoomRef.current + gridSize * 2;

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5 / zoomRef.current;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();

    // Draw all shapes
    const allShapes = [...shapesRef.current];
    if (currentShape) {
      allShapes.push(currentShape);
    }

    for (const shape of allShapes) {
      drawShape(ctx, shape);
    }

    // Draw selection box
    if (selectedIdRef.current) {
      const sel = shapesRef.current.find(s => s.id === selectedIdRef.current);
      if (sel) {
        const bounds = getShapeBounds(sel);
        const pad = 6 / zoomRef.current;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / zoomRef.current;
        ctx.setLineDash([4 / zoomRef.current, 4 / zoomRef.current]);
        ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
        ctx.setLineDash([]);

        // Draw resize handles
        const handleSize = 8 / zoomRef.current;
        const handles = [
          { dir: 'nw', x: bounds.x - pad, y: bounds.y - pad },
          { dir: 'ne', x: bounds.x + bounds.w + pad, y: bounds.y - pad },
          { dir: 'sw', x: bounds.x - pad, y: bounds.y + bounds.h + pad },
          { dir: 'se', x: bounds.x + bounds.w + pad, y: bounds.y + bounds.h + pad },
        ];
        for (const h of handles) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1.5 / zoomRef.current;
          ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        }
      }
    }

    ctx.restore();
  }, [currentShape]);

  const drawShape = (ctx: CanvasRenderingContext2D, shape: Shape) => {
    ctx.save();
    ctx.strokeStyle = shape.strokeColor;
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.fill && shape.fillColor) {
      ctx.fillStyle = shape.fillColor;
    }

    switch (shape.type) {
      case 'pen': {
        if (!shape.points || shape.points.length < 2) {
          if (shape.points && shape.points.length === 1) {
            ctx.beginPath();
            ctx.arc(shape.points[0].x, shape.points[0].y, shape.strokeWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = shape.strokeColor;
            ctx.fill();
          }
          break;
        }
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        ctx.stroke();
        break;
      }
      case 'line': {
        const x2 = shape.x2 ?? shape.x;
        const y2 = shape.y2 ?? shape.y;
        ctx.beginPath();
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      }
      case 'rect': {
        const w = shape.width ?? 0;
        const h = shape.height ?? 0;
        if (shape.fill) {
          ctx.fillRect(shape.x, shape.y, w, h);
        }
        ctx.strokeRect(shape.x, shape.y, w, h);
        break;
      }
      case 'circle': {
        const w = shape.width ?? 0;
        const h = shape.height ?? 0;
        const cx = shape.x + w / 2;
        const cy = shape.y + h / 2;
        const rx = Math.abs(w) / 2;
        const ry = Math.abs(h) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (shape.fill) {
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
      case 'arrow': {
        const x2 = shape.x2 ?? shape.x;
        const y2 = shape.y2 ?? shape.y;
        ctx.beginPath();
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Arrowhead
        const angle = Math.atan2(y2 - shape.y, x2 - shape.x);
        const headLen = 12 + shape.strokeWidth * 2;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLen * Math.cos(angle - Math.PI / 6),
          y2 - headLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLen * Math.cos(angle + Math.PI / 6),
          y2 - headLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.stroke();
        break;
      }
      case 'text': {
        const fontSize = Math.max(14, shape.strokeWidth * 6);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = shape.strokeColor;
        ctx.textBaseline = 'top';
        const lines = (shape.text ?? '').split('\n');
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], shape.x, shape.y + i * (fontSize * 1.3));
        }
        break;
      }
    }

    ctx.restore();
  };

  // Trigger re-render whenever shapes, pan, zoom, selection, or currentShape changes
  useEffect(() => {
    renderCanvas();
  }, [shapes, pan, zoom, selectedId, currentShape, renderCanvas]);

  // Also resize on window resize
  useEffect(() => {
    const onResize = () => renderCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderCanvas]);

  // -------------------------------------------------------------------------
  // Keyboard handlers
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Space held for panning
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      }

      // Undo: Cmd/Ctrl + Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Redo: Cmd/Ctrl + Shift + Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      }

      // Save: Cmd/Ctrl + S
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveCanvas();
      }

      // Delete selected shape
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current && !textInput) {
        e.preventDefault();
        const newShapes = shapesRef.current.filter(s => s.id !== selectedIdRef.current);
        setShapes(newShapes);
        pushHistory(newShapes);
        setSelectedId(null);
      }

      // Escape to deselect / cancel text input
      if (e.key === 'Escape') {
        setSelectedId(null);
        if (textInput) {
          commitTextInput(textInput);
          setTextInput(null);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, saveCanvas, pushHistory, textInput]);

  // -------------------------------------------------------------------------
  // Text input handling
  // -------------------------------------------------------------------------

  const commitTextInput = useCallback(
    (input: { x: number; y: number; value: string }) => {
      if (!input.value.trim()) return;
      const fontSize = Math.max(14, strokeWidth * 6);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      let textW = input.value.length * fontSize * 0.6;
      if (ctx) {
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        textW = ctx.measureText(input.value).width;
      }

      const newShape: Shape = {
        id: generateId(),
        type: 'text',
        x: input.x,
        y: input.y,
        width: textW + 8,
        height: fontSize * 1.4,
        text: input.value,
        strokeColor,
        fillColor,
        strokeWidth,
        fill: false,
      };
      const newShapes = [...shapesRef.current, newShape];
      setShapes(newShapes);
      pushHistory(newShapes);
    },
    [strokeColor, fillColor, strokeWidth, pushHistory],
  );

  // -------------------------------------------------------------------------
  // Mouse handlers
  // -------------------------------------------------------------------------

  const getHandleAtPos = (cx: number, cy: number, shape: Shape): HandleDirection | null => {
    const bounds = getShapeBounds(shape);
    const pad = 6 / zoomRef.current;
    const hs = 10 / zoomRef.current;
    const handles: { dir: HandleDirection; hx: number; hy: number }[] = [
      { dir: 'nw', hx: bounds.x - pad, hy: bounds.y - pad },
      { dir: 'ne', hx: bounds.x + bounds.w + pad, hy: bounds.y - pad },
      { dir: 'sw', hx: bounds.x - pad, hy: bounds.y + bounds.h + pad },
      { dir: 'se', hx: bounds.x + bounds.w + pad, hy: bounds.y + bounds.h + pad },
    ];
    for (const h of handles) {
      if (Math.abs(cx - h.hx) < hs && Math.abs(cy - h.hy) < hs) {
        return h.dir;
      }
    }
    return null;
  };

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);

      // Commit pending text input
      if (textInput) {
        commitTextInput(textInput);
        setTextInput(null);
      }

      // Panning with space
      if (spaceHeld) {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y });
        return;
      }

      // Tool: Select
      if (activeTool === 'select') {
        // Check if clicking on a resize handle of the selected shape
        if (selectedId) {
          const sel = shapesRef.current.find(s => s.id === selectedId);
          if (sel) {
            const handle = getHandleAtPos(cx, cy, sel);
            if (handle) {
              const bounds = getShapeBounds(sel);
              setResizingHandle(handle);
              setResizeAnchor({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
              setDrawStart({ x: cx, y: cy });
              setIsDrawing(true);
              return;
            }
          }
        }

        // Check if clicking on any shape (iterate in reverse for topmost first)
        for (let i = shapesRef.current.length - 1; i >= 0; i--) {
          const shape = shapesRef.current[i];
          if (pointInShape(cx, cy, shape, 8 / zoomRef.current)) {
            setSelectedId(shape.id);
            setDragOffset({ x: cx - shape.x, y: cy - shape.y });
            setIsDrawing(true);
            return;
          }
        }

        // Clicked on empty space
        setSelectedId(null);
        return;
      }

      // Tool: Eraser
      if (activeTool === 'eraser') {
        for (let i = shapesRef.current.length - 1; i >= 0; i--) {
          const shape = shapesRef.current[i];
          if (pointInShape(cx, cy, shape, 12 / zoomRef.current)) {
            const newShapes = shapesRef.current.filter(s => s.id !== shape.id);
            setShapes(newShapes);
            pushHistory(newShapes);
            return;
          }
        }
        return;
      }

      // Tool: Text
      if (activeTool === 'text') {
        setTextInput({ x: cx, y: cy, value: '' });
        setTimeout(() => textInputRef.current?.focus(), 50);
        return;
      }

      // Start drawing shapes
      setIsDrawing(true);
      setDrawStart({ x: cx, y: cy });
      setSelectedId(null);

      if (activeTool === 'pen') {
        setCurrentShape({
          id: generateId(),
          type: 'pen',
          points: [{ x: cx, y: cy }],
          x: cx,
          y: cy,
          strokeColor,
          fillColor,
          strokeWidth,
          fill: fillEnabled,
        });
      } else if (activeTool === 'line') {
        setCurrentShape({
          id: generateId(),
          type: 'line',
          x: cx,
          y: cy,
          x2: cx,
          y2: cy,
          strokeColor,
          fillColor,
          strokeWidth,
          fill: false,
        });
      } else if (activeTool === 'rect') {
        setCurrentShape({
          id: generateId(),
          type: 'rect',
          x: cx,
          y: cy,
          width: 0,
          height: 0,
          strokeColor,
          fillColor,
          strokeWidth,
          fill: fillEnabled,
        });
      } else if (activeTool === 'circle') {
        setCurrentShape({
          id: generateId(),
          type: 'circle',
          x: cx,
          y: cy,
          width: 0,
          height: 0,
          strokeColor,
          fillColor,
          strokeWidth,
          fill: fillEnabled,
        });
      } else if (activeTool === 'arrow') {
        setCurrentShape({
          id: generateId(),
          type: 'arrow',
          x: cx,
          y: cy,
          x2: cx,
          y2: cy,
          strokeColor,
          fillColor,
          strokeWidth,
          fill: false,
        });
      }
    },
    [
      activeTool,
      spaceHeld,
      strokeColor,
      fillColor,
      strokeWidth,
      fillEnabled,
      selectedId,
      textInput,
      commitTextInput,
      pushHistory,
      screenToCanvas,
    ],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);

      // Panning
      if (isPanning && panStart) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setPan({ x: panStart.panX + dx, y: panStart.panY + dy });
        return;
      }

      if (!isDrawing) return;

      // Resizing selected shape
      if (resizingHandle && selectedId && drawStart && resizeAnchor) {
        const dx = cx - drawStart.x;
        const dy = cy - drawStart.y;
        const sel = shapesRef.current.find(s => s.id === selectedId);
        if (!sel) return;

        let newX = resizeAnchor.x;
        let newY = resizeAnchor.y;
        let newW = resizeAnchor.w;
        let newH = resizeAnchor.h;

        if (resizingHandle === 'se') {
          newW = resizeAnchor.w + dx;
          newH = resizeAnchor.h + dy;
        } else if (resizingHandle === 'sw') {
          newX = resizeAnchor.x + dx;
          newW = resizeAnchor.w - dx;
          newH = resizeAnchor.h + dy;
        } else if (resizingHandle === 'ne') {
          newY = resizeAnchor.y + dy;
          newW = resizeAnchor.w + dx;
          newH = resizeAnchor.h - dy;
        } else if (resizingHandle === 'nw') {
          newX = resizeAnchor.x + dx;
          newY = resizeAnchor.y + dy;
          newW = resizeAnchor.w - dx;
          newH = resizeAnchor.h - dy;
        }

        const updated = shapesRef.current.map(s => {
          if (s.id !== selectedId) return s;
          if (s.type === 'line' || s.type === 'arrow') {
            return { ...s, x: newX, y: newY, x2: newX + newW, y2: newY + newH };
          }
          if (s.type === 'pen' && s.points && resizeAnchor.w > 0 && resizeAnchor.h > 0) {
            const scaleX = newW / resizeAnchor.w;
            const scaleY = newH / resizeAnchor.h;
            const newPoints = s.points.map(p => ({
              x: newX + (p.x - resizeAnchor.x) * scaleX,
              y: newY + (p.y - resizeAnchor.y) * scaleY,
            }));
            return { ...s, x: newX, y: newY, points: newPoints, width: newW, height: newH };
          }
          return { ...s, x: newX, y: newY, width: newW, height: newH };
        });
        setShapes(updated);
        return;
      }

      // Dragging selected shape
      if (activeTool === 'select' && selectedId && dragOffset) {
        const newX = cx - dragOffset.x;
        const newY = cy - dragOffset.y;
        const sel = shapesRef.current.find(s => s.id === selectedId);
        if (!sel) return;
        const dxMove = newX - sel.x;
        const dyMove = newY - sel.y;

        const updated = shapesRef.current.map(s => {
          if (s.id !== selectedId) return s;
          const moved = { ...s, x: s.x + dxMove, y: s.y + dyMove };
          if (s.type === 'line' || s.type === 'arrow') {
            moved.x2 = (s.x2 ?? s.x) + dxMove;
            moved.y2 = (s.y2 ?? s.y) + dyMove;
          }
          if (s.type === 'pen' && s.points) {
            moved.points = s.points.map(p => ({ x: p.x + dxMove, y: p.y + dyMove }));
          }
          return moved;
        });
        setShapes(updated);
        return;
      }

      // Drawing in progress
      if (!drawStart || !currentShape) return;

      if (activeTool === 'pen') {
        setCurrentShape(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            points: [...(prev.points ?? []), { x: cx, y: cy }],
          };
        });
      } else if (activeTool === 'line') {
        setCurrentShape(prev => prev ? { ...prev, x2: cx, y2: cy } : prev);
      } else if (activeTool === 'rect') {
        const x = Math.min(drawStart.x, cx);
        const y = Math.min(drawStart.y, cy);
        const w = Math.abs(cx - drawStart.x);
        const h = Math.abs(cy - drawStart.y);
        setCurrentShape(prev => prev ? { ...prev, x, y, width: w, height: h } : prev);
      } else if (activeTool === 'circle') {
        const x = Math.min(drawStart.x, cx);
        const y = Math.min(drawStart.y, cy);
        const w = Math.abs(cx - drawStart.x);
        const h = Math.abs(cy - drawStart.y);
        setCurrentShape(prev => prev ? { ...prev, x, y, width: w, height: h } : prev);
      } else if (activeTool === 'arrow') {
        setCurrentShape(prev => prev ? { ...prev, x2: cx, y2: cy } : prev);
      }
    },
    [
      isDrawing,
      isPanning,
      panStart,
      activeTool,
      selectedId,
      dragOffset,
      drawStart,
      currentShape,
      resizingHandle,
      resizeAnchor,
      screenToCanvas,
    ],
  );

  const onMouseUp = useCallback(() => {
    // End panning
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    // End resizing
    if (resizingHandle) {
      setResizingHandle(null);
      setResizeAnchor(null);
      setDrawStart(null);
      setIsDrawing(false);
      pushHistory(shapesRef.current);
      return;
    }

    // End dragging
    if (activeTool === 'select' && selectedId && dragOffset) {
      setDragOffset(null);
      setIsDrawing(false);
      pushHistory(shapesRef.current);
      return;
    }

    // End shape drawing
    if (isDrawing && currentShape) {
      const newShapes = [...shapesRef.current, currentShape];
      setShapes(newShapes);
      pushHistory(newShapes);
      setCurrentShape(null);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setDragOffset(null);
  }, [isDrawing, isPanning, activeTool, selectedId, dragOffset, currentShape, resizingHandle, pushHistory]);

  // -------------------------------------------------------------------------
  // Mouse wheel for zoom
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.1, Math.min(10, zoomRef.current * zoomFactor));

      // Adjust pan so zoom is centered on cursor
      const newPanX = mouseX - (mouseX - panRef.current.x) * (newZoom / zoomRef.current);
      const newPanY = mouseY - (mouseY - panRef.current.y) * (newZoom / zoomRef.current);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // -------------------------------------------------------------------------
  // Export as PNG
  // -------------------------------------------------------------------------

  const exportPNG = useCallback(() => {
    const allShapes = shapesRef.current;
    if (allShapes.length === 0) return;

    // Calculate bounding box of all shapes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const shape of allShapes) {
      const b = getShapeBounds(shape);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }

    const padding = 40;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width * 2;
    exportCanvas.height = height * 2;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.translate(-minX, -minY);

    for (const shape of allShapes) {
      drawShape(ctx, shape);
    }

    const link = document.createElement('a');
    link.download = `${fileName}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }, [fileName]);

  // -------------------------------------------------------------------------
  // Clear canvas
  // -------------------------------------------------------------------------

  const clearCanvas = useCallback(() => {
    const newShapes: Shape[] = [];
    setShapes(newShapes);
    pushHistory(newShapes);
    setSelectedId(null);
  }, [pushHistory]);

  // -------------------------------------------------------------------------
  // Zoom controls
  // -------------------------------------------------------------------------

  const zoomIn = useCallback(() => {
    setZoom(prev => Math.min(10, prev * 1.25));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(prev => Math.max(0.1, prev * 0.8));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // -------------------------------------------------------------------------
  // Tool definitions
  // -------------------------------------------------------------------------

  const tools: { id: ToolType; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <MousePointer size={18} />, label: 'Select (V)' },
    { id: 'pen', icon: <Pencil size={18} />, label: 'Pen (P)' },
    { id: 'line', icon: <Minus size={18} />, label: 'Line (L)' },
    { id: 'rect', icon: <Square size={18} />, label: 'Rectangle (R)' },
    { id: 'circle', icon: <Circle size={18} />, label: 'Ellipse (C)' },
    { id: 'arrow', icon: <ArrowUpRight size={18} />, label: 'Arrow (A)' },
    { id: 'eraser', icon: <Eraser size={18} />, label: 'Eraser (E)' },
    { id: 'text', icon: <Type size={18} />, label: 'Text (T)' },
  ];

  // Tool keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textInput) return; // Don't switch tools while typing text
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const map: Record<string, ToolType> = {
        v: 'select',
        p: 'pen',
        l: 'line',
        r: 'rect',
        c: 'circle',
        a: 'arrow',
        e: 'eraser',
        t: 'text',
      };
      const tool = map[e.key.toLowerCase()];
      if (tool) {
        setActiveTool(tool);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textInput]);

  // -------------------------------------------------------------------------
  // Cursor style
  // -------------------------------------------------------------------------

  const getCursor = (): string => {
    if (spaceHeld || isPanning) return 'grab';
    switch (activeTool) {
      case 'select': return 'default';
      case 'pen': return 'crosshair';
      case 'line': return 'crosshair';
      case 'rect': return 'crosshair';
      case 'circle': return 'crosshair';
      case 'arrow': return 'crosshair';
      case 'eraser': return 'pointer';
      case 'text': return 'text';
      default: return 'default';
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full w-full bg-[#1a1d26] text-gray-200 select-none overflow-hidden">
      {/* Left Toolbar */}
      <div className="w-12 bg-[#1a1d26] border-r border-[#2a2d3a] flex flex-col items-center py-2 gap-1 shrink-0">
        {tools.map(tool => (
          <button
            key={tool.id}
            onClick={() => {
              setActiveTool(tool.id);
              if (tool.id !== 'select') setSelectedId(null);
            }}
            title={tool.label}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
              activeTool === tool.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-gray-400 hover:bg-[#2a2d3a] hover:text-gray-200'
            }`}
          >
            {tool.icon}
          </button>
        ))}

        <div className="flex-1" />

        {/* Undo / Redo */}
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          title="Undo (Cmd+Z)"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-[#2a2d3a] hover:text-gray-200 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          title="Redo (Cmd+Shift+Z)"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-[#2a2d3a] hover:text-gray-200 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
        >
          <Redo2 size={16} />
        </button>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-10 bg-[#1a1d26] border-b border-[#2a2d3a] flex items-center justify-between px-3 shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={fileName}
              onChange={e => setFileName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              className="bg-transparent text-sm text-gray-300 border-none outline-none w-32 px-1 py-0.5 rounded hover:bg-[#2a2d3a] focus:bg-[#2a2d3a]"
              title="Canvas file name"
            />
            <span className="text-xs text-gray-500">.json</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={saveCanvas}
              title="Save (Cmd+S)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                saveStatus === 'saved'
                  ? 'bg-green-600/20 text-green-400'
                  : saveStatus === 'saving'
                  ? 'bg-yellow-600/20 text-yellow-400'
                  : 'bg-[#2a2d3a] text-gray-300 hover:bg-[#353849]'
              }`}
            >
              <Save size={14} />
              {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={exportPNG}
              title="Export as PNG"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#2a2d3a] text-gray-300 hover:bg-[#353849] transition-all"
            >
              <Download size={14} />
              PNG
            </button>
            <button
              onClick={clearCanvas}
              title="Clear canvas"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#2a2d3a] text-gray-300 hover:bg-red-900/40 hover:text-red-400 transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-white">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: getCursor() }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />

          {/* Floating text input */}
          {textInput && (
            <input
              ref={textInputRef}
              type="text"
              value={textInput.value}
              onChange={e => setTextInput(prev => prev ? { ...prev, value: e.target.value } : prev)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  commitTextInput(textInput);
                  setTextInput(null);
                }
                if (e.key === 'Escape') {
                  setTextInput(null);
                }
                e.stopPropagation();
              }}
              className="absolute bg-transparent border-2 border-blue-500 outline-none text-black px-1"
              style={{
                left: textInput.x * zoom + pan.x,
                top: textInput.y * zoom + pan.y,
                fontSize: Math.max(14, strokeWidth * 6) * zoom,
                minWidth: 100 * zoom,
                zIndex: 10,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
              autoFocus
            />
          )}
        </div>

        {/* Bottom status bar */}
        <div className="h-7 bg-[#1a1d26] border-t border-[#2a2d3a] flex items-center justify-between px-3 text-xs text-gray-500 shrink-0">
          <div className="flex items-center gap-4">
            <span>{shapes.length} object{shapes.length !== 1 ? 's' : ''}</span>
            {selectedId && <span className="text-blue-400">1 selected</span>}
            <span>
              Pan: {Math.round(pan.x)}, {Math.round(pan.y)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={zoomOut}
              className="p-0.5 hover:text-gray-300 transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={resetZoom}
              className="hover:text-gray-300 transition-colors px-1 min-w-[48px] text-center"
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              className="p-0.5 hover:text-gray-300 transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
            <span className="ml-2 text-gray-600">|</span>
            <span className="text-gray-500">{useKernel ? 'Kernel FS' : 'localStorage'}</span>
          </div>
        </div>
      </div>

      {/* Right Property Panel */}
      <div className="w-52 bg-[#1a1d26] border-l border-[#2a2d3a] flex flex-col shrink-0 overflow-y-auto">
        {/* Stroke color */}
        <div className="p-3 border-b border-[#2a2d3a]">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 block">
            Stroke Color
          </label>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="color"
                value={strokeColor}
                onChange={e => {
                  setStrokeColor(e.target.value);
                  if (selectedId) {
                    const updated = shapes.map(s =>
                      s.id === selectedId ? { ...s, strokeColor: e.target.value } : s,
                    );
                    setShapes(updated);
                    pushHistory(updated);
                  }
                }}
                className="w-8 h-8 rounded-md cursor-pointer border border-[#2a2d3a] bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
              />
            </div>
            <input
              type="text"
              value={strokeColor}
              onChange={e => {
                const val = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                  setStrokeColor(val);
                }
              }}
              className="flex-1 bg-[#2a2d3a] text-gray-300 text-xs px-2 py-1.5 rounded-md border border-[#353849] outline-none focus:border-blue-500"
            />
          </div>
          {/* Preset colors */}
          <div className="flex gap-1 mt-2 flex-wrap">
            {['#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#ffffff'].map(
              color => (
                <button
                  key={color}
                  onClick={() => {
                    setStrokeColor(color);
                    if (selectedId) {
                      const updated = shapes.map(s =>
                        s.id === selectedId ? { ...s, strokeColor: color } : s,
                      );
                      setShapes(updated);
                      pushHistory(updated);
                    }
                  }}
                  className={`w-5 h-5 rounded-full border transition-all ${
                    strokeColor === color
                      ? 'border-blue-500 ring-1 ring-blue-500 scale-110'
                      : 'border-[#2a2d3a] hover:scale-110'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ),
            )}
          </div>
        </div>

        {/* Stroke width */}
        <div className="p-3 border-b border-[#2a2d3a]">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 block">
            Stroke Width
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="1"
              max="20"
              value={strokeWidth}
              onChange={e => {
                const val = parseInt(e.target.value);
                setStrokeWidth(val);
                if (selectedId) {
                  const updated = shapes.map(s =>
                    s.id === selectedId ? { ...s, strokeWidth: val } : s,
                  );
                  setShapes(updated);
                  pushHistory(updated);
                }
              }}
              className="flex-1 h-1.5 bg-[#2a2d3a] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <span className="text-xs text-gray-400 w-8 text-right tabular-nums">{strokeWidth}px</span>
          </div>
          {/* Preview line */}
          <div className="mt-2 h-6 flex items-center justify-center bg-[#2a2d3a] rounded-md">
            <div
              className="rounded-full"
              style={{
                width: '60%',
                height: Math.min(strokeWidth, 18),
                backgroundColor: strokeColor,
              }}
            />
          </div>
        </div>

        {/* Fill */}
        <div className="p-3 border-b border-[#2a2d3a]">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Fill
            </label>
            <button
              onClick={() => {
                const newFill = !fillEnabled;
                setFillEnabled(newFill);
                if (selectedId) {
                  const updated = shapes.map(s =>
                    s.id === selectedId ? { ...s, fill: newFill } : s,
                  );
                  setShapes(updated);
                  pushHistory(updated);
                }
              }}
              className={`w-9 h-5 rounded-full transition-all relative ${
                fillEnabled ? 'bg-blue-600' : 'bg-[#2a2d3a]'
              }`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${
                  fillEnabled ? 'left-[18px]' : 'left-[3px]'
                }`}
              />
            </button>
          </div>

          {fillEnabled && (
            <div className="mt-2">
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5 block">
                Fill Color
              </label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="color"
                    value={fillColor}
                    onChange={e => {
                      setFillColor(e.target.value);
                      if (selectedId) {
                        const updated = shapes.map(s =>
                          s.id === selectedId ? { ...s, fillColor: e.target.value } : s,
                        );
                        setShapes(updated);
                        pushHistory(updated);
                      }
                    }}
                    className="w-8 h-8 rounded-md cursor-pointer border border-[#2a2d3a] bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
                  />
                </div>
                <input
                  type="text"
                  value={fillColor}
                  onChange={e => {
                    const val = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                      setFillColor(val);
                    }
                  }}
                  className="flex-1 bg-[#2a2d3a] text-gray-300 text-xs px-2 py-1.5 rounded-md border border-[#353849] outline-none focus:border-blue-500"
                />
              </div>
              {/* Preset fill colors */}
              <div className="flex gap-1 mt-2 flex-wrap">
                {[
                  '#ef444440',
                  '#f9731640',
                  '#eab30840',
                  '#22c55e40',
                  '#3b82f640',
                  '#8b5cf640',
                  '#ec489940',
                  '#ef4444',
                  '#3b82f6',
                  '#22c55e',
                ].map((color, idx) => (
                  <button
                    key={`fill-${idx}`}
                    onClick={() => {
                      setFillColor(color);
                      if (selectedId) {
                        const updated = shapes.map(s =>
                          s.id === selectedId ? { ...s, fillColor: color } : s,
                        );
                        setShapes(updated);
                        pushHistory(updated);
                      }
                    }}
                    className={`w-5 h-5 rounded-full border transition-all ${
                      fillColor === color
                        ? 'border-blue-500 ring-1 ring-blue-500 scale-110'
                        : 'border-[#2a2d3a] hover:scale-110'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Selection info */}
        {selectedId && (() => {
          const sel = shapes.find(s => s.id === selectedId);
          if (!sel) return null;
          const bounds = getShapeBounds(sel);
          return (
            <div className="p-3 border-b border-[#2a2d3a]">
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 block">
                Selected: {sel.type}
              </label>
              <div className="space-y-1.5 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>X</span>
                  <span className="text-gray-300 tabular-nums">{Math.round(bounds.x)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Y</span>
                  <span className="text-gray-300 tabular-nums">{Math.round(bounds.y)}</span>
                </div>
                <div className="flex justify-between">
                  <span>W</span>
                  <span className="text-gray-300 tabular-nums">{Math.round(bounds.w)}</span>
                </div>
                <div className="flex justify-between">
                  <span>H</span>
                  <span className="text-gray-300 tabular-nums">{Math.round(bounds.h)}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  const newShapes = shapes.filter(s => s.id !== selectedId);
                  setShapes(newShapes);
                  pushHistory(newShapes);
                  setSelectedId(null);
                }}
                className="mt-3 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-all"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          );
        })()}

        {/* Keyboard shortcuts help */}
        <div className="p-3 mt-auto">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 block">
            Shortcuts
          </label>
          <div className="space-y-1 text-[10px] text-gray-500">
            <div className="flex justify-between">
              <span>Pan</span>
              <span className="text-gray-400">Space + Drag</span>
            </div>
            <div className="flex justify-between">
              <span>Zoom</span>
              <span className="text-gray-400">Scroll</span>
            </div>
            <div className="flex justify-between">
              <span>Undo</span>
              <span className="text-gray-400">Cmd+Z</span>
            </div>
            <div className="flex justify-between">
              <span>Redo</span>
              <span className="text-gray-400">Cmd+Shift+Z</span>
            </div>
            <div className="flex justify-between">
              <span>Save</span>
              <span className="text-gray-400">Cmd+S</span>
            </div>
            <div className="flex justify-between">
              <span>Delete</span>
              <span className="text-gray-400">Del / Backspace</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
