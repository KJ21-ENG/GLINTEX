import prisma from '../../lib/prisma.js';
import {
  andWhere,
  buildCursorWhere,
  buildDateWhere,
  clampLimit,
  countBy,
  decodeCursor,
  jsonValue,
  normalizeString,
  pickEnumValues,
  reportInputError,
  round,
  serializePage,
  sumBy,
  toNullableNumber,
  toNumber,
} from './reportUtils.js';
import { decimalUnitWeightKg } from '../packing/varianceMath.js';

const BATCH_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'SHORT_CLOSED', 'VOIDED'];
const BATCH_KINDS = ['INITIAL', 'REPACKING', 'OPENING'];
const UNIT_STATUSES = ['IN_PROGRESS', 'LABEL_PENDING', 'QUALITY_HOLD', 'AVAILABLE', 'RESERVED', 'DISPATCHED', 'RETURNED_PENDING_INSPECTION', 'DAMAGED', 'REPACKED', 'SPLIT_CONSUMED', 'OPENED', 'VOIDED'];
const ADJUSTMENT_KINDS = ['LEGACY_CUTOVER', 'MANUAL_CORRECTION', 'DAMAGE_WRITE_OFF', 'OPENING_BALANCE'];
const ADJUSTMENT_STATUSES = ['DRAFT', 'APPLIED', 'REVERSED', 'FAILED'];
const SEALED_EVENT = 'UNIT_SEALED';
const EXCEPTION_EVENT_TYPES = [
  'UNIT_LABEL_PENDING',
  'UNIT_RETURNED',
  'UNIT_RETURN_INSPECTED',
  'UNIT_DAMAGED',
  'UNIT_WRITTEN_OFF',
  'UNIT_REPACKED',
  'BATCH_SHORT_CLOSED',
  'BATCH_VOIDED',
  'EVENT_REVERSED',
  'UNIT_SEALED',
];
const DISPATCH_EXCEPTION_TYPES = ['CHALLAN_VOIDED', 'LINE_CORRECTED', 'LINE_RETURNED', 'RETURN_REVERSED', 'DISPATCH_EVENT_REVERSED'];

function entityFilter(params, allowedStatuses, allowedKinds) {
  const status = pickEnumValues(params.status, allowedStatuses, 'status');
  const kind = pickEnumValues(params.kind, allowedKinds, 'kind');
  return {
    status: status ? { in: status } : undefined,
    kind: kind ? { in: kind } : undefined,
  };
}

function serializeRecipe(recipe) {
  if (!recipe) return null;
  return {
    id: recipe.id,
    familyKey: recipe.familyKey,
    version: recipe.version,
    status: recipe.status,
    itemId: recipe.itemId || null,
    itemName: recipe.item?.name || null,
    wrapperId: recipe.wrapperId || null,
    wrapperName: recipe.wrapper?.name || null,
    colorId: recipe.colorId || null,
    colorName: recipe.color?.name || null,
    coneTypeId: recipe.coneTypeId || null,
    coneTypeName: recipe.coneType?.name || null,
    customerId: recipe.customerId || null,
    nominalGram: toNullableNumber(recipe.nominalGram),
    deliveryMode: recipe.deliveryMode,
    stockUnitLevelIndex: recipe.stockUnitLevelIndex,
    allowPartialDispatch: recipe.allowPartialDispatch,
    requiresQualityHold: recipe.requiresQualityHold,
    warningVariancePercent: toNullableNumber(recipe.warningVariancePercent),
    approvalVariancePercent: toNullableNumber(recipe.approvalVariancePercent),
  };
}

function serializeSource(source) {
  return {
    id: source.id,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceBarcode: source.sourceBarcode || null,
    sourceItemSnapshot: jsonValue(source.sourceItemSnapshot, {}),
    sourceLotSnapshot: jsonValue(source.sourceLotSnapshot, {}),
    sourceRecipeSnapshot: jsonValue(source.sourceRecipeSnapshot, {}),
    sourceCustomerSnapshot: jsonValue(source.sourceCustomerSnapshot, {}),
    reservedBaseCount: source.reservedBaseCount,
    reservedNetWeightKg: toNumber(source.reservedNetWeightKg),
    consumedBaseCount: source.consumedBaseCount,
    consumedNetWeightKg: toNumber(source.consumedNetWeightKg),
    releasedBaseCount: source.releasedBaseCount,
    releasedNetWeightKg: toNumber(source.releasedNetWeightKg),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function summarizeBatch(batch) {
  const units = Array.isArray(batch.units) ? batch.units : [];
  const activeUnits = units.filter((unit) => unit.status !== 'VOIDED');
  const stockUnits = activeUnits.filter((unit) => unit.isStockUnit);
  const measurementUnits = stockUnits.length ? stockUnits : activeUnits;
  const plannedBaseCount = toNumber(batch.plannedBaseCount);
  const plannedNetWeightKg = toNumber(batch.plannedNetWeightKg);
  const actualBaseCount = measurementUnits.reduce((sum, unit) => sum + toNumber(unit.baseCount), 0);
  const actualNetWeightKg = measurementUnits.reduce((sum, unit) => sum + toNumber(unit.netWeightKg), 0);
  const varianceNetWeightKg = actualNetWeightKg - plannedNetWeightKg;
  const variancePercent = plannedNetWeightKg > 0
    ? Math.abs(varianceNetWeightKg) / plannedNetWeightKg * 100
    : null;
  const reservedBaseCount = (batch.sources || []).reduce((sum, source) => sum + toNumber(source.reservedBaseCount), 0);
  const consumedBaseCount = (batch.sources || []).reduce((sum, source) => sum + toNumber(source.consumedBaseCount), 0);
  const reservedNetWeightKg = (batch.sources || []).reduce((sum, source) => sum + toNumber(source.reservedNetWeightKg), 0);
  const consumedNetWeightKg = (batch.sources || []).reduce((sum, source) => sum + toNumber(source.consumedNetWeightKg), 0);
  return {
    id: batch.id,
    batchNo: batch.batchNo,
    kind: batch.kind,
    status: batch.status,
    recipeId: batch.recipeId,
    recipe: serializeRecipe(batch.recipe),
    recipeSnapshot: jsonValue(batch.recipeSnapshot, {}),
    customerId: batch.customerId || null,
    customerName: batch.customer?.name || null,
    deliveryMode: batch.deliveryMode,
    plannedBaseCount,
    plannedNetWeightKg,
    actualBaseCount,
    actualNetWeightKg: round(actualNetWeightKg),
    varianceBaseCount: actualBaseCount - plannedBaseCount,
    varianceNetWeightKg: round(varianceNetWeightKg),
    variancePercent: variancePercent === null ? null : round(variancePercent),
    physicalUnitCount: activeUnits.length,
    stockUnitCount: stockUnits.length,
    qualityHoldCount: activeUnits.filter((unit) => unit.status === 'QUALITY_HOLD').length,
    statusCounts: countBy(activeUnits, (unit) => unit.status),
    sourceCount: (batch.sources || []).length,
    reservedBaseCount,
    consumedBaseCount,
    reservedNetWeightKg: round(reservedNetWeightKg),
    consumedNetWeightKg: round(consumedNetWeightKg),
    targetAmendmentReason: batch.targetAmendmentReason || null,
    shortCloseReason: batch.shortCloseReason || null,
    voidReason: batch.voidReason || null,
    confirmedAt: batch.confirmedAt,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
    shortClosedAt: batch.shortClosedAt,
    voidedAt: batch.voidedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function serializeStockUnit(unit) {
  return {
    id: unit.id,
    barcode: unit.barcode || null,
    batchId: unit.batchId,
    batchNo: unit.batch?.batchNo || null,
    batchKind: unit.batch?.kind || null,
    recipeId: unit.recipeId,
    recipeFamilyKey: unit.recipe?.familyKey || null,
    recipeVersion: unit.recipe?.version || null,
    packageTypeId: unit.packageTypeId,
    packageTypeName: unit.packageType?.name || null,
    packageKind: unit.packageType?.kind || null,
    parentUnitId: unit.parentUnitId || null,
    parentBarcode: unit.parentUnit?.barcode || null,
    levelIndex: unit.levelIndex,
    isStockUnit: unit.isStockUnit,
    status: unit.status,
    itemId: unit.itemId,
    itemName: unit.item?.name || null,
    wrapperId: unit.wrapperId,
    wrapperName: unit.wrapper?.name || null,
    colorId: unit.colorId,
    colorName: unit.color?.name || null,
    coneTypeId: unit.coneTypeId,
    coneTypeName: unit.coneType?.name || null,
    customerId: unit.customerId || null,
    customerName: unit.customer?.name || null,
    nominalGram: toNumber(unit.nominalGram),
    baseCount: unit.baseCount,
    grossWeightKg: toNumber(unit.grossWeightKg),
    tareWeightKg: toNumber(unit.tareWeightKg),
    netWeightKg: toNumber(unit.netWeightKg),
    labelPrintCount: unit.labelPrintCount,
    sealedAt: unit.sealedAt,
    qualityReleasedAt: unit.qualityReleasedAt,
    splitFromUnitId: unit.splitFromUnitId || null,
    replacedByUnitId: unit.replacedByUnitId || null,
    version: unit.version,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}

function payloadNumber(payload, ...keys) {
  for (const key of keys) {
    const value = payload && typeof payload === 'object' ? payload[key] : undefined;
    if (value !== undefined && value !== null && value !== '') return toNullableNumber(value);
  }
  return null;
}

export function serializeVarianceEvent(event) {
  const payload = jsonValue(event.payload, {});
  const unit = event.unit;
  const batch = unit?.batch || event.batch;
  const actualPayload = payload?.actual && typeof payload.actual === 'object' ? payload.actual : {};
  const plannedPayload = payload?.planned && typeof payload.planned === 'object' ? payload.planned : {};
  const actualBaseCount = payloadNumber(payload, 'actualBaseCount', 'actualCount')
    ?? payloadNumber(actualPayload, 'baseCount', 'count')
    ?? toNullableNumber(unit?.baseCount);
  const actualNetWeightKg = payloadNumber(payload, 'actualNetWeightKg', 'actualWeightKg')
    ?? payloadNumber(actualPayload, 'netWeightKg', 'weightKg', 'weight')
    ?? toNullableNumber(unit?.netWeightKg);
  const nominalGram = toNullableNumber(unit?.nominalGram);
  const plannedBaseCount = nominalGram !== null && actualBaseCount !== null
    ? actualBaseCount
    : payloadNumber(payload, 'plannedBaseCount', 'plannedCount')
      ?? payloadNumber(plannedPayload, 'baseCount', 'count')
      ?? toNullableNumber(batch?.plannedBaseCount);
  const plannedNetWeightKg = nominalGram !== null && actualBaseCount !== null
    ? round(decimalUnitWeightKg(nominalGram, actualBaseCount))
    : payloadNumber(payload, 'plannedNetWeightKg', 'plannedWeightKg')
      ?? payloadNumber(plannedPayload, 'netWeightKg', 'weightKg', 'weight')
      ?? toNullableNumber(batch?.plannedNetWeightKg);
  const varianceNetWeightKg = plannedNetWeightKg === null || actualNetWeightKg === null
    ? null
    : round(actualNetWeightKg - plannedNetWeightKg);
  const variancePercent = plannedNetWeightKg > 0 && varianceNetWeightKg !== null
    ? round(Math.abs(varianceNetWeightKg) / plannedNetWeightKg * 100)
    : null;
  const warning = toNullableNumber(batch?.recipe?.warningVariancePercent) ?? 2;
  const approval = toNullableNumber(batch?.recipe?.approvalVariancePercent) ?? 5;
  const severity = variancePercent === null ? 'UNKNOWN' : variancePercent <= warning ? 'NORMAL' : variancePercent <= approval ? 'WARNING' : 'APPROVAL_REQUIRED';
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    reason: event.reason || null,
    batchId: batch?.id || event.batchId || null,
    batchNo: batch?.batchNo || null,
    unitId: unit?.id || event.unitId || null,
    barcode: unit?.barcode || null,
    status: unit?.status || null,
    packageKind: unit?.packageType?.kind || null,
    itemName: unit?.item?.name || null,
    plannedBaseCount,
    actualBaseCount,
    plannedNetWeightKg,
    actualNetWeightKg,
    varianceNetWeightKg,
    variancePercent,
    severity,
    payload,
  };
}

function serializeExceptionEvent(event, source) {
  const unit = event.unit;
  const batch = unit?.batch || event.batch;
  const line = event.line;
  const challan = line?.challan || event.challan;
  const variance = event.type === SEALED_EVENT ? serializeVarianceEvent(event) : null;
  return {
    id: event.id,
    source,
    type: event.type,
    reason: event.reason || null,
    createdAt: event.createdAt,
    batchId: batch?.id || event.batchId || null,
    batchNo: batch?.batchNo || null,
    unitId: unit?.id || event.unitId || null,
    barcode: unit?.barcode || line?.sourceBarcode || null,
    unitStatus: unit?.status || null,
    challanId: challan?.id || event.challanId || null,
    challanNo: challan?.challanNo || null,
    customerName: challan?.customer?.name || unit?.customer?.name || null,
    payload: jsonValue(event.payload, {}),
    ...(variance ? {
      plannedBaseCount: variance.plannedBaseCount,
      actualBaseCount: variance.actualBaseCount,
      plannedNetWeightKg: variance.plannedNetWeightKg,
      actualNetWeightKg: variance.actualNetWeightKg,
      varianceNetWeightKg: variance.varianceNetWeightKg,
      variancePercent: variance.variancePercent,
      severity: variance.severity,
    } : {}),
  };
}

function serializeQualityHoldUnit(unit) {
  return {
    id: unit.id,
    source: 'PACKING',
    type: 'QUALITY_HOLD',
    reason: 'Unit remains on quality hold',
    createdAt: unit.updatedAt || unit.createdAt,
    batchId: unit.batch?.id || null,
    batchNo: unit.batch?.batchNo || null,
    unitId: unit.id,
    barcode: unit.barcode || null,
    unitStatus: unit.status,
    challanId: null,
    challanNo: null,
    customerName: unit.customer?.name || null,
    payload: { status: unit.status, currentUnitState: true },
  };
}

function serializeAdjustmentLine(line) {
  return {
    id: line.id,
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    countDelta: line.countDelta,
    weightDeltaKg: toNumber(line.weightDeltaKg),
    sourceBarcode: line.sourceBarcode || null,
    sourceItemSnapshot: jsonValue(line.sourceItemSnapshot, {}),
    sourceLotSnapshot: jsonValue(line.sourceLotSnapshot, {}),
    sourceConeSnapshot: jsonValue(line.sourceConeSnapshot, {}),
    replacementSourceId: line.replacementSourceId || null,
    replacementUnitId: line.replacementUnitId || null,
    reversalOfLineId: line.reversalOfLineId || null,
  };
}

function serializeReconciliationBatch(batch, lines) {
  return {
    id: batch.id,
    batchNo: batch.batchNo,
    kind: batch.kind,
    status: batch.status,
    effectiveAt: batch.effectiveAt,
    reason: batch.reason,
    evidenceSnapshot: jsonValue(batch.evidenceSnapshot, {}),
    idempotencyKey: batch.idempotencyKey,
    appliedAt: batch.appliedAt,
    reversedAt: batch.reversedAt,
    lineCount: lines.length,
    countDelta: lines.reduce((sum, line) => sum + toNumber(line.countDelta), 0),
    weightDeltaKg: round(lines.reduce((sum, line) => sum + toNumber(line.weightDeltaKg), 0)),
    lines: lines.map(serializeAdjustmentLine),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

export async function getPackingProductionReport(params = {}, client = prisma) {
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const { status, kind } = entityFilter(params, BATCH_STATUSES, BATCH_KINDS);
  const where = andWhere(
    buildDateWhere(params, 'createdAt'),
    status ? { status } : null,
    kind ? { kind } : null,
    normalizeString(params.recipeId) ? { recipeId: normalizeString(params.recipeId) } : null,
    normalizeString(params.customerId) ? { customerId: normalizeString(params.customerId) } : null,
    buildCursorWhere(cursor),
  );
  const batches = await client.packingBatch.findMany({
    where,
    take: limit + 1,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      recipe: {
        include: {
          item: { select: { name: true } },
          wrapper: { select: { name: true } },
          color: { select: { name: true } },
          coneType: { select: { name: true } },
        },
      },
      customer: { select: { name: true } },
      sources: true,
      units: {
        select: {
          status: true,
          isStockUnit: true,
          baseCount: true,
          netWeightKg: true,
        },
      },
    },
  });
  const page = serializePage(batches.map(summarizeBatch).map((row, index) => ({ ...row, _cursor: batches[index] })), limit);
  return {
    report: {
      type: 'production',
      generatedAt: new Date().toISOString(),
      filters: { dateFrom: params.dateFrom || params.from || null, dateTo: params.dateTo || params.to || null, status: status || null, kind: kind || null },
      rows: page.items.map(({ _cursor, ...row }) => ({ ...row, createdAt: _cursor.createdAt, updatedAt: _cursor.updatedAt })),
      nextCursor: page.nextCursor,
    },
  };
}

export async function getPackingStockReport(params = {}, client = prisma) {
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const statuses = pickEnumValues(params.status, UNIT_STATUSES, 'status') || ['AVAILABLE', 'RESERVED'];
  const baseWhere = andWhere(
    { isStockUnit: true },
    { status: { in: statuses } },
    buildDateWhere(params, 'createdAt'),
    normalizeString(params.recipeId) ? { recipeId: normalizeString(params.recipeId) } : null,
    normalizeString(params.customerId) ? { customerId: normalizeString(params.customerId) } : null,
    normalizeString(params.itemId) ? { itemId: normalizeString(params.itemId) } : null,
  );
  const where = andWhere(baseWhere, buildCursorWhere(cursor));
  const [units, total, statusGroups, customerGroups] = await Promise.all([
    client.packedUnit.findMany({
      where,
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        batch: { select: { batchNo: true, kind: true } },
        recipe: { select: { familyKey: true, version: true } },
        packageType: { select: { name: true, kind: true } },
        parentUnit: { select: { barcode: true } },
        item: { select: { name: true } },
        wrapper: { select: { name: true } },
        color: { select: { name: true } },
        coneType: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    client.packedUnit.count({ where }),
    client.packedUnit.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
      _sum: { baseCount: true, netWeightKg: true },
    }),
    client.packedUnit.groupBy({
      by: ['customerId'],
      where: baseWhere,
      _count: { _all: true },
      _sum: { baseCount: true, netWeightKg: true },
    }),
  ]);
  const customerIds = customerGroups.map((group) => group.customerId).filter(Boolean);
  const customers = customerIds.length
    ? await client.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const page = serializePage(units, limit);
  const rows = page.items.map(serializeStockUnit);
  return {
    report: {
      type: 'stock',
      generatedAt: new Date().toISOString(),
      filters: { statuses, dateFrom: params.dateFrom || params.from || null, dateTo: params.dateTo || params.to || null },
      rows,
      nextCursor: page.nextCursor,
      summary: {
        totalUnits: total,
        statusGroups: statusGroups.map((group) => ({
          status: group.status,
          units: group._count?._all || 0,
          baseCount: toNumber(group._sum?.baseCount),
          netWeightKg: toNumber(group._sum?.netWeightKg),
        })),
        customerGroups: customerGroups.map((group) => ({
          customerId: group.customerId || null,
          customerName: group.customerId ? customerNames.get(group.customerId) || null : null,
          units: group._count?._all || 0,
          baseCount: toNumber(group._sum?.baseCount),
          netWeightKg: toNumber(group._sum?.netWeightKg),
        })),
      },
    },
  };
}

export async function getPackingVarianceReport(params = {}, client = prisma) {
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const baseWhere = andWhere(
    { type: SEALED_EVENT },
    buildDateWhere(params, 'createdAt'),
    normalizeString(params.batchId) ? { batchId: normalizeString(params.batchId) } : null,
  );
  const where = andWhere(baseWhere, buildCursorWhere(cursor));
  const [events, total, severityGroups] = await Promise.all([
    client.packedUnitEvent.findMany({
      where,
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        batch: {
          select: {
            id: true,
            batchNo: true,
            plannedBaseCount: true,
            plannedNetWeightKg: true,
            recipe: { select: { warningVariancePercent: true, approvalVariancePercent: true } },
          },
        },
        unit: {
          select: {
            id: true,
            barcode: true,
            status: true,
            baseCount: true,
            netWeightKg: true,
            nominalGram: true,
            batch: {
              select: {
                id: true,
                batchNo: true,
                plannedBaseCount: true,
                plannedNetWeightKg: true,
                recipe: { select: { warningVariancePercent: true, approvalVariancePercent: true } },
              },
            },
            packageType: { select: { kind: true } },
            item: { select: { name: true } },
          },
        },
      },
    }),
    client.packedUnitEvent.count({ where }),
    client.packedUnitEvent.findMany({
      where: baseWhere,
      select: {
        id: true,
        payload: true,
        batch: { select: { plannedBaseCount: true, plannedNetWeightKg: true, recipe: { select: { warningVariancePercent: true, approvalVariancePercent: true } } } },
        unit: {
          select: {
            baseCount: true,
            netWeightKg: true,
            nominalGram: true,
            batch: { select: { plannedBaseCount: true, plannedNetWeightKg: true, recipe: { select: { warningVariancePercent: true, approvalVariancePercent: true } } } },
          },
        },
      },
      take: 10000,
    }),
  ]);
  const page = serializePage(events, limit);
  const serialized = page.items.map(serializeVarianceEvent);
  const severityCounts = { NORMAL: 0, WARNING: 0, APPROVAL_REQUIRED: 0, UNKNOWN: 0 };
  for (const event of severityGroups) {
    const severity = serializeVarianceEvent(event).severity;
    severityCounts[severity] = (severityCounts[severity] || 0) + 1;
  }
  return {
    report: {
      type: 'variance',
      generatedAt: new Date().toISOString(),
      rows: serialized,
      nextCursor: page.nextCursor,
      summary: { totalEvents: total, severityCounts },
    },
  };
}

export async function getPackingExceptionsReport(params = {}, client = prisma) {
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const dateWhere = buildDateWhere(params, 'createdAt');
  const cursorWhere = buildCursorWhere(cursor);
  const [packingEvents, qualityHoldUnits, dispatchEvents] = await Promise.all([
    client.packedUnitEvent.findMany({
      where: andWhere({ type: { in: EXCEPTION_EVENT_TYPES } }, dateWhere, cursorWhere),
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        batch: { select: { id: true, batchNo: true } },
        unit: {
          select: {
            id: true,
            barcode: true,
            status: true,
            baseCount: true,
            netWeightKg: true,
            nominalGram: true,
            customer: { select: { name: true } },
            packageType: { select: { kind: true } },
            item: { select: { name: true } },
            batch: {
              select: {
                id: true,
                batchNo: true,
                plannedBaseCount: true,
                plannedNetWeightKg: true,
                recipe: { select: { warningVariancePercent: true, approvalVariancePercent: true } },
              },
            },
          },
        },
      },
    }),
    client.packedUnit.findMany({
      where: andWhere({ status: 'QUALITY_HOLD' }, dateWhere, cursorWhere),
      take: limit + 1,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        barcode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        batch: { select: { id: true, batchNo: true } },
        customer: { select: { name: true } },
      },
    }),
    client.dispatchEvent.findMany({
      where: andWhere({ type: { in: DISPATCH_EXCEPTION_TYPES } }, dateWhere, cursorWhere),
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        challan: { select: { id: true, challanNo: true, customer: { select: { name: true } } } },
        line: { select: { sourceBarcode: true, challan: { select: { id: true, challanNo: true, customer: { select: { name: true } } } } } },
      },
    }),
  ]);
  const combined = [
    ...packingEvents.map((event) => serializeExceptionEvent(event, 'PACKING')),
    ...qualityHoldUnits.map(serializeQualityHoldUnit),
    ...dispatchEvents.map((event) => serializeExceptionEvent(event, 'DISPATCH')),
  ].sort((left, right) => {
    const byDate = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    return byDate || String(right.id).localeCompare(String(left.id));
  });
  const hasMore = combined.length > limit;
  const rows = hasMore ? combined.slice(0, limit) : combined;
  return {
    report: {
      type: 'exceptions',
      generatedAt: new Date().toISOString(),
      rows,
      nextCursor: hasMore ? encodeReportCursor(rows[rows.length - 1]) : null,
      summary: { totalRows: rows.length, typeCounts: countBy(rows, (row) => row.type), sourceCounts: countBy(rows, (row) => row.source) },
    },
  };
}

function encodeReportCursor(row) {
  if (!row?.id || !row?.createdAt) return null;
  return Buffer.from(JSON.stringify({ createdAt: new Date(row.createdAt).toISOString(), id: row.id }), 'utf8').toString('base64url');
}

export async function getPackingReconciliationReport(params = {}, client = prisma) {
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const { status, kind } = entityFilter(params, ADJUSTMENT_STATUSES, ADJUSTMENT_KINDS);
  const where = andWhere(
    buildDateWhere(params, 'effectiveAt'),
    status ? { status } : null,
    kind ? { kind } : null,
    buildCursorWhere(cursor),
  );
  const [batches, launchState] = await Promise.all([
    client.inventoryAdjustmentBatch.findMany({
      where,
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    client.packingLaunchState.findUnique({ where: { id: 'packing_dispatch_v2' } }),
  ]);
  const batchIds = batches.map((batch) => batch.id);
  const lines = batchIds.length
    ? await client.inventoryAdjustmentLine.findMany({ where: { batchId: { in: batchIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    : [];
  const linesByBatch = new Map();
  for (const line of lines) {
    const list = linesByBatch.get(line.batchId) || [];
    list.push(line);
    linesByBatch.set(line.batchId, list);
  }
  const page = serializePage(batches, limit);
  const rows = page.items.map((batch) => serializeReconciliationBatch(batch, linesByBatch.get(batch.id) || []));
  const countDelta = rows.reduce((sum, row) => sum + row.countDelta, 0);
  const weightDeltaKg = round(rows.reduce((sum, row) => sum + row.weightDeltaKg, 0));
  return {
    report: {
      type: 'reconciliation',
      generatedAt: new Date().toISOString(),
      rows,
      nextCursor: page.nextCursor,
      launchState: launchState ? {
        id: launchState.id,
        status: launchState.status,
        affectedWritesPaused: launchState.affectedWritesPaused,
        cutoffAt: launchState.cutoffAt,
        adjustmentBatchId: launchState.adjustmentBatchId,
        lastError: launchState.lastError,
        updatedAt: launchState.updatedAt,
      } : null,
      summary: { batchCount: rows.length, countDelta, weightDeltaKg },
    },
  };
}

export function normalizeReportError(error) {
  if (error?.code === 'invalid_report_request') return error;
  if (error?.code === 'P2025') {
    const normalized = reportInputError('Requested report resource was not found');
    normalized.code = 'report_not_found';
    return normalized;
  }
  return error;
}

export {
  BATCH_STATUSES,
  BATCH_KINDS,
  UNIT_STATUSES,
  ADJUSTMENT_KINDS,
  ADJUSTMENT_STATUSES,
  EXCEPTION_EVENT_TYPES,
};
