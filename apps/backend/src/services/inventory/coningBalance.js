import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { ACTIVE_BATCH_STATUSES } from '../packing/constants.js';
import { badRequest, notFound } from '../packing/errors.js';
import { serialize } from '../packing/serialization.js';

const EPSILON = 0.000001;

function uniqueSorted(ids) {
  return [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))].sort();
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundBalance(value) {
  return Math.round((numberOrZero(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function parseRefs(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function refIdentityMatches(ref, sourceId, barcode) {
  const rowId = String(ref?.rowId || '').trim();
  const refBarcode = String(ref?.barcode || '').trim();
  return rowId === sourceId || (!!barcode && refBarcode === barcode);
}

async function lockByIds(tx, tableName, ids) {
  const sorted = uniqueSorted(ids);
  if (!sorted.length) return [];
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM ${Prisma.raw(`"${tableName}"`)}
    WHERE "id" IN (${Prisma.join(sorted)})
    ORDER BY "id"
    FOR UPDATE
  `);
  const locked = rows.map((row) => String(row.id));
  if (locked.length !== sorted.length) {
    throw notFound('source_not_found', 'One or more inventory sources could not be found.', { sourceIds: sorted });
  }
  return locked;
}

export async function lockConingSources(tx, sourceIds = []) {
  return lockByIds(tx, 'ReceiveFromConingMachineRow', sourceIds);
}

export async function lockPackedSources(tx, sourceIds = []) {
  return lockByIds(tx, 'PackedUnit', sourceIds);
}

export async function lockPackingSourcesForConing(tx, sourceIds = []) {
  const ids = uniqueSorted(sourceIds);
  if (!ids.length) return [];
  return tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "PackingBatchSource"
    WHERE "sourceType" = 'CONING_RECEIVE'
      AND "sourceId" IN (${Prisma.join(ids)})
    ORDER BY "sourceId", "id"
    FOR UPDATE
  `);
}

export async function lockPackingSourcesForPackedUnits(tx, sourceIds = []) {
  const ids = uniqueSorted(sourceIds);
  if (!ids.length) return [];
  return tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "PackingBatchSource"
    WHERE "sourceType" = 'PACKED_UNIT'
      AND "sourceId" IN (${Prisma.join(ids)})
    ORDER BY "sourceId", "id"
    FOR UPDATE
  `);
}

async function loadReConingConsumption(client, row) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT "receivedRowRefs"
    FROM "IssueToConingMachine"
    WHERE "isDeleted" = false
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements("receivedRowRefs") AS element
        WHERE element->>'rowId' = ${row.id}
           OR (${row.barcode || null} IS NOT NULL AND element->>'barcode' = ${row.barcode || null})
      )
  `);
  const total = { count: 0, weight: 0 };
  for (const issue of rows) {
    for (const ref of parseRefs(issue.receivedRowRefs)) {
      if (!refIdentityMatches(ref, row.id, row.barcode)) continue;
      total.count += numberOrZero(ref.issueRolls ?? ref.rolls);
      total.weight += numberOrZero(ref.issueWeight ?? ref.weight);
    }
  }

  const takeBackLines = await client.issueTakeBackLine.findMany({
    where: {
      sourceId: row.id,
      takeBack: { stage: 'coning', isReversed: false },
    },
    select: {
      count: true,
      weight: true,
      takeBack: { select: { isReverse: true } },
    },
  });
  for (const line of takeBackLines) {
    const sign = line.takeBack?.isReverse ? 1 : -1;
    total.count += sign * numberOrZero(line.count);
    total.weight += sign * numberOrZero(line.weight);
  }
  return total;
}

async function loadPackingConsumption(client, rowId) {
  const rows = await client.packingBatchSource.findMany({
    where: {
      sourceType: 'CONING_RECEIVE',
      sourceId: rowId,
      batch: { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'SHORT_CLOSED'] } },
    },
    select: {
      batch: { select: { status: true } },
      reservedBaseCount: true,
      reservedNetWeightKg: true,
      consumedBaseCount: true,
      consumedNetWeightKg: true,
      releasedBaseCount: true,
      releasedNetWeightKg: true,
    },
  });
  const result = {
    consumed: { count: 0, weight: 0 },
    reserved: { count: 0, weight: 0 },
  };
  for (const source of rows) {
    result.consumed.count += numberOrZero(source.consumedBaseCount);
    result.consumed.weight += numberOrZero(source.consumedNetWeightKg);
    if (ACTIVE_BATCH_STATUSES.includes(source.batch?.status)) {
      result.reserved.count += Math.max(
        0,
        numberOrZero(source.reservedBaseCount)
          - numberOrZero(source.consumedBaseCount)
          - numberOrZero(source.releasedBaseCount),
      );
      result.reserved.weight += Math.max(
        0,
        numberOrZero(source.reservedNetWeightKg)
          - numberOrZero(source.consumedNetWeightKg)
          - numberOrZero(source.releasedNetWeightKg),
      );
    }
  }
  return result;
}

async function loadAppliedAdjustments(client, rowId) {
  const lines = await client.inventoryAdjustmentLine.findMany({
    where: {
      sourceId: rowId,
      sourceType: { in: ['CONING_RECEIVE', 'CONING_OPENING', 'CONING'] },
      batch: { status: { in: ['APPLIED', 'REVERSED'] } },
    },
    select: { countDelta: true, weightDeltaKg: true },
  });
  return lines.reduce((total, line) => ({
    count: total.count + numberOrZero(line.countDelta),
    weight: total.weight + numberOrZero(line.weightDeltaKg),
  }), { count: 0, weight: 0 });
}

async function loadConingSource(client, sourceId) {
  const row = await client.receiveFromConingMachineRow.findUnique({
    where: { id: String(sourceId) },
    include: {
      issue: { include: { yarn: true, twist: true, cut: true } },
      box: true,
    },
  });
  if (row?.issue?.itemId) {
    row.issue.item = await client.item.findUnique({ where: { id: row.issue.itemId } });
  }
  return row;
}

async function loadConingSources(client, sourceIds) {
  const ids = uniqueSorted(sourceIds);
  if (!ids.length) return [];
  const rows = await client.receiveFromConingMachineRow.findMany({
    where: { id: { in: ids } },
    include: {
      issue: { include: { yarn: true, twist: true, cut: true } },
      box: true,
    },
  });
  const itemIds = uniqueSorted(rows.map((row) => row.issue?.itemId));
  const items = itemIds.length && client.item?.findMany
    ? await client.item.findMany({ where: { id: { in: itemIds } } })
    : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const row of rows) {
    if (row.issue?.itemId) row.issue.item = itemById.get(row.issue.itemId) || null;
  }
  return rows;
}

function emptyConsumption() {
  return { count: 0, weight: 0 };
}

function emptyPackingConsumption() {
  return { consumed: emptyConsumption(), reserved: emptyConsumption() };
}

async function loadReConingConsumptionBatch(client, rows) {
  const ids = uniqueSorted(rows.map((row) => row.id));
  const barcodes = new Set(rows.map((row) => String(row.barcode || '').trim()).filter(Boolean));
  const result = new Map(ids.map((id) => [id, emptyConsumption()]));
  if (!ids.length) return result;

  const barcodeValues = [...barcodes];
  const barcodeClause = barcodeValues.length
    ? Prisma.sql`OR element->>'barcode' IN (${Prisma.join(barcodeValues)})`
    : Prisma.sql``;
  const issues = await client.$queryRaw(Prisma.sql`
    SELECT "receivedRowRefs"
    FROM "IssueToConingMachine"
    WHERE "isDeleted" = false
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE("receivedRowRefs", '[]'::jsonb)) AS element
        WHERE element->>'rowId' IN (${Prisma.join(ids)})
          ${barcodeClause}
      )
  `);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const issue of issues) {
    for (const ref of parseRefs(issue.receivedRowRefs)) {
      const row = rowById.get(String(ref?.rowId || '').trim())
        || rows.find((candidate) => refIdentityMatches(ref, candidate.id, candidate.barcode) && barcodes.has(String(candidate.barcode || '').trim()));
      if (!row) continue;
      const total = result.get(row.id);
      total.count += numberOrZero(ref.issueRolls ?? ref.rolls);
      total.weight += numberOrZero(ref.issueWeight ?? ref.weight);
    }
  }

  const takeBackLines = await client.issueTakeBackLine.findMany({
    where: {
      sourceId: { in: ids },
      takeBack: { stage: 'coning', isReversed: false },
    },
    select: {
      sourceId: true,
      count: true,
      weight: true,
      takeBack: { select: { isReverse: true } },
    },
  });
  for (const line of takeBackLines) {
    const total = result.get(line.sourceId);
    if (!total) continue;
    const sign = line.takeBack?.isReverse ? 1 : -1;
    total.count += sign * numberOrZero(line.count);
    total.weight += sign * numberOrZero(line.weight);
  }
  return result;
}

async function loadPackingConsumptionBatch(client, sourceIds) {
  const ids = uniqueSorted(sourceIds);
  const result = new Map(ids.map((id) => [id, emptyPackingConsumption()]));
  if (!ids.length) return result;
  const rows = await client.packingBatchSource.findMany({
    where: {
      sourceType: 'CONING_RECEIVE',
      sourceId: { in: ids },
      batch: { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'SHORT_CLOSED'] } },
    },
    select: {
      sourceId: true,
      batch: { select: { status: true } },
      reservedBaseCount: true,
      reservedNetWeightKg: true,
      consumedBaseCount: true,
      consumedNetWeightKg: true,
      releasedBaseCount: true,
      releasedNetWeightKg: true,
    },
  });
  for (const source of rows) {
    const total = result.get(source.sourceId);
    if (!total) continue;
    total.consumed.count += numberOrZero(source.consumedBaseCount);
    total.consumed.weight += numberOrZero(source.consumedNetWeightKg);
    if (ACTIVE_BATCH_STATUSES.includes(source.batch?.status)) {
      total.reserved.count += Math.max(0, numberOrZero(source.reservedBaseCount) - numberOrZero(source.consumedBaseCount) - numberOrZero(source.releasedBaseCount));
      total.reserved.weight += Math.max(0, numberOrZero(source.reservedNetWeightKg) - numberOrZero(source.consumedNetWeightKg) - numberOrZero(source.releasedNetWeightKg));
    }
  }
  return result;
}

async function loadAppliedAdjustmentsBatch(client, sourceIds) {
  const ids = uniqueSorted(sourceIds);
  const result = new Map(ids.map((id) => [id, emptyConsumption()]));
  if (!ids.length) return result;
  const lines = await client.inventoryAdjustmentLine.findMany({
    where: {
      sourceId: { in: ids },
      sourceType: { in: ['CONING_RECEIVE', 'CONING_OPENING', 'CONING'] },
      batch: { status: { in: ['APPLIED', 'REVERSED'] } },
    },
    select: { sourceId: true, countDelta: true, weightDeltaKg: true },
  });
  for (const line of lines) {
    const total = result.get(line.sourceId);
    if (!total) continue;
    total.count += numberOrZero(line.countDelta);
    total.weight += numberOrZero(line.weightDeltaKg);
  }
  return result;
}

function buildConingAvailability(row, reconing, packing, adjustments) {
  const current = {
    count: numberOrZero(row.coneCount),
    weight: numberOrZero(row.netWeight),
  };
  const dispatch = {
    count: numberOrZero(row.dispatchedCount),
    weight: numberOrZero(row.dispatchedWeight),
  };
  const available = {
    count: current.count - dispatch.count - reconing.count - packing.consumed.count - packing.reserved.count + adjustments.count,
    weight: roundBalance(current.weight - dispatch.weight - reconing.weight - packing.consumed.weight - packing.reserved.weight + adjustments.weight),
  };
  return {
    source: serialize(row),
    current,
    dispatch,
    reconing,
    packing,
    adjustments,
    available,
    invariantBroken: available.count < -EPSILON || available.weight < -EPSILON,
  };
}

export async function getConingAvailability(client = prisma, sourceId, { includeDeleted = false } = {}) {
  const id = String(sourceId || '').trim();
  if (!id) throw badRequest('source_id_required', 'A Coning receive source ID is required.');
  const row = await loadConingSource(client, id);
  if (!row || (!includeDeleted && row.isDeleted)) throw notFound('coning_source_not_found', 'Coning receive source not found.', { sourceId: id });

  const reconing = await loadReConingConsumption(client, row);
  const packing = await loadPackingConsumption(client, row.id);
  const adjustments = await loadAppliedAdjustments(client, row.id);
  return buildConingAvailability(row, reconing, packing, adjustments);
}

export async function getConingAvailabilityBatch(client = prisma, sourceIds = [], { includeDeleted = false } = {}) {
  const ids = uniqueSorted(sourceIds);
  if (!ids.length) return new Map();
  const rows = await loadConingSources(client, ids);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !rowById.has(id) || (!includeDeleted && rowById.get(id).isDeleted));
  if (missing.length) throw notFound('coning_source_not_found', 'One or more Coning receive sources were not found.', { sourceIds: missing });
  const [reconing, packing, adjustments] = await Promise.all([
    loadReConingConsumptionBatch(client, rows),
    loadPackingConsumptionBatch(client, ids),
    loadAppliedAdjustmentsBatch(client, ids),
  ]);
  return new Map(rows.map((row) => [
    row.id,
    buildConingAvailability(row, reconing.get(row.id) || emptyConsumption(), packing.get(row.id) || emptyPackingConsumption(), adjustments.get(row.id) || emptyConsumption()),
  ]));
}

export async function assertConingAvailability(client, sourceId, requestedCount, requestedWeight, options = {}) {
  const balance = await getConingAvailability(client, sourceId, options);
  const count = numberOrZero(requestedCount);
  const weight = numberOrZero(requestedWeight);
  if (count < 0 || weight < 0) throw badRequest('negative_quantity', 'Count and weight cannot be negative.');
  if (balance.invariantBroken || count > balance.available.count + EPSILON || weight > balance.available.weight + 0.001) {
    throw badRequest('insufficient_coning_balance', 'The requested Coning quantity exceeds the authoritative available balance.', {
      sourceId,
      requested: { count, weight },
      available: balance.available,
    });
  }
  return balance;
}

export function assertNonNegativeBalance(balance, sourceId) {
  if (balance?.count < -EPSILON || balance?.weight < -EPSILON) {
    throw badRequest('negative_inventory_balance', 'The operation would create a negative inventory balance.', { sourceId, balance });
  }
}

export async function getConingSourceSnapshot(client, sourceId) {
  const row = await loadConingSource(client, sourceId);
  if (!row || row.isDeleted) throw notFound('coning_source_not_found', 'Coning receive source not found.', { sourceId });
  return row;
}

export { EPSILON };
