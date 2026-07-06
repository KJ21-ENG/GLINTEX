import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';

// Windowed page list: 1 … 4 5 [6] 7 8 … 20
function pageWindow(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out = [1];
  if (page > 3) out.push('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) out.push(i);
  if (page < totalPages - 2) out.push('…');
  out.push(totalPages);
  return out;
}

/**
 * TablePagination - Numbered pager for offset-paginated tables (useV2PagedList).
 * Hidden when everything fits on one page. `totalPages` may be null while the
 * first page is loading — Prev/Next then fall back to `hasMore`.
 */
export function TablePagination({ page, totalPages, hasMore = false, onPageChange, isLoading = false, className = '' }) {
  const known = Number.isFinite(Number(totalPages)) && totalPages != null;
  if (known && totalPages <= 1) return null;
  if (!known && page <= 1 && !hasMore) return null;

  const canPrev = page > 1 && !isLoading;
  const canNext = (known ? page < totalPages : hasMore) && !isLoading;

  return (
    <div className={`flex items-center justify-center gap-1 py-2 ${className}`}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        disabled={!canPrev}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      {known && pageWindow(page, totalPages).map((p, i) => (
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1.5 text-sm text-muted-foreground select-none">…</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? 'default' : 'ghost'}
            size="sm"
            className="h-8 min-w-8 px-2 tabular-nums"
            disabled={isLoading && p !== page}
            onClick={() => p !== page && onPageChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </Button>
        )
      ))}
      {!known && <span className="px-2 text-sm text-muted-foreground tabular-nums">Page {page}</span>}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        disabled={!canNext}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
