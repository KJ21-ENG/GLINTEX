import React from 'react';

const formatCount = (n) => Number(n || 0).toLocaleString('en-IN');

/**
 * TableResultCount - "Showing X of Y" indicator so users can tell how much data
 * exists behind an infinite-scrolling table. `total` is optional (legacy mode or
 * while the first page is still loading).
 */
export function TableResultCount({ shown, total, isLoading, className = '' }) {
  let label;
  if (isLoading && !shown) {
    label = 'Loading…';
  } else if (Number.isFinite(Number(total)) && total != null) {
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
