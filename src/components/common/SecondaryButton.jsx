/**
 * SecondaryButton component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const SecondaryButton = ({ children, className = "", ...props }) => {
  const { cls } = useBrand();
  return (
    <button
      className={`px-3 md:px-4 py-2 rounded-xl border ${cls.cardBorder} ${cls.cardBg} ${cls.baseText} text-sm md:text-base ${cls.navHover} ` + className}
      {...props}
    >
      {children}
    </button>
  );
};
