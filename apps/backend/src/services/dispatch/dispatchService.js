import prisma from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { runIdempotent } from '../inventory/idempotency.js';
import { returnPackingUnit } from '../packing/unitService.js';
import { lockRecord } from '../packing/common.js';
import {
  badRequest,
  conflict,
  notFound,
  requireNonEmptyString,
} from '../packing/errors.js';
import { serialize } from '../packing/serialization.js';
import {
  DISPATCH_CHALLAN_STATUSES,
  DISPATCH_EVENT_TYPES,
  DISPATCH_SOURCE_TYPES,
  WEIGHT_EPSILON,
  allocateDispatchChallanNumber,
  clampLimit,
  companySnapshot,
  cursorWhere,
  customerSnapshot,
  dateOnly,
  decodeCursor,
  normalizeSourceType,
  optionalString,
  parseDateOnly,
  parseOptionalNonNegativeInt,
  parseOptionalPositiveInt,
  parsePositiveNumber,
  requiredId,
  requireReason,
  safeSnapshot,
  transactionClient,
} from './common.js';
import {
  applyLegacyLineConsumption,
  applyLegacySourceDelta,
  dispatchPackedUnitSource,
  findDispatchSourceByBarcode,
  getLegacySourceView,
  getPackedSourceView,
  listDispatchSources,
  lockSourcesInStableOrder,
  prepareLegacyLine,
  restoreLegacyLineConsumption,
  sourceSummary,
} from './sourceAdapters.js';
import { generateDispatchChallanPdf } from '../../utils/pdf/dispatchChallanPdf.js';

const CHALLAN_HEADER_INCLUDE = {
  customer: true,
  _count: { select: { lines: true } },
};

const CHALLAN_DETAIL_INCLUDE = {
  customer: true,
  lines: {
    orderBy: { createdAt: 'asc' },
    include: {
      parentPackedUnit: { select: { id: true, barcode: true, levelIndex: true, status: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  },
  events: { orderBy: { createdAt: 'asc' } },
  document: {
    select: {
      id: true,
      challanId: true,
      kind: true,
      sha256Hash: true,
      generatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
};

function activeLineEvent(events = []) {
  const ordered = [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ordered.find((event) => [DISPATCH_EVENT_TYPES.LINE_RETURNED, DISPATCH_EVENT_TYPES.RETURN_REVERSED].includes(event.type)) || null;
}

function lineReturned(line) {
  const event = activeLineEvent(line.events || []);
  if (!event) return false;
  if (event.type === DISPATCH_EVENT_TYPES.RETURN_REVERSED) return false;
  return true;
}

export function assertChallanCanBeVoided(challan) {
  const returnedLine = (challan?.lines || []).find((line) => lineReturned(line));
  if (returnedLine) {
    throw conflict('dispatch_line_returned', 'A challan containing a returned Dispatch line cannot be voided.', {
      lineId: returnedLine.id,
    });
  }
}

export function assertLegacyDispatchMutationAllowed(legacyRecord) {
  if (legacyRecord) {
    throw conflict('legacy_dispatch_read_only', 'Historical Dispatch reconstruction records are read-only.', {
      legacyDispatchId: legacyRecord.id,
      challanNo: legacyRecord.challanNo || null,
    });
  }
}

export function legacyDispatchIdFromSyntheticLineId(lineId) {
  const value = String(lineId || '');
  return value.startsWith('historical:') ? value.slice('historical:'.length) : value;
}

export function legacyDispatchChallanNoFromSyntheticId(challanId) {
  const value = String(challanId || '');
  return value.startsWith('legacy:') ? value.slice('legacy:'.length) : null;
}

export async function assertLegacyChallanMutationAllowed(tx, challanId) {
  const challanNo = legacyDispatchChallanNoFromSyntheticId(challanId);
  if (!challanNo || typeof tx.dispatch?.findFirst !== 'function') return;
  const legacyRecord = await tx.dispatch.findFirst({
    where: { challanNo, v2Line: null },
    select: { id: true, challanNo: true },
    orderBy: { createdAt: 'asc' },
  });
  assertLegacyDispatchMutationAllowed(legacyRecord);
}

export async function assertLegacyLineMutationAllowed(tx, lineId) {
  const value = String(lineId || '');
  if (!value.startsWith('historical:') || typeof tx.dispatch?.findUnique !== 'function') return;
  const legacyRecord = await tx.dispatch.findUnique({
    where: { id: legacyDispatchIdFromSyntheticLineId(value) },
    select: { id: true, challanNo: true },
  });
  assertLegacyDispatchMutationAllowed(legacyRecord);
}

function decodeRouteSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function preflightDispatchV2Mutation(req, { client = prisma } = {}) {
  const path = String(req?.path || req?.originalUrl || '').split('?')[0];
  const challanMatch = path.match(/^\/api\/v2\/dispatch\/challans\/([^/]+)\/void$/);
  if (challanMatch) return assertLegacyChallanMutationAllowed(client, decodeRouteSegment(challanMatch[1]));
  const lineMatch = path.match(/^\/api\/v2\/dispatch\/lines\/([^/]+)\/(correct|return)$/);
  if (lineMatch) return assertLegacyLineMutationAllowed(client, decodeRouteSegment(lineMatch[1]));
}

function ensureActiveChallan(challan) {
  if (!challan) throw notFound('dispatch_challan_not_found', 'Dispatch challan not found.');
  if (challan.isLegacyReconstruction) throw conflict('legacy_dispatch_read_only', 'Historical Dispatch reconstruction records are read-only.');
  if (challan.status === DISPATCH_CHALLAN_STATUSES.VOIDED) throw conflict('challan_voided', 'A voided challan cannot be changed.');
  return challan;
}

function normalizedLinePayload(line, index) {
  if (!line || typeof line !== 'object') throw badRequest('invalid_dispatch_line', `Dispatch line ${index + 1} is invalid.`);
  const sourceType = normalizeSourceType(line.sourceType || line.stage);
  const sourceId = line.sourceId || line.stageItemId || null;
  const sourceBarcode = optionalString(line.sourceBarcode || line.barcode || line.stageBarcode, 250);
  if (!sourceId && !sourceBarcode) throw badRequest('dispatch_source_required', `Dispatch line ${index + 1} requires sourceId or sourceBarcode.`);
  const baseCount = line.baseCount === null || line.baseCount === undefined || line.baseCount === ''
    ? null
    : parseOptionalPositiveInt(line.baseCount, 'baseCount');
  const netWeightKg = parsePositiveNumber(line.netWeightKg ?? line.weight, 'netWeightKg');
  const parentPackedUnitId = optionalString(line.parentPackedUnitId, 200);
  const reason = optionalString(line.reason, 2000);
  const residualBaseCount = parseOptionalPositiveInt(line.residualBaseCount ?? line.residualCount, 'residualBaseCount');
  const residualNetWeightKg = line.residualNetWeightKg === undefined && line.residualWeightKg === undefined && line.residualWeight === undefined
    ? null
    : parsePositiveNumber(line.residualNetWeightKg ?? line.residualWeightKg ?? line.residualWeight, 'residualNetWeightKg');
  const damagedLostBaseCount = parseOptionalNonNegativeInt(line.damagedLostBaseCount ?? line.damagedLostCount ?? line.damagedOrLostCount, 'damagedLostBaseCount');
  const damagedLostNetWeightKg = line.damagedLostNetWeightKg === undefined && line.damagedLostWeightKg === undefined && line.damagedLostWeight === undefined
    ? null
    : parsePositiveNumber(line.damagedLostNetWeightKg ?? line.damagedLostWeightKg ?? line.damagedLostWeight, 'damagedLostNetWeightKg', { allowZero: true });
  const salvageableBaseCount = parseOptionalNonNegativeInt(line.salvageableBaseCount ?? line.salvageableCount, 'salvageableBaseCount');
  const salvageableNetWeightKg = line.salvageableNetWeightKg === undefined && line.salvageableWeightKg === undefined && line.salvageableWeight === undefined
    ? null
    : parsePositiveNumber(line.salvageableNetWeightKg ?? line.salvageableWeightKg ?? line.salvageableWeight, 'salvageableNetWeightKg', { allowZero: true });
  return {
    sourceType,
    sourceId: sourceId ? String(sourceId).trim() : null,
    sourceBarcode,
    baseCount,
    netWeightKg,
    residualBaseCount,
    residualNetWeightKg,
    damagedLostBaseCount,
    damagedLostNetWeightKg,
    salvageableBaseCount,
    salvageableNetWeightKg,
    parentPackedUnitId,
    reason,
    _index: index,
  };
}

function validateNoDuplicateSourceLines(lines) {
  const seen = new Set();
  for (const line of lines) {
    if (!line.sourceId) continue;
    const key = `${line.sourceType}:${line.sourceId}`;
    if (seen.has(key)) throw badRequest('duplicate_dispatch_source', 'A source may appear only once in a Dispatch challan.', { sourceType: line.sourceType, sourceId: line.sourceId });
    seen.add(key);
  }
}

async function resolveLineSourceId(tx, line) {
  if (line.sourceId) {
    if (line.sourceBarcode) {
      const source = line.sourceType === DISPATCH_SOURCE_TYPES.PACKED
        ? await getPackedSourceView(tx, line.sourceId)
        : await getLegacySourceView(tx, line.sourceType, line.sourceId);
      if (source.sourceBarcode && source.sourceBarcode !== line.sourceBarcode) {
        throw conflict('source_barcode_mismatch', 'The supplied source barcode does not match the authoritative source.', { sourceId: line.sourceId, expected: source.sourceBarcode, supplied: line.sourceBarcode });
      }
    }
    return line;
  }
  const found = await findDispatchSourceByBarcode(tx, line.sourceBarcode);
  if (!found || found.sourceType !== line.sourceType) throw notFound('dispatch_source_not_found', 'The exact Dispatch barcode was not found for the selected source type.', { sourceType: line.sourceType, barcode: line.sourceBarcode });
  return { ...line, sourceId: found.sourceId };
}

async function dispatchSourceLine(tx, line, { customerId, actorUserId, idempotencyKey }) {
  if (line.sourceType === DISPATCH_SOURCE_TYPES.PACKED) {
    return dispatchPackedUnitSource(tx, {
      sourceId: line.sourceId,
      customerId,
      baseCount: line.baseCount,
      netWeightKg: line.netWeightKg,
      residualBaseCount: line.residualBaseCount,
      residualNetWeightKg: line.residualNetWeightKg,
      damagedLostBaseCount: line.damagedLostBaseCount,
      damagedLostNetWeightKg: line.damagedLostNetWeightKg,
      salvageableBaseCount: line.salvageableBaseCount,
      salvageableNetWeightKg: line.salvageableNetWeightKg,
      reason: line.reason,
      actorUserId,
      idempotencyKey,
      parentPackedUnitId: line.parentPackedUnitId,
    });
  }
  const prepared = await prepareLegacyLine(tx, line, { customerId });
  await applyLegacyLineConsumption(tx, prepared, actorUserId);
  return { kind: 'legacy', source: prepared.source, lines: [prepared] };
}

async function createDispatchEvent(tx, {
  challanId = null,
  lineId = null,
  type,
  reason = null,
  payload = {},
  idempotencyKey,
  actorUserId = null,
  reversalOfEventId = null,
}) {
  const reasonRequired = [
    DISPATCH_EVENT_TYPES.CHALLAN_VOIDED,
    DISPATCH_EVENT_TYPES.LINE_CORRECTED,
    DISPATCH_EVENT_TYPES.LINE_RETURNED,
    DISPATCH_EVENT_TYPES.RETURN_REVERSED,
    DISPATCH_EVENT_TYPES.DISPATCH_EVENT_REVERSED,
  ].includes(type);
  if (reasonRequired && !String(reason || '').trim()) throw badRequest('dispatch_event_reason_required', 'A reason is required for this Dispatch event.', { type });
  return tx.dispatchEvent.create({
    data: {
      challanId,
      lineId,
      type,
      reason: reason ? String(reason).trim() : null,
      payload: safeSnapshot(payload),
      reversalOfEventId,
      idempotencyKey: String(idempotencyKey),
      actorUserId: actorUserId ? String(actorUserId) : null,
    },
  });
}

async function fetchChallan(tx, id, { detail = true, lock = false } = {}) {
  const challanId = requiredId(id, 'challanId');
  await assertLegacyChallanMutationAllowed(tx, challanId);
  if (lock) await lockRecord(tx, 'DispatchChallan', challanId, 'dispatch_challan_not_found', 'Dispatch challan not found.');
  const challan = await tx.dispatchChallan.findUnique({
    where: { id: challanId },
    include: detail ? CHALLAN_DETAIL_INCLUDE : CHALLAN_HEADER_INCLUDE,
  });
  if (!challan) throw notFound('dispatch_challan_not_found', 'Dispatch challan not found.', { id: challanId });
  return challan;
}

async function updateChallanReturnStatus(tx, challanId, actorUserId = null) {
  const challan = await fetchChallan(tx, challanId, { detail: true });
  if (challan.status === DISPATCH_CHALLAN_STATUSES.VOIDED) return challan;
  const returned = challan.lines.filter(lineReturned).length;
  let status = DISPATCH_CHALLAN_STATUSES.ACTIVE;
  if (returned > 0 && returned < challan.lines.length) status = DISPATCH_CHALLAN_STATUSES.PARTIALLY_RETURNED;
  if (returned > 0 && returned === challan.lines.length) status = DISPATCH_CHALLAN_STATUSES.RETURNED;
  if (status !== challan.status) {
    await tx.dispatchChallan.update({ where: { id: challanId }, data: { status, version: { increment: 1 }, ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}) } });
  }
  return fetchChallan(tx, challanId, { detail: true });
}

function buildDispatchDocumentSnapshot(challan) {
  return serialize({
    ...challan,
    document: undefined,
    lines: (challan.lines || []).map((line) => ({
      ...line,
      sourceDisplaySnapshot: line.sourceDisplaySnapshot || {},
    })),
  });
}

async function persistOriginalDispatchDocument(tx, challan) {
  const renderingSnapshot = buildDispatchDocumentSnapshot(challan);
  const pdfBytes = await generateDispatchChallanPdf(renderingSnapshot);
  const sha256Hash = createHash('sha256').update(pdfBytes).digest('hex');
  await tx.dispatchDocument.create({
    data: {
      challanId: challan.id,
      kind: 'ORIGINAL',
      renderingSnapshot,
      pdfBytes,
      sha256Hash,
      generatedAt: new Date(),
    },
  });
}

async function createChallanInTransaction(tx, payload, actorUserId, idempotencyKey) {
  const customerId = requiredId(payload?.customerId, 'customerId');
  const businessDate = parseDateOnly(payload?.businessDate || payload?.date || dateOnly(new Date()));
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : (Array.isArray(payload?.items) ? payload.items : []);
  if (!rawLines.length) throw badRequest('dispatch_lines_required', 'At least one Dispatch line is required.');
  if (rawLines.length > 200) throw badRequest('dispatch_lines_too_many', 'A Dispatch challan may contain at most 200 lines.');
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound('customer_not_found', 'Customer not found.', { customerId });
  if (customer.isActive === false) throw badRequest('customer_inactive', 'Inactive customers cannot receive new Dispatches.', { customerId });
  const normalizedLines = rawLines.map(normalizedLinePayload);
  validateNoDuplicateSourceLines(normalizedLines);
  const resolvedLines = [];
  for (const line of normalizedLines) resolvedLines.push(await resolveLineSourceId(tx, line));
  validateNoDuplicateSourceLines(resolvedLines);
  await lockSourcesInStableOrder(tx, resolvedLines);
  const challanNo = await allocateDispatchChallanNumber(tx, businessDate);
  const company = await companySnapshot(tx);
  const physicalLines = [];
  for (const line of resolvedLines) {
    const dispatchResult = await dispatchSourceLine(tx, { ...line, reason: line.reason || payload?.reason }, {
      customerId,
      actorUserId,
      idempotencyKey: `${idempotencyKey}:source:${line._index}`,
    });
    physicalLines.push(...dispatchResult.lines);
  }
  const challan = await tx.dispatchChallan.create({
    data: {
      challanNo,
      businessDate,
      customerId,
      status: DISPATCH_CHALLAN_STATUSES.ACTIVE,
      notes: optionalString(payload?.notes, 5000),
      companySnapshot: safeSnapshot(company),
      customerSnapshot: safeSnapshot(customerSnapshot(customer)),
      idempotencyKey,
      isLegacyReconstruction: false,
      version: 1,
      ...((actorUserId && { createdByUserId: String(actorUserId), updatedByUserId: String(actorUserId) }) || {}),
    },
  });
  const createdLines = [];
  for (let index = 0; index < physicalLines.length; index += 1) {
    const line = physicalLines[index];
    const created = await tx.dispatchLine.create({
      data: {
        challanId: challan.id,
        sourceType: line.sourceType,
        sourceId: String(line.sourceId),
        sourceBarcode: line.sourceBarcode || null,
        sourceDisplaySnapshot: safeSnapshot(line.sourceDisplaySnapshot),
        baseCount: line.baseCount === null || line.baseCount === undefined ? null : Number(line.baseCount),
        netWeightKg: Number(line.netWeightKg),
        parentPackedUnitId: line.parentPackedUnitId || null,
        ...((actorUserId && { createdByUserId: String(actorUserId), updatedByUserId: String(actorUserId) }) || {}),
      },
    });
    createdLines.push(created);
    await createDispatchEvent(tx, {
      challanId: challan.id,
      lineId: created.id,
      type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
      payload: { challanNo, line: serialize(created), source: line.sourceDisplaySnapshot },
      idempotencyKey: `${idempotencyKey}:created:${index}`,
      actorUserId,
    });
  }
  await createDispatchEvent(tx, {
    challanId: challan.id,
    type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
    payload: { challanNo, lineCount: createdLines.length, sourceTypes: [...new Set(createdLines.map((line) => line.sourceType))] },
    idempotencyKey: `${idempotencyKey}:created:challan`,
    actorUserId,
  });
  const completedChallan = await fetchChallan(tx, challan.id, { detail: true });
  await persistOriginalDispatchDocument(tx, completedChallan);
  return fetchChallan(tx, challan.id, { detail: true });
}

export async function createDispatchChallan({ payload, actorUserId, idempotencyKey, client = prisma }) {
  return runIdempotent({
    operation: 'dispatch.challan.create',
    idempotencyKey,
    actorUserId,
    client,
    work: (tx, key) => createChallanInTransaction(tx, payload, actorUserId, key),
  });
}

export async function getDispatchSourceSummary({ client = prisma } = {}) {
  return client.$transaction((tx) => sourceSummary(tx));
}

export async function listDispatchSourceItems({ sourceType, search, cursor, limit, client = prisma } = {}) {
  return client.$transaction((tx) => listDispatchSources(tx, sourceType, { search, cursor, limit }));
}

export async function lookupDispatchBarcode({ barcode, client = prisma } = {}) {
  const exact = requireNonEmptyString(barcode, 'barcode', 250);
  const source = await client.$transaction((tx) => findDispatchSourceByBarcode(tx, exact));
  if (!source) {
    const historical = await client.dispatchLine.findFirst({ where: { sourceBarcode: exact }, include: { challan: true }, orderBy: { createdAt: 'desc' } });
    if (historical) return serialize({ ...historical, sourceType: historical.sourceType, sourceId: historical.sourceId, historical: true });
    const legacyRow = await client.dispatch.findFirst({ where: { stageBarcode: exact }, include: { customer: true }, orderBy: { createdAt: 'desc' } });
    if (legacyRow) {
      return serialize({
        sourceType: String(legacyRow.stage || '').toUpperCase(),
        sourceId: legacyRow.stageItemId,
        barcode: legacyRow.stageBarcode,
        sourceBarcode: legacyRow.stageBarcode,
        baseCount: legacyRow.count,
        netWeightKg: legacyRow.weight,
        customerId: legacyRow.customerId,
        customer: legacyRow.customer,
        historical: true,
        dispatchable: false,
        readOnly: true,
        legacyDispatchId: legacyRow.id,
      });
    }
    throw notFound('barcode_not_found', 'The exact Dispatch barcode was not found.', { barcode: exact });
  }
  return serialize({ source });
}

function compareCompatibilityChallans(a, b) {
  const createdDifference = new Date(b.createdAt || b.businessDate).getTime() - new Date(a.createdAt || a.businessDate).getTime();
  if (createdDifference !== 0) return createdDifference;
  return String(b.id).localeCompare(String(a.id));
}

async function listLegacyChallanHeaders(client, filters = {}, cursor = null) {
  const take = clampLimit(filters.limit) + 1;
  const statuses = String(filters.status || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (statuses.length && !statuses.includes(DISPATCH_CHALLAN_STATUSES.ACTIVE)) return [];
  const predicates = [Prisma.sql`legacyLine."id" IS NULL`];
  if (filters.customerId) predicates.push(Prisma.sql`legacyRow."customerId" = ${String(filters.customerId)}`);
  if (filters.from) predicates.push(Prisma.sql`legacyRow."date" >= ${String(filters.from)}`);
  if (filters.to) predicates.push(Prisma.sql`legacyRow."date" <= ${String(filters.to)}`);
  if (filters.search) {
    const search = `%${String(filters.search).trim().toLowerCase()}%`;
    predicates.push(Prisma.sql`(LOWER(legacyRow."challanNo") LIKE ${search} OR LOWER(COALESCE(customer."name", '')) LIKE ${search})`);
  }
  predicates.push(Prisma.sql`NOT EXISTS (
    SELECT 1
    FROM "DispatchChallan" representedChallan
    WHERE representedChallan."challanNo" = legacyRow."challanNo"
  )`);
  const where = Prisma.join(predicates, ' AND ');
  const cursorWhereSql = cursor
    ? Prisma.sql`WHERE ("createdAt" < ${cursor.createdAt} OR ("createdAt" = ${cursor.createdAt} AND "id" < ${cursor.id}))`
    : Prisma.sql``;
  const rows = await client.$queryRaw(Prisma.sql`
    WITH legacyHeaders AS (
      SELECT
        CONCAT('legacy:', legacyRow."challanNo") AS "id",
        legacyRow."challanNo" AS "challanNo",
        MIN(legacyRow."date") AS "businessDate",
        MAX(legacyRow."createdAt") AS "createdAt",
        MIN(legacyRow."customerId") AS "customerId",
        MIN(customer."name") AS "customerName",
        MIN(customer."phone") AS "customerPhone",
        MIN(customer."address") AS "customerAddress",
        BOOL_AND(COALESCE(customer."isActive", true)) AS "customerIsActive",
        MIN(legacyRow."notes") AS "notes",
        COUNT(*)::int AS "lineCount",
        COALESCE(SUM(legacyRow."weight"), 0)::numeric AS "totalNetWeightKg"
      FROM "Dispatch" legacyRow
      LEFT JOIN "DispatchLine" legacyLine ON legacyLine."legacyDispatchId" = legacyRow."id"
      LEFT JOIN "Customer" customer ON customer."id" = legacyRow."customerId"
      WHERE ${where}
      GROUP BY legacyRow."challanNo"
    )
    SELECT *
    FROM legacyHeaders
    ${cursorWhereSql}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${take}
  `);
  return rows.map((row) => ({
    id: row.id,
    challanNo: row.challanNo,
    businessDate: row.businessDate,
    status: DISPATCH_CHALLAN_STATUSES.ACTIVE,
    customerId: row.customerId,
    customer: {
      id: row.customerId,
      name: row.customerName,
      phone: row.customerPhone,
      address: row.customerAddress,
      isActive: row.customerIsActive !== false,
    },
    notes: row.notes || null,
    lineCount: Number(row.lineCount || 0),
    totalNetWeightKg: Number(row.totalNetWeightKg || 0),
    isLegacyReconstruction: true,
    legacy: true,
    createdAt: row.createdAt,
  }));
}

export async function listDispatchChallans({ filters = {}, client = prisma } = {}) {
  const take = clampLimit(filters.limit);
  const where = {};
  if (filters.customerId) where.customerId = String(filters.customerId);
  if (filters.status) {
    const statuses = String(filters.status).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    const allowed = Object.values(DISPATCH_CHALLAN_STATUSES);
    const invalid = statuses.filter((status) => !allowed.includes(status));
    if (invalid.length) throw badRequest('invalid_challan_status', 'Dispatch challan status is invalid.', { invalid });
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (filters.from || filters.to) {
    where.businessDate = {};
    if (filters.from) where.businessDate.gte = parseDateOnly(filters.from, 'from');
    if (filters.to) where.businessDate.lte = parseDateOnly(filters.to, 'to');
  }
  if (filters.search) {
    const search = String(filters.search).trim();
    if (search) where.OR = [{ challanNo: { contains: search, mode: 'insensitive' } }, { customer: { name: { contains: search, mode: 'insensitive' } } }];
  }
  const after = cursorWhere(filters.cursor);
  const compatibilityCursor = decodeCursor(filters.cursor);
  const combinedWhere = after ? { AND: [where, after] } : where;
  const rows = await client.dispatchChallan.findMany({
    where: combinedWhere,
    include: CHALLAN_HEADER_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  const weightGroups = pageRows.length && typeof client.dispatchLine.groupBy === 'function'
    ? await client.dispatchLine.groupBy({ where: { challanId: { in: pageRows.map((row) => row.id) } }, by: ['challanId'], _sum: { netWeightKg: true } })
    : [];
  const weightByChallanId = new Map(weightGroups.map((group) => [group.challanId, Number(group._sum?.netWeightKg || 0)]));
  const challans = pageRows.map((row) => ({
    ...row,
    lineCount: row._count?.lines || 0,
    totalNetWeightKg: weightByChallanId.get(row.id) || 0,
    _count: undefined,
  }));
  if (String(filters.includeLegacy ?? 'true') !== 'false') {
    const legacy = await listLegacyChallanHeaders(client, filters, compatibilityCursor);
    const merged = [...challans, ...legacy]
      .sort(compareCompatibilityChallans);
    const mergedHasMore = merged.length > take;
    const page = mergedHasMore ? merged.slice(0, take) : merged;
    return { challans: serialize(page), nextCursor: mergedHasMore ? encodeChallanCursor(page[page.length - 1]) : null, includesLegacy: true };
  }
  return { challans: serialize(challans), nextCursor: hasMore ? encodeChallanCursor(challans[challans.length - 1]) : null, includesLegacy: false };
}

function encodeChallanCursor(challan) {
  if (!challan?.createdAt || !challan?.id) return null;
  return Buffer.from(JSON.stringify({ createdAt: new Date(challan.createdAt).toISOString(), id: challan.id }), 'utf8').toString('base64url');
}

async function legacyChallanDetail(client, challanNo) {
  const rows = await client.dispatch.findMany({ where: { challanNo, v2Line: null }, include: { customer: true }, orderBy: { createdAt: 'asc' } });
  if (!rows.length) return null;
  const first = rows[0];
  return {
    id: `legacy:${challanNo}`,
    challanNo,
    businessDate: first.date,
    customerId: first.customerId,
    customer: first.customer,
    status: DISPATCH_CHALLAN_STATUSES.ACTIVE,
    notes: first.notes || null,
    isLegacyReconstruction: true,
    legacy: true,
    lines: rows.map((row) => ({
      id: row.id,
      challanId: `legacy:${challanNo}`,
      sourceType: String(row.stage || '').toUpperCase(),
      sourceId: row.stageItemId,
      sourceBarcode: row.stageBarcode,
      sourceDisplaySnapshot: { stage: row.stage, stageItemId: row.stageItemId, stageBarcode: row.stageBarcode },
      baseCount: row.count,
      netWeightKg: row.weight,
      legacyDispatchId: row.id,
      createdAt: row.createdAt,
    })),
    events: [],
    document: null,
  };
}

export async function getDispatchChallan({ id, client = prisma } = {}) {
  const value = requiredId(id, 'challanId');
  if (value.startsWith('legacy:')) {
    const legacy = await legacyChallanDetail(client, value.slice('legacy:'.length));
    if (!legacy) throw notFound('dispatch_challan_not_found', 'Dispatch challan not found.', { id: value });
    return serialize(legacy);
  }
  const challan = await client.dispatchChallan.findUnique({ where: { id: value }, include: CHALLAN_DETAIL_INCLUDE });
  if (challan) {
    if (challan.isLegacyReconstruction && challan.lines.length === 0) {
      const document = await client.dispatchDocument.findUnique({ where: { challanId: challan.id }, select: { renderingSnapshot: true } });
      const snapshotRows = Array.isArray(document?.renderingSnapshot?.lines) ? document.renderingSnapshot.lines : [];
      const eventRows = challan.events
        .map((event) => event.payload)
        .filter((payload) => payload?.legacyDispatchId && payload?.historicalOnly)
        .map((payload) => payload);
      const historicalRows = (snapshotRows.length ? snapshotRows : eventRows).map((row) => ({
        ...row,
        id: `historical:${row.legacyDispatchId}`,
        challanId: challan.id,
        historicalOnly: true,
        readOnly: true,
        immutable: true,
        events: [],
      }));
      return serialize({ ...challan, lines: historicalRows, historicalRows, historicalOnly: true, readOnly: true });
    }
    return serialize(challan);
  }
  const legacy = await legacyChallanDetail(client, value);
  if (!legacy) throw notFound('dispatch_challan_not_found', 'Dispatch challan not found.', { id: value });
  return serialize(legacy);
}

async function ensureLineForUpdate(tx, lineId) {
  const id = requiredId(lineId, 'lineId');
  try {
    await lockRecord(tx, 'DispatchLine', id, 'dispatch_line_not_found', 'Dispatch line not found.');
  } catch (error) {
    if (error?.code === 'dispatch_line_not_found') {
      await assertLegacyLineMutationAllowed(tx, id);
    }
    throw error;
  }
  const line = await tx.dispatchLine.findUnique({ where: { id }, include: { challan: true, events: { orderBy: { createdAt: 'asc' } } } });
  if (!line) throw notFound('dispatch_line_not_found', 'Dispatch line not found.', { lineId: id });
  ensureActiveChallan(line.challan);
  if (lineReturned(line)) throw conflict('dispatch_line_returned', 'A returned Dispatch line cannot be changed.');
  return line;
}

async function packedUnitStatus(tx, unitId) {
  const unit = await tx.packedUnit.findUnique({ where: { id: String(unitId) }, select: { id: true, status: true } });
  if (!unit) throw notFound('packed_source_not_found', 'Packed Unit source not found.', { sourceId: unitId });
  return unit;
}

export async function voidDispatchChallan({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const challanId = requiredId(id, 'challanId');
  const reason = requireReason(payload?.reason);
  return runIdempotent({
    operation: 'dispatch.challan.void',
    idempotencyKey,
    actorUserId,
    client,
    work: async (tx, key) => {
      const challan = await fetchChallan(tx, challanId, { detail: true, lock: true });
      ensureActiveChallan(challan);
      assertChallanCanBeVoided(challan);
      for (const line of challan.lines) {
        if (line.sourceType === DISPATCH_SOURCE_TYPES.PACKED) {
          const unit = await packedUnitStatus(tx, line.sourceId);
          if (unit.status === 'DISPATCHED') {
            await returnPackingUnit({ id: line.sourceId, payload: { reason: `Dispatch challan voided: ${reason}` }, actorUserId, idempotencyKey: `${key}:return:${line.id}`, client: transactionClient(tx) });
          }
        } else {
          await restoreLegacyLineConsumption(tx, line, actorUserId);
        }
      }
      const updated = await tx.dispatchChallan.update({ where: { id: challanId }, data: { status: DISPATCH_CHALLAN_STATUSES.VOIDED, version: { increment: 1 }, ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}) } });
      await createDispatchEvent(tx, { challanId, type: DISPATCH_EVENT_TYPES.CHALLAN_VOIDED, reason, payload: { beforeStatus: challan.status, afterStatus: updated.status, lineCount: challan.lines.length }, idempotencyKey: `${key}:event`, actorUserId });
      return fetchChallan(tx, challanId, { detail: true });
    },
  });
}

export async function correctDispatchLine({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const lineId = requiredId(id, 'lineId');
  const reason = requireReason(payload?.reason);
  return runIdempotent({
    operation: 'dispatch.line.correct',
    idempotencyKey,
    actorUserId,
    client,
    work: async (tx, key) => {
      const line = await ensureLineForUpdate(tx, lineId);
      if (line.sourceType === DISPATCH_SOURCE_TYPES.PACKED) throw conflict('packed_line_immutable', 'Packed Dispatch lines are immutable; use return and repacking for a physical correction.');
      const nextWeight = payload?.netWeightKg === undefined ? Number(line.netWeightKg) : parsePositiveNumber(payload.netWeightKg, 'netWeightKg');
      const nextCount = payload?.baseCount === undefined ? line.baseCount : parseOptionalPositiveInt(payload.baseCount, 'baseCount');
      if (line.sourceType === DISPATCH_SOURCE_TYPES.INBOUND && nextCount !== null && nextCount !== 1) throw badRequest('inbound_count_invalid', 'Inbound Dispatch count is fixed at one source unit.');
      const deltaWeight = nextWeight - Number(line.netWeightKg);
      const deltaCount = Number(nextCount || 0) - Number(line.baseCount || 0);
      if (Math.abs(deltaWeight) > WEIGHT_EPSILON || deltaCount !== 0) {
        if (deltaWeight > WEIGHT_EPSILON || deltaCount > 0) {
          const source = await getLegacySourceView(tx, line.sourceType, line.sourceId, { forUpdate: true, requireAvailable: true });
          if (deltaWeight > Number(source.availableNetWeightKg) + WEIGHT_EPSILON) throw conflict('dispatch_weight_exceeds_available', 'The correction exceeds the available source weight.');
          if (deltaCount > Number(source.availableCount || 0)) throw conflict('dispatch_count_exceeds_available', 'The correction exceeds the available source count.');
        }
        await applyLegacySourceDelta(tx, { sourceType: line.sourceType, sourceId: line.sourceId, deltaWeightKg: deltaWeight, deltaBaseCount: deltaCount, actorUserId });
      }
      const updated = await tx.dispatchLine.update({ where: { id: lineId }, data: { baseCount: nextCount, netWeightKg: nextWeight, ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}) } });
      await createDispatchEvent(tx, { challanId: line.challanId, lineId, type: DISPATCH_EVENT_TYPES.LINE_CORRECTED, reason, payload: { before: serialize(line), after: serialize(updated) }, idempotencyKey: `${key}:event`, actorUserId });
      return fetchChallan(tx, line.challanId, { detail: true });
    },
  });
}

export async function returnDispatchLine({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const lineId = requiredId(id, 'lineId');
  const reason = requireReason(payload?.reason);
  return runIdempotent({
    operation: 'dispatch.line.return',
    idempotencyKey,
    actorUserId,
    client,
    work: async (tx, key) => {
      const line = await ensureLineForUpdate(tx, lineId);
      if (line.sourceType === DISPATCH_SOURCE_TYPES.PACKED) {
        const unit = await packedUnitStatus(tx, line.sourceId);
        if (unit.status !== 'DISPATCHED') throw conflict('packed_unit_not_dispatched', 'The Packed Unit is not currently dispatched.', { status: unit.status });
        await returnPackingUnit({ id: line.sourceId, payload: { reason, opened: payload?.opened === true, physicallyChanged: payload?.physicallyChanged === true }, actorUserId, idempotencyKey: `${key}:packed-return`, client: transactionClient(tx) });
      } else {
        await restoreLegacyLineConsumption(tx, line, actorUserId);
      }
      await createDispatchEvent(tx, { challanId: line.challanId, lineId, type: DISPATCH_EVENT_TYPES.LINE_RETURNED, reason, payload: { lineId, sourceType: line.sourceType, sourceId: line.sourceId, before: serialize(line) }, idempotencyKey: `${key}:event`, actorUserId });
      return updateChallanReturnStatus(tx, line.challanId, actorUserId);
    },
  });
}

async function reverseLegacyEvent(tx, event, reason, actorUserId) {
  if (event.type === DISPATCH_EVENT_TYPES.CHALLAN_VOIDED) {
    const challanId = event.challanId || event.challan?.id;
    if (!challanId) throw badRequest('event_challan_required', 'This event is not attached to a Dispatch challan.');
    const challan = await fetchChallan(tx, challanId, { detail: true, lock: true });
    for (const challanLine of challan.lines) {
      if (challanLine.sourceType === DISPATCH_SOURCE_TYPES.PACKED) throw conflict('packed_event_not_reversible', 'A challan containing Packed lines cannot have its void reversed.');
      await applyLegacyLineConsumption(tx, challanLine, actorUserId);
    }
    await tx.dispatchChallan.update({ where: { id: challanId }, data: { status: DISPATCH_CHALLAN_STATUSES.ACTIVE, version: { increment: 1 }, ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}) } });
    return { line: null, challanId, payload: { restoredChallanStatus: DISPATCH_CHALLAN_STATUSES.ACTIVE } };
  }
  if (!event.line) throw badRequest('event_line_required', 'This event is not attached to a Dispatch line.');
  const line = await tx.dispatchLine.findUnique({ where: { id: event.line.id }, include: { challan: true } });
  if (!line) throw notFound('dispatch_line_not_found', 'Dispatch line not found.');
  if (line.sourceType === DISPATCH_SOURCE_TYPES.PACKED) throw conflict('packed_event_not_reversible', 'Packed Dispatch transitions are append-only and require a new return or repacking workflow.');
  if (event.type === DISPATCH_EVENT_TYPES.LINE_RETURNED) {
    await applyLegacySourceDelta(tx, { sourceType: line.sourceType, sourceId: line.sourceId, deltaWeightKg: Number(line.netWeightKg), deltaBaseCount: Number(line.baseCount || 0), actorUserId });
    return { line, challanId: line.challanId, payload: { restoredWeightKg: line.netWeightKg, restoredBaseCount: line.baseCount } };
  }
  if (event.type === DISPATCH_EVENT_TYPES.LINE_CORRECTED) {
    const before = event.payload?.before || {};
    const after = event.payload?.after || {};
    const beforeWeight = Number(before.netWeightKg ?? line.netWeightKg);
    const beforeCount = Number(before.baseCount || 0);
    const afterWeight = Number(after.netWeightKg ?? line.netWeightKg);
    const afterCount = Number(after.baseCount || 0);
    await applyLegacySourceDelta(tx, { sourceType: line.sourceType, sourceId: line.sourceId, deltaWeightKg: beforeWeight - afterWeight, deltaBaseCount: beforeCount - afterCount, actorUserId });
    await tx.dispatchLine.update({ where: { id: line.id }, data: { netWeightKg: beforeWeight, baseCount: before.baseCount ?? null, ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}) } });
    return { line, challanId: line.challanId, payload: { restored: { netWeightKg: beforeWeight, baseCount: before.baseCount ?? null } } };
  }
  throw badRequest('event_not_reversible', 'This Dispatch event cannot be reversed.', { type: event.type });
}

export async function reverseDispatchEvent({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const eventId = requiredId(id, 'eventId');
  const reason = requireReason(payload?.reason);
  return runIdempotent({
    operation: 'dispatch.event.reverse',
    idempotencyKey,
    actorUserId,
    client,
    work: async (tx, key) => {
      await lockRecord(tx, 'DispatchEvent', eventId, 'dispatch_event_not_found', 'Dispatch event not found.');
      const event = await tx.dispatchEvent.findUnique({ where: { id: eventId }, include: { line: true, challan: true } });
      if (!event) throw notFound('dispatch_event_not_found', 'Dispatch event not found.', { eventId });
      if (event.challan?.isLegacyReconstruction) throw conflict('legacy_dispatch_read_only', 'Historical Dispatch reconstruction events are read-only.');
      if (event.reversalOfEventId) throw conflict('dispatch_event_already_reversed', 'This Dispatch event has already been reversed.');
      if (event.type === DISPATCH_EVENT_TYPES.DISPATCH_EVENT_REVERSED || event.type === DISPATCH_EVENT_TYPES.RETURN_REVERSED) throw conflict('dispatch_event_not_reversible', 'A reversal event cannot be reversed.');
      const inverse = await reverseLegacyEvent(tx, event, reason, actorUserId);
      const reversal = await createDispatchEvent(tx, { challanId: inverse.challanId, lineId: event.lineId, type: event.type === DISPATCH_EVENT_TYPES.LINE_RETURNED ? DISPATCH_EVENT_TYPES.RETURN_REVERSED : DISPATCH_EVENT_TYPES.DISPATCH_EVENT_REVERSED, reason, payload: { reversedEventId: event.id, inverse: inverse.payload }, reversalOfEventId: event.id, idempotencyKey: `${key}:event`, actorUserId });
      const challan = await updateChallanReturnStatus(tx, inverse.challanId, actorUserId);
      return { reversal, challan };
    },
  });
}

export async function getDispatchLine(id, client = prisma) {
  const lineId = requiredId(id, 'lineId');
  const line = await client.dispatchLine.findUnique({ where: { id: lineId }, include: { challan: true, events: { orderBy: { createdAt: 'asc' } } } });
  if (!line) throw notFound('dispatch_line_not_found', 'Dispatch line not found.', { lineId });
  return serialize(line);
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
}

export function formatDispatchCsvWeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : String(value ?? '');
}

function exportWhere(filters = {}) {
  const where = {};
  if (filters.customerId) where.customerId = String(filters.customerId);
  if (filters.status) {
    const statuses = String(filters.status).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (filters.from || filters.to) {
    where.businessDate = {};
    if (filters.from) where.businessDate.gte = parseDateOnly(filters.from, 'from');
    if (filters.to) where.businessDate.lte = parseDateOnly(filters.to, 'to');
  }
  if (filters.search) {
    const search = String(filters.search).trim();
    if (search) where.OR = [{ challanNo: { contains: search, mode: 'insensitive' } }, { customer: { name: { contains: search, mode: 'insensitive' } } }];
  }
  return where;
}

const EXPORT_PAGE_SIZE = 250;

export async function exportDispatchCsv({ filters = {}, client = prisma } = {}) {
  const baseWhere = exportWhere(filters);
  const filename = `dispatch-v2-${dateOnly(new Date())}.csv`;
  const chunks = async function* dispatchCsvChunks() {
    yield `${['challanNo', 'businessDate', 'status', 'customer', 'sourceType', 'sourceId', 'sourceBarcode', 'baseCount', 'netWeightKg', 'parentPackedUnitId'].map(csvCell).join(',')}\n`;
    let lastCursor = null;
    while (true) {
      const where = lastCursor
        ? {
          AND: [
            baseWhere,
            {
              OR: [
                { businessDate: { lt: lastCursor.businessDate } },
                { businessDate: lastCursor.businessDate, createdAt: { lt: lastCursor.createdAt } },
                { businessDate: lastCursor.businessDate, createdAt: lastCursor.createdAt, id: { lt: lastCursor.id } },
              ],
            },
          ],
        }
        : baseWhere;
      const rows = await client.dispatchChallan.findMany({
        where,
        include: { customer: true, lines: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_PAGE_SIZE,
      });
      const pageLines = [];
      rows.forEach((challan) => {
        challan.lines.forEach((line) => {
          pageLines.push([
            challan.challanNo,
            dateOnly(challan.businessDate),
            challan.status,
            challan.customer?.name,
            line.sourceType,
            line.sourceId,
            line.sourceBarcode,
            line.baseCount,
            formatDispatchCsvWeight(line.netWeightKg),
            line.parentPackedUnitId,
          ].map(csvCell).join(','));
        });
      });
      if (pageLines.length) yield `${pageLines.join('\n')}\n`;
      if (rows.length < EXPORT_PAGE_SIZE) break;
      const last = rows[rows.length - 1];
      lastCursor = { businessDate: last.businessDate, createdAt: last.createdAt, id: last.id };
    }
  };
  return { filename, chunks };
}
