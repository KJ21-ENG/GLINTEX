import React from 'react';
import { Type, Barcode, QrCode, Minus, Square, Image as ImageIcon, Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';

const ICONS = { text: Type, barcode: Barcode, qr: QrCode, line: Minus, rect: Square, image: ImageIcon };
const ADD = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'barcode', label: 'Barcode', icon: Barcode },
  { type: 'qr', label: 'QR code', icon: QrCode },
  { type: 'line', label: 'Line', icon: Minus },
  { type: 'rect', label: 'Box', icon: Square },
  { type: 'image', label: 'Image', icon: ImageIcon },
];

const excerpt = (el) => {
  if (el.name) return el.name;
  if (el.type === 'text') return el.text || 'Empty text';
  if (el.type === 'barcode' || el.type === 'qr') return el.value;
  if (el.type === 'line') return `${el.direction} ${el.lengthMm} mm`;
  if (el.type === 'rect') return `${el.w} × ${el.h} mm`;
  return el.src ? 'Image' : 'Image (empty)';
};

export default function LayersPanel({ template, selectedIds, warnings, dispatch, canEdit, canvas }) {
  const warned = new Set(warnings.map((w) => w.id));
  // Topmost element first, like every drawing tool.
  const items = [...template.elements].reverse();
  const add = (type) => {
    const overrides = { x: Math.round(canvas.widthMm * 0.1), y: Math.round(canvas.heightMm * 0.1) };
    if (type === 'text') Object.assign(overrides, { w: Math.round(canvas.widthMm * 0.5), h: 6, text: 'Text' });
    if (type === 'rect') Object.assign(overrides, { w: Math.round(canvas.widthMm * 0.3), h: Math.round(canvas.heightMm * 0.2) });
    if (type === 'image') Object.assign(overrides, { w: 15, h: 15 });
    if (type === 'line') Object.assign(overrides, { lengthMm: Math.round(canvas.widthMm * 0.5) });
    dispatch({ type: 'addElement', elementType: type, overrides });
  };
  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-border/70">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1"><Plus className="h-3 w-3" /> Add</div>
        <div className="grid grid-cols-3 gap-1">
          {ADD.map((a) => (
            <button key={a.type} type="button" disabled={!canEdit} onClick={() => add(a.type)} className="flex flex-col items-center gap-1 rounded-md border border-border/70 bg-background px-1 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50" title={`Add ${a.label.toLowerCase()}`}>
              <a.icon className="h-4 w-4" />{a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Elements · {template.elements.length}</div>
      <div className="overflow-auto min-h-0 pb-2" role="list">
        {items.length === 0 ? <div className="px-3 py-2 text-xs text-muted-foreground">No elements yet.</div> : null}
        {items.map((el) => {
          const Icon = ICONS[el.type] || Type;
          const selected = selectedIds.includes(el.id);
          return (
            <div
              key={el.id}
              role="listitem"
              className={cn('group mx-2 my-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer', selected ? 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-300' : 'hover:bg-accent', el.hidden && 'opacity-50')}
              onClick={(e) => dispatch(e.shiftKey ? { type: 'toggleSelect', id: el.id } : { type: 'select', ids: [el.id] })}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className={cn('flex-1 truncate', el.type === 'text' || el.type === 'barcode' || el.type === 'qr' ? 'font-mono' : '')}>{excerpt(el)}</span>
              {warned.has(el.id) ? <span className="h-2 w-2 rounded-full bg-amber-500" title="Needs attention" /> : null}
              <span className="hidden group-hover:flex items-center gap-0.5">
                <button type="button" className="p-0.5 rounded hover:bg-background" title="Bring forward" disabled={!canEdit} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'reorder', id: el.id, direction: 'up' }); }}><ChevronUp className="h-3.5 w-3.5" /></button>
                <button type="button" className="p-0.5 rounded hover:bg-background" title="Send backward" disabled={!canEdit} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'reorder', id: el.id, direction: 'down' }); }}><ChevronDown className="h-3.5 w-3.5" /></button>
              </span>
              <button type="button" className={cn('p-0.5 rounded hover:bg-background', !el.hidden && 'hidden group-hover:block')} title={el.hidden ? 'Show' : 'Hide'} disabled={!canEdit} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'updateElements', ids: [el.id], patch: { hidden: !el.hidden } }); }}>{el.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
              <button type="button" className={cn('p-0.5 rounded hover:bg-background', !el.locked && 'hidden group-hover:block')} title={el.locked ? 'Unlock' : 'Lock'} disabled={!canEdit} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'updateElements', ids: [el.id], patch: { locked: !el.locked } }); }}>{el.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
