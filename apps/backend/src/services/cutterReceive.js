import { randomUUID } from 'node:crypto';
import { makeReceiveBarcode, parseReceiveCrateIndex } from '../utils/barcodeHelpers.js';

export class CutterReceiveError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const optionalId = (value) => typeof value === 'string' ? value.trim() : '';
const roundKg = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
const fail = (message, status) => { throw new CutterReceiveError(message, status); };

// All reads affecting balances and crate numbering happen under the piece lock.
// Worker groups share one transaction, so a failed group cannot leave a partial save.
export async function createCutterReceiveBatch(prisma, entriesRaw, {
  actorUserId,
  loadIssueAllocations,
  allocateChallanNumber,
  markWastage,
  normalizeWastageNote,
  fallbackMachineName,
}) {
  if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) fail('No entries provided');
  if (entriesRaw.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) fail('Invalid receive entry');
  const defaultDate = new Date().toISOString().slice(0, 10);
  const entries = entriesRaw.map((entry) => ({
    ...entry,
    pieceId: optionalId(entry.pieceId),
    issueId: optionalId(entry.issueId),
    bobbinId: optionalId(entry.bobbinId),
    boxId: optionalId(entry.boxId),
    operatorId: optionalId(entry.operatorId),
    helperId: optionalId(entry.helperId),
    cutId: optionalId(entry.cutId),
    shift: optionalId(entry.shift),
    receiveDate: optionalId(entry.receiveDate) || defaultDate,
  }));
  const pieceIds = new Set(entries.map((entry) => entry.pieceId));
  if (pieceIds.size !== 1 || !entries[0].pieceId) fail('Entries must belong to a single piece');
  const pieceId = entries[0].pieceId;
  const issueIds = new Set(entries.map((entry) => entry.issueId).filter(Boolean));
  if (issueIds.size > 1) fail('Entries must belong to a single cutter issue');
  const requestedIssueId = [...issueIds][0] || null;
  const wastageEntries = entries.filter((entry) => entry.isWastage);
  if (wastageEntries.length > 1) fail('Only one wastage entry is allowed per save');
  for (const entry of entries) {
    if (!entry.operatorId) fail('Missing operator');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.receiveDate)
      || Number.isNaN(new Date(entry.receiveDate).getTime())
      || new Date(entry.receiveDate).toISOString().slice(0, 10) !== entry.receiveDate) {
      fail('Invalid receive date');
    }
  }
  const createFields = { createdByUserId: actorUserId || null, updatedByUserId: actorUserId || null };
  const updateFields = { updatedByUserId: actorUserId || null };

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT id FROM "InboundItem" WHERE id = ${pieceId} FOR UPDATE`;
    if (locked.length === 0) fail('Piece not found', 404);
    const piece = await tx.inboundItem.findUnique({ where: { id: pieceId } });
    let allocations = await loadIssueAllocations(tx, pieceId);
    if (requestedIssueId) {
      allocations = allocations.filter((allocation) => allocation.issueId === requestedIssueId);
      if (allocations.length === 0) fail('Selected cutter issue has no pending weight for this piece');
    }
    allocations = allocations.map((allocation) => ({ ...allocation }));
    const totals = await tx.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
    if (Number(totals?.wastageNetWeight || 0) > 0.000001) {
      fail('This piece is already marked as wastage. Receiving is closed.');
    }
    const inboundPending = roundKg(Math.max(0, Number(piece.weight || 0) - Number(totals?.totalNetWeight || 0)));
    let pendingRemaining = allocations.length
      ? roundKg(allocations.reduce((sum, allocation) => sum + Number(allocation.remainingWeight || 0), 0))
      : inboundPending;
    pendingRemaining = Math.min(pendingRemaining, inboundPending);
    if (pendingRemaining <= 0) fail('Piece has no pending weight remaining');

    const workerIds = [...new Set(entries.flatMap((entry) => [entry.operatorId, entry.helperId]).filter(Boolean))];
    const cutIds = [...new Set(entries.map((entry) => entry.cutId).filter(Boolean))];
    const receiveEntries = entries.filter((entry) => !entry.isWastage);
    const [workers, cuts, bobbins, boxes, item, existingRows] = await Promise.all([
      tx.operator.findMany({ where: { id: { in: workerIds } } }),
      tx.cut.findMany({ where: { id: { in: cutIds } } }),
      tx.bobbin.findMany({ where: { id: { in: [...new Set(receiveEntries.map((entry) => entry.bobbinId).filter(Boolean))] } } }),
      tx.box.findMany({ where: { id: { in: [...new Set(receiveEntries.map((entry) => entry.boxId).filter(Boolean))] } } }),
      piece.itemId ? tx.item.findUnique({ where: { id: piece.itemId } }) : null,
      tx.receiveFromCutterMachineRow.findMany({ where: { pieceId, isDeleted: false }, select: { barcode: true } }),
    ]);
    const byId = (records) => new Map(records.map((record) => [record.id, record]));
    const workerMap = byId(workers);
    const cutMap = byId(cuts);
    const bobbinMap = byId(bobbins);
    const boxMap = byId(boxes);
    const validWorker = (worker, role) => worker
      && (worker.role || 'operator').trim().toLowerCase() === role
      && ['all', 'cutter'].includes(worker.processType || 'all');
    const groups = new Map();
    for (const entry of entries) {
      if (!validWorker(workerMap.get(entry.operatorId), 'operator')) fail('Invalid cutter operator selected');
      if (entry.helperId && !validWorker(workerMap.get(entry.helperId), 'helper')) fail('Invalid cutter helper selected');
      if (entry.cutId && !cutMap.has(entry.cutId)) fail('Selected cut was not found', 404);
      // Empty helper is a distinct group; it must never inherit another crate's helper.
      const key = JSON.stringify([entry.operatorId, entry.helperId, entry.cutId, entry.receiveDate]);
      if (!groups.has(key)) groups.set(key, {
        operatorId: entry.operatorId, helperId: entry.helperId || null,
        cutId: entry.cutId || null, date: entry.receiveDate,
        operatorName: workerMap.get(entry.operatorId).name,
        rows: [], totalNetWeight: 0, totalBobbinQty: 0, wastageNetWeight: 0,
      });
      entry.group = groups.get(key);
    }

    let crateIndex = existingRows.reduce((max, row) => Math.max(max, parseReceiveCrateIndex(row.barcode) || 0), 0);
    let totalNetWeight = 0;
    let totalBobbinQty = 0;
    const rowsToCreate = [];
    for (const entry of receiveEntries) {
      if (!entry.bobbinId) fail('Missing bobbin selection');
      if (!entry.boxId) fail('Missing box selection');
      const bobbinQty = Number(entry.bobbinQuantity ?? entry.bobbinQty);
      if (!Number.isInteger(bobbinQty) || bobbinQty <= 0) fail('Bobbin quantity must be a positive whole number');
      const gross = Number(entry.grossWeight);
      if (!Number.isFinite(gross) || gross <= 0) fail('Gross weight must be a positive number');
      const bobbin = bobbinMap.get(entry.bobbinId);
      const box = boxMap.get(entry.boxId);
      if (!bobbin) fail('Bobbin not found', 404);
      if (!box) fail('Box not found', 404);
      if (bobbin.weight == null || !Number.isFinite(Number(bobbin.weight)) || Number(bobbin.weight) < 0) {
        fail('Bobbin weight missing. Update bobbin first.');
      }
      if (!Number.isFinite(Number(box.weight)) || Number(box.weight) <= 0) fail('Box weight missing. Update box first.');
      const tare = roundKg(Number(box.weight) + Number(bobbin.weight) * bobbinQty);
      const net = roundKg(gross - tare);
      if (!Number.isFinite(net) || net <= 0) fail('Computed net weight must be positive. Check weights and quantity.');
      if (net - pendingRemaining > 0.000001) fail('Net weight exceeds pending weight');
      let rowIssueId = null;
      if (allocations.length) {
        const allocation = allocations.find((candidate) => Number(candidate.remainingWeight) - net >= -0.000001);
        if (!allocation) fail('Net weight exceeds pending weight');
        rowIssueId = allocation.issueId;
        allocation.remainingWeight = roundKg(Math.max(0, allocation.remainingWeight - net));
      }
      pendingRemaining = roundKg(pendingRemaining - net);
      totalNetWeight = roundKg(totalNetWeight + net);
      totalBobbinQty += bobbinQty;
      entry.group.totalNetWeight = roundKg(entry.group.totalNetWeight + net);
      entry.group.totalBobbinQty += bobbinQty;
      const operator = workerMap.get(entry.operatorId);
      const helper = workerMap.get(entry.helperId);
      const cut = cutMap.get(entry.cutId);
      const row = {
        issueId: rowIssueId, pieceId, vchNo: `MAN-${randomUUID().slice(0, 8)}`,
        date: entry.receiveDate, itemName: item?.name || null,
        grossWt: roundKg(gross), tareWt: tare, netWt: net, totalKg: net,
        pktTypeName: box.name, pcsTypeName: bobbin.name, bobbinId: bobbin.id, boxId: box.id,
        operatorId: operator.id, employee: operator.name,
        helperId: helper?.id || null, helperName: helper?.name || null,
        bobbinQuantity: bobbinQty, shift: entry.shift || null,
        machineNo: entry.machineNo || fallbackMachineName || null,
        cutId: cut?.id || null, cut: cut?.name || null,
        narration: 'Manual entry', createdBy: 'manual',
        barcode: makeReceiveBarcode({ lotNo: piece.lotNo, seq: piece.seq, crateIndex: ++crateIndex }),
      };
      entry.group.rows.push(row);
      rowsToCreate.push(row);
    }

    let wastageToMark = 0;
    let userWastageNote = null;
    const wastageGroup = wastageEntries[0]?.group;
    if (wastageGroup) {
      if (pendingRemaining <= 0) fail('No remaining pending weight to mark as wastage');
      wastageToMark = roundKg(pendingRemaining);
      userWastageNote = normalizeWastageNote(wastageEntries[0].wastageNote);
      wastageGroup.wastageNetWeight = wastageToMark;
      wastageGroup.wastageNote = userWastageNote
        ? `Wastage marked: ${wastageToMark.toFixed(3)} kg — ${userWastageNote}`
        : `Wastage marked: ${wastageToMark.toFixed(3)} kg`;
    }
    const upload = await tx.receiveFromCutterMachineUpload.create({
      data: { originalFilename: 'manual-challan', rowCount: rowsToCreate.length, ...createFields },
    });
    const challans = [];
    for (const group of groups.values()) {
      const meta = await allocateChallanNumber(tx, actorUserId, group.date);
      const challan = await tx.receiveFromCutterMachineChallan.create({
        data: {
          ...meta, pieceId, lotNo: piece.lotNo, itemId: piece.itemId || null,
          date: group.date, operatorId: group.operatorId, helperId: group.helperId, cutId: group.cutId,
          totalNetWeight: group.totalNetWeight, totalBobbinQty: group.totalBobbinQty,
          wastageNetWeight: group.wastageNetWeight, wastageNote: group.wastageNote || null,
          changeLog: [{ at: new Date().toISOString(), action: 'create', actorUserId,
            details: { totalNetWeight: group.totalNetWeight, totalBobbinQty: group.totalBobbinQty, wastageNetWeight: group.wastageNetWeight } }],
          ...createFields,
        },
      });
      group.challan = challan;
      challans.push(challan);
      for (const row of group.rows) row.challanId = challan.id;
    }
    // Preserve the original crate order even when worker groups are interleaved.
    for (const row of rowsToCreate) {
      await tx.receiveFromCutterMachineRow.create({ data: { ...row, uploadId: upload.id, ...createFields } });
    }
    await tx.receiveFromCutterMachinePieceTotal.upsert({
      where: { pieceId },
      update: {
        totalNetWeight: { increment: totalNetWeight }, totalBob: { increment: totalBobbinQty },
        ...(wastageToMark > 0 ? { wastageNetWeight: { increment: wastageToMark } } : {}), ...updateFields,
      },
      create: { pieceId, totalNetWeight, totalBob: totalBobbinQty, wastageNetWeight: wastageToMark, ...createFields },
    });
    if (wastageToMark > 0) {
      const event = await markWastage(tx, { pieceId, weight: wastageToMark, note: userWastageNote, challanId: wastageGroup.challan.id });
      await tx.receiveFromCutterMachinePieceTotal.update({ where: { pieceId }, data: { lastWastageEventId: event.id } });
    }
    return { challans, rowsCreated: rowsToCreate.length, totalNetWeight, totalBobbinQty,
      wastageToMark, userWastageNote, piece, itemName: item?.name || '',
      groups: [...groups.values()].map(({ operatorName, challan }) => ({ operatorName, challan })) };
  }, { maxWait: 10000, timeout: 20000 });
}
