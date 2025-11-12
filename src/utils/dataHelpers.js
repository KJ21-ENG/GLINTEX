/**
 * Data helper utilities for GLINTEX Inventory
 */

import { defaultBrand } from './theme.js';

export function normalizeDb(raw) {
  const ensureArr = (val) => (Array.isArray(val) ? val : []);
  const items = ensureArr(raw?.items);
  const firms = ensureArr(raw?.firms);
  const suppliers = ensureArr(raw?.suppliers);
  const machines = ensureArr(raw?.machines);
  const workersRaw = ensureArr(raw?.workers?.length ? raw?.workers : raw?.operators);
  const workers = workersRaw.map((worker) => ({
    ...worker,
    role: (worker.role || 'operator').toLowerCase() === 'helper' ? 'helper' : 'operator',
  }));
  const operators = workers.filter((w) => w.role === 'operator');
  const helpers = workers.filter((w) => w.role === 'helper');
  const bobbins = ensureArr(raw?.bobbins);
  const boxes = ensureArr(raw?.boxes);
  const lots = ensureArr(raw?.lots);
  const inbound_items = ensureArr(raw?.inbound_items);
  const issueToMachine = ensureArr(raw?.issue_to_machine).map((record) => ({
    ...record,
    pieceIds: typeof record.pieceIds === 'string' ? record.pieceIds.split(',').filter(Boolean) : ensureArr(record.pieceIds),
    // Normalize date to canonical ISO (YYYY-MM-DD) for sorting, keep original for display if needed
    dateISO: (function() {
      try {
        // lazy-load formatting helper to avoid cycles
        const { parseDateToISO } = require('./formatting');
        return parseDateToISO(record.date || '');
      } catch (e) {
        // fallback simple normalization
        const d = record.date || '';
        if (typeof d === 'string' && d.match(/^\d{4}-\d{2}-\d{2}$/)) return d;
        return '';
      }
    })(),
  }));
  const settings = ensureArr(raw?.settings);
  const receiveUploads = ensureArr(raw?.receive_uploads);
  const receiveRows = ensureArr(raw?.receive_rows);
  const receivePieceTotals = ensureArr(raw?.receive_piece_totals);
  return {
    items,
    firms,
    suppliers,
    machines,
    workers,
    operators,
    helpers,
    bobbins,
    boxes,
    lots,
    inbound_items,
    issue_to_machine: issueToMachine,
    settings,
    receive_uploads: receiveUploads,
    receive_rows: receiveRows,
    receive_piece_totals: receivePieceTotals,
  };
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

/**
 * Aggregate lots by name, cullah and supplier and sum numeric fields.
 * Keeps first-seen values for non-numeric fields.
 */
export function aggregateLots(lots = []) {
  const keyFor = (lot) => `${lot.name || lot.itemName || ''}||${lot.cullah || ''}||${lot.supplier || lot.supplierName || ''}`;
  const grouped = new Map();

  for (const lot of lots) {
    const key = keyFor(lot);
    if (!grouped.has(key)) {
      // shallow clone to avoid mutating original and track source metadata
      const clone = { ...lot };
      clone._sourceLots = [lot.lotNo].filter(Boolean);
      clone._firms = [lot.firmName || lot.firm].filter(Boolean);
      grouped.set(key, clone);
      continue;
    }

    const acc = grouped.get(key);
    for (const field of Object.keys(lot)) {
      const val = lot[field];
      // sum numeric fields
      if (typeof val === 'number') {
        acc[field] = (acc[field] || 0) + val;
      } else if (typeof val === 'string') {
        // If the destination is numeric-like string, try coercion
        const maybeNum = Number(val);
        if (!Number.isNaN(maybeNum)) {
          acc[field] = (acc[field] || 0) + maybeNum;
        }
        // otherwise keep first-seen string value (do nothing)
      }
      // non-numeric fields: keep first-seen (already present in acc)
    }
    // merge source lots and firms metadata
    if (lot.lotNo) {
      acc._sourceLots = Array.from(new Set([...(acc._sourceLots || []), lot.lotNo]));
    }
    const maybeFirm = lot.firmName || lot.firm;
    if (maybeFirm) {
      acc._firms = Array.from(new Set([...(acc._firms || []), maybeFirm]));
    }
  }

  return Array.from(grouped.values());
}
