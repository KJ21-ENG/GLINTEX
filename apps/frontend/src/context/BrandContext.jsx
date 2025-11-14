/**
 * Brand Context for GLINTEX Inventory
 */

import React, { createContext, useContext } from 'react';

const BrandCtx = createContext(null);

export function useBrand() { 
  return useContext(BrandCtx); 
}

export { BrandCtx };
