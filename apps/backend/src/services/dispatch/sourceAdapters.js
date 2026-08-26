import { Prisma } from '@prisma/client';
import { createPackedUnitEvent, packedUnitInclude, lockRecord } from '../packing/common.js';
import { PACKING_EVENT_TYPES } from '../packing/constants.js';
import {
  damagePackingUnit,
  dispatchWholePackedUnit,
  returnPackingUnit,
  splitPackedUnitForDispatch,
} from '../packing/unitService.js';
import { badRequest, conflict, notFound } from '../packing/errors.js';
import { transitionUnit } from '../packing/transitionService.js';
import {
  DISPATCH_SOURCE_TYPES,
  WEIGHT_EPSILON,
  clampLimit,
  cursorWhere,
  decodeCursor,
  normalizeSourceType,
  requiredId,
  safeSnapshot,
  serialize,
  sortByLockKey,
  transactionClient,
} from './common.js';

const LEGACY_STAGES = Object.freeze({
  INBOUND: 'inbound',
  CUTTER: 'cutter',
  HOLO: 'holo',
});

const ACTIVE_PACKED_STATUSES = ['AVAILABLE', 'RESERVED'];
const PACKING_RESERVATION_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'];

function numberOrZero(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function hasPackedPartialDispatchFields({
  residualBaseCount = null,
  residualNetWeightKg = null,
  damagedLostBaseCount = null,
  damagedLostNetWeightKg = null,
  salvageableBaseCount = null,
  salvageableNetWeightKg = null,
} = {}) {
  return [
    residualBaseCount,
    residualNetWeightKg,
    damagedLostBaseCount,
    damagedLostNetWeightKg,
    salvageableBaseCount,
    salvageableNetWeightKg,
  ].some((value) => value !== null && value !== undefined);
}

export function isWholePackedDispatch({
  count,
  weight,
  sourceCount,
  sourceWeight,
  ...partialFields
} = {}) {
  return Number(count) === Number(sourceCount)
    && Math.abs(Number(weight) - Number(sourceWeight)) <= WEIGHT_EPSILON
    && !hasPackedPartialDispatchFields(partialFields);
}

function clampZero(value) {
  return Math.max(0, numberOrZero(value));
}

function calcAvailableCountFromWeight({ totalCount, issuedCount, dispatchedCount, totalWeight, availableWeight }) {
  const total = Math.max(0, Math.trunc(numberOrZero(totalCount)));
  if (total <= 0) return 0;
  const countBased = Math.max(0, total - Math.trunc(numberOrZero(issuedCount)) - Math.trunc(numberOrZero(dispatchedCount)));
  const sourceWeight = numberOrZero(totalWeight);
  const available = numberOrZero(availableWeight);
  if (sourceWeight <= WEIGHT_EPSILON) return countBased;
  if (available <= WEIGHT_EPSILON) return 0;
  const weightBased = Math.floor((available / sourceWeight) * total + 1e-6);
  return Math.max(0, Math.min(countBased, weightBased));
}

async function buildHoloIssuedToConingMap(client, holoRowIds = []) {
  const ids = Array.from(new Set(holoRowIds.filter(Boolean).map(String)));
  if (!ids.length) return new Map();
  const [issueRows, takeBackRows] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT
        elem->>'rowId' AS row_id,
        SUM(CASE WHEN COALESCE(elem->>'issueRolls', '') = '' THEN 0 ELSE (elem->>'issueRolls')::numeric END) AS issue_rolls,
        SUM(CASE WHEN COALESCE(elem->>'issueWeight', '') = '' THEN 0 ELSE (elem->>'issueWeight')::numeric END) AS issue_weight
      FROM "IssueToConingMachine" issue,
        jsonb_array_elements(COALESCE(issue."receivedRowRefs", '[]'::jsonb)) elem
      WHERE issue."isDeleted" = false
        AND elem->>'rowId' = ANY (${ids}::text[])
      GROUP BY row_id
    `),
    client.issueTakeBackLine.findMany({
      where: { sourceId: { in: ids }, takeBack: { stage: 'coning' } },
      select: { sourceId: true, count: true, weight: true, takeBack: { select: { isReverse: true } } },
    }),
  ]);
  const result = new Map();
  (issueRows || []).forEach((row) => {
    const id = row.row_id || row.rowId;
    if (!id) return;
    result.set(String(id), {
      issuedRolls: numberOrZero(row.issue_rolls || row.issueRolls),
      issuedWeight: numberOrZero(row.issue_weight || row.issueWeight),
    });
  });
  (takeBackRows || []).forEach((line) => {
    const id = String(line.sourceId);
    const current = result.get(id) || { issuedRolls: 0, issuedWeight: 0 };
    const sign = line.takeBack?.isReverse ? 1 : -1;
    current.issuedRolls += sign * numberOrZero(line.count);
    current.issuedWeight += sign * numberOrZero(line.weight);
    result.set(id, current);
  });
  result.forEach((value) => {
    value.issuedRolls = clampZero(value.issuedRolls);
    value.issuedWeight = clampZero(value.issuedWeight);
  });
  return result;
}

function holoNetWeight(row) {
  const rollWeight = numberOrZero(row.rollWeight);
  if (rollWeight > WEIGHT_EPSILON) return rollWeight;
  return Math.max(0, numberOrZero(row.grossWeight) - numberOrZero(row.tareWeight));
}

function legacyModel(sourceType) {
  switch (sourceType) {
    case DISPATCH_SOURCE_TYPES.INBOUND: return { model: 'inboundItem', table: 'InboundItem', stage: LEGACY_STAGES.INBOUND };
    case DISPATCH_SOURCE_TYPES.CUTTER: return { model: 'receiveFromCutterMachineRow', table: 'ReceiveFromCutterMachineRow', stage: LEGACY_STAGES.CUTTER };
    case DISPATCH_SOURCE_TYPES.HOLO: return { model: 'receiveFromHoloMachineRow', table: 'ReceiveFromHoloMachineRow', stage: LEGACY_STAGES.HOLO };
    default: return null;
  }
}

export function isLegacySourceType(sourceType) {
  return Boolean(legacyModel(sourceType));
}

export async function lockLegacySource(tx, sourceType, sourceId) {
  const normalizedType = normalizeSourceType(sourceType);
  const config = legacyModel(normalizedType);
  if (!config) throw badRequest('legacy_source_not_supported', 'This source is not a legacy Dispatch source.');
  const id = requiredId(sourceId, 'sourceId');
  await lockRecord(tx, config.table, id, 'dispatch_source_not_found', 'Dispatch source not found.');
  return id;
}

async function loadLegacySource(tx, sourceType, sourceId, { forUpdate = false } = {}) {
  const normalizedType = normalizeSourceType(sourceType);
  const config = legacyModel(normalizedType);
  if (!config) throw badRequest('legacy_source_not_supported', 'This source is not a legacy Dispatch source.');
  const id = requiredId(sourceId, 'sourceId');
  if (forUpdate) await lockLegacySource(tx, normalizedType, id);
  let row;
  if (normalizedType === DISPATCH_SOURCE_TYPES.INBOUND) {
    row = await tx.inboundItem.findUnique({ where: { id } });
  } else if (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER) {
    row = await tx.receiveFromCutterMachineRow.findUnique({
      where: { id },
      include: { issue: true, bobbin: true, cutMaster: true },
    });
  } else {
    row = await tx.receiveFromHoloMachineRow.findUnique({
      where: { id },
      include: { issue: true, rollType: true },
    });
  }
  if (!row || (row.isDeleted === true)) throw notFound('dispatch_source_not_found', 'Dispatch source not found.', { sourceType: normalizedType, sourceId: id });
  return row;
}

async function legacyAvailability(tx, sourceType, row) {
  const normalizedType = normalizeSourceType(sourceType);
  if (normalizedType === DISPATCH_SOURCE_TYPES.INBOUND) {
    const availableWeight = numberOrZero(row.weight) - numberOrZero(row.dispatchedWeight) - numberOrZero(row.issuedToCutterWeight);
    return { availableWeight: clampZero(availableWeight), availableCount: null, totalCount: null, sourceWeight: numberOrZero(row.weight) };
  }
  if (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER) {
    const totalWeight = numberOrZero(row.netWt);
    const issuedWeight = numberOrZero(row.issuedBobbinWeight);
    const availableWeight = totalWeight - numberOrZero(row.dispatchedWeight) - issuedWeight;
    const availableCount = calcAvailableCountFromWeight({
      totalCount: row.bobbinQuantity,
      issuedCount: row.issuedBobbins,
      dispatchedCount: row.dispatchedCount,
      totalWeight,
      availableWeight,
    });
    return { availableWeight: clampZero(availableWeight), availableCount, totalCount: numberOrZero(row.bobbinQuantity), sourceWeight: totalWeight };
  }
  const totalWeight = holoNetWeight(row);
  const issued = (await buildHoloIssuedToConingMap(tx, [row.id])).get(String(row.id)) || { issuedRolls: 0, issuedWeight: 0 };
  const availableWeight = totalWeight - numberOrZero(row.dispatchedWeight) - numberOrZero(issued.issuedWeight);
  const availableCount = calcAvailableCountFromWeight({
    totalCount: row.rollCount,
    issuedCount: issued.issuedRolls,
    dispatchedCount: row.dispatchedCount,
    totalWeight,
    availableWeight,
  });
  return { availableWeight: clampZero(availableWeight), availableCount, totalCount: numberOrZero(row.rollCount), sourceWeight: totalWeight, issuedToConing: issued };
}

async function itemName(tx, itemId) {
  if (!itemId) return null;
  const item = await tx.item.findUnique({ where: { id: String(itemId) }, select: { id: true, name: true } });
  return item?.name || null;
}

export async function getLegacySourceView(tx, sourceType, sourceId, { forUpdate = false, requireAvailable = false } = {}) {
  const normalizedType = normalizeSourceType(sourceType);
  const row = await loadLegacySource(tx, normalizedType, sourceId, { forUpdate });
  const availability = await legacyAvailability(tx, normalizedType, row);
  if (requireAvailable && availability.availableWeight <= WEIGHT_EPSILON && Number(availability.availableCount || 0) <= 0) {
    throw conflict('dispatch_source_unavailable', 'The Dispatch source has no remaining availability.', {
      sourceType: normalizedType,
      sourceId: row.id,
    });
  }
  const itemId = normalizedType === DISPATCH_SOURCE_TYPES.INBOUND
    ? row.itemId
    : row.issue?.itemId;
  const view = {
    sourceType: normalizedType,
    stage: legacyModel(normalizedType).stage,
    sourceId: row.id,
    createdAt: row.createdAt,
    barcode: normalizedType === DISPATCH_SOURCE_TYPES.INBOUND
      ? row.barcode
      : (row.barcode || (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER ? row.vchNo : null)),
    sourceBarcode: normalizedType === DISPATCH_SOURCE_TYPES.INBOUND
      ? row.barcode
      : (row.barcode || (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER ? row.vchNo : null)),
    itemId,
    itemName: await itemName(tx, itemId),
    lotNo: row.lotNo || row.issue?.lotNo || null,
    availableCount: availability.availableCount,
    availableNetWeightKg: availability.availableWeight,
    netWeightKg: availability.sourceWeight,
    customerId: null,
    customerName: null,
    packageKind: normalizedType === DISPATCH_SOURCE_TYPES.INBOUND ? 'INBOUND' : (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER ? 'BOBBIN' : 'ROLL'),
    allowPartialDispatch: true,
    isParentParcel: false,
    children: [],
    sourceDisplaySnapshot: {
      sourceType: normalizedType,
      stage: legacyModel(normalizedType).stage,
      sourceId: row.id,
      barcode: row.barcode || (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER ? row.vchNo : null),
      itemId,
      itemName: await itemName(tx, itemId),
      lotNo: row.lotNo || row.issue?.lotNo || null,
      notes: row.notes || row.note || null,
      machineName: row.machineNo || row.issue?.machine?.name || null,
      typeName: row.rollType?.name || row.bobbin?.name || row.pktTypeName || row.pcsTypeName || null,
      cutName: row.cut || row.cutMaster?.name || row.issue?.cut?.name || null,
      yarnName: row.yarnName || row.issue?.yarn?.name || null,
      twistName: row.issue?.twist?.name || null,
    },
  };
  return view;
}

export async function applyLegacySourceDelta(tx, {
  sourceType,
  sourceId,
  deltaWeightKg = 0,
  deltaBaseCount = 0,
  actorUserId = null,
}) {
  const normalizedType = normalizeSourceType(sourceType);
  const weight = numberOrZero(deltaWeightKg);
  const count = Math.trunc(numberOrZero(deltaBaseCount));
  if (Math.abs(weight) <= WEIGHT_EPSILON && count === 0) return getLegacySourceView(tx, normalizedType, sourceId, { forUpdate: true });
  const row = await loadLegacySource(tx, normalizedType, sourceId, { forUpdate: true });
  const currentWeight = numberOrZero(row.dispatchedWeight);
  const currentCount = numberOrZero(row.dispatchedCount);
  if (currentWeight + weight < -WEIGHT_EPSILON) throw conflict('dispatch_counter_underflow', 'Dispatch weight cannot become negative.', { sourceType: normalizedType, sourceId });
  if (normalizedType !== DISPATCH_SOURCE_TYPES.INBOUND && currentCount + count < 0) throw conflict('dispatch_counter_underflow', 'Dispatch count cannot become negative.', { sourceType: normalizedType, sourceId });
  const data = {
    dispatchedWeight: weight >= 0 ? { increment: weight } : { decrement: Math.abs(weight) },
    ...(normalizedType !== DISPATCH_SOURCE_TYPES.INBOUND && count !== 0
      ? { dispatchedCount: count >= 0 ? { increment: count } : { decrement: Math.abs(count) } }
      : {}),
    ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}),
  };
  const config = legacyModel(normalizedType);
  await tx[config.model].update({ where: { id: String(sourceId) }, data });
  return getLegacySourceView(tx, normalizedType, sourceId, { forUpdate: false });
}

export async function findLegacySourceByBarcode(tx, barcode) {
  const exact = String(barcode || '').trim();
  if (!exact) return null;
  const inbound = await tx.inboundItem.findUnique({ where: { barcode: exact } });
  if (inbound) return getLegacySourceView(tx, DISPATCH_SOURCE_TYPES.INBOUND, inbound.id, { requireAvailable: true });
  const cutterRows = await tx.receiveFromCutterMachineRow.findMany({
    where: { OR: [{ barcode: exact }, { vchNo: exact }], isDeleted: false },
    take: 3,
  });
  if (cutterRows.length > 1) throw conflict('barcode_ambiguous', 'The barcode matches more than one Cutter source.', { barcode: exact });
  if (cutterRows.length === 1) return getLegacySourceView(tx, DISPATCH_SOURCE_TYPES.CUTTER, cutterRows[0].id, { requireAvailable: true });
  const holo = await tx.receiveFromHoloMachineRow.findUnique({ where: { barcode: exact } });
  if (holo) return getLegacySourceView(tx, DISPATCH_SOURCE_TYPES.HOLO, holo.id, { requireAvailable: true });
  return null;
}

function searchWhere(search, fields) {
  const value = String(search || '').trim();
  if (!value) return null;
  return { OR: fields.map((field) => ({ [field]: { contains: value, mode: 'insensitive' } })) };
}

export async function listLegacySources(tx, sourceType, { search, cursor, limit = 50 } = {}) {
  const normalizedType = normalizeSourceType(sourceType);
  const take = clampLimit(limit);
  const cursorFilter = cursorWhere(cursor);
  const config = legacyModel(normalizedType);
  const where = normalizedType === DISPATCH_SOURCE_TYPES.INBOUND
    ? { status: { not: 'consumed' } }
    : { isDeleted: false };
  const textFilter = searchWhere(search, normalizedType === DISPATCH_SOURCE_TYPES.INBOUND ? ['barcode', 'lotNo'] : (normalizedType === DISPATCH_SOURCE_TYPES.CUTTER ? ['barcode', 'vchNo', 'itemName', 'pieceId'] : ['barcode', 'notes']));
  if (textFilter) where.AND = [textFilter];
  if (cursorFilter) where.AND = [...(where.AND || []), cursorFilter];
  const rawRows = await tx[config.model].findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(1000, take * 5 + 1),
  });
  const views = [];
  for (const row of rawRows) {
    try {
      const view = await getLegacySourceView(tx, normalizedType, row.id);
      if (view.availableNetWeightKg > WEIGHT_EPSILON || Number(view.availableCount || 0) > 0) views.push(view);
      if (views.length >= take + 1) break;
    } catch {
      // A concurrently deleted or malformed historical row is omitted from the available list.
    }
  }
  const hasMore = views.length > take;
  const items = hasMore ? views.slice(0, take) : views;
  return { items, nextCursor: hasMore ? cursorForSource(items[items.length - 1]) : null };
}

function cursorForSource(source) {
  return source?.createdAt && source?.sourceId
    ? Buffer.from(JSON.stringify({ createdAt: new Date(source.createdAt).toISOString(), id: source.sourceId }), 'utf8').toString('base64url')
    : null;
}

async function packedDescendants(tx, rootId) {
  const descendants = [];
  let frontier = [String(rootId)];
  while (frontier.length) {
    if (descendants.length > 10000) throw conflict('packed_hierarchy_too_large', 'The Packed hierarchy is too large to dispatch atomically.');
    const children = await tx.packedUnit.findMany({
      where: { parentUnitId: { in: frontier } },
      include: {
        packageType: true,
        item: true,
        wrapper: true,
        color: true,
        coneType: true,
        customer: true,
        childUnits: { select: { id: true } },
      },
      orderBy: { id: 'asc' },
    });
    if (!children.length) break;
    descendants.push(...children);
    frontier = children.map((child) => child.id);
  }
  return descendants;
}

function packedCustomerId(units) {
  const ids = [...new Set(units.map((unit) => unit.customerId).filter(Boolean).map(String))];
  if (ids.length > 1) throw conflict('packed_customer_mismatch', 'A parent Parcel contains units reserved to different Customers.', { customerIds: ids });
  return ids[0] || null;
}

function packedUnitDisplay(unit, { sourceId = unit.id, isParentParcel = false, children = [] } = {}) {
  const item = unit.item?.name || null;
  const packageKind = unit.packageType?.kind || null;
  const activeChildren = children.filter((child) => ACTIVE_PACKED_STATUSES.includes(child.status));
  const baseCount = isParentParcel ? activeChildren.reduce((sum, child) => sum + Number(child.baseCount || 0), 0) : Number(unit.baseCount || 0);
  const netWeightKg = isParentParcel ? activeChildren.reduce((sum, child) => sum + numberOrZero(child.netWeightKg), 0) : numberOrZero(unit.netWeightKg);
  return {
    sourceType: DISPATCH_SOURCE_TYPES.PACKED,
    sourceId,
    id: sourceId,
    barcode: unit.barcode,
    sourceBarcode: unit.barcode,
    itemId: unit.itemId,
    parentUnitId: unit.parentUnitId || null,
    itemName: item,
    packageKind,
    packageType: unit.packageType,
    levelIndex: unit.levelIndex,
    baseCount,
    availableCount: baseCount,
    netWeightKg,
    availableNetWeightKg: netWeightKg,
    customerId: packedCustomerId(activeChildren.length ? activeChildren : [unit]),
    customerName: activeChildren.find((child) => child.customer?.name)?.customer?.name || unit.customer?.name || null,
    allowPartialDispatch: unit.recipe?.allowPartialDispatch === true,
    isParentParcel,
    children: activeChildren.map((child) => ({
      id: child.id,
      sourceId: child.id,
      barcode: child.barcode,
      sourceType: DISPATCH_SOURCE_TYPES.PACKED,
      packageKind: child.packageType?.kind,
      baseCount: child.baseCount,
      netWeightKg: serialize(child.netWeightKg),
      availableCount: child.baseCount,
      availableNetWeightKg: serialize(child.netWeightKg),
      customerId: child.customerId,
      status: child.status,
    })),
    sourceDisplaySnapshot: safeSnapshot({
      sourceType: DISPATCH_SOURCE_TYPES.PACKED,
      sourceId,
      barcode: unit.barcode,
      itemId: unit.itemId,
      itemName: item,
      packageKind,
      levelIndex: unit.levelIndex,
      customerId: packedCustomerId(activeChildren.length ? activeChildren : [unit]),
      childCount: activeChildren.length,
    }),
  };
}

async function loadPackedUnit(tx, id, { requireStock = false } = {}) {
  const unit = await tx.packedUnit.findUnique({ where: { id: String(id) }, include: packedUnitInclude });
  if (!unit) throw notFound('packed_source_not_found', 'Packed Unit source not found.', { sourceId: id });
  if (requireStock && !unit.isStockUnit) throw badRequest('packed_stock_unit_required', 'The selected Packed source is not an independently actionable stock unit.');
  return unit;
}

async function openPackedParentForChildMutation(tx, parentUnitId, {
  reason,
  actorUserId,
  idempotencyKey,
  childMutation,
} = {}) {
  if (!parentUnitId) return null;
  const parentId = requiredId(parentUnitId, 'parentPackedUnitId');
  await lockRecord(tx, 'PackedUnit', parentId, 'packed_parent_not_found', 'Packed parent container not found.');
  const parent = await tx.packedUnit.findUnique({ where: { id: parentId }, select: { id: true, batchId: true, status: true, barcode: true, levelIndex: true } });
  if (!parent) throw notFound('packed_parent_not_found', 'Packed parent container not found.', { parentUnitId: parentId });
  if (parent.status !== 'OPENED') transitionUnit(parent.status, 'OPENED');
  const updated = parent.status === 'OPENED'
    ? parent
    : await tx.packedUnit.update({ where: { id: parentId }, data: { status: 'OPENED', version: { increment: 1 }, ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}) } });
  await createPackedUnitEvent(tx, {
    batchId: parent.batchId,
    unitId: parent.id,
    type: PACKING_EVENT_TYPES.UNIT_SPLIT,
    reason: reason || 'A child Packed Unit was removed from the sealed parent hierarchy.',
    payload: {
      childMutation: childMutation || 'DISPATCHED',
      beforeStatus: parent.status,
      afterStatus: 'OPENED',
      parentBarcode: parent.barcode,
    },
    idempotencyKey: `${idempotencyKey}:parent-open:${parent.id}`,
    actorUserId,
  });
  return updated;
}

export async function getPackedSourceView(tx, sourceId, { requireAvailable = false } = {}) {
  const unit = await loadPackedUnit(tx, requiredId(sourceId, 'sourceId'));
  if (!unit.barcode) throw conflict('packed_barcode_pending', 'Packed Unit does not have a sealed barcode yet.');
  if (!unit.isStockUnit && String(unit.packageType?.kind || '').toUpperCase() !== 'PARCEL') {
    throw badRequest('packed_stock_unit_required', 'Only stock units or parent Parcels can be selected for Dispatch.');
  }
  const children = unit.isStockUnit ? [] : (await packedDescendants(tx, unit.id)).filter((child) => child.isStockUnit);
  if (!unit.isStockUnit && children.length) {
    const reservedChild = await tx.packingBatchSource.findFirst({
      where: {
        sourceType: 'PACKED_UNIT',
        sourceId: { in: children.map((child) => child.id) },
        batch: { status: { in: PACKING_RESERVATION_STATUSES } },
      },
      select: { sourceId: true, batchId: true },
    });
    if (reservedChild) throw conflict('parent_parcel_child_reserved', 'A child Packed Unit is reserved for active Packing and cannot be dispatched through its parent Parcel.', reservedChild);
  }
  const activeChildren = children.filter((child) => ACTIVE_PACKED_STATUSES.includes(child.status));
  if (!unit.isStockUnit && (!activeChildren.length || activeChildren.length !== children.length)) {
    throw conflict('parent_parcel_not_dispatchable', 'Every active child of the parent Parcel must be eligible for Dispatch.');
  }
  if (requireAvailable) {
    const available = unit.isStockUnit
      ? ACTIVE_PACKED_STATUSES.includes(unit.status)
      : ACTIVE_PACKED_STATUSES.includes(unit.status) && activeChildren.length > 0;
    if (!available) throw conflict('dispatch_source_unavailable', 'The Packed source is not currently available for Dispatch.', { sourceId: unit.id, status: unit.status });
  }
  return packedUnitDisplay(unit, { isParentParcel: !unit.isStockUnit, children: activeChildren });
}

export async function listPackedSources(tx, { search, cursor, limit = 50 } = {}) {
  const take = clampLimit(limit);
  const value = String(search || '').trim();
  const candidateLimit = Math.min(1000, Math.max(25, take * 3 + 1));
  const searchFilter = value ? `%${value.toLowerCase()}%` : null;
  const sources = [];
  let candidateCursor = decodeCursor(cursor);
  let exhausted = false;
  while (!exhausted && sources.length < take + 1) {
    const candidateRows = await tx.$queryRaw(Prisma.sql`
      SELECT unit."id", unit."createdAt"
      FROM "PackedUnit" unit
      JOIN "PackingPackageType" packageType ON packageType."id" = unit."packageTypeId"
      JOIN "Item" item ON item."id" = unit."itemId"
      WHERE unit."barcode" IS NOT NULL
        AND unit."status" IN ('AVAILABLE', 'RESERVED')
        AND (unit."isStockUnit" = true OR packageType."kind" = 'PARCEL')
        AND NOT EXISTS (
          SELECT 1
          FROM "PackingBatchSource" reservation
          JOIN "PackingBatch" batch ON batch."id" = reservation."batchId"
          WHERE reservation."sourceType" = 'PACKED_UNIT'
            AND reservation."sourceId" = unit."id"
            AND batch."status" IN ('CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED')
        )
        ${searchFilter ? Prisma.sql`AND (LOWER(unit."barcode") LIKE ${searchFilter} OR LOWER(item."name") LIKE ${searchFilter})` : Prisma.sql``}
        ${candidateCursor ? Prisma.sql`AND (unit."createdAt" < ${candidateCursor.createdAt} OR (unit."createdAt" = ${candidateCursor.createdAt} AND unit."id" < ${candidateCursor.id}))` : Prisma.sql``}
      ORDER BY unit."createdAt" DESC, unit."id" DESC
      LIMIT ${candidateLimit}
    `);
    if (!candidateRows.length) break;
    const candidateIds = candidateRows.map((row) => String(row.id));
    const rows = await tx.packedUnit.findMany({ where: { id: { in: candidateIds } }, include: packedUnitInclude });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const candidate of candidateRows) {
      const row = rowsById.get(String(candidate.id));
      if (!row) continue;
      try {
        const source = await getPackedSourceView(tx, row.id, { requireAvailable: true });
        sources.push({ ...source, createdAt: row.createdAt });
        if (sources.length >= take + 1) break;
      } catch {
        // A parent whose children changed between candidate selection and the
        // authoritative hierarchy check is omitted, then later candidates are scanned.
      }
    }
    exhausted = candidateRows.length < candidateLimit;
    if (!exhausted && sources.length < take + 1) {
      const lastCandidate = candidateRows[candidateRows.length - 1];
      candidateCursor = { createdAt: new Date(lastCandidate.createdAt), id: String(lastCandidate.id) };
    }
  }
  const hasMore = sources.length > take;
  const items = hasMore ? sources.slice(0, take) : sources;
  return { items, nextCursor: hasMore ? cursorForSource(items[items.length - 1]) : null };
}

export async function findPackedSourceByBarcode(tx, barcode) {
  const exact = String(barcode || '').trim();
  if (!exact) return null;
  const unit = await tx.packedUnit.findUnique({ where: { barcode: exact }, include: packedUnitInclude });
  if (!unit) return null;
  return getPackedSourceView(tx, unit.id, { requireAvailable: true });
}

export async function listDispatchSources(tx, sourceType, options = {}) {
  const normalizedType = normalizeSourceType(sourceType);
  if (normalizedType === DISPATCH_SOURCE_TYPES.PACKED) return listPackedSources(tx, options);
  return listLegacySources(tx, normalizedType, options);
}

export async function findDispatchSourceByBarcode(tx, barcode) {
  const packed = await findPackedSourceByBarcode(tx, barcode);
  if (packed) return packed;
  return findLegacySourceByBarcode(tx, barcode);
}

export async function dispatchPackedUnitSource(tx, {
  sourceId,
  customerId,
  baseCount,
  netWeightKg,
  residualBaseCount = null,
  residualNetWeightKg = null,
  damagedLostBaseCount = null,
  damagedLostNetWeightKg = null,
  salvageableBaseCount = null,
  salvageableNetWeightKg = null,
  reason,
  actorUserId,
  idempotencyKey,
  parentPackedUnitId = null,
}) {
  const initialSource = await getPackedSourceView(tx, sourceId, { requireAvailable: true });
  if (parentPackedUnitId && parentPackedUnitId !== sourceId && String(initialSource.parentUnitId || '') !== String(parentPackedUnitId)) {
    throw badRequest('packed_parent_mismatch', 'The supplied parent Packed Unit does not contain the selected source.');
  }
  await lockPackedSources(tx, [sourceId, parentPackedUnitId || initialSource.parentUnitId].filter(Boolean));
  let source = await getPackedSourceView(tx, sourceId, { requireAvailable: true });
  if (source.customerId && String(source.customerId) !== String(customerId)) {
    throw conflict('customer_reservation_mismatch', 'Packed Unit is reserved to a different Customer.', { reservedCustomerId: source.customerId, customerId });
  }
  const count = Number(baseCount);
  const weight = numberOrZero(netWeightKg);
  if (!Number.isInteger(count) || count <= 0) throw badRequest('packed_count_required', 'Packed Dispatch requires an exact positive base count.');
  if (weight <= WEIGHT_EPSILON) throw badRequest('packed_weight_required', 'Packed Dispatch requires an exact positive net weight.');
  if (source.isParentParcel) {
    if (count !== Number(source.availableCount) || Math.abs(weight - Number(source.availableNetWeightKg)) > WEIGHT_EPSILON) {
      throw badRequest('parent_parcel_partial_dispatch', 'A parent Parcel can only be dispatched atomically in full. Scan child units for a partial Dispatch.');
    }
    let children = source.children.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    await lockPackedSources(tx, children.map((child) => child.id));
    source = await getPackedSourceView(tx, source.sourceId, { requireAvailable: true });
    children = source.children.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    await lockPackedSources(tx, children.map((child) => child.id));
    const dispatched = [];
    for (const child of children) {
      const childResult = await dispatchWholePackedUnit({
        id: child.id,
        customerId,
        actorUserId,
        client: transactionClient(tx),
      });
      dispatched.push({
        sourceType: DISPATCH_SOURCE_TYPES.PACKED,
        sourceId: childResult.result?.id || childResult.id || child.id,
        sourceBarcode: childResult.result?.barcode || childResult.barcode || child.barcode,
        sourceDisplaySnapshot: safeSnapshot({ ...source, parentPackedUnitId: source.sourceId, child }),
        baseCount: Number(child.baseCount),
        netWeightKg: numberOrZero(child.netWeightKg),
        parentPackedUnitId: source.sourceId,
      });
    }
    await openPackedParentForChildMutation(tx, source.sourceId, {
      reason: reason || 'All child Packed Units were dispatched from the parent Parcel.',
      actorUserId,
      idempotencyKey,
      childMutation: 'PARENT_CHILDREN_DISPATCHED',
    });
    return { kind: 'parent', source, lines: dispatched };
  }
  const sourceCount = Number(source.availableCount);
  const sourceWeight = Number(source.availableNetWeightKg);
  if (isWholePackedDispatch({
    count,
    weight,
    sourceCount,
    sourceWeight,
    residualBaseCount,
    residualNetWeightKg,
    damagedLostBaseCount,
    damagedLostNetWeightKg,
    salvageableBaseCount,
    salvageableNetWeightKg,
  })) {
    const result = await dispatchWholePackedUnit({ id: source.sourceId, customerId, actorUserId, client: transactionClient(tx) });
    const unit = result.result || result;
    await openPackedParentForChildMutation(tx, source.parentUnitId || parentPackedUnitId, {
      reason: reason || 'A child Packed Unit was dispatched from its parent hierarchy.',
      actorUserId,
      idempotencyKey,
      childMutation: 'DISPATCHED',
    });
    return {
      kind: 'whole',
      source,
      lines: [{
        sourceType: DISPATCH_SOURCE_TYPES.PACKED,
        sourceId: unit.id,
        sourceBarcode: unit.barcode,
        sourceDisplaySnapshot: source.sourceDisplaySnapshot,
        baseCount: count,
        netWeightKg: weight,
        parentPackedUnitId: source.parentUnitId || parentPackedUnitId || null,
      }],
    };
  }
  if (count > sourceCount) throw conflict('dispatch_count_exceeds_available', 'Packed Dispatch count exceeds the available unit count.', { availableCount: sourceCount, requestedCount: count });
  if (!source.allowPartialDispatch) throw conflict('partial_dispatch_not_allowed', 'The recipe does not allow partial Packed Dispatch.');
  if (residualBaseCount === null) throw badRequest('residual_count_required', 'Partial Packed Dispatch requires an exact residual base count.');
  if (residualNetWeightKg === null) throw badRequest('residual_weight_required', 'Partial Packed Dispatch requires an exact residual net weight.');
  if (damagedLostBaseCount === null) throw badRequest('damaged_lost_count_required', 'Partial Packed Dispatch requires an explicit damaged/lost count, including zero when none was damaged or lost.');
  const damagedLostWeight = damagedLostNetWeightKg === null ? 0 : Number(damagedLostNetWeightKg);
  if ((damagedLostBaseCount > 0) !== (damagedLostWeight > WEIGHT_EPSILON)) {
    throw badRequest('damaged_lost_conservation_failed', 'Damaged/lost count and weight must both be supplied when damaged or lost content is present.');
  }
  if ((salvageableBaseCount === null) !== (salvageableNetWeightKg === null)) {
    throw badRequest('salvageable_conservation_failed', 'Salvageable count and weight must be supplied together.');
  }
  const salvageCount = salvageableBaseCount === null ? 0 : Number(salvageableBaseCount);
  const salvageWeight = salvageableNetWeightKg === null ? 0 : Number(salvageableNetWeightKg);
  if ((salvageCount > 0) !== (salvageWeight > WEIGHT_EPSILON)) {
    throw badRequest('salvageable_conservation_failed', 'Salvageable count and weight must both be positive or both be zero.');
  }
  if (salvageCount > damagedLostBaseCount || salvageWeight > damagedLostWeight + WEIGHT_EPSILON) {
    throw badRequest('salvageable_exceeds_damaged', 'Salvageable content cannot exceed the declared damaged/lost content.');
  }
  const expectedResidualCount = sourceCount - count - damagedLostBaseCount;
  const expectedResidualWeight = sourceWeight - weight - damagedLostWeight;
  if (expectedResidualCount <= 0 || Number(residualBaseCount) <= 0) throw badRequest('invalid_partial_residual', 'Partial Packed Dispatch must leave a positive residual count.');
  if (expectedResidualWeight <= WEIGHT_EPSILON || Number(residualNetWeightKg) <= WEIGHT_EPSILON) throw badRequest('invalid_partial_residual', 'Partial Packed Dispatch must leave a positive residual weight.');
  if (Number(residualBaseCount) !== expectedResidualCount) {
    throw badRequest('partial_count_conservation_failed', 'Dispatched, residual, and damaged/lost counts must exactly conserve the Packed Unit count.', {
      sourceCount,
      dispatchedCount: count,
      residualCount: residualBaseCount,
      damagedLostCount: damagedLostBaseCount,
      expectedResidualCount,
    });
  }
  if (Math.abs(Number(residualNetWeightKg) - expectedResidualWeight) > WEIGHT_EPSILON) {
    throw badRequest('partial_weight_conservation_failed', 'Dispatched, residual, and damaged/lost weights must exactly conserve the Packed Unit weight.', {
      sourceWeight,
      dispatchedWeight: weight,
      residualWeight: residualNetWeightKg,
      damagedLostWeight,
      expectedResidualWeight,
    });
  }
  const partialReason = String(reason || '').trim();
  if (!partialReason) throw badRequest('partial_dispatch_reason_required', 'A reason is required for a partial Packed Dispatch.');
  const result = await splitPackedUnitForDispatch({
    id: source.sourceId,
    customerId,
    dispatchedBaseCount: count,
    dispatchedNetWeightKg: weight,
    reason: partialReason,
    actorUserId,
    idempotencyKey,
    client: transactionClient(tx),
  });
  const split = result.result || result;
  if (Number(split.dispatchedUnit?.baseCount) !== count || Math.abs(Number(split.dispatchedUnit?.netWeightKg) - weight) > WEIGHT_EPSILON) {
    throw conflict('partial_dispatched_mismatch', 'The dispatched Packed Unit did not match the exact requested count and weight.');
  }
  if (!split.residualUnit?.barcode || !['AVAILABLE', 'RESERVED'].includes(split.residualUnit.status)) {
    throw conflict('partial_residual_label_failed', 'The residual Packed Unit did not receive a sealed barcode and actionable status.');
  }
  const expectedIntermediateCount = Number(residualBaseCount) + Number(damagedLostBaseCount);
  const expectedIntermediateWeight = Number(residualNetWeightKg) + damagedLostWeight;
  if (Number(split.residualUnit.baseCount) !== expectedIntermediateCount || Math.abs(Number(split.residualUnit.netWeightKg) - expectedIntermediateWeight) > WEIGHT_EPSILON) {
    throw conflict('partial_residual_mismatch', 'The residual Packed Unit did not match the exact requested count and weight.');
  }
  let finalResidualUnit = split.residualUnit;
  let damageEvidence = null;
  if (damagedLostBaseCount > 0) {
    const damageReason = `${partialReason} Damaged or lost content evidence.`.slice(0, 1000);
    const damageSplitResult = await splitPackedUnitForDispatch({
      id: split.residualUnit.id,
      customerId,
      dispatchedBaseCount: damagedLostBaseCount,
      dispatchedNetWeightKg: damagedLostWeight,
      reason: damageReason,
      actorUserId,
      idempotencyKey: `${idempotencyKey}:damage-split`,
      client: transactionClient(tx),
    });
    const damageSplit = damageSplitResult.result || damageSplitResult;
    const damageUnit = damageSplit.dispatchedUnit;
    finalResidualUnit = damageSplit.residualUnit;
    if (Number(damageUnit?.baseCount) !== Number(damagedLostBaseCount) || Math.abs(Number(damageUnit?.netWeightKg) - damagedLostWeight) > WEIGHT_EPSILON) {
      throw conflict('partial_damage_mismatch', 'The damaged/lost Packed Unit did not match the exact declared count and weight.');
    }
    if (!damageUnit?.barcode || !finalResidualUnit?.barcode || !['AVAILABLE', 'RESERVED'].includes(finalResidualUnit.status)) {
      throw conflict('partial_damage_label_failed', 'The damaged/lost and final residual Packed Units did not receive atomic sealed barcodes.');
    }
    if (Number(finalResidualUnit.baseCount) !== Number(residualBaseCount) || Math.abs(Number(finalResidualUnit.netWeightKg) - Number(residualNetWeightKg)) > WEIGHT_EPSILON) {
      throw conflict('partial_residual_mismatch', 'The final residual Packed Unit did not match the exact requested count and weight.');
    }
    await returnPackingUnit({
      id: damageUnit.id,
      payload: { reason: `${damageReason} Return damaged/lost split for inspection.`.slice(0, 1000) },
      actorUserId,
      idempotencyKey: `${idempotencyKey}:damage-return`,
      client: transactionClient(tx),
    });
    const damageResult = await damagePackingUnit({
      id: damageUnit.id,
      payload: { reason: `${damageReason} Mark damaged/lost content.`.slice(0, 1000), salvageableBaseCount: salvageCount, salvageableWeightKg: salvageWeight },
      actorUserId,
      idempotencyKey: `${idempotencyKey}:damage`,
      client: transactionClient(tx),
    });
    const damage = damageResult.result || damageResult;
    const expectedWrittenOffCount = damagedLostBaseCount - salvageCount;
    const expectedWrittenOffWeight = Math.max(0, damagedLostWeight - salvageWeight);
    if (Number(damage.writtenOff?.baseCount) !== expectedWrittenOffCount || Math.abs(Number(damage.writtenOff?.netWeightKg) - expectedWrittenOffWeight) > WEIGHT_EPSILON) {
      throw conflict('partial_writeoff_mismatch', 'Damaged/lost write-off evidence did not match the declared salvage split.');
    }
    if (salvageCount > 0 && (!damage.salvageUnit?.barcode || damage.unit?.status !== 'REPACKED')) {
      throw conflict('partial_salvage_identity_failed', 'The salvage split did not produce a retired source and sealed salvage identity.');
    }
    if (salvageCount === 0 && (damage.salvageUnit || damage.unit?.status !== 'DAMAGED')) {
      throw conflict('partial_full_loss_identity_failed', 'Full damaged/lost content must remain a DAMAGED identity with zero salvage.');
    }
    damageEvidence = { damage };
  }
  await openPackedParentForChildMutation(tx, source.parentUnitId || parentPackedUnitId, {
    reason: partialReason,
    actorUserId,
    idempotencyKey,
    childMutation: damagedLostBaseCount > 0 ? 'PARTIAL_SPLIT_WITH_DAMAGE' : 'PARTIAL_SPLIT',
  });
  return {
    kind: 'partial',
    source,
    lines: [{
      sourceType: DISPATCH_SOURCE_TYPES.PACKED,
      sourceId: split.dispatchedUnit.id,
      sourceBarcode: split.dispatchedUnit.barcode,
      sourceDisplaySnapshot: safeSnapshot({
        ...source.sourceDisplaySnapshot,
        splitFromUnitId: source.sourceId,
        residualUnitId: finalResidualUnit.id,
        residualBarcode: finalResidualUnit.barcode,
        damageEvidence,
      }),
      baseCount: count,
      netWeightKg: weight,
      parentPackedUnitId: source.parentUnitId || parentPackedUnitId || null,
    }],
  };
}

export async function lockPackedSources(tx, sourceIds = []) {
  const uniqueIds = [...new Set(sourceIds.filter(Boolean).map(String))].sort();
  for (const id of uniqueIds) await lockRecord(tx, 'PackedUnit', id, 'packed_source_not_found', 'Packed Unit source not found.');
  return uniqueIds;
}

export async function prepareLegacyLine(tx, line, { customerId }) {
  const sourceType = normalizeSourceType(line.sourceType);
  if (sourceType === DISPATCH_SOURCE_TYPES.PACKED) throw badRequest('packed_source_requires_packed_adapter', 'Packed sources must use the Packed Dispatch adapter.');
  const source = await getLegacySourceView(tx, sourceType, line.sourceId, { forUpdate: true, requireAvailable: true });
  const weight = numberOrZero(line.netWeightKg);
  if (weight <= WEIGHT_EPSILON) throw badRequest('net_weight_required', 'Every Dispatch line requires a positive net weight.');
  if (weight > Number(source.availableNetWeightKg) + WEIGHT_EPSILON) throw conflict('dispatch_weight_exceeds_available', 'Dispatch weight exceeds the available source weight.', { sourceId: source.sourceId, availableNetWeightKg: source.availableNetWeightKg, requestedNetWeightKg: weight });
  const count = line.baseCount === null || line.baseCount === undefined || line.baseCount === ''
    ? (sourceType === DISPATCH_SOURCE_TYPES.INBOUND ? 1 : null)
    : Math.trunc(Number(line.baseCount));
  if (count !== null && (!Number.isInteger(count) || count <= 0)) throw badRequest('invalid_base_count', 'baseCount must be a positive integer.');
  if (sourceType !== DISPATCH_SOURCE_TYPES.INBOUND && count === null) throw badRequest('base_count_required', 'Cutter and Holo Dispatch lines require an exact base count.');
  if (sourceType !== DISPATCH_SOURCE_TYPES.INBOUND && count !== null && count > Number(source.availableCount || 0)) throw conflict('dispatch_count_exceeds_available', 'Dispatch count exceeds the available source count.', { sourceId: source.sourceId, availableCount: source.availableCount, requestedCount: count });
  if (customerId && source.customerId && String(source.customerId) !== String(customerId)) throw conflict('customer_reservation_mismatch', 'The source is reserved to a different Customer.');
  return {
    sourceType,
    sourceId: source.sourceId,
    sourceBarcode: line.sourceBarcode || source.sourceBarcode || null,
    sourceDisplaySnapshot: safeSnapshot({ ...source.sourceDisplaySnapshot, requestedCustomerId: customerId }),
    baseCount: count,
    netWeightKg: weight,
    parentPackedUnitId: null,
    source,
  };
}

export async function applyLegacyLineConsumption(tx, prepared, actorUserId) {
  return applyLegacySourceDelta(tx, {
    sourceType: prepared.sourceType,
    sourceId: prepared.sourceId,
    deltaWeightKg: prepared.netWeightKg,
    deltaBaseCount: prepared.baseCount || 0,
    actorUserId,
  });
}

export async function restoreLegacyLineConsumption(tx, line, actorUserId) {
  return applyLegacySourceDelta(tx, {
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    deltaWeightKg: -numberOrZero(line.netWeightKg),
    deltaBaseCount: -(line.baseCount || 0),
    actorUserId,
  });
}

export async function lockSourcesInStableOrder(tx, lines = []) {
  const unique = [];
  const seen = new Set();
  for (const line of sortByLockKey(lines)) {
    const sourceType = normalizeSourceType(line.sourceType);
    const sourceId = requiredId(line.sourceId, 'sourceId');
    const key = `${sourceType}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ sourceType, sourceId });
  }
  for (const source of unique) {
    if (source.sourceType === DISPATCH_SOURCE_TYPES.PACKED) await lockPackedSources(tx, [source.sourceId]);
    else await lockLegacySource(tx, source.sourceType, source.sourceId);
  }
  return unique;
}

function rawCount(rows) {
  return Number(rows?.[0]?.count || 0);
}

async function countEligibleInbound(tx) {
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "InboundItem" source
    WHERE source."status" <> 'consumed'
      AND (source."weight" - source."dispatchedWeight" - source."issuedToCutterWeight") > ${WEIGHT_EPSILON}
  `);
  return rawCount(rows);
}

async function countEligibleCutter(tx) {
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "ReceiveFromCutterMachineRow" source
    WHERE source."isDeleted" = false
      AND (
        (
          COALESCE(source."netWt", 0) > ${WEIGHT_EPSILON}
          AND (COALESCE(source."netWt", 0) - source."dispatchedWeight" - source."issuedBobbinWeight") > ${WEIGHT_EPSILON}
        )
        OR (
          COALESCE(source."netWt", 0) <= ${WEIGHT_EPSILON}
          AND (COALESCE(source."bobbin_quantity", 0) - source."issuedBobbins" - source."dispatchedCount") > 0
        )
      )
  `);
  return rawCount(rows);
}

async function countEligibleHolo(tx) {
  const rows = await tx.$queryRaw(Prisma.sql`
    WITH issueConsumption AS (
      SELECT
        elem->>'rowId' AS row_id,
        SUM(CASE WHEN NULLIF(elem->>'issueRolls', '') IS NULL THEN 0 ELSE (elem->>'issueRolls')::numeric END) AS issue_rolls,
        SUM(CASE WHEN NULLIF(elem->>'issueWeight', '') IS NULL THEN 0 ELSE (elem->>'issueWeight')::numeric END) AS issue_weight
      FROM "IssueToConingMachine" issue,
        jsonb_array_elements(COALESCE(issue."receivedRowRefs", '[]'::jsonb)) elem
      WHERE issue."isDeleted" = false
      GROUP BY row_id
    ),
    takeBackConsumption AS (
      SELECT
        line."sourceId" AS source_id,
        SUM(CASE WHEN takeBack."isReverse" THEN line."count" ELSE -line."count" END) AS take_back_rolls,
        SUM(CASE WHEN takeBack."isReverse" THEN line."weight" ELSE -line."weight" END) AS take_back_weight
      FROM "IssueTakeBackLine" line
      JOIN "IssueTakeBack" takeBack ON takeBack."id" = line."takeBackId"
      WHERE takeBack."stage" = 'coning'
      GROUP BY line."sourceId"
    ),
    holoBase AS (
      SELECT
        source."id",
        source."rollCount",
        source."dispatchedCount",
        source."dispatchedWeight",
        CASE
          WHEN COALESCE(source."rollWeight", 0) > ${WEIGHT_EPSILON} THEN source."rollWeight"
          ELSE GREATEST(0, COALESCE(source."grossWeight", 0) - COALESCE(source."tareWeight", 0))
        END AS total_weight,
        GREATEST(0, COALESCE(issueConsumption.issue_rolls, 0) + COALESCE(takeBackConsumption.take_back_rolls, 0)) AS issued_rolls,
        GREATEST(0, COALESCE(issueConsumption.issue_weight, 0) + COALESCE(takeBackConsumption.take_back_weight, 0)) AS issued_weight
      FROM "ReceiveFromHoloMachineRow" source
      LEFT JOIN issueConsumption ON issueConsumption.row_id = source."id"
      LEFT JOIN takeBackConsumption ON takeBackConsumption.source_id = source."id"
      WHERE source."isDeleted" = false
    )
    SELECT COUNT(*)::int AS count
    FROM holoBase
    WHERE (
      (total_weight > ${WEIGHT_EPSILON} AND total_weight - "dispatchedWeight" - issued_weight > ${WEIGHT_EPSILON})
      OR (total_weight <= ${WEIGHT_EPSILON} AND "rollCount" - "dispatchedCount" - issued_rolls > 0)
    )
  `);
  return rawCount(rows);
}

async function countEligiblePacked(tx) {
  const [stockRows, parcelRows] = await Promise.all([
    tx.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "PackedUnit" unit
      WHERE unit."isStockUnit" = true
        AND unit."barcode" IS NOT NULL
        AND unit."status" IN ('AVAILABLE', 'RESERVED')
        AND NOT EXISTS (
          SELECT 1
          FROM "PackingBatchSource" reservation
          JOIN "PackingBatch" batch ON batch."id" = reservation."batchId"
          WHERE reservation."sourceType" = 'PACKED_UNIT'
            AND reservation."sourceId" = unit."id"
            AND batch."status" IN ('CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED')
        )
    `),
    tx.$queryRaw(Prisma.sql`
      WITH RECURSIVE parents AS (
        SELECT parent."id", parent."status"
        FROM "PackedUnit" parent
        JOIN "PackingPackageType" packageType ON packageType."id" = parent."packageTypeId"
        WHERE parent."isStockUnit" = false
          AND parent."barcode" IS NOT NULL
          AND parent."status" IN ('AVAILABLE', 'RESERVED')
          AND packageType."kind" = 'PARCEL'
          AND NOT EXISTS (
            SELECT 1
            FROM "PackingBatchSource" reservation
            JOIN "PackingBatch" batch ON batch."id" = reservation."batchId"
            WHERE reservation."sourceType" = 'PACKED_UNIT'
              AND reservation."sourceId" = parent."id"
              AND batch."status" IN ('CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED')
          )
      ),
      descendants AS (
        SELECT parent."id" AS root_id, child."id" AS child_id
        FROM parents parent
        JOIN "PackedUnit" child ON child."parentUnitId" = parent."id"
        UNION ALL
        SELECT descendants.root_id, child."id"
        FROM descendants
        JOIN "PackedUnit" child ON child."parentUnitId" = descendants.child_id
      ),
      childSummary AS (
        SELECT
          parents."id" AS root_id,
          COUNT(child."id") FILTER (WHERE child."isStockUnit" = true) AS stock_units,
          COUNT(child."id") FILTER (
            WHERE child."isStockUnit" = true
              AND child."status" IN ('AVAILABLE', 'RESERVED')
          ) AS active_stock_units
        FROM parents
        LEFT JOIN descendants ON descendants.root_id = parents."id"
        LEFT JOIN "PackedUnit" child ON child."id" = descendants.child_id
        GROUP BY parents."id"
      )
      SELECT COUNT(*)::int AS count
      FROM childSummary
      WHERE stock_units > 0
        AND active_stock_units = stock_units
        AND NOT EXISTS (
          SELECT 1
          FROM descendants reservedDescendant
          JOIN "PackingBatchSource" reservation ON reservation."sourceId" = reservedDescendant.child_id
          JOIN "PackingBatch" batch ON batch."id" = reservation."batchId"
          WHERE reservedDescendant.root_id = childSummary.root_id
            AND reservation."sourceType" = 'PACKED_UNIT'
            AND batch."status" IN ('CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED')
        )
    `),
  ]);
  return { stock: rawCount(stockRows), parcels: rawCount(parcelRows) };
}

export async function sourceSummary(tx) {
  const [inbound, cutter, holo, packed] = await Promise.all([
    countEligibleInbound(tx),
    countEligibleCutter(tx),
    countEligibleHolo(tx),
    countEligiblePacked(tx),
  ]);
  return {
    INBOUND: inbound,
    CUTTER: cutter,
    HOLO: holo,
    PACKED: packed.stock + packed.parcels,
    PACKED_UNITS: packed.stock,
    PACKED_PARCELS: packed.parcels,
  };
}
