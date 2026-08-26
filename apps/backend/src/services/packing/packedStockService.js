import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { packedUnitInclude } from './common.js';
import { BATCH_KINDS, UNIT_STATUSES } from './constants.js';
import { badRequest, conflict, notFound } from './errors.js';

const MAX_HIERARCHY_NODES = 250;
const MAX_HIERARCHY_DEPTH = 32;

async function buildHierarchy(client, unit) {
  const ancestors = [];
  const visited = new Set([unit.id]);
  let parentId = unit.parentUnitId || null;
  let depth = 0;
  while (parentId) {
    depth += 1;
    if (depth > MAX_HIERARCHY_DEPTH || ancestors.length >= MAX_HIERARCHY_NODES) throw conflict('hierarchy_too_deep', 'Packed Stock hierarchy exceeds the bounded inspection limit.');
    if (visited.has(parentId)) throw conflict('hierarchy_cycle', 'Packed Stock hierarchy contains a cycle.');
    visited.add(parentId);
    const parent = await client.packedUnit.findUnique({ where: { id: parentId }, include: packedUnitInclude });
    if (!parent) throw conflict('hierarchy_incomplete', 'Packed Stock hierarchy references a missing ancestor.', { unitId: unit.id, parentId });
    ancestors.unshift(parent);
    parentId = parent.parentUnitId || null;
  }

  const descendants = [];
  let frontier = [unit.id];
  let descendantDepth = 0;
  while (frontier.length) {
    descendantDepth += 1;
    if (descendantDepth > MAX_HIERARCHY_DEPTH) throw conflict('hierarchy_too_deep', 'Packed Stock hierarchy exceeds the bounded inspection limit.');
    const children = await client.packedUnit.findMany({
      where: { parentUnitId: { in: frontier } },
      orderBy: [{ levelIndex: 'asc' }, { unitSequence: 'asc' }],
      include: packedUnitInclude,
    });
    const next = [];
    for (const child of children) {
      if (visited.has(child.id)) throw conflict('hierarchy_cycle', 'Packed Stock hierarchy contains a cycle.', { unitId: child.id });
      visited.add(child.id);
      descendants.push({ ...child, hierarchyDepth: descendantDepth });
      next.push(child.id);
      if (ancestors.length + descendants.length > MAX_HIERARCHY_NODES) throw conflict('hierarchy_too_large', 'Packed Stock hierarchy exceeds the bounded inspection limit.');
    }
    frontier = next;
  }
  return {
    complete: true,
    boundedBy: { maxNodes: MAX_HIERARCHY_NODES, maxDepth: MAX_HIERARCHY_DEPTH },
    ancestors,
    root: unit,
    descendants,
  };
}

export async function listPackedStock({ status, customerId, barcode, itemId, search, batchKind, includeHierarchy = false, cursor, limit = 50, client = prisma } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const conditions = [Prisma.sql`pu."isStockUnit" = true`];
  const activeStatuses = ['CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'];
  conditions.push(Prisma.sql`NOT EXISTS (
    SELECT 1
    FROM "PackingBatchSource" AS reserved_source
    INNER JOIN "PackingBatch" AS active_batch ON active_batch."id" = reserved_source."batchId"
    WHERE reserved_source."sourceType"::text = 'PACKED_UNIT'
      AND reserved_source."sourceId" = pu."id"
      AND active_batch."status"::text IN (${Prisma.join(activeStatuses)})
  )`);
  if (status) {
    const statuses = String(status).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    const invalid = statuses.filter((value) => !Object.values(UNIT_STATUSES).includes(value));
    if (invalid.length) throw badRequest('invalid_unit_status', 'Packed Stock status filter is invalid.', { invalid });
    if (!statuses.length) return { units: [], nextCursor: null };
    conditions.push(Prisma.sql`pu."status"::text IN (${Prisma.join(statuses)})`);
  }
  if (customerId) conditions.push(Prisma.sql`pu."customerId" = ${String(customerId)}`);
  if (barcode) conditions.push(Prisma.sql`pu."barcode" = ${String(barcode).trim()}`);
  if (itemId) conditions.push(Prisma.sql`pu."itemId" = ${String(itemId)}`);
  if (batchKind) {
    const normalizedKind = String(batchKind).trim().toUpperCase();
    if (!BATCH_KINDS.includes(normalizedKind)) throw badRequest('invalid_batch_kind', 'Packed Stock batch kind filter is invalid.', { allowed: BATCH_KINDS });
    conditions.push(Prisma.sql`batch."kind"::text = ${normalizedKind}`);
  }
  if (search && !barcode) {
    const term = String(search).trim();
    if (term) {
      if (term.startsWith('PKU-')) {
        conditions.push(Prisma.sql`pu."barcode" = ${term}`);
      } else {
        const pattern = `%${term}%`;
        const searchConditions = [
          Prisma.sql`pu."id" = ${term}`,
          Prisma.sql`pu."barcode" = ${term}`,
          Prisma.sql`batch."batchNo" ILIKE ${pattern}`,
          Prisma.sql`item."name" ILIKE ${pattern}`,
          Prisma.sql`wrapper."name" ILIKE ${pattern}`,
          Prisma.sql`color."name" ILIKE ${pattern}`,
        ];
        const searchSql = searchConditions.slice(1).reduce((query, condition) => Prisma.sql`${query} OR ${condition}`, searchConditions[0]);
        conditions.push(Prisma.sql`(${searchSql})`);
      }
    }
  }
  if (cursor) {
    const cursorUnit = await client.packedUnit.findUnique({ where: { id: String(cursor) }, select: { id: true, createdAt: true } });
    if (!cursorUnit) throw badRequest('invalid_cursor', 'Packed Stock cursor does not identify an existing unit.', { cursor });
    conditions.push(Prisma.sql`(pu."createdAt" < ${cursorUnit.createdAt} OR (pu."createdAt" = ${cursorUnit.createdAt} AND pu."id" < ${cursorUnit.id}))`);
  }
  const whereSql = conditions.slice(1).reduce((query, condition) => Prisma.sql`${query} AND ${condition}`, conditions[0]);
  const idRows = await client.$queryRaw(Prisma.sql`
    SELECT pu."id"
    FROM "PackedUnit" AS pu
    INNER JOIN "PackingBatch" AS batch ON batch."id" = pu."batchId"
    INNER JOIN "Item" AS item ON item."id" = pu."itemId"
    INNER JOIN "Wrapper" AS wrapper ON wrapper."id" = pu."wrapperId"
    INNER JOIN "PackingColor" AS color ON color."id" = pu."colorId"
    WHERE ${whereSql}
    ORDER BY pu."createdAt" DESC, pu."id" DESC
    LIMIT ${take + 1}
  `);
  const hasMore = idRows.length > take;
  const pageIds = idRows.slice(0, take).map((row) => row.id);
  const loadedRows = pageIds.length
    ? await client.packedUnit.findMany({ where: { id: { in: pageIds } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: packedUnitInclude })
    : [];
  const byId = new Map(loadedRows.map((row) => [row.id, row]));
  const units = pageIds.map((id) => byId.get(id)).filter(Boolean);
  if (includeHierarchy) {
    for (let index = 0; index < units.length; index += 1) units[index] = { ...units[index], hierarchy: await buildHierarchy(client, units[index]) };
  }
  return { units, nextCursor: hasMore ? units[units.length - 1].id : null };
}

export async function getPackedStockByBarcode(barcode, client = prisma) {
  const exact = String(barcode || '').trim();
  if (!exact) throw notFound('barcode_not_found', 'A barcode is required.');
  const unit = await client.packedUnit.findUnique({ where: { barcode: exact }, include: packedUnitInclude });
  if (!unit || !unit.isStockUnit) throw notFound('barcode_not_found', 'Packed Stock barcode not found.', { barcode: exact });
  return { ...unit, hierarchy: await buildHierarchy(client, unit) };
}

export async function getPackedStockById(id, client = prisma) {
  const unit = await client.packedUnit.findUnique({ where: { id: String(id) }, include: packedUnitInclude });
  if (!unit || !unit.isStockUnit) throw notFound('packed_stock_not_found', 'Packed Stock unit not found.', { id });
  return { ...unit, hierarchy: await buildHierarchy(client, unit) };
}

export async function getPackedStockHistory({ id, cursor, limit = 50, client = prisma } = {}) {
  const unitId = String(id || '').trim();
  if (!unitId) throw notFound('packed_stock_not_found', 'Packed Stock unit not found.', { id });
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const unit = await client.packedUnit.findUnique({ where: { id: unitId }, select: { id: true, barcode: true, isStockUnit: true, status: true } });
  if (!unit || !unit.isStockUnit) throw notFound('packed_stock_not_found', 'Packed Stock unit not found.', { id: unitId });
  const where = { unitId };
  if (cursor) {
    const marker = await client.packedUnitEvent.findUnique({ where: { id: String(cursor) }, select: { id: true, unitId: true, createdAt: true } });
    if (!marker || marker.unitId !== unitId) throw badRequest('invalid_cursor', 'Packed Stock history cursor is invalid.', { cursor });
    where.OR = [{ createdAt: { lt: marker.createdAt } }, { createdAt: marker.createdAt, id: { lt: marker.id } }];
  }
  const rows = await client.packedUnitEvent.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { batch: { select: { id: true, batchNo: true, kind: true } } },
  });
  const hasMore = rows.length > take;
  const events = hasMore ? rows.slice(0, take) : rows;
  return { unit, events, nextCursor: hasMore ? events[events.length - 1].id : null };
}
