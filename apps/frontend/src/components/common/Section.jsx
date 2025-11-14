/**
 * Section component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';

export const Section = ({ title, actions, children }) => {
  const { cls } = useBrand();
  return (
    <div className={`rounded-2xl p-4 md:p-6 shadow-sm border ${cls.cardBorder} ${cls.cardBg} hover-elevate soft-shadow`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
        <div className="flex gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
};
