import prisma from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { badRequest, conflict } from '../packing/errors.js';
import { serialize } from '../packing/serialization.js';
import {
  DISPATCH_EVENT_TYPES,
  DISPATCH_SOURCE_TYPES,
  companySnapshot,
  customerSnapshot,
  dateOnly,
  parseDateOnly,
  safeSnapshot,
} from './common.js';

const MIGRATION_ENTITY_TYPE = 'dispatch_v2_migration';
const MIGRATION_EVIDENCE_VERSION = 'dispatch-v2-legacy-migration-v3';
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

const LEGACY_STAGE_TO_SOURCE = Object.freeze({
  inbound: DISPATCH_SOURCE_TYPES.INBOUND,
  cutter: DISPATCH_SOURCE_TYPES.CUTTER,
  holo: DISPATCH_SOURCE_TYPES.HOLO,
});

function normalizeBatchSize(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, number);
}

function emptyTotals(scannedRows = 0) {
  return {
    evidenceVersion: MIGRATION_EVIDENCE_VERSION,
    scannedRows,
    representedRows: 0,
    migratedChallans: 0,
    historicalOnlyChallans: 0,
    alreadyMigratedChallans: 0,
    migratedLines: 0,
    historicalOnlyRows: 0,
    completedBatches: 0,
    rowsByStage: {},
    historicalOnlyChallansList: [],
  };
}

function groupsByChallan(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.challanNo || '').trim();
    if (!key) throw badRequest('legacy_challan_number_missing', 'A legacy Dispatch row is missing its challan number.', { rowId: row.id });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function validateLegacyGroup(challanNo, rows) {
  const customers = new Set(rows.map((row) => String(row.customerId || '')));
  const dates = new Set(rows.map((row) => String(row.date || '')));
  const stages = new Set(rows.map((row) => String(row.stage || '').trim().toLowerCase()));
  if (customers.size !== 1 || dates.size !== 1 || stages.size !== 1) {
    throw conflict('legacy_challan_inconsistent', 'Legacy rows under one challan disagree on customer, date, or stage.', {
      challanNo,
      customers: [...customers],
      dates: [...dates],
      stages: [...stages],
    });
  }
  const stage = [...stages][0];
  return { customerId: [...customers][0], date: [...dates][0], stage, sourceType: LEGACY_STAGE_TO_SOURCE[stage] || null };
}

function legacyHistoricalSnapshot(row, challanNo, stage) {
  return {
    id: row.id,
    legacy: true,
    historicalOnly: true,
    readOnly: true,
    legacyDispatchId: row.id,
    sourceType: String(stage || '').toUpperCase(),
    sourceId: row.stageItemId,
    sourceBarcode: row.stageBarcode || null,
    sourceDisplaySnapshot: {
      legacy: true,
      historicalOnly: true,
      readOnly: true,
      legacyDispatchId: row.id,
      stage,
      stageItemId: row.stageItemId,
      stageBarcode: row.stageBarcode || null,
      challanNo,
    },
    baseCount: row.count === null || row.count === undefined ? null : Number(row.count),
    netWeightKg: Number(row.weight || 0),
    createdAt: row.createdAt,
  };
}

async function lockMigration(tx, key, batchNumber = 0) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`dispatch-v2-migration:${key}:${batchNumber}`}))`);
}

async function findNextChallanNumbers(tx, cursor, batchSize) {
  const cursorSql = cursor
    ? Prisma.sql`AND legacyRow."challanNo" > ${String(cursor)}`
    : Prisma.sql``;
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT legacyRow."challanNo"
    FROM "Dispatch" legacyRow
    WHERE legacyRow."challanNo" IS NOT NULL
      AND btrim(legacyRow."challanNo") <> ''
      ${cursorSql}
    GROUP BY legacyRow."challanNo"
    ORDER BY legacyRow."challanNo" ASC
    LIMIT ${batchSize}
  `);
  return rows.map((row) => String(row.challanNo));
}

async function assertNoMalformedChallanNumbers(client) {
  const malformed = await client.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "Dispatch"
    WHERE "challanNo" IS NULL OR btrim("challanNo") = ''
    LIMIT 1
  `);
  if (malformed.length) throw badRequest('legacy_challan_number_missing', 'A legacy Dispatch row is missing its challan number.', { rowId: malformed[0].id });
}

async function representedRowIds(tx, challanId, group) {
  const ids = group.map((row) => row.id);
  const lineRows = await tx.dispatchLine.findMany({ where: { challanId, legacyDispatchId: { in: ids } }, select: { legacyDispatchId: true } });
  const represented = new Set(lineRows.map((row) => row.legacyDispatchId).filter(Boolean));
  const document = await tx.dispatchDocument.findUnique({ where: { challanId }, select: { renderingSnapshot: true } });
  const snapshotRows = Array.isArray(document?.renderingSnapshot?.lines) ? document.renderingSnapshot.lines : [];
  snapshotRows.forEach((row) => {
    if (row?.legacyDispatchId) represented.add(String(row.legacyDispatchId));
  });
  const eventRows = await tx.dispatchEvent.findMany({ where: { challanId, lineId: null }, select: { payload: true } });
  eventRows.forEach((event) => {
    const legacyId = event.payload?.legacyDispatchId;
    if (legacyId) represented.add(String(legacyId));
  });
  return represented;
}

async function ensureHistoricalOnlyRowEvidence(tx, { challan, group, contract, actorUserId }) {
  const document = await tx.dispatchDocument.findUnique({ where: { challanId: challan.id }, select: { id: true, renderingSnapshot: true } });
  const historicalLines = group.map((row) => legacyHistoricalSnapshot(row, challan.challanNo, contract.stage));
  const existingLines = Array.isArray(document?.renderingSnapshot?.lines) ? document.renderingSnapshot.lines : [];
  if (!existingLines.length) {
    const renderingSnapshot = safeSnapshot({ ...(document?.renderingSnapshot || {}), ...challan, historicalOnly: true, legacyStage: contract.stage, document: undefined, lines: historicalLines });
    if (document) await tx.dispatchDocument.update({ where: { id: document.id }, data: { renderingSnapshot } });
    else await tx.dispatchDocument.create({ data: { challanId: challan.id, kind: 'LEGACY_RECONSTRUCTION', renderingSnapshot } });
  }
  for (const row of historicalLines) {
    const eventKey = `legacy-dispatch:${challan.challanNo}:historical-row:${row.legacyDispatchId}`;
    const event = await tx.dispatchEvent.findFirst({ where: { idempotencyKey: eventKey }, select: { id: true } });
    if (!event) {
      await tx.dispatchEvent.create({
        data: {
          challanId: challan.id,
          type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
          payload: safeSnapshot({ historicalOnly: true, readOnly: true, ...row }),
          idempotencyKey: eventKey,
          actorUserId: actorUserId || null,
          createdAt: row.createdAt || undefined,
        },
      });
    }
    const audit = await tx.auditLog.findFirst({ where: { entityType: 'dispatch_v2_legacy_row', entityId: row.legacyDispatchId, action: 'historical_reconstruction' }, select: { id: true } });
    if (!audit) {
      await tx.auditLog.create({
        data: {
          entityType: 'dispatch_v2_legacy_row',
          entityId: row.legacyDispatchId,
          action: 'historical_reconstruction',
          actorUserId: actorUserId || null,
          payload: safeSnapshot({ challanId: challan.id, challanNo: challan.challanNo, ...row }),
          createdAt: row.createdAt || undefined,
        },
      });
    }
  }
}

async function createHistoricalOnlyRepresentation(tx, { challan, group, contract, actorUserId }) {
  const historicalLines = group.map((row) => legacyHistoricalSnapshot(row, challan.challanNo, contract.stage));
  const renderingSnapshot = safeSnapshot({ ...challan, historicalOnly: true, legacyStage: contract.stage, document: undefined, lines: historicalLines });
  await tx.dispatchDocument.create({ data: { challanId: challan.id, kind: 'LEGACY_RECONSTRUCTION', renderingSnapshot } });
  for (const row of historicalLines) {
    await tx.dispatchEvent.create({
      data: {
        challanId: challan.id,
        type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
        payload: safeSnapshot({ historicalOnly: true, readOnly: true, ...row }),
        idempotencyKey: `legacy-dispatch:${challan.challanNo}:historical-row:${row.legacyDispatchId}`,
        actorUserId: actorUserId || null,
        createdAt: row.createdAt || undefined,
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: 'dispatch_v2_legacy_row',
        entityId: row.legacyDispatchId,
        action: 'historical_reconstruction',
        actorUserId: actorUserId || null,
        payload: safeSnapshot({ challanId: challan.id, challanNo: challan.challanNo, ...row }),
        createdAt: row.createdAt || undefined,
      },
    });
  }
  await tx.dispatchEvent.create({
    data: {
      challanId: challan.id,
      type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
      payload: safeSnapshot({ legacy: true, historicalOnly: true, challanNo: challan.challanNo, stage: contract.stage, legacyDispatchIds: group.map((row) => row.id) }),
      idempotencyKey: `legacy-dispatch:${challan.challanNo}:historical-only`,
      actorUserId: actorUserId || null,
      createdAt: group[0].createdAt,
    },
  });
}

async function createChallan(tx, { challanNo, group, contract, customer, company, actorUserId }) {
  const fallbackDate = dateOnly(group[0].createdAt) || dateOnly(new Date());
  const businessDate = parseDateOnly(contract.date || fallbackDate);
  return tx.dispatchChallan.create({
    data: {
      challanNo,
      businessDate,
      customerId: contract.customerId,
      status: 'ACTIVE',
      notes: group[0].notes || null,
      companySnapshot: safeSnapshot(company),
      customerSnapshot: safeSnapshot(customerSnapshot(customer)),
      idempotencyKey: `legacy-dispatch:${challanNo}`,
      isLegacyReconstruction: true,
      createdAt: group[0].createdAt,
      updatedAt: group[group.length - 1].updatedAt || group[group.length - 1].createdAt,
      ...(group[0].createdByUserId ? { createdByUserId: group[0].createdByUserId } : actorUserId ? { createdByUserId: String(actorUserId) } : {}),
      ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}),
    },
  });
}

async function migrateSupportedGroup(tx, { challan, group, contract, actorUserId }) {
  for (const row of group) {
    const line = await tx.dispatchLine.create({
      data: {
        challanId: challan.id,
        sourceType: contract.sourceType,
        sourceId: row.stageItemId,
        sourceBarcode: row.stageBarcode || null,
        sourceDisplaySnapshot: safeSnapshot({ legacy: true, legacyDispatchId: row.id, stage: row.stage, stageItemId: row.stageItemId, stageBarcode: row.stageBarcode, challanNo: row.challanNo }),
        baseCount: row.count === null || row.count === undefined ? null : Number(row.count),
        netWeightKg: Number(row.weight || 0),
        legacyDispatchId: row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt || row.createdAt,
        ...(row.createdByUserId ? { createdByUserId: row.createdByUserId } : actorUserId ? { createdByUserId: String(actorUserId) } : {}),
        ...(actorUserId ? { updatedByUserId: String(actorUserId) } : {}),
      },
    });
    await tx.dispatchEvent.create({
      data: {
        challanId: challan.id,
        lineId: line.id,
        type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
        payload: serialize({ legacyDispatchId: row.id, sourceType: contract.sourceType, sourceId: row.stageItemId }),
        idempotencyKey: `legacy-dispatch:${challan.challanNo}:line:${row.id}`,
        actorUserId: row.createdByUserId || actorUserId || null,
        createdAt: row.createdAt,
      },
    });
  }
  await tx.dispatchEvent.create({
    data: {
      challanId: challan.id,
      type: DISPATCH_EVENT_TYPES.CHALLAN_CREATED,
      payload: safeSnapshot({ legacy: true, challanNo: challan.challanNo, lineCount: group.length }),
      idempotencyKey: `legacy-dispatch:${challan.challanNo}:challan`,
      actorUserId: actorUserId || group[0].createdByUserId || null,
      createdAt: group[0].createdAt,
    },
  });
}

function mergeTotals(totals, { group, contract, existing }) {
  totals.representedRows += group.length;
  totals.rowsByStage[contract.stage] = (totals.rowsByStage[contract.stage] || 0) + group.length;
  if (existing) {
    totals.alreadyMigratedChallans += 1;
    return;
  }
  totals.migratedChallans += 1;
  if (contract.sourceType) totals.migratedLines += group.length;
  else {
    totals.historicalOnlyChallans += 1;
    totals.historicalOnlyRows += group.length;
    totals.historicalOnlyChallansList.push(group[0].challanNo);
  }
}

async function processMigrationBatch(client, { migrationKey, cursor, batchSize, batchNumber, actorUserId, totals }) {
  return client.$transaction(async (tx) => {
    await lockMigration(tx, migrationKey, batchNumber);
    const challanNos = await findNextChallanNumbers(tx, cursor, batchSize);
    if (!challanNos.length) return { done: true, totals };
    const rows = await tx.dispatch.findMany({ where: { challanNo: { in: challanNos } }, orderBy: [{ challanNo: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    const groups = groupsByChallan(rows);
    const company = await companySnapshot(tx);
    const representedIds = [];
    for (const challanNo of challanNos) {
      const group = groups.get(challanNo) || [];
      if (!group.length) throw conflict('legacy_challan_batch_incomplete', 'A migration batch selected a challan without complete rows.', { challanNo });
      const contract = validateLegacyGroup(challanNo, group);
      const existing = await tx.dispatchChallan.findUnique({ where: { challanNo } });
      if (existing) {
        const represented = await representedRowIds(tx, existing.id, group);
        if (represented.size < group.length) throw conflict('legacy_representation_incomplete', 'An existing historical challan does not represent every legacy Dispatch row.', { challanNo, representedRows: represented.size, expectedRows: group.length });
        if (!contract.sourceType) await ensureHistoricalOnlyRowEvidence(tx, { challan: existing, group, contract, actorUserId });
      } else {
        const customer = await tx.customer.findUnique({ where: { id: contract.customerId } });
        if (!customer) throw conflict('legacy_customer_missing', 'A legacy Dispatch customer no longer exists.', { challanNo, customerId: contract.customerId });
        const challan = await createChallan(tx, { challanNo, group, contract, customer, company, actorUserId });
        if (contract.sourceType) await migrateSupportedGroup(tx, { challan, group, contract, actorUserId });
        else await createHistoricalOnlyRepresentation(tx, { challan, group, contract, actorUserId });
      }
      representedIds.push(...group.map((row) => row.id));
      mergeTotals(totals, { group, contract, existing });
    }
    const nextCursor = challanNos[challanNos.length - 1];
    totals.completedBatches += 1;
    await tx.auditLog.create({
      data: {
        entityType: MIGRATION_ENTITY_TYPE,
        entityId: migrationKey,
        action: 'batch_completed',
        actorUserId: actorUserId || null,
        payload: safeSnapshot({ evidenceVersion: MIGRATION_EVIDENCE_VERSION, batchNumber, cursorBefore: cursor, cursorAfter: nextCursor, challanNos, representedLegacyDispatchIds: representedIds, totals }),
      },
    });
    return { done: false, nextCursor, totals };
  });
}

async function latestMigrationAudit(client, migrationKey, action) {
  return client.auditLog.findFirst({ where: { entityType: MIGRATION_ENTITY_TYPE, entityId: migrationKey, action }, orderBy: { createdAt: 'desc' }, select: { payload: true } });
}

export async function migrateLegacyDispatches({ client = prisma, actorUserId = null, idempotencyKey = 'dispatch-v2-legacy-migration', batchSize = DEFAULT_BATCH_SIZE, startAfter = null } = {}) {
  await assertNoMalformedChallanNumbers(client);
  const migrationKey = String(idempotencyKey);
  const completed = await latestMigrationAudit(client, migrationKey, 'completed');
  if (completed?.payload?.summary) return completed.payload.summary;
  const progress = await latestMigrationAudit(client, migrationKey, 'batch_completed');
  const scannedRows = await client.dispatch.count();
  const priorTotals = progress?.payload?.totals && typeof progress.payload.totals === 'object' ? progress.payload.totals : emptyTotals(scannedRows);
  const totals = { ...emptyTotals(scannedRows), ...priorTotals, scannedRows, rowsByStage: { ...(priorTotals.rowsByStage || {}) }, historicalOnlyChallansList: [...(priorTotals.historicalOnlyChallansList || [])] };
  let cursor = startAfter || progress?.payload?.cursorAfter || null;
  let batchNumber = Number(progress?.payload?.batchNumber || 0) + 1;
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  while (true) {
    const result = await processMigrationBatch(client, { migrationKey, cursor, batchSize: normalizedBatchSize, batchNumber, actorUserId, totals });
    if (result.done) break;
    cursor = result.nextCursor;
    batchNumber += 1;
  }
  const summary = {
    ...totals,
    allLegacyRowsRepresented: totals.representedRows === totals.scannedRows,
    migrationEvidence: {
      version: MIGRATION_EVIDENCE_VERSION,
      migrationKey,
      completedCursor: cursor,
      scannedRows: totals.scannedRows,
      representedRows: totals.representedRows,
      allLegacyRowsRepresented: totals.representedRows === totals.scannedRows,
      migratedChallans: totals.migratedChallans,
      historicalOnlyChallans: totals.historicalOnlyChallans,
      historicalOnlyRows: totals.historicalOnlyRows,
      rowsByStage: totals.rowsByStage,
      completedBatches: totals.completedBatches,
    },
  };
  await client.$transaction(async (tx) => {
    await lockMigration(tx, migrationKey, 'complete');
    await tx.auditLog.create({ data: { entityType: MIGRATION_ENTITY_TYPE, entityId: migrationKey, action: 'completed', actorUserId: actorUserId || null, payload: safeSnapshot({ summary }) } });
  });
  return summary;
}
