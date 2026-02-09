/**
 * Data helper utilities for GLINTEX Inventory
 */

import { defaultBrand } from './theme.js';

export function normalizeDb(raw) {
  const ensureArr = (val) => (Array.isArray(val) ? val : []);
  const items = ensureArr(raw?.items);
  const yarns = ensureArr(raw?.yarns);
  const cuts = ensureArr(raw?.cuts);
  const twists = ensureArr(raw?.twists);
  const firms = ensureArr(raw?.firms);
  const customers = ensureArr(raw?.customers);
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
  const rollTypes = ensureArr(raw?.roll_types);
  const coneTypes = ensureArr(raw?.cone_types);
  const wrappers = ensureArr(raw?.wrappers);
  const issueToCutterMachine = ensureArr(raw?.issue_to_cutter_machine).map((record) => ({
    ...record,
    pieceIds: typeof record.pieceIds === 'string' ? record.pieceIds.split(',').filter(Boolean) : ensureArr(record.pieceIds),
    // Normalize date to canonical ISO (YYYY-MM-DD) for sorting, keep original for display if needed
    dateISO: (function () {
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
  const issueToHoloMachine = ensureArr(raw?.issue_to_holo_machine);
  const issueToConingMachine = ensureArr(raw?.issue_to_coning_machine);
  const receiveUploads = ensureArr(raw?.receive_from_cutter_machine_uploads);
  const receiveRows = ensureArr(raw?.receive_from_cutter_machine_rows);
  const receiveChallans = ensureArr(raw?.receive_from_cutter_machine_challans);
  const receivePieceTotals = ensureArr(raw?.receive_from_cutter_machine_piece_totals);
  return {
    items,
    yarns,
    cuts,
    twists,
    firms,
    customers,
    suppliers,
    machines,
    workers,
    operators,
    helpers,
    bobbins,
    boxes,
    lots,
    inbound_items,
    rollTypes,
    cone_types: coneTypes,
    wrappers,
    issue_to_cutter_machine: issueToCutterMachine,
    issue_to_holo_machine: issueToHoloMachine,
    issue_to_coning_machine: issueToConingMachine,
    settings,
    receive_from_cutter_machine_uploads: receiveUploads,
    receive_from_cutter_machine_rows: receiveRows,
    receive_from_cutter_machine_challans: receiveChallans,
    receive_from_cutter_machine_piece_totals: receivePieceTotals,
    receive_from_holo_machine_rows: ensureArr(raw?.receive_from_holo_machine_rows),
    receive_from_coning_machine_rows: ensureArr(raw?.receive_from_coning_machine_rows),
    receive_from_holo_machine_piece_totals: ensureArr(raw?.receive_from_holo_machine_piece_totals),
    receive_from_coning_machine_piece_totals: ensureArr(raw?.receive_from_coning_machine_piece_totals),
  };
}

export function extractBrandFromDb(db) {
  const settingsRow = db?.settings?.[0];
  if (!settingsRow) return { ...defaultBrand };
  return {
    primary: settingsRow.brandPrimary || defaultBrand.primary,
    gold: settingsRow.brandGold || defaultBrand.gold,
    logoDataUrl: settingsRow.logoDataUrl || "",
    faviconDataUrl: settingsRow.faviconDataUrl || "",
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

// Mirror backend availability logic so weight-only dispatches reduce counts accurately.
export function calcAvailableCountFromWeight({
  totalCount,
  issuedCount,
  dispatchedCount,
  totalWeight,
  availableWeight,
}) {
  const total = Number(totalCount || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const issued = Number(issuedCount || 0);
  const dispatched = Number(dispatchedCount || 0);
  const countBased = Math.max(0, total - issued - dispatched);
  const totalWt = Number(totalWeight || 0);
  if (!Number.isFinite(totalWt) || totalWt <= 0) return countBased;
  const availWt = Number(availableWeight || 0);
  if (!Number.isFinite(availWt) || availWt <= 0) return 0;
  const ratio = availWt / totalWt;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const weightBased = Math.floor((ratio * total) + 1e-6);
  return Math.max(0, Math.min(countBased, weightBased));
}

export function estimateWeightFromCount({
  count,
  availableCount,
  availableWeight,
  avgWeightPerPiece,
  totalWeight,
  totalCount,
}) {
  const pieces = Number(count || 0);
  if (!Number.isFinite(pieces) || pieces <= 0) return '';

  const availCount = Number(availableCount || 0);
  const availWeight = Number(availableWeight || 0);
  if (Number.isFinite(availCount) && Number.isFinite(availWeight) && pieces === availCount && availWeight > 0) {
    return availWeight.toFixed(3);
  }

  let avgWeight = Number(avgWeightPerPiece || 0);
  if (!Number.isFinite(avgWeight) || avgWeight <= 0) {
    if (Number.isFinite(availCount) && availCount > 0 && Number.isFinite(availWeight) && availWeight > 0) {
      avgWeight = availWeight / availCount;
    }
  }
  if (!Number.isFinite(avgWeight) || avgWeight <= 0) {
    const totalCnt = Number(totalCount || 0);
    const totalWt = Number(totalWeight || 0);
    if (Number.isFinite(totalCnt) && totalCnt > 0 && Number.isFinite(totalWt) && totalWt > 0) {
      avgWeight = totalWt / totalCnt;
    }
  }
  if (!Number.isFinite(avgWeight) || avgWeight <= 0) return '';
  return (pieces * avgWeight).toFixed(3);
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
