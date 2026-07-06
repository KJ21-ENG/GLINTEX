import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * SortToggle - Column-header button that flips sort direction.
 *
 * Currently used for the Date column (server-side `order` param on v2 list
 * endpoints); the arrow always reflects the active direction.
 */
export function SortToggle({ label, order = 'desc', onToggle, className = '' }) {
  const asc = order === 'asc';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${className}`}
      title={asc ? 'Oldest first — click for newest first' : 'Newest first — click for oldest first'}
    >
      <span>{label}</span>
      {asc ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
    </button>
  );
}
