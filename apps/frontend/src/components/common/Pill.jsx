/**
 * Pill component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const Pill = ({ children, className = "", style = {} }) => {
  const { cls, brand } = useBrand();
  return (
    <span
      className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border ${cls.pill} ` + className}
      style={{ borderColor: brand.gold, ...style }}
    >
      {children}
    </span>
  );
};
