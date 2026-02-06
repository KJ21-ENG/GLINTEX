import React from 'react';
import { cn } from '../../lib/utils';

/**
 * KeyValueGrid: render key/value pairs consistently in mobile card views.
 * `items`: [{ label, value, mono?, badge? }]
 */
export function KeyValueGrid({ items = [], className = '' }) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safeItems.length) return null;

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm', className)}>
      {safeItems.map((it, idx) => {
        const label = it.label ?? '';
        const value = it.value ?? '—';
        const mono = Boolean(it.mono);
        const badge = it.badge;

        return (
          <div key={`${label}-${idx}`} className="flex items-start justify-between gap-2 min-w-0">
            <span className="text-muted-foreground text-xs">{label}</span>
            <span className={cn('text-right min-w-0', mono ? 'font-mono text-xs' : 'font-medium')}>
              {badge ? badge : value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default KeyValueGrid;

