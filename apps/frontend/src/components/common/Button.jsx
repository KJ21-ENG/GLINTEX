/**
 * Button component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const Button = ({ children, className = "", style = {}, ...props }) => {
  const { brand } = useBrand();
  return (
    <button
      className={
        "btn-hover px-3 md:px-4 py-2 rounded-xl active:scale-[.99] transition text-white text-sm md:text-base disabled:opacity-60 disabled:cursor-not-allowed " +
        className
      }
      style={{ backgroundColor: brand.primary, ...style }}
      {...props}
    >
      {children}
    </button>
  );
};
