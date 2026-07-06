import React from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { TableRow, TableCell } from '../ui/Table';
import { Button } from '../ui/Button';

/**
 * Shared list-state content for data tables: initial loading, error (with retry),
 * and true empty. Prevents the classic bug where a table shows "No records" while
 * the first page is still loading.
 *
 * Render only when there are zero rows; pick the state via props.
 */
function StateContent({ isLoading, error, onRetry, emptyMessage }) {
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </span>
    );
  }
  if (error) {
    return (
      <span className="inline-flex flex-col items-center gap-2">
        <span className="inline-flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          {error?.message || 'Failed to load data.'}
        </span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        )}
      </span>
    );
  }
  return <span className="text-muted-foreground">{emptyMessage || 'No records found.'}</span>;
}

/** Table-body variant: a single full-width row. */
export function TableStateRow({ colSpan, isLoading, error, onRetry, emptyMessage }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center py-8">
        <StateContent isLoading={isLoading} error={error} onRetry={onRetry} emptyMessage={emptyMessage} />
      </TableCell>
    </TableRow>
  );
}

/** Card-list variant for the mobile layouts of the same tables. */
export function ListState({ isLoading, error, onRetry, emptyMessage, className = '' }) {
  return (
    <div className={`text-center text-sm py-8 ${className}`}>
      <StateContent isLoading={isLoading} error={error} onRetry={onRetry} emptyMessage={emptyMessage} />
    </div>
  );
}
