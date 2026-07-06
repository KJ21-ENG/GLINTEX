import React from 'react';
import { HighlightMatch } from '../common/HighlightMatch';

const MAX_WIDTHS = {
  sm: 'max-w-[120px]',
  md: 'max-w-[180px]',
  lg: 'max-w-[260px]',
};

/**
 * CellText - Truncating cell content with a hover tooltip for the full value.
 *
 * Keeps long values (item names, cone types, barcodes) on a single line so row
 * heights stay uniform, instead of wrapping into 3-line-tall cells.
 */
export function CellText({ text, query = '', max = 'md', className = '' }) {
  const value = text == null || text === '' ? '—' : String(text);
  return (
    <span
      className={`inline-block align-middle truncate ${MAX_WIDTHS[max] || MAX_WIDTHS.md} ${className}`}
      title={value === '—' ? undefined : value}
    >
      <HighlightMatch text={value} query={query} />
    </span>
  );
}
