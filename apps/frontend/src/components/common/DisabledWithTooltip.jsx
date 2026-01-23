import React from 'react';
import { cn } from '../../lib/utils';

export function DisabledWithTooltip({ disabled, tooltip, children, className }) {
  if (!disabled) return children;
  const child = React.isValidElement(children)
    ? React.cloneElement(children, { disabled: true, 'aria-disabled': true, tabIndex: -1 })
    : children;
  return (
    <span className={cn('inline-flex cursor-not-allowed', className)} title={tooltip}>
      {child}
    </span>
  );
}
