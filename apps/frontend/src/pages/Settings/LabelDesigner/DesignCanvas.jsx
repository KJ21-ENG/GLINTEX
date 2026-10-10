import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import { rotatedBox } from '../../../utils/label/model';

const PX_PER_MM_AT_100 = 96 / 25.4;
const RULER = 22;
const PAD = 40;
const SNAP_MM = 0.75;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// Visual (post-rotation) geometry for every laid-out element.
const visualBoxes = (layout) => layout.elements.map((el) => ({ el, box: rotatedBox(el.box, el.rotation) }));

const resizeHandlesFor = (el) => {
  if (el.locked) return [];
  if (el.type === 'text' || el.type === 'rect' || el.type === 'image') return HANDLES;
  if (el.type === 'qr') return ['se'];
  if (el.type === 'line') return [el.direction === 'horizontal' ? 'e' : 's'];
  return [];
};

const snapCandidates = (layout, excludeIds) => {
  const xs = [0, layout.canvas.widthMm / 2, layout.canvas.widthMm];
  const ys = [0, layout.canvas.heightMm / 2, layout.canvas.heightMm];
  for (const { el, box } of visualBoxes(layout)) {
    if (excludeIds.has(el.id)) continue;
    xs.push(box.x, box.x + box.w / 2, box.x + box.w);
    ys.push(box.y, box.y + box.h / 2, box.y + box.h);
  }
  return { xs, ys };
};

const snapDelta = (value, candidates) => {
  let best = null;
  for (const c of candidates) {
    const diff = c - value;
    if (Math.abs(diff) <= SNAP_MM && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, guide: c };
  }
  return best;
};

function Ruler({ orientation, lengthMm, pxPerMm }) {
  const ticks = [];
  const step = pxPerMm >= 8 ? 1 : pxPerMm >= 3 ? 5 : 10;
  const labelEvery = pxPerMm >= 16 ? 5 : pxPerMm >= 5 ? 10 : 20;
  for (let mm = 0; mm <= lengthMm + 0.001; mm += step) {
    const major = mm % labelEvery === 0;
    const pos = mm * pxPerMm;
    ticks.push(
      <div key={mm} className="absolute bg-slate-400" style={orientation === 'h'
        ? { left: pos, bottom: 0, width: 1, height: major ? 10 : mm % 5 === 0 ? 6 : 3 }
        : { top: pos, right: 0, height: 1, width: major ? 10 : mm % 5 === 0 ? 6 : 3 }} />,
    );
    if (major) {
      ticks.push(
        <div key={`l${mm}`} className="absolute text-[9px] leading-none text-slate-500 select-none" style={orientation === 'h'
          ? { left: pos + 2, top: 2 }
          : { top: pos + 2, left: 2, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{mm}</div>,
      );
    }
  }
  return <div className="absolute overflow-hidden bg-slate-50 border-slate-200" style={orientation === 'h'
    ? { left: RULER + PAD, top: 0, height: RULER, width: lengthMm * pxPerMm, borderBottomWidth: 1 }
    : { top: RULER + PAD, left: 0, width: RULER, height: lengthMm * pxPerMm, borderRightWidth: 1 }}>{ticks}</div>;
}

export default function DesignCanvas({ template, layout, markup, css, zoom, selectedIds, warnings, snap, showGrid, dispatch, onZoom, onOpenInspector }) {
  const pxPerMm = PX_PER_MM_AT_100 * zoom;
  const { widthMm: canvasW, heightMm: canvasH } = layout.canvas;
  const hostRef = useRef(null);
  const surfaceRef = useRef(null);
  const [gesture, setGesture] = useState(null);
  const [guides, setGuides] = useState({ x: null, y: null });
  const [marquee, setMarquee] = useState(null);
  const warningsById = useMemo(() => Object.fromEntries(warnings.map((w) => [w.id, w])), [warnings]);
  const boxes = useMemo(() => visualBoxes(layout), [layout]);
  const byId = useMemo(() => Object.fromEntries(template.elements.map((el) => [el.id, el])), [template.elements]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:block;position:relative;overflow:hidden;background:#fff}${css}</style><div class="lb" style="position:absolute;left:0;top:0;width:${canvasW}mm;height:${canvasH}mm">${markup}</div>`;
  }, [markup, css, canvasW, canvasH]);

  const toMm = useCallback((clientX, clientY) => {
    const rect = surfaceRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left) / pxPerMm, y: (clientY - rect.top) / pxPerMm };
  }, [pxPerMm]);

  const startDrag = (event, el) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    let ids = selectedIds;
    if (event.shiftKey) {
      dispatch({ type: 'toggleSelect', id: el.id });
      return;
    }
    if (!selectedIds.includes(el.id)) {
      ids = [el.id];
      dispatch({ type: 'select', ids });
    }
    const movable = ids.filter((id) => byId[id] && !byId[id].locked);
    if (!movable.length) return;
    event.currentTarget.ownerDocument.body.style.userSelect = 'none';
    dispatch({ type: 'beginTransaction' });
    setGesture({ kind: 'move', primary: el.id, ids: movable, start: toMm(event.clientX, event.clientY), origins: Object.fromEntries(movable.map((id) => [id, { x: byId[id].x, y: byId[id].y }])) });
  };

  const startResize = (event, el, handle) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const visual = boxes.find((b) => b.el.id === el.id)?.box;
    if (!visual) return;
    dispatch({ type: 'beginTransaction' });
    setGesture({ kind: 'resize', id: el.id, handle, start: toMm(event.clientX, event.clientY), origin: { ...visual }, rotation: el.rotation });
  };

  const startMarquee = (event) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const start = toMm(event.clientX, event.clientY);
    if (!event.shiftKey) dispatch({ type: 'select', ids: [] });
    setMarquee({ start, end: start, additive: event.shiftKey });
  };

  useEffect(() => {
    if (!gesture && !marquee) return undefined;
    const onMove = (event) => {
      const point = toMm(event.clientX, event.clientY);
      if (marquee) {
        setMarquee((m) => ({ ...m, end: point }));
        return;
      }
      if (gesture.kind === 'move') {
        let dx = point.x - gesture.start.x;
        let dy = point.y - gesture.start.y;
        const primary = boxes.find((b) => b.el.id === gesture.primary);
        let guideX = null;
        let guideY = null;
        if (snap && primary && !event.altKey) {
          const origin = gesture.origins[gesture.primary];
          const shiftX = origin.x - primary.el.x;
          const shiftY = origin.y - primary.el.y;
          const box = { x: primary.box.x + shiftX + dx, y: primary.box.y + shiftY + dy, w: primary.box.w, h: primary.box.h };
          const { xs, ys } = snapCandidates(layout, new Set(gesture.ids));
          const sx = [snapDelta(box.x, xs), snapDelta(box.x + box.w / 2, xs), snapDelta(box.x + box.w, xs)].filter(Boolean).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
          const sy = [snapDelta(box.y, ys), snapDelta(box.y + box.h / 2, ys), snapDelta(box.y + box.h, ys)].filter(Boolean).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
          if (sx) { dx += sx.diff; guideX = sx.guide; }
          if (sy) { dy += sy.diff; guideY = sy.guide; }
        }
        setGuides({ x: guideX, y: guideY });
        dispatch({ type: 'updateElements', ids: gesture.ids, history: false, patch: (el) => ({ x: round(gesture.origins[el.id].x + dx), y: round(gesture.origins[el.id].y + dy) }) });
        return;
      }
      if (gesture.kind === 'resize') {
        const el = byId[gesture.id];
        if (!el) return;
        const dx = point.x - gesture.start.x;
        const dy = point.y - gesture.start.y;
        const o = gesture.origin;
        let { x, y, w, h } = o;
        const hnd = gesture.handle;
        if (hnd.includes('e')) w = Math.max(1, o.w + dx);
        if (hnd.includes('s')) h = Math.max(1, o.h + dy);
        if (hnd.includes('w')) { w = Math.max(1, o.w - dx); x = o.x + (o.w - w); }
        if (hnd.includes('n')) { h = Math.max(1, o.h - dy); y = o.y + (o.h - h); }
        if (event.shiftKey && (el.type === 'image' || el.type === 'rect')) { const k = Math.max(w / o.w, h / o.h); w = o.w * k; h = o.h * k; }
        const sideways = el.rotation === 90 || el.rotation === 270;
        let patch;
        if (el.type === 'qr') patch = { sizeMm: round(Math.max(4, Math.max(w, h))) };
        else if (el.type === 'line') patch = { lengthMm: round(Math.max(0.5, el.direction === 'horizontal' ? w : h)) };
        else patch = { x: round(x), y: round(y), w: round(sideways ? h : w), h: round(sideways ? w : h) };
        dispatch({ type: 'updateElements', ids: [el.id], history: false, patch });
      }
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      if (marquee) {
        const x1 = Math.min(marquee.start.x, marquee.end.x), x2 = Math.max(marquee.start.x, marquee.end.x);
        const y1 = Math.min(marquee.start.y, marquee.end.y), y2 = Math.max(marquee.start.y, marquee.end.y);
        if (x2 - x1 > 0.5 || y2 - y1 > 0.5) {
          const hit = boxes.filter(({ box }) => box.x < x2 && box.x + box.w > x1 && box.y < y2 && box.y + box.h > y1).map(({ el }) => el.id);
          dispatch({ type: 'select', ids: marquee.additive ? [...selectedIds, ...hit] : hit });
        }
        setMarquee(null);
        return;
      }
      dispatch({ type: 'commitTransaction' });
      setGesture(null);
      setGuides({ x: null, y: null });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [gesture, marquee, boxes, byId, dispatch, layout, selectedIds, snap, toMm]);

  const onKeyDown = (event) => {
    if (!selectedIds.length) return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const step = event.shiftKey ? 1 : 0.25;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (nudge) {
      event.preventDefault();
      dispatch({ type: 'updateElements', ids: selectedIds.filter((id) => !byId[id]?.locked), patch: (el) => ({ x: round(el.x + nudge[0]), y: round(el.y + nudge[1]) }) });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      dispatch({ type: 'removeElements', ids: selectedIds });
    } else if (event.key === 'Escape') {
      dispatch({ type: 'select', ids: [] });
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      dispatch({ type: 'duplicateElements', ids: selectedIds });
    }
  };

  const onWheel = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    onZoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  const gridStep = pxPerMm >= 6 ? 1 : 5;
  const surfaceW = canvasW * pxPerMm;
  const surfaceH = canvasH * pxPerMm;

  return (
    <div className="relative flex-1 min-h-0 overflow-auto bg-slate-100/70 focus:outline-none" tabIndex={0} onKeyDown={onKeyDown} onWheel={onWheel} data-testid="design-canvas">
      <div className="relative" style={{ width: surfaceW + RULER + PAD * 2, height: surfaceH + RULER + PAD * 2 }}>
        <Ruler orientation="h" lengthMm={canvasW} pxPerMm={pxPerMm} />
        <Ruler orientation="v" lengthMm={canvasH} pxPerMm={pxPerMm} />
        <div className="absolute bg-slate-50 border-b border-r border-slate-200" style={{ left: 0, top: 0, width: RULER, height: RULER }} />
        <div
          ref={surfaceRef}
          className="absolute bg-white shadow-[0_1px_3px_rgba(15,23,42,0.18),0_0_0_1px_rgba(15,23,42,0.08)]"
          style={{ left: RULER + PAD, top: RULER + PAD, width: surfaceW, height: surfaceH }}
          onPointerDown={startMarquee}
        >
          <div ref={hostRef} className="absolute left-0 top-0 pointer-events-none" style={{ width: `${canvasW}mm`, height: `${canvasH}mm`, transform: `scale(${zoom})`, transformOrigin: 'top left' }} />
          {showGrid && (
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(to right, rgba(100,116,139,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.14) 1px, transparent 1px)', backgroundSize: `${gridStep * pxPerMm}px ${gridStep * pxPerMm}px` }} />
          )}
          {boxes.map(({ el, box }) => {
            const selected = selectedIds.includes(el.id);
            const warning = warningsById[el.id];
            const handles = selected && selectedIds.length === 1 ? resizeHandlesFor(el) : [];
            return (
              <div
                key={el.id}
                data-element-id={el.id}
                className={cn('absolute group', el.locked ? 'cursor-default' : 'cursor-move')}
                style={{ left: box.x * pxPerMm, top: box.y * pxPerMm, width: Math.max(2, box.w * pxPerMm), height: Math.max(2, box.h * pxPerMm) }}
                onPointerDown={(event) => startDrag(event, el)}
                onDoubleClick={() => onOpenInspector?.(el.id)}
                title={el.name || el.text || el.value || el.type}
              >
                <div className={cn('absolute inset-0 rounded-[2px] border transition-colors',
                  selected ? 'border-indigo-500' : warning ? (warning.level === 'error' ? 'border-red-500/80 border-dashed' : 'border-amber-500/80 border-dashed') : 'border-transparent group-hover:border-indigo-300',
                  selected && 'bg-indigo-500/5')} />
                {warning && <div className={cn('absolute -top-2 -right-2 h-4 w-4 rounded-full text-[10px] leading-4 text-center text-white shadow', warning.level === 'error' ? 'bg-red-500' : 'bg-amber-500')} title={warning.message}>!</div>}
                {handles.map((handle) => (
                  <div
                    key={handle}
                    className="absolute h-2.5 w-2.5 rounded-sm bg-white border border-indigo-500 shadow-sm"
                    style={{
                      cursor: CURSORS[handle],
                      left: handle.includes('w') ? -5 : handle.includes('e') ? 'calc(100% - 5px)' : 'calc(50% - 5px)',
                      top: handle.includes('n') ? -5 : handle.includes('s') ? 'calc(100% - 5px)' : 'calc(50% - 5px)',
                    }}
                    onPointerDown={(event) => startResize(event, el, handle)}
                  />
                ))}
              </div>
            );
          })}
          {guides.x !== null && <div className="absolute top-0 bottom-0 w-px bg-indigo-500 pointer-events-none" style={{ left: guides.x * pxPerMm }} />}
          {guides.y !== null && <div className="absolute left-0 right-0 h-px bg-indigo-500 pointer-events-none" style={{ top: guides.y * pxPerMm }} />}
          {marquee && (
            <div className="absolute border border-indigo-400 bg-indigo-400/10 pointer-events-none" style={{ left: Math.min(marquee.start.x, marquee.end.x) * pxPerMm, top: Math.min(marquee.start.y, marquee.end.y) * pxPerMm, width: Math.abs(marquee.end.x - marquee.start.x) * pxPerMm, height: Math.abs(marquee.end.y - marquee.start.y) * pxPerMm }} />
          )}
          {template.elements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 pointer-events-none select-none">Add text, a barcode or a line from the left panel</div>
          )}
        </div>
      </div>
    </div>
  );
}
