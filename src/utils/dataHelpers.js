/**
 * Data helper utilities for GLINTEX Inventory
 */

import { defaultBrand } from './theme.js';

export function normalizeDb(raw) {
  const ensureArr = (val) => (Array.isArray(val) ? val : []);
  const items = ensureArr(raw?.items);
  const firms = ensureArr(raw?.firms);
  const suppliers = ensureArr(raw?.suppliers);
  const lots = ensureArr(raw?.lots);
  const inbound_items = ensureArr(raw?.inbound_items);
  const consumptions = ensureArr(raw?.consumptions).map((c) => ({
    ...c,
    pieceIds: typeof c.pieceIds === 'string' ? c.pieceIds.split(',').filter(Boolean) : ensureArr(c.pieceIds),
  }));
  const settings = ensureArr(raw?.settings);
  return { items, firms, suppliers, lots, inbound_items, consumptions, settings };
}

export function extractBrandFromDb(db) {
  const settingsRow = db?.settings?.[0];
  if (!settingsRow) return { ...defaultBrand };
  return {
    primary: settingsRow.brandPrimary || defaultBrand.primary,
    gold: settingsRow.brandGold || defaultBrand.gold,
    logoDataUrl: settingsRow.logoDataUrl || "",
  };
}

export function groupBy(arr, keyFn) { 
  const m = {}; 
  for (const x of arr) { 
    const k = keyFn(x); 
    (m[k] ||= []).push(x);
  } 
  return m; 
}
