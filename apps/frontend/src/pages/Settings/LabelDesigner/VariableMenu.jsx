import React, { useEffect, useRef, useState } from 'react';
import { AtSign } from 'lucide-react';
import { cn } from '../../../lib/utils';

// Inserts @variable placeholders into text at the caret.
export default function VariableMenu({ variables, onInsert, className, label = 'Insert variable' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const list = variables.filter((v) => !query || v.key.toLowerCase().includes(query.toLowerCase()) || v.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className={cn('relative', className)} ref={ref}>
      <button type="button" className="h-8 inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 text-xs hover:bg-accent" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <AtSign className="h-3.5 w-3.5" /> {label}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <input autoFocus className="w-full border-b border-border bg-transparent px-3 py-2 text-sm focus:outline-none" placeholder="Search variables" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-64 overflow-auto py-1" role="listbox">
            {list.length === 0 ? <div className="px-3 py-2 text-xs text-muted-foreground">No variable matches</div> : null}
            {list.map((v) => (
              <button key={v.key} type="button" role="option" className="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center justify-between gap-2" onMouseDown={(e) => e.preventDefault()} onClick={() => { onInsert(`@${v.key}`); setOpen(false); setQuery(''); }}>
                <span className="font-mono text-xs">@{v.key}</span>
                <span className="text-[11px] text-muted-foreground truncate">{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
