import React from 'react';
import { Button } from '../ui';

export function LotRowsLoadMore({ pageState, onLoadMore }) {
  if (!pageState?.hasMore || typeof onLoadMore !== 'function') return null;
  return (
    <div className="flex justify-center py-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={Boolean(pageState.loadingMore)}
        onClick={(event) => {
          event.stopPropagation();
          onLoadMore();
        }}
      >
        {pageState.loadingMore ? 'Loading…' : 'Load more rows'}
      </Button>
    </div>
  );
}
