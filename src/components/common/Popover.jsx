import React from 'react';

// Minimal popover panel used across the app. Uses CSS variable --card-bg-solid
// so it is opaque in both light and dark themes.
export function Popover({ children, className = '', ...rest }) {
  return (
    <div className={`popover-panel ${className}`} {...rest}>
      {children}
    </div>
  );
}

export default Popover;


