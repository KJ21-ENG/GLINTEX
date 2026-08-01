/**
 * Pure stock selectors shared by the Stock page views and the Combined Stock view.
 *
 * Every function here was moved verbatim out of `pages/Stock.jsx` / `BobbinView.jsx`
 * so both the existing views and Combined Stock run the exact same math. The only
 * change made during the move was turning each closed-over value into a parameter.
 * Do not "improve" these bodies — the views' numbers must stay byte-for-byte identical.
 */

import { extractUserWastageNote, calcAvailableCountFromWeight } from '../../utils';

export const EPSILON = 1e-9;
export const idEq = (a, b) => String(a ?? '') === String(b ?? '');

export const getPieceIssueableWeight = (piece) => {
  const gross = Number(piece?.weight || 0);
  const dispatched = Number(piece?.dispatchedWeight || 0);
  const issuedToCutterWeight = Number(piece?.issuedToCutterWeight || 0);
  return Math.max(0, gross - dispatched - issuedToCutterWeight);
};

export const isPieceAvailableForIssue = (piece) => (
  getPieceIssueableWeight(piece) > EPSILON
  && Number(piece?.dispatchedWeight || 0) <= EPSILON
  && String(piece?.status || '').toLowerCase() !== 'consumed'
);

export const countAvailablePieces = (pieces = []) => pieces.filter(isPieceAvailableForIssue).length;

export function lotStatus(lot) {
  const pending = Number(lot.pendingWeight || 0);
  const initial = Number(lot.totalWeight || 0);
  if (pending > EPSILON && pending <= initial + EPSILON) return 'active';
  if (Math.abs(pending) <= EPSILON) return 'inactive';
  return pending > 0 ? 'active' : 'inactive';
}

export function buildStockGroupKey(lot) {
  return [
    lot.itemId || lot.itemName || '',
    lot.supplierId || lot.supplierName || '',
    lot.cutName || '',
    lot.yarnName || '',
    lot.twistName || ''
  ].join('::');
}

export const isCutterPurchaseLotNo = (lotNo) =>
  typeof lotNo === 'string' && lotNo.trim().toUpperCase().startsWith('CP-');

export function buildReceiveTotalsMap(db, receiveTotalsKey, receiveWeightField, receiveUnitField) {
  const map = new Map();
  const totalsList = Array.isArray(db?.[receiveTotalsKey]) ? db[receiveTotalsKey] : [];
  totalsList.forEach((row) => {
    map.set(row.pieceId, {
      received: Number(row[receiveWeightField] || 0),
      wastage: Number(row.wastageNetWeight || 0),
      totalUnits: Number(row[receiveUnitField] || 0),
    });
  });
  return map;
}

// Latest active cutter wastage note per piece (from challans). Only entries with an
// actual user-supplied note (after the em-dash separator) are included; auto-only
// notes like "Wastage marked: 7.794 kg" are skipped so the (i) tooltip surfaces only
// when there is real operator-written context to read.
export function buildCutterWastageNoteByPieceId(db, isCutter) {
  if (!isCutter) return new Map();
  const challans = Array.isArray(db?.receive_from_cutter_machine_challans) ? db.receive_from_cutter_machine_challans : [];
  const map = new Map();
  const sorted = [...challans].sort((a, b) => (b?.createdAt || '').localeCompare(a?.createdAt || ''));
  for (const ch of sorted) {
    if (!ch || ch.isDeleted) continue;
    if (!(Number(ch.wastageNetWeight || 0) > 0)) continue;
    if (!ch.pieceId || map.has(ch.pieceId)) continue;
    const userNote = extractUserWastageNote(ch.wastageNote);
    if (userNote) map.set(ch.pieceId, userNote);
  }
  return map;
}

export function buildCutterIssueByPieceId(db, isCutter) {
  if (!isCutter) return new Map();
  const issues = Array.isArray(db?.issue_to_cutter_machine) ? db.issue_to_cutter_machine : [];
  const machineMap = new Map((db?.machines || []).map(m => [m.id, m.name]));
  const sortedIssues = [...issues].sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return String(b?.date || '').localeCompare(String(a?.date || ''));
  });
  const map = new Map();
  sortedIssues.forEach((issue) => {
    const pieceIds = Array.isArray(issue.pieceIds)
      ? issue.pieceIds
      : String(issue.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
    const machineName = issue.machineName || machineMap.get(issue.machineId) || '';
    const issueDate = issue.date || '';
    pieceIds.forEach((id) => {
      if (!map.has(id)) {
        map.set(id, { machineName, issueDate });
      }
    });
  });
  return map;
}

export function buildJumboLotsMap(db, receiveTotalsMap, cutterIssueByPieceId, cutterWastageNoteByPieceId) {
  if (!db?.lots) return {};
  const m = {};
  for (const lot of db.lots) {
    m[lot.lotNo] = {
      ...lot,
      itemName: db.items.find(i => i.id === lot.itemId)?.name || '—',
      firmName: db.firms.find(f => f.id === lot.firmId)?.name || '—',
      supplierName: db.suppliers.find(s => s.id === lot.supplierId)?.name || '—',
      pieces: [],
      availableCount: 0,
      remainingWeight: 0,
      pendingWeight: 0,
      totalReceivedWeight: 0,
      totalReceivedUnits: 0,
      wastageTotal: 0,
      wastageCount: 0,
      wastageWeightBaseTotal: 0,
      issuedWeightBaseTotal: 0,
      avgWastage: 0,
      wastagePercent: 0,
      cutNames: new Set(),
      yarnNames: new Set(),
      barcodes: [],
    };
  }
  const inbound = db.inbound_items || [];
  for (const piece of inbound) {
    if (!m[piece.lotNo]) continue;
    const inboundWeight = Number(piece.weight || 0);
    const dispatchedWeight = Number(piece.dispatchedWeight || 0);
    const issuedToCutterWeight = Number(piece.issuedToCutterWeight || 0);
    const issueableWeight = Math.max(0, inboundWeight - dispatchedWeight - issuedToCutterWeight);
    const totals = receiveTotalsMap.get(piece.id) || { received: 0, wastage: 0, totalUnits: 0 };
    const receivedWeight = totals.received || 0;
    const wastageWeight = totals.wastage || 0;
    const pieceTotalUnits = totals.totalUnits || 0;
    const pendingRaw = inboundWeight - receivedWeight - wastageWeight - dispatchedWeight;
    const pendingForPiece = pendingRaw > EPSILON ? pendingRaw : 0;

    // Remaining weight for Jumbo Rolls view should reflect pieces that are still present (not issued/consumed).
    // We treat any piece with status === 'consumed' as not remaining.
    if (piece.status !== 'consumed') {
      m[piece.lotNo].remainingWeight = (m[piece.lotNo].remainingWeight || 0) + inboundWeight;
    }

    // Cut & Yarn Resolution
    const cutName = piece.cutName || piece.cut?.name || (typeof piece.cut === 'string' ? piece.cut : '') || db.cuts?.find(c => c.id === piece.cutId)?.name || '';
    if (cutName) m[piece.lotNo].cutNames.add(cutName);

    const yarnName = piece.yarnName || piece.yarn?.name || (typeof piece.yarn === 'string' ? piece.yarn : '') || db.yarns?.find(y => y.id === piece.yarnId)?.name || '';
    if (yarnName) m[piece.lotNo].yarnNames.add(yarnName);

    const issueMeta = cutterIssueByPieceId.get(piece.id);
    const issuedLabel = issueMeta
      ? `Issued${issueMeta.machineName ? `: ${issueMeta.machineName}` : ''}${issueMeta.issueDate ? ` • ${issueMeta.issueDate}` : ''}`
      : '';
    // Collect barcode for lot-level search
    const pieceBarcode = piece.barcode || '';
    if (pieceBarcode) m[piece.lotNo].barcodes.push(pieceBarcode);

    const pieceEntry = {
      ...piece,
      pendingWeight: pendingForPiece,
      receivedWeight,
      wastageWeight,
      wastageNote: cutterWastageNoteByPieceId.get(piece.id) || null,
      totalUnits: pieceTotalUnits,
      issueableWeight,
      cutName,
      yarnName,
      issuedLabel
    };

    m[piece.lotNo].pieces.push(pieceEntry);

    if (wastageWeight > 0) {
      m[piece.lotNo].wastageTotal = (m[piece.lotNo].wastageTotal || 0) + wastageWeight;
      m[piece.lotNo].wastageCount = (m[piece.lotNo].wastageCount || 0) + 1;
      m[piece.lotNo].wastageWeightBaseTotal = (m[piece.lotNo].wastageWeightBaseTotal || 0) + Number(piece.weight || 0);
    }
    m[piece.lotNo].issuedWeightBaseTotal = (m[piece.lotNo].issuedWeightBaseTotal || 0) + issuedToCutterWeight;
    const availableForIssue = isPieceAvailableForIssue(pieceEntry);
    if (availableForIssue) {
      m[piece.lotNo].availableCount = (m[piece.lotNo].availableCount || 0) + 1;
    }
    m[piece.lotNo].pendingWeight = (m[piece.lotNo].pendingWeight || 0) + pendingForPiece;
    m[piece.lotNo].totalReceivedWeight = (m[piece.lotNo].totalReceivedWeight || 0) + receivedWeight;
    m[piece.lotNo].totalReceivedUnits = (m[piece.lotNo].totalReceivedUnits || 0) + pieceTotalUnits;
  }

  Object.values(m).forEach(lot => {
    lot.avgWastage = (lot.wastageCount && lot.wastageCount > 0) ? (lot.wastageTotal / lot.wastageCount) : 0;
    lot.wastagePercent = Number(lot.issuedWeightBaseTotal || 0) > 0 ? ((lot.wastageTotal / lot.issuedWeightBaseTotal) * 100) : 0;
    lot.statusType = lotStatus(lot);
    lot.cutName = Array.from(lot.cutNames).join(', ') || '—';
    lot.yarnName = Array.from(lot.yarnNames).join(', ') || '—';
    lot.barcodeStr = (lot.barcodes || []).join(' ');
  });
  return m;
}

// --- Bobbins (moved verbatim from BobbinView.jsx) ---

// 1. Map Inbound Pieces
export function buildInboundPieceMap(db) {
  const map = new Map();
  (db.inbound_items || []).forEach((p) => { if (p?.id) map.set(p.id, p); });
  return map;
}

// 2. Map Lot Metadata
export function buildBobbinLotMetaMap(db) {
  const map = new Map();
  (db.lots || []).forEach((lot) => {
    const item = db.items.find(i => i.id === lot.itemId);
    const firm = db.firms.find(f => f.id === lot.firmId);
    const supplier = db.suppliers.find(s => s.id === lot.supplierId);
    map.set(lot.lotNo, {
      ...lot,
      itemName: item?.name || lot.itemName || '—',
      firmName: firm?.name || lot.firmName || '—',
      supplierName: supplier?.name || lot.supplierName || '—',
    });
  });
  return map;
}

// 3. Calculate Bobbin Crates (Rows)
export function buildBobbinCrates(db, inboundPieceMap, lotMetaMap) {
  return (db.receive_from_cutter_machine_rows || [])
    .filter(row => !row.isDeleted)
    .map((row) => {
      const piece = row?.pieceId ? inboundPieceMap.get(row.pieceId) : null;
      const lotNo = row?.lotNo || piece?.lotNo || '';
      const lotMeta = lotNo ? lotMetaMap.get(lotNo) : null;

      const bobbinQty = Number(row?.bobbinQuantity || 0);
      const issuedBobbins = Number(row?.issuedBobbins || 0);
      const dispatchedBobbins = Number(row?.dispatchedCount || 0);

      const netWeight = Number(row?.netWt ?? row?.totalKg ?? row?.yarnWt ?? 0);
      const issuedWeight = Number(row?.issuedBobbinWeight || 0);
      const dispatchedWeight = Number(row?.dispatchedWeight || 0);
      const availableWeightRaw = Number.isFinite(netWeight)
        ? (netWeight - issuedWeight - dispatchedWeight)
        : 0;
      const availableWeight = availableWeightRaw > EPSILON ? Math.max(0, availableWeightRaw) : 0;
      const availableBobbinsCalc = calcAvailableCountFromWeight({
        totalCount: bobbinQty,
        issuedCount: issuedBobbins,
        dispatchedCount: dispatchedBobbins,
        totalWeight: netWeight,
        availableWeight,
      });
      const availableBobbins = availableBobbinsCalc == null ? 0 : availableBobbinsCalc;

      const cutName = (typeof row.cut === 'string' ? row.cut : row.cut?.name) || db.cuts?.find(c => c.id === row.cutId)?.name || '—';
      const yarnName = row.yarnName || db.yarns?.find(y => y.id === row.yarnId)?.name || '—';

      return {
        ...row,
        lotNo,
        date: row.date || row.createdAt || '',
        itemId: piece?.itemId || lotMeta?.itemId || '',
        firmId: lotMeta?.firmId || '',
        supplierId: lotMeta?.supplierId || '',
        itemName: lotMeta?.itemName || '—',
        firmName: lotMeta?.firmName || '—',
        supplierName: lotMeta?.supplierName || '—',
        cutName,
        yarnName,
        bobbinQty,
        issuedBobbins,
        dispatchedBobbins,
        availableBobbins,
        netWeight,
        issuedWeight,
        availableWeight,
        bobbinName: row.bobbin?.name || row.pcsTypeName || '—',
      };
    });
}

// 4. Aggregate into Lots
export function buildBobbinLots(bobbinCrates) {
  const map = new Map();
  bobbinCrates.forEach((crate) => {
    const lotNo = crate.lotNo || '(No Lot)';
    const existing = map.get(lotNo) || {
      lotNo,
      lotKey: [
        lotNo,
        crate.itemId || '',
        crate.supplierId || '',
        crate.firmId || '',
      ].join('::'),
      date: crate.date || '',
      itemId: crate.itemId,
      firmId: crate.firmId,
      supplierId: crate.supplierId,
      itemName: crate.itemName,
      cutNames: new Set(),
      yarnNames: new Set(),
      firmName: crate.firmName,
      supplierName: crate.supplierName,
      totalBobbins: 0,
      issuedBobbins: 0,
      availableBobbins: 0,
      totalWeight: 0,
      issuedWeight: 0,
      availableWeight: 0,
      crates: [],
      barcodes: [],
      notes: [],
    };

    existing.crates.push(crate);
    existing.totalBobbins += crate.bobbinQty;
    existing.issuedBobbins += crate.issuedBobbins;
    existing.availableBobbins += crate.availableBobbins;
    existing.totalWeight += crate.netWeight;
    existing.issuedWeight += crate.issuedWeight;
    existing.availableWeight += crate.availableWeight;
    if (crate.cutName && crate.cutName !== '—') existing.cutNames.add(crate.cutName);
    if (crate.yarnName && crate.yarnName !== '—') existing.yarnNames.add(crate.yarnName);
    if (crate.barcode) existing.barcodes.push(crate.barcode);
    if (crate.notes) existing.notes.push(crate.notes);

    map.set(lotNo, existing);
  });
  return Array.from(map.values()).map(l => ({
    ...l,
    cutName: l.cutNames.size > 1 ? 'Mixed' : Array.from(l.cutNames)[0] || '—',
    barcodeStr: (l.barcodes || []).join(' '),
    notesStr: (l.notes || []).join(' '),
  }));
}
