import React from 'react';

const formatCount = (n) => Number(n || 0).toLocaleString('en-IN');

/**
 * TableResultCount - "Showing X of Y" indicator so users can tell how much data
 * exists behind a table. `total` is optional (legacy mode or while the first
 * page is still loading). Pass `rangeStart` on numbered-pagination tables to
 * render "Showing 51–100 of 120" instead.
 */
export function TableResultCount({ shown, total, rangeStart, isLoading, className = '' }) {
  const hasTotal = Number.isFinite(Number(total)) && total != null;
  let label;
  if (isLoading && !shown) {
    label = 'Loading…';
  } else if (hasTotal && Number.isFinite(Number(rangeStart)) && rangeStart > 0 && shown > 0) {
    label = `Showing ${formatCount(rangeStart)}–${formatCount(rangeStart + shown - 1)} of ${formatCount(total)}`;
  } else if (hasTotal) {
    label = `Showing ${formatCount(shown)} of ${formatCount(total)}`;
  } else {
    label = `Showing ${formatCount(shown)}`;
  }
  return (
    <span className={`text-xs text-muted-foreground whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}
