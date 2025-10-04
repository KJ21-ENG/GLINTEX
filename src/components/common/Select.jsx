/**
 * Select component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const Select = ({ className = "", children, ...props }) => {
  const { cls } = useBrand();
  return (
    <select
      className={`w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${cls.input} ` + className}
      {...props}
    >
      {children}
    </select>
  );
};
