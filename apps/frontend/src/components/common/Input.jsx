/**
 * Input component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const Input = ({ className = "", inputRef, ...props }) => {
  const { cls } = useBrand();
  return (
    <input
      ref={inputRef}
      className={`w-full box-border appearance-none leading-tight px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${cls.input} ` + className}
      {...props}
    />
  );
};
