/**
 * Section component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const Section = ({ title, actions, children }) => {
  const { cls } = useBrand();
  return (
    <div className={`rounded-2xl p-4 md:p-6 shadow-sm border ${cls.cardBorder} ${cls.cardBg} hover-elevate soft-shadow`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 min-w-0">
        <h2 className="text-lg md:text-xl font-semibold min-w-0 break-words">{title}</h2>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">{actions}</div>
      </div>
      {children}
    </div>
  );
};
