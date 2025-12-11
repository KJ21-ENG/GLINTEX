import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, FileCode2, Printer, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '../../components/ui';
import {
  DEFAULT_DIMENSIONS,
  DEFAULT_CONTENT,
  LABEL_STAGE_KEYS,
  getStageVariables,
  normalizeBlock,
  migrateContent,
  buildTspl,
  loadTemplate,
  saveTemplate,
  setPreferredPrinter,
  getPreferredPrinter,
} from '../../utils/labelPrint';

const PX_PER_MM = 3.6; // for on-screen preview

const SNAP_TOLERANCE_MM = 1.5;
const NUDGE_STEP_PX = 1;
const NUDGE_STEP_FAST_PX = 5;

const getFontScale = (fontSize) => Math.max(1, Math.round(fontSize / 10) || 1);

const snapAngle = (angle = 0) => {
  const normalized = ((angle % 360) + 360) % 360;
  const steps = [0, 90, 180, 270];
  return steps.reduce((best, step) => (Math.abs(step - normalized) < Math.abs(best - normalized) ? step : best), 0);
};

const mmToPx = (mm) => mm * PX_PER_MM;

const normalizeTextBlock = (block = {}, fallbackId = 0) => normalizeBlock(block, fallbackId);

const migrateLegacyContent = (raw) => migrateContent(raw);

const LabelPreview = ({
  dimensions,
  content,
  setContent,
  setContentWithHistory,
  pushHistory,
  selectedIds,
  setSelectedIds,
  snapEnabled,
  clipboard,
  setClipboard,
}) => {
  const {
    width,
    height,
    horizontalGap,
    verticalGap,
    pageWidth,
    columns,
    offsetX,
    offsetY,
    orientation,
    marginLeft,
    marginTop,
    fontSize,
  } = dimensions;
  const totalLabelsWidth = columns * width + horizontalGap * (columns - 1);
  const pagePadding = Math.max(0, (pageWidth - totalLabelsWidth) / 2);
  const pxToMm = (px) => px / PX_PER_MM;

  const labelBoxStyle = useMemo(() => {
    const base = {
      width: `${mmToPx(width)}px`,
      height: `${mmToPx(height)}px`,
      position: 'relative',
      border: '1px dashed #cbd5e1',
      background: 'white',
      borderRadius: '6px',
      overflow: 'hidden',
    };
    if (orientation === 'landscape') {
      return {
        ...base,
        transformOrigin: 'top left',
        transform: `rotate(90deg) translate(0, -${mmToPx(height)}px)`,
      };
    }
    return base;
  }, [width, height, orientation]);

  const labelWrapperStyle = useMemo(() => {
    if (orientation === 'landscape') {
      return { width: `${mmToPx(height)}px`, height: `${mmToPx(width)}px`, position: 'relative' };
    }
    return { width: `${mmToPx(width)}px`, height: `${mmToPx(height)}px`, position: 'relative' };
  }, [width, height, orientation]);

  const [dragging, setDragging] = useState({ ids: [], startX: 0, startY: 0, origins: {} });
  const [guides, setGuides] = useState({ vertical: null, horizontal: null });
  const preDragSnapshotRef = useRef(null);
  const dragMovedRef = useRef(false);

  const measureBlock = (block) => {
    if (block.type === 'barcode') {
      const moduleMm = block.style?.moduleMm ?? 0.3;
      const heightMm = block.style?.heightMm ?? 12;
      const valueLength = Math.max(1, (block.value || '').length);
      const modules = Math.max(30, valueLength * 11 + 35); // rough Code128 width estimate
      const widthMm = modules * moduleMm;
      return { widthMm, heightMm };
    }
    const scale = getFontScale(block.style?.size || dimensions.fontSize);
    const charHeightMm = 3 * scale;
    const charWidthMm = 2 * scale;
    const paddingMm = block.style?.background?.enabled ? block.style.background.paddingMm ?? 0.8 : 0;
    const widthMm = Math.max(1, (block.value || '').length) * charWidthMm + paddingMm * 2;
    const heightMm = charHeightMm + paddingMm * 2;
    return { widthMm, heightMm };
  };

  const computeBoundingBox = (text) => {
    const { widthMm, heightMm } = measureBlock(text);
    const angle = snapAngle(text.angle || 0);
    let minX = 0;
    let maxX = widthMm;
    let minY = 0;
    let maxY = heightMm;

    // rotate around top-left origin by 90/180/270
    if (angle === 90) {
      // rotate 90° clockwise around top-left
      minX = -heightMm;
      maxX = 0;
      minY = 0;
      maxY = widthMm;
    } else if (angle === 180) {
      minX = -widthMm;
      maxX = 0;
      minY = -heightMm;
      maxY = 0;
    } else if (angle === 270) {
      // rotate 270° clockwise (90° CCW)
      minX = 0;
      maxX = heightMm;
      minY = -widthMm;
      maxY = 0;
    }

    const originX = (text.pos?.x || 0) + offsetX;
    const originY = (text.pos?.y || 0) + offsetY;

    return {
      widthMm,
      heightMm,
      left: originX + minX,
      right: originX + maxX,
      top: originY + minY,
      bottom: originY + maxY,
      centerX: originX + (minX + maxX) / 2,
      centerY: originY + (minY + maxY) / 2,
    };
  };

  const blockStyle = (block, selected = false) => {
    const angle = block.angle || 0;
    const pos = block.pos || { x: 0, y: 0 };
    if (block.type === 'barcode') {
      const { widthMm, heightMm } = measureBlock(block);
      return {
        position: 'absolute',
        left: `${mmToPx(pos.x + offsetX)}px`,
        top: `${mmToPx(pos.y + offsetY)}px`,
        width: `${mmToPx(widthMm)}px`,
        height: `${mmToPx(heightMm)}px`,
        transform: `rotate(${snapAngle(angle)}deg)`,
        transformOrigin: 'top left',
        backgroundImage:
          'repeating-linear-gradient(90deg, #0f172a, #0f172a 2px, transparent 2px, transparent 4px)',
        backgroundSize: '6px 100%',
        color: '#0f172a',
        display: 'flex',
        alignItems: 'flex-end',
        fontSize: '10px',
        padding: '2px',
        borderRadius: '4px',
        opacity: block.style?.visible === false ? 0.35 : 1,
        cursor: block.style?.visible === false ? 'not-allowed' : 'move',
        outline: selected ? '1px dashed #818cf8' : 'none',
        outlineOffset: '3px',
      };
    }
    const style = block.style || {};
    const scale = getFontScale(style.size || dimensions.fontSize);
    const charHeightMm = 3 * scale; // TSPL font 3: 24 dots high -> 3mm @203dpi
    const paddingMm = style.background?.enabled ? style.background.paddingMm ?? 0.8 : 0;
    const paddingPx = mmToPx(paddingMm);
    const backgroundColor = style.background?.enabled ? style.background.color || '#000000' : 'transparent';
    const textColor = style.background?.enabled ? style.background.textColor || '#ffffff' : '#0f172a';
    return {
      position: 'absolute',
      left: `${mmToPx(pos.x + offsetX)}px`,
      top: `${mmToPx(pos.y + offsetY)}px`,
      transform: `rotate(${snapAngle(angle)}deg)`,
      transformOrigin: 'top left',
      whiteSpace: 'nowrap',
      display: 'inline-block',
      fontSize: `${mmToPx(charHeightMm)}px`,
      lineHeight: `${mmToPx(charHeightMm * 1.05)}px`,
      letterSpacing: '0px', // mirror TSPL monospace font spacing
      fontFamily: '"Courier New", monospace',
      fontWeight: style.bold ? 700 : 500,
      fontStyle: style.italic ? 'italic' : 'normal',
      textDecoration: style.underline ? 'underline' : 'none',
      opacity: style.visible === false ? 0.35 : 1,
      cursor: style.visible === false ? 'not-allowed' : 'move',
      outline: selected ? '1px dashed #818cf8' : 'none',
      outlineOffset: '4px',
      backgroundColor,
      color: textColor,
      padding: `${paddingPx}px`,
      borderRadius: style.background?.enabled ? '4px' : '0px',
    };
  };

  const computeSnap = (active, proposedPos, allTexts = [], labelBounds = null) => {
    const activeWithPos = { ...active, pos: proposedPos };
    const activeBox = computeBoundingBox(activeWithPos);
    let bestX = null;
    let bestY = null;

    const considerCandidate = (candidate, axis) => {
      if (!candidate) return;
      if (Math.abs(candidate.diff) > SNAP_TOLERANCE_MM) return;
      if (axis === 'x') {
        if (!bestX || Math.abs(candidate.diff) < Math.abs(bestX.diff)) bestX = candidate;
      } else if (axis === 'y') {
        if (!bestY || Math.abs(candidate.diff) < Math.abs(bestY.diff)) bestY = candidate;
      }
    };

    // other texts
    (allTexts || [])
      .filter((t) => t.id !== active.id)
      .forEach((other) => {
        const otherBox = computeBoundingBox(other);

        [
          { diff: otherBox.left - activeBox.left, guide: otherBox.left },
          { diff: otherBox.centerX - activeBox.centerX, guide: otherBox.centerX },
          { diff: otherBox.right - activeBox.right, guide: otherBox.right },
        ].forEach((c) => considerCandidate(c, 'x'));

        [
          { diff: otherBox.top - activeBox.top, guide: otherBox.top },
          { diff: otherBox.centerY - activeBox.centerY, guide: otherBox.centerY },
          { diff: otherBox.bottom - activeBox.bottom, guide: otherBox.bottom },
        ].forEach((c) => considerCandidate(c, 'y'));
      });

    // label bounds (center/edges)
    if (labelBounds) {
      const centerX = (labelBounds.left + labelBounds.right) / 2;
      const centerY = (labelBounds.top + labelBounds.bottom) / 2;
      [
        { diff: labelBounds.left - activeBox.left, guide: labelBounds.left },
        { diff: centerX - activeBox.centerX, guide: centerX },
        { diff: labelBounds.right - activeBox.right, guide: labelBounds.right },
      ].forEach((c) => considerCandidate(c, 'x'));

      [
        { diff: labelBounds.top - activeBox.top, guide: labelBounds.top },
        { diff: centerY - activeBox.centerY, guide: centerY },
        { diff: labelBounds.bottom - activeBox.bottom, guide: labelBounds.bottom },
      ].forEach((c) => considerCandidate(c, 'y'));
    }

    return {
      snappedX: bestX ? Math.max(0, proposedPos.x + bestX.diff) : proposedPos.x,
      snappedY: bestY ? Math.max(0, proposedPos.y + bestY.diff) : proposedPos.y,
      guideX: bestX ? bestX.guide : null,
      guideY: bestY ? bestY.guide : null,
      diffX: bestX ? bestX.diff : null,
      diffY: bestY ? bestY.diff : null,
    };
  };

  const startDrag = (id, clientX, clientY, additive = false) => {
    const currentSelection = selectedIds || [];
    let nextSelection = currentSelection;
    if (additive) {
      if (!currentSelection.includes(id)) {
        nextSelection = [...currentSelection, id];
        setSelectedIds(nextSelection);
      }
    } else if (!currentSelection.includes(id)) {
      nextSelection = [id];
      setSelectedIds(nextSelection);
    }
    const targets = (content.texts || []).filter((t) => nextSelection.includes(t.id));
    if (!targets.length) return;
    const origins = {};
    targets.forEach((t) => {
      const pos = t.pos || { x: 0, y: 0 };
      origins[t.id] = { x: pos.x, y: pos.y };
    });
    preDragSnapshotRef.current = JSON.parse(JSON.stringify(content || {}));
    dragMovedRef.current = false;
    setDragging({
      ids: nextSelection,
      startX: clientX,
      startY: clientY,
      origins,
    });
  };

  const updatePosition = (clientX, clientY) => {
    if (!dragging.ids || dragging.ids.length === 0) return;
    let dxMm = pxToMm(clientX - dragging.startX);
    let dyMm = pxToMm(clientY - dragging.startY);

    if (orientation === 'landscape') {
      const mappedDx = dyMm;
      const mappedDy = -dxMm;
      dxMm = mappedDx;
      dyMm = mappedDy;
    }
    if (dxMm !== 0 || dyMm !== 0) {
      dragMovedRef.current = true;
    }

    setContent((prev) => {
      const allTexts = prev.texts || [];
      const activeId = dragging.ids[0];
      const target = allTexts.find((t) => t.id === activeId);
      if (!target) return prev;
      const origin = dragging.origins[activeId] || { x: 0, y: 0 };
      const proposed = { x: Math.max(0, origin.x + dxMm), y: Math.max(0, origin.y + dyMm) };
      if (!snapEnabled) {
        setGuides({ vertical: null, horizontal: null });
        return {
          ...prev,
          texts: allTexts.map((t) => {
            if (!dragging.ids.includes(t.id)) return t;
            const originPos = dragging.origins[t.id] || { x: t.pos?.x || 0, y: t.pos?.y || 0 };
            return {
              ...t,
              pos: {
                x: Math.max(0, originPos.x + dxMm),
                y: Math.max(0, originPos.y + dyMm),
              },
            };
          }),
        };
      }
      const labelBounds = {
        left: offsetX,
        right: offsetX + width,
        top: offsetY,
        bottom: offsetY + height,
      };
      const { snappedX, snappedY, guideX, guideY, diffX, diffY } = computeSnap(
        target,
        proposed,
        allTexts,
        labelBounds
      );
      const snapDeltaX = snappedX - proposed.x;
      const snapDeltaY = snappedY - proposed.y;
      setGuides({
        vertical: guideX !== null ? { x: guideX, diff: diffX } : null,
        horizontal: guideY !== null ? { y: guideY, diff: diffY } : null,
      });
      return {
        ...prev,
        texts: allTexts.map((t) => {
          if (!dragging.ids.includes(t.id)) return t;
          const originPos = dragging.origins[t.id] || { x: t.pos?.x || 0, y: t.pos?.y || 0 };
          return {
            ...t,
            pos: {
              x: Math.max(0, originPos.x + dxMm + snapDeltaX),
              y: Math.max(0, originPos.y + dyMm + snapDeltaY),
            },
          };
        }),
      };
    });
  };

  const stopDrag = () => {
    setDragging({ ids: [], startX: 0, startY: 0, origins: {} });
    setGuides({ vertical: null, horizontal: null });
    if (dragMovedRef.current && preDragSnapshotRef.current) {
      pushHistory(preDragSnapshotRef.current);
    }
    preDragSnapshotRef.current = null;
    dragMovedRef.current = false;
  };

  const cycleRotation = (id) => {
    setContent((prev) => {
      const texts = (prev.texts || []).map((t) => {
        if (t.id !== id) return t;
        return { ...t, angle: snapAngle((t.angle || 0) + 90) };
      });
      return { ...prev, texts };
    });
  };

  const renderTextBlock = (text, className, selectedIds, setSelectedIds) => {
    const pos = text.pos || { x: 0, y: 0 };
    const angle = snapAngle(text.angle || 0);
    const style = text.style || {};
    const isSelected = (selectedIds || []).includes(text.id);

    const onMouseDown = (e) => {
      e.preventDefault();
      const additive = e.shiftKey;
      startDrag(text.id, e.clientX, e.clientY, additive);
    };

    const onTouchStart = (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      startDrag(text.id, touch.clientX, touch.clientY, false);
    };

    return (
      <div
        style={blockStyle(text, isSelected)}
        className={`${className} select-none`}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onClick={() => {}}
      >
        {text.type === 'barcode' ? (
          <div className="absolute inset-x-1 bottom-1 text-[10px] font-mono bg-white/80 px-1 rounded">
            {text.value || ''}
          </div>
        ) : (
          text.value || ''
        )}
        {isSelected && (
          <div
            className="absolute w-7 h-7 bg-white border border-slate-300 rounded-full flex items-center justify-center text-[10px] text-slate-600 shadow-sm cursor-pointer"
            style={{ top: '-18px', right: '-18px' }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cycleRotation(text.id);
            }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (!t) return;
              e.preventDefault();
              e.stopPropagation();
              cycleRotation(text.id);
            }}
          >
            {angle}°
          </div>
        )}
      </div>
    );
  };

  const handleMouseMove = (e) => updatePosition(e.clientX, e.clientY);
  const handleTouchMove = (e) => {
    const t = e.touches[0];
    if (!t) return;
    updatePosition(t.clientX, t.clientY);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedIds || selectedIds.length === 0) return;
      const targetTag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(targetTag) || e.target?.isContentEditable) return;

      // copy
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const items = (content.texts || []).filter((t) => selectedIds.includes(t.id));
        if (items.length) {
          setClipboard(JSON.parse(JSON.stringify(items)));
        }
        return;
      }
      // paste
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (!clipboard || clipboard.length === 0) return;
        const offsetMm = 2;
        const newItems = clipboard.map((t) => ({
          ...t,
          id: `${t.id}-copy-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          pos: {
            x: (t.pos?.x || 0) + offsetMm,
            y: (t.pos?.y || 0) + offsetMm,
          },
        }));
        setContentWithHistory((prev) => ({
          ...prev,
          texts: [...(prev.texts || []), ...newItems],
        }));
        setSelectedIds(newItems.map((t) => t.id));
        return;
      }

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const stepPx = e.shiftKey ? NUDGE_STEP_FAST_PX : NUDGE_STEP_PX;
      const stepMm = pxToMm(stepPx);
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -stepMm;
      if (e.key === 'ArrowRight') dx = stepMm;
      if (e.key === 'ArrowUp') dy = -stepMm;
      if (e.key === 'ArrowDown') dy = stepMm;
      if (orientation === 'landscape') {
        const mappedDx = dy;
        const mappedDy = -dx;
        dx = mappedDx;
        dy = mappedDy;
      }
      setContentWithHistory((prev) => ({
        ...prev,
        texts: (prev.texts || []).map((t) => {
          if (!selectedIds.includes(t.id)) return t;
          return {
            ...t,
            pos: {
              x: Math.max(0, (t.pos?.x || 0) + dx),
              y: Math.max(0, (t.pos?.y || 0) + dy),
            },
          };
        }),
      }));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, setContentWithHistory, orientation, pxToMm, content.texts, clipboard]);

  return (
    <div className="w-full select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span>Roll width: {pageWidth} mm</span>
        <span>
          Label: {width} × {height} mm · Columns: {columns}
        </span>
      </div>
      <div
        className="bg-slate-100/80 border border-dashed border-slate-200 rounded-lg p-4 overflow-auto"
        style={{ minWidth: `${mmToPx(pageWidth)}px`, paddingTop: `${mmToPx(marginTop)}px` }}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onTouchMove={handleTouchMove}
        onTouchEnd={stopDrag}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${columns}, ${mmToPx(width)}px)`,
            columnGap: `${mmToPx(horizontalGap)}px`,
            rowGap: `${mmToPx(verticalGap)}px`,
            paddingLeft: `${mmToPx(pagePadding + marginLeft)}px`,
            paddingRight: `${mmToPx(pagePadding)}px`,
          }}
        >
          {Array.from({ length: columns }).map((_, idx) => (
            <div key={idx} style={labelWrapperStyle}>
              <div
                style={labelBoxStyle}
                className="shadow-sm"
                onMouseDown={(e) => {
                  // blank area deselect
                  if (e.target === e.currentTarget) {
                    setSelectedIds([]);
                  }
                }}
                onTouchStart={(e) => {
                  if (e.target === e.currentTarget) {
                    setSelectedIds([]);
                  }
                }}
              >
                {guides.vertical && (
                  <div
                    className="absolute top-0 bottom-0 border-l border-indigo-400/80 pointer-events-none"
                    style={{ left: `${mmToPx(guides.vertical.x)}px` }}
                  >
                    <div className="absolute -top-3 left-[-9999px] right-[-9999px] flex justify-center">
                      <span className="bg-indigo-500 text-white text-[10px] px-2 py-0.5 rounded shadow-sm">
                        {Math.abs(guides.vertical.diff ?? 0).toFixed(1)}mm
                      </span>
                    </div>
                  </div>
                )}
                {guides.horizontal && (
                  <div
                    className="absolute left-0 right-0 border-t border-indigo-400/80 pointer-events-none"
                    style={{ top: `${mmToPx(guides.horizontal.y)}px` }}
                  >
                    <div className="absolute -left-3 top-[-9999px] bottom-[-9999px] flex items-center">
                      <span className="bg-indigo-500 text-white text-[10px] px-2 py-0.5 rounded shadow-sm">
                        {Math.abs(guides.horizontal.diff ?? 0).toFixed(1)}mm
                      </span>
                    </div>
                  </div>
                )}
                {(content.texts || []).map((text) => (
                  <React.Fragment key={text.id}>
                    {renderTextBlock(text, 'text-slate-900', selectedIds, setSelectedIds)}
                  </React.Fragment>
                ))}
                {(!content.texts || content.texts.length === 0) && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    Add text or barcode to start designing
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const StickerTest = () => {
  const navigate = useNavigate();
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => getPreferredPrinter() || '');
  const [serviceStatus, setServiceStatus] = useState({ state: 'idle', message: 'Idle', tone: 'muted' });
  const [dimensions, setDimensions] = useState(() => {
    const saved = localStorage.getItem('stickerDimensions');
    return saved ? { ...DEFAULT_DIMENSIONS, ...JSON.parse(saved) } : { ...DEFAULT_DIMENSIONS };
  });
  const [content, setContent] = useState(() => {
    const saved = localStorage.getItem('stickerContent');
    return migrateContent(saved ? JSON.parse(saved) : null);
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [templateStage, setTemplateStage] = useState(LABEL_STAGE_KEYS.INBOUND);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [clipboard, setClipboard] = useState([]);
  const [lastCommand, setLastCommand] = useState('');
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const stageVariables = useMemo(() => getStageVariables(templateStage), [templateStage]);
  const inputRef = useRef(null);
  const [mention, setMention] = useState({
    open: false,
    query: '',
    start: -1,
    caret: 0,
    targetId: null,
  });
  const [mentionIndex, setMentionIndex] = useState(0);

  const cloneContent = (value) => JSON.parse(JSON.stringify(value || {}));

  const pushHistory = useCallback((snapshot) => {
    if (!snapshot) return;
    undoStack.current = [...undoStack.current, cloneContent(snapshot)].slice(-50);
    redoStack.current = [];
  }, []);

  const setContentWithHistory = useCallback(
    (updater) => {
      setContent((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (next === prev) return prev;
        pushHistory(prev);
        return next;
      });
    },
    [pushHistory]
  );

  const performUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    setContent((current) => {
      const previous = undoStack.current.pop();
      redoStack.current = [...redoStack.current, cloneContent(current)].slice(-50);
      return previous;
    });
    setSelectedIds([]);
  }, []);

  const performRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    setContent((current) => {
      const next = redoStack.current.pop();
      undoStack.current = [...undoStack.current, cloneContent(current)].slice(-50);
      return next;
    });
    setSelectedIds([]);
  }, []);

  useEffect(() => {
    localStorage.setItem('stickerDimensions', JSON.stringify(dimensions));
  }, [dimensions]);

  useEffect(() => {
    localStorage.setItem('stickerContent', JSON.stringify(content));
  }, [content]);

  useEffect(() => {
    setPreferredPrinter(selectedPrinter || '');
  }, [selectedPrinter]);

  useEffect(() => {
    fetchPrinters();
  }, [performUndo, performRedo]);

  useEffect(() => {
    const handleUndoRedo = (e) => {
      const targetTag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(targetTag) || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          performUndo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          performRedo();
        }
      }
    };
    window.addEventListener('keydown', handleUndoRedo);
    return () => window.removeEventListener('keydown', handleUndoRedo);
  }, []);

  const fetchPrinters = async () => {
    try {
      setServiceStatus({ state: 'connecting', message: 'Connecting to local print service...', tone: 'muted' });
      const response = await fetch('http://localhost:9090/printers');
      if (!response.ok) {
        throw new Error('Local print service not reachable on port 9090');
      }
      const data = await response.json();
      const printerList = data.printers || [];
      setPrinters(printerList);
      setSelectedPrinter((prev) => {
        if (prev && printerList.includes(prev)) return prev;
        return printerList[0] || '';
      });
      setServiceStatus({
        state: 'connected',
        message: `${printerList.length} printer${printerList.length === 1 ? '' : 's'} available via local service.`,
        tone: 'success',
      });
    } catch (error) {
      console.error('Error fetching printers:', error);
      setServiceStatus({
        state: 'error',
        message: 'Could not reach local print service. Please start it on port 9090.',
        tone: 'error',
      });
    }
  };

  const updateDimension = (key, value) => {
    setDimensions((prev) => ({ ...prev, [key]: value }));
  };

  const updateContent = (key, value) => {
    setContentWithHistory((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveTemplateStage = () => {
    saveTemplate(templateStage, { dimensions, content });
    alert(`Template saved for ${templateStage}`);
  };

  const handleLoadTemplateStage = () => {
    const tpl = loadTemplate(templateStage);
    if (!tpl) {
      alert('No template saved for this stage yet.');
      return;
    }
    setDimensions({ ...DEFAULT_DIMENSIONS, ...(tpl.dimensions || {}) });
    setContent(migrateContent(tpl.content || tpl));
    setSelectedIds([]);
  };

  const handleExportTemplate = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ dimensions, content }, null, 2));
      alert('Template copied to clipboard');
    } catch (e) {
      alert('Unable to copy template JSON');
    }
  };

  const handleImportTemplate = () => {
    const raw = window.prompt('Paste template JSON');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      setDimensions({ ...DEFAULT_DIMENSIONS, ...(parsed.dimensions || parsed?.layout || {}) });
      setContent(migrateContent(parsed.content || parsed));
      setSelectedIds([]);
    } catch (e) {
      alert('Invalid template JSON');
    }
  };

  const addTextBlock = () => {
    const base = normalizeTextBlock({
      id: `text-${Date.now()}`,
      value: 'New text',
      pos: { x: 5, y: 5 },
      style: { size: dimensions.fontSize || 10, bold: false, italic: false, underline: false },
    });
    setContentWithHistory((prev) => ({ ...prev, texts: [...(prev.texts || []), base] }));
    setSelectedIds([base.id]);
  };

  const addBarcodeBlock = () => {
    const base = normalizeTextBlock({
      id: `barcode-${Date.now()}`,
      type: 'barcode',
      value: '{{barcode}}',
      pos: { x: 5, y: 5 },
      style: { heightMm: 12, moduleMm: 0.3, humanReadable: true },
    });
    setContentWithHistory((prev) => ({ ...prev, texts: [...(prev.texts || []), base] }));
    setSelectedIds([base.id]);
  };

  const updateTextValue = (id, value) => {
    setContentWithHistory((prev) => ({
      ...prev,
      texts: (prev.texts || []).map((t) => (t.id === id ? { ...t, value } : t)),
    }));
  };

  const closeMention = () => {
    setMention({ open: false, query: '', start: -1, caret: 0, targetId: null });
    setMentionIndex(0);
  };

  const handleValueChange = (id, nextValue, caretPos) => {
    updateTextValue(id, nextValue);
    const beforeCaret = nextValue.slice(0, caretPos);
    const lastAt = beforeCaret.lastIndexOf('@');
    if (lastAt === -1) {
      closeMention();
      return;
    }
    const afterAt = beforeCaret.slice(lastAt + 1);
    if (!/^[a-zA-Z0-9_]*$/.test(afterAt)) {
      closeMention();
      return;
    }
    setMention({
      open: true,
      query: afterAt,
      start: lastAt,
      caret: caretPos,
      targetId: id,
    });
    setMentionIndex(0);
  };

  const applyMention = (id, key) => {
    const texts = content.texts || [];
    const target = texts.find((t) => t.id === id);
    if (!target) return;
    const value = target.value || '';
    const start = mention.start ?? -1;
    const caret = mention.caret ?? value.length;
    if (start < 0 || start > caret) return;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    const inserted = `@${key}`;
    const nextValue = `${before}${inserted}${after}`;
    updateTextValue(id, nextValue);
    closeMention();
    requestAnimationFrame(() => {
      if (inputRef.current) {
        const pos = before.length + inserted.length;
        try {
          inputRef.current.setSelectionRange(pos, pos);
          inputRef.current.focus();
        } catch (e) {
          // ignore
        }
      }
    });
  };

  const updateTextStyle = (id, patch) => {
    setContentWithHistory((prev) => ({
      ...prev,
      texts: (prev.texts || []).map((t) => (t.id === id ? { ...t, style: { ...(t.style || {}), ...patch } } : t)),
    }));
  };

  const updateTextBackground = (id, patch) => {
    setContentWithHistory((prev) => ({
      ...prev,
      texts: (prev.texts || []).map((t) => {
        if (t.id !== id) return t;
        const currentBg = t.style?.background || {};
        return {
          ...t,
          style: {
            ...(t.style || {}),
            background: { ...currentBg, ...patch },
          },
        };
      }),
    }));
  };

  const updateTextPosition = (id, axis, value) => {
    setContentWithHistory((prev) => ({
      ...prev,
      texts: (prev.texts || []).map((t) =>
        t.id === id ? { ...t, pos: { ...(t.pos || {}), [axis]: value } } : t
      ),
    }));
  };

  const updateTextAngle = (id, angle) => {
    setContentWithHistory((prev) => ({
      ...prev,
      texts: (prev.texts || []).map((t) => (t.id === id ? { ...t, angle: snapAngle(angle) } : t)),
    }));
  };

  const removeText = (id) => {
    setContentWithHistory((prev) => ({
      ...prev,
      texts: (prev.texts || []).filter((t) => t.id !== id),
    }));
    if (selectedIds.includes(id)) setSelectedIds((prev) => prev.filter((s) => s !== id));
  };

  const handlePrint = async () => {
    if (!selectedPrinter) {
      setServiceStatus({ state: 'error', message: 'Pick a printer before sending.', tone: 'error' });
      return;
    }
    if (!content.texts || content.texts.length === 0) {
      setServiceStatus({ state: 'error', message: 'Add at least one text block before printing.', tone: 'error' });
      return;
    }
    const command = buildTspl(dimensions, content);
    setLastCommand(command);
    try {
      setServiceStatus({ state: 'working', message: 'Sending job for silent print...', tone: 'muted' });
      const response = await fetch('http://localhost:9090/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printer: selectedPrinter,
          content: command,
          type: 'raw',
        }),
      });
      const result = await response.json();
      if (result.success) {
        setServiceStatus({ state: 'connected', message: 'Print job sent via local service.', tone: 'success' });
      } else {
        setServiceStatus({ state: 'error', message: result.error || 'Failed to send print job.', tone: 'error' });
      }
    } catch (error) {
      console.error('Error printing:', error);
      setServiceStatus({ state: 'error', message: error.message || 'Error sending print job.', tone: 'error' });
    }
  };

  const handleReset = () => {
    setDimensions({ ...DEFAULT_DIMENSIONS });
    setContent({ ...DEFAULT_CONTENT });
    setLastCommand('');
  };

  const statusToneClass = serviceStatus.tone === 'success'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : serviceStatus.tone === 'error'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-slate-50 text-slate-600 border-slate-200';

  const stageOptions = [
    { value: LABEL_STAGE_KEYS.INBOUND, label: 'Inbound' },
    { value: LABEL_STAGE_KEYS.CUTTER_ISSUE, label: 'Issue to machine (cutter)' },
    { value: LABEL_STAGE_KEYS.CUTTER_RECEIVE, label: 'Receive from machine (cutter)' },
    { value: LABEL_STAGE_KEYS.HOLO_ISSUE, label: 'Issue to machine (holo)' },
    { value: LABEL_STAGE_KEYS.HOLO_RECEIVE, label: 'Receive from machine (holo)' },
    { value: LABEL_STAGE_KEYS.CONING_ISSUE, label: 'Issue to machine (coning)' },
    { value: LABEL_STAGE_KEYS.CONING_RECEIVE, label: 'Receive from machine (coning)' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/settings')} className="px-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Settings
        </Button>
        <h1 className="text-xl font-semibold">Sticker / Label Test Bench</h1>
        <Badge variant="outline" className="ml-auto">Silent printing via local service</Badge>
      </div>

      <div className={`rounded-lg border ${statusToneClass} px-4 py-3 flex items-center gap-3`}>
        <Printer className="w-5 h-5" />
        <div className="flex flex-col">
          <span className="font-medium capitalize">{serviceStatus.state}</span>
          <span className="text-sm">{serviceStatus.message}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={fetchPrinters}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh printers
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset}>
            <SlidersHorizontal className="w-4 h-4 mr-1" /> Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px,1fr] gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Printer & Layout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Target printer</Label>
              <div className="flex gap-2">
                <select
                  value={selectedPrinter}
                  onChange={(e) => setSelectedPrinter(e.target.value)}
                  className="flex-1 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {printers.length === 0 && <option value="">No printers detected</option>}
                  {printers.map((printer) => (
                    <option key={printer} value={printer}>{printer}</option>
                  ))}
                </select>
                <Button variant="outline" size="icon" onClick={fetchPrinters}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Local print service: http://localhost:9090 (apps/local-print-service/server.js)</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Label width (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.width}
                  onChange={(e) => updateDimension('width', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Label height (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.height}
                  onChange={(e) => updateDimension('height', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Roll width (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.pageWidth}
                  onChange={(e) => updateDimension('pageWidth', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Columns</Label>
                <Input
                  type="number"
                  min="1"
                  max="5"
                  value={dimensions.columns}
                  onChange={(e) => updateDimension('columns', Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
              <div>
                <Label>Horizontal gap (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.horizontalGap}
                  onChange={(e) => updateDimension('horizontalGap', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Vertical gap (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.verticalGap}
                  onChange={(e) => updateDimension('verticalGap', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Offset X (mm)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={dimensions.offsetX}
                  onChange={(e) => updateDimension('offsetX', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Offset Y (mm)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={dimensions.offsetY}
                  onChange={(e) => updateDimension('offsetY', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Font size (pt)</Label>
                <Input
                  type="number"
                  value={dimensions.fontSize}
                  onChange={(e) => updateDimension('fontSize', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Orientation</Label>
                <select
                  value={dimensions.orientation}
                  onChange={(e) => updateDimension('orientation', e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="portrait">Portrait (0°)</option>
                  <option value="landscape">Landscape (90°)</option>
                </select>
              </div>
              <div>
                <Label>Margin left (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.marginLeft}
                  onChange={(e) => updateDimension('marginLeft', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Margin top (mm)</Label>
                <Input
                  type="number"
                  value={dimensions.marginTop}
                  onChange={(e) => updateDimension('marginTop', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-dashed space-y-2">
              <Label className="text-sm font-medium">Stage template</Label>
              <div className="flex flex-wrap gap-2">
                <select
                  value={templateStage}
                  onChange={(e) => setTemplateStage(e.target.value)}
                  className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {stageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <Button size="sm" variant="outline" onClick={handleLoadTemplateStage}>Load</Button>
                <Button size="sm" variant="outline" onClick={handleSaveTemplateStage}>Save</Button>
                <Button size="sm" variant="ghost" onClick={handleExportTemplate}>Copy JSON</Button>
                <Button size="sm" variant="ghost" onClick={handleImportTemplate}>Import</Button>
              </div>
              <p className="text-xs text-muted-foreground">Templates are saved locally per stage and reused by app flows.</p>
            </div>

            <div className="pt-2 border-t border-dashed space-y-1">
              <div className="text-sm font-medium">Variables (read-only)</div>
              <div className="text-xs text-muted-foreground">
                {'Type @varName in text or {{varName}} inside text/barcode value. Barcode defaults to {{barcode}} and always shows the value underneath.'}
              </div>
              <div className="border rounded-md bg-slate-50 p-2 max-h-48 overflow-auto">
                {stageVariables.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No variables for this stage.</div>
                ) : (
                  <ul className="text-xs space-y-1">
                    {stageVariables.map((v) => (
                      <li key={v.key} className="flex justify-between">
                        <span className="font-mono text-[11px]">@{v.key}</span>
                        <span className="text-muted-foreground">{v.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-dashed">
              <Label>Copies</Label>
              <Input
                type="number"
                min="1"
                value={content.copies}
                onChange={(e) => updateContent('copies', Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>

            <Button className="w-full" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" /> Send to printer
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Content & Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-muted-foreground">
                Click a text in the preview to edit. Only the selected text is shown here.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={snapEnabled ? 'default' : 'outline'}
                  onClick={() => setSnapEnabled((prev) => !prev)}
                  className="flex items-center gap-1"
                >
                  Snap {snapEnabled ? 'On' : 'Off'}
                </Button>
                <Button size="sm" onClick={addTextBlock}>
                  + Add text
                </Button>
                <Button size="sm" variant="outline" onClick={addBarcodeBlock}>
                  + Add barcode
                </Button>
                {selectedIds.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Selected: {selectedIds[0]}{selectedIds.length > 1 ? ` (+${selectedIds.length - 1})` : ''}
                  </Badge>
                )}
              </div>
            </div>

            {(!content.texts || content.texts.length === 0) && (
              <div className="border border-dashed rounded-lg p-4 text-sm text-muted-foreground">
                No text yet. Click “Add text” then click it in the preview to edit.
              </div>
            )}

            {selectedIds.length > 0 && (
              <div className="border border-dashed rounded-lg p-4 space-y-3">
                {(() => {
                  const primarySelectedId = selectedIds[0];
                  const text = (content.texts || []).find((t) => t.id === primarySelectedId);
                  if (!text) return <div className="text-sm text-muted-foreground">Select a text to edit.</div>;
                  const isBarcode = text.type === 'barcode';
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">Editing: {text.id}</p>
                          <Badge variant="outline" className="text-[11px]">
                            {isBarcode ? 'Barcode' : 'Text'}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">X: {text.pos?.x ?? 0}mm · Y: {text.pos?.y ?? 0}mm</Badge>
                        </div>
                        <Button size="sm" variant="destructive" onClick={() => removeText(text.id)}>
                          Remove
                        </Button>
                      </div>
                      <Input
                        ref={inputRef}
                        value={text.value}
                        onChange={(e) => handleValueChange(text.id, e.target.value, e.target.selectionStart || e.target.value.length)}
                        onSelect={(e) => handleValueChange(text.id, e.target.value, e.target.selectionStart || e.target.value.length)}
                        onKeyDown={(e) => {
                          if (!mention.open) return;
                          const filtered = stageVariables.filter((v) =>
                            mention.query ? v.key.toLowerCase().startsWith(mention.query.toLowerCase()) : true
                          );
                          if (filtered.length === 0) return;
                          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
                            e.preventDefault();
                          }
                          if (e.key === 'ArrowDown') {
                            setMentionIndex((prev) => (prev + 1) % filtered.length);
                          } else if (e.key === 'ArrowUp') {
                            setMentionIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
                          } else if (e.key === 'Enter' || e.key === 'Tab') {
                            const pick = filtered[mentionIndex] || filtered[0];
                            if (pick) applyMention(text.id, pick.key);
                          } else if (e.key === 'Escape') {
                            closeMention();
                          }
                        }}
                        placeholder="Enter text"
                      />
                      {mention.open && mention.targetId === text.id && (
                        <div className="relative">
                          <div className="absolute z-10 mt-1 w-full max-w-sm rounded-md border bg-white shadow-lg">
                            <div className="max-h-48 overflow-auto text-sm">
                              {stageVariables
                                .filter((v) =>
                                  mention.query ? v.key.toLowerCase().startsWith(mention.query.toLowerCase()) : true
                                )
                                .map((v, idx) => (
                                  <button
                                    key={v.key}
                                    type="button"
                                    className={`w-full text-left px-3 py-2 flex items-center justify-between ${
                                      idx === mentionIndex ? 'bg-indigo-50' : ''
                                    }`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      applyMention(text.id, v.key);
                                    }}
                                  >
                                    <span className="font-mono text-xs">@{v.key}</span>
                                    <span className="text-xs text-muted-foreground">{v.label}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {isBarcode ? (
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <div className="text-[11px]">Tip: use {'{{barcode}}'} to pull the runtime barcode value.</div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">Height (mm)</Label>
                              <Input
                                type="number"
                                step="0.5"
                                className="h-8"
                                value={text.style?.heightMm ?? 12}
                                onChange={(e) => updateTextStyle(text.id, { heightMm: Math.max(4, parseFloat(e.target.value) || 12) })}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Module width (mm)</Label>
                              <Input
                                type="number"
                                step="0.05"
                                className="h-8"
                                value={text.style?.moduleMm ?? 0.3}
                                onChange={(e) => updateTextStyle(text.id, { moduleMm: Math.max(0.1, parseFloat(e.target.value) || 0.3) })}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Label className="text-xs">Human readable</Label>
                              <Button
                                size="sm"
                                variant={text.style?.humanReadable === false ? 'outline' : 'default'}
                                className="h-8"
                                onClick={() => updateTextStyle(text.id, { humanReadable: text.style?.humanReadable === false ? true : false })}
                              >
                                {text.style?.humanReadable === false ? 'Off' : 'On'}
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <Label className="text-xs">Angle</Label>
                              <select
                                value={text.angle || 0}
                                onChange={(e) => updateTextAngle(text.id, parseInt(e.target.value, 10))}
                                className="flex h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {[0, 90, 180, 270].map((deg) => (
                                  <option key={deg} value={deg}>{deg}°</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Label className="text-xs">Font size (pt)</Label>
                          <Input
                            type="number"
                            min="6"
                            className="h-8 w-20"
                            value={text.style?.size || dimensions.fontSize}
                            onChange={(e) => updateTextStyle(text.id, { size: Math.max(6, parseInt(e.target.value, 10) || dimensions.fontSize) })}
                          />
                          <div className="flex gap-1 ml-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={text.style?.bold ? 'default' : 'outline'}
                              className="h-8"
                              onClick={() => updateTextStyle(text.id, { bold: !text.style?.bold })}
                            >
                              B
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={text.style?.italic ? 'default' : 'outline'}
                              className="h-8"
                              onClick={() => updateTextStyle(text.id, { italic: !text.style?.italic })}
                            >
                              I
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={text.style?.underline ? 'default' : 'outline'}
                              className="h-8"
                              onClick={() => updateTextStyle(text.id, { underline: !text.style?.underline })}
                            >
                              U
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={text.style?.background?.enabled ? 'default' : 'outline'}
                              className="h-8"
                              onClick={() => {
                                const nextEnabled = !text.style?.background?.enabled;
                                updateTextBackground(text.id, {
                                  enabled: nextEnabled,
                                  color: text.style?.background?.color || '#000000',
                                  textColor: text.style?.background?.textColor || '#ffffff',
                                  paddingMm: text.style?.background?.paddingMm ?? 0.8,
                                });
                              }}
                            >
                              BG
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            <Label className="text-xs">Angle</Label>
                            <select
                              value={text.angle || 0}
                              onChange={(e) => updateTextAngle(text.id, parseInt(e.target.value, 10))}
                              className="flex h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {[0, 90, 180, 270].map((deg) => (
                                <option key={deg} value={deg}>{deg}°</option>
                              ))}
                            </select>
                          </div>
                          {text.style?.background?.enabled && (
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <Label className="text-xs">BG color</Label>
                              <input
                                type="color"
                                value={text.style?.background?.color || '#000000'}
                                onChange={(e) => updateTextBackground(text.id, { color: e.target.value })}
                                className="h-8 w-10 border rounded cursor-pointer"
                              />
                              <Label className="text-xs ml-2">Text color</Label>
                              <input
                                type="color"
                                value={text.style?.background?.textColor || '#ffffff'}
                                onChange={(e) => updateTextBackground(text.id, { textColor: e.target.value })}
                                className="h-8 w-10 border rounded cursor-pointer"
                              />
                              <Label className="text-xs ml-2">Padding (mm)</Label>
                              <Input
                                type="number"
                                step="0.1"
                                className="h-8 w-20"
                                value={text.style?.background?.paddingMm ?? 0.8}
                                onChange={(e) =>
                                  updateTextBackground(text.id, {
                                    paddingMm: Math.max(0, parseFloat(e.target.value) || 0),
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">X (mm)</Label>
                          <Input
                            type="number"
                            value={text.pos?.x ?? 0}
                            onChange={(e) => updateTextPosition(text.id, 'x', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Y (mm)</Label>
                          <Input
                            type="number"
                            value={text.pos?.y ?? 0}
                            onChange={(e) => updateTextPosition(text.id, 'y', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            <LabelPreview
              dimensions={dimensions}
              content={content}
              setContent={setContent}
              setContentWithHistory={setContentWithHistory}
              pushHistory={pushHistory}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              snapEnabled={snapEnabled}
              clipboard={clipboard}
              setClipboard={setClipboard}
            />

            <div className="border rounded-lg bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileCode2 className="w-4 h-4" /> Generated TSPL (sent to local service)
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(lastCommand || buildTspl(dimensions, content));
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> Copy
                </Button>
              </div>
              <pre className="text-[11px] bg-white border rounded p-3 overflow-auto max-h-48 leading-relaxed">
                {lastCommand || buildTspl(dimensions, content)}
              </pre>
              <p className="text-xs text-muted-foreground">This is sent as a raw job to http://localhost:9090/print for silent printing.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default StickerTest;
