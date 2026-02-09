import React from 'react';
import { cn } from '../../lib/utils';

/**
 * ResponsiveToolbar
 * - Mobile: stacked (title/subtitle, then actions)
 * - sm+: single row with actions on the right
 */
export function ResponsiveToolbar({
  title,
  subtitle,
  left,
  actions,
  className,
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3', className)}>
      <div className="min-w-0">
        {left}
        {title ? (
          <h1 className="text-2xl font-bold tracking-tight min-w-0 break-words">{title}</h1>
        ) : null}
        {subtitle ? (
          <p className="text-sm text-muted-foreground mt-1 min-w-0 break-words">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export default ResponsiveToolbar;

