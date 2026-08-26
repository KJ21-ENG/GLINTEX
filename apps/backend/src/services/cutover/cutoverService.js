import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import {
  applyReconciliationBatch,
  createReconciliationBatch,
  getReconciliationBatch,
  importOpeningBalances as importOpeningBalancesBatch,
  previewReconciliationBatch,
  reverseReconciliationBatch,
} from '../packing/reconciliationService.js';
import { getConingAvailability, EPSILON } from '../inventory/coningBalance.js';
import { badRequest, conflict, notFound, parseDate, requireNonEmptyString } from '../packing/errors.js';
import { serialize } from '../packing/serialization.js';
import {
  isAffectedWriteGated,
  PACKING_LAUNCH_STATE_ID,
  readLaunchState,
  transitionLaunchState,
} from './writeGate.js';
import { checkBackendReadiness, REQUIRED_PACKING_MIGRATION } from './readiness.js';

export const LEGACY_CUTOVER_KIND = 'LEGACY_CUTOVER';
export const OPENING_BALANCE_KIND = 'OPENING_BALANCE';

export function openingBalanceKindPredicate(kind = OPENING_BALANCE_KIND) {
  // InventoryAdjustmentKind is a PostgreSQL enum. Cast the column before
  // comparing it with the parameter so the linked-opening scan remains
  // valid under Prisma's text parameter binding.
  return Prisma.sql`"kind"::text = ${kind}`;
}

const CUTOVER_SOURCE_TYPES = new Set(['CONING_RECEIVE', 'CONING']);
const LINKED_OPENING_BATCH_SCAN_LIMIT = 2;
const LINKED_OPENING_BATCH_REVERSE_LIMIT = 100;
const ADJUSTMENT_BATCH_HEADER_SELECT = {
  id: true,
  batchNo: true,
  kind: true,
  status: true,
  effectiveAt: true,
  evidenceSnapshot: true,
  idempotencyKey: true,
  appliedAt: true,
  reversedAt: true,
  createdAt: true,
  updatedAt: true,
};
// Historical source tables retain deleted rows for audit and barcode lineage.
// Cutover uniqueness and snapshot ownership must inspect only active owners;
// counting deleted legacy rows makes a previously retired barcode look like a
// second live identity without changing the historical barcode itself.
export const ACTIVE_BARCODE_OWNER_SQL = Prisma.raw(`
  SELECT "barcode" AS barcode FROM "InboundItem" WHERE "barcode" IS NOT NULL
  UNION ALL SELECT "barcode" AS barcode FROM "IssueToCutterMachine" WHERE "barcode" IS NOT NULL AND "isDeleted" = false
  UNION ALL SELECT "barcode" AS barcode FROM "IssueToHoloMachine" WHERE "barcode" IS NOT NULL AND "isDeleted" = false
  UNION ALL SELECT "barcode" AS barcode FROM "IssueToConingMachine" WHERE "barcode" IS NOT NULL AND "isDeleted" = false
  UNION ALL SELECT "barcode" AS barcode FROM "ReceiveFromCutterMachineRow" WHERE "barcode" IS NOT NULL AND "isDeleted" = false
  UNION ALL SELECT "barcode" AS barcode FROM "ReceiveFromHoloMachineRow" WHERE "barcode" IS NOT NULL AND "isDeleted" = false
  UNION ALL SELECT "barcode" AS barcode FROM "ReceiveFromConingMachineRow" WHERE "barcode" IS NOT NULL AND "isDeleted" = false
  UNION ALL SELECT "barcode" AS barcode FROM "PackedUnit" WHERE "barcode" IS NOT NULL
`);

const OWNER_BARCODE_SQL = ACTIVE_BARCODE_OWNER_SQL;

function unwrap(result) {
  return result?.result !== undefined ? result.result : result;
}

function normalizeIdempotencyKey(value, field = 'idempotencyKey') {
  return requireNonEmptyString(value, field, 200);
}

function normalizeReason(value, fallback) {
  return requireNonEmptyString(value || fallback, 'reason', 2000);
}

function normalizeEvidence(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeCutoverLine(line, index) {
  const sourceType = requireNonEmptyString(line?.sourceType, `lines[${index}].sourceType`, 100).toUpperCase();
  if (!CUTOVER_SOURCE_TYPES.has(sourceType)) {
    throw badRequest('invalid_cutover_source_type', 'Legacy cutover lines must reference Coning receive sources.', {
      sourceType,
      allowed: [...CUTOVER_SOURCE_TYPES],
    });
  }

  const sourceId = requireNonEmptyString(line?.sourceId, `lines[${index}].sourceId`, 200);
  const countDelta = Number(line?.countDelta ?? -(Number(line?.availableCount ?? 0)));
  const weightDeltaKg = Number(line?.weightDeltaKg ?? -(Number(line?.availableWeightKg ?? line?.weightKg ?? 0)));
  if (!Number.isInteger(countDelta) || !Number.isFinite(weightDeltaKg)) {
    throw badRequest('invalid_cutover_delta', 'Cutover countDelta must be an integer and weightDeltaKg must be finite.', { sourceId });
  }
  if (countDelta > 0 || weightDeltaKg > EPSILON) {
    throw badRequest('cutover_must_reduce_balance', 'Legacy cutover adjustments may not increase authoritative availability.', { sourceId });
  }
  if (countDelta === 0 && Math.abs(weightDeltaKg) <= EPSILON) {
    throw badRequest('empty_cutover_line', 'Each legacy cutover line must reduce count or weight.', { sourceId });
  }

  return {
    sourceType,
    sourceId,
    countDelta,
    weightDeltaKg,
    sourceBarcode: line?.sourceBarcode ? String(line.sourceBarcode).trim() : null,
    sourceItemSnapshot: normalizeEvidence(line?.sourceItemSnapshot),
    sourceLotSnapshot: normalizeEvidence(line?.sourceLotSnapshot),
    sourceConeSnapshot: normalizeEvidence(line?.sourceConeSnapshot),
  };
}

function normalizeCutoverLines(payload) {
  const rawLines = payload?.lines ?? payload?.sources;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw badRequest('lines_required', 'At least one audited Coning balance line is required for cutover.');
  }
  if (rawLines.length > 1000) throw badRequest('too_many_lines', 'A cutover may contain at most 1000 lines.');

  const seen = new Set();
  return rawLines.map((line, index) => {
    const normalized = normalizeCutoverLine(line, index);
    const identity = normalized.sourceId;
    if (seen.has(identity)) throw badRequest('duplicate_cutover_line', 'Each Coning source may appear only once in a cutover.', { sourceType: normalized.sourceType, sourceId: normalized.sourceId });
    seen.add(identity);
    return normalized;
  });
}

function sourceSnapshots(balance) {
  const source = balance.source || {};
  const issue = source.issue || {};
  const item = issue.item || {};
  return {
    sourceBarcode: source.barcode || null,
    sourceItemSnapshot: {
      id: item.id || issue.itemId || null,
      name: item.name || null,
    },
    sourceLotSnapshot: {
      lotNo: issue.lotNo || null,
      date: source.date || issue.date || null,
    },
    sourceConeSnapshot: {
      issueId: source.issueId || null,
      coneCount: source.coneCount ?? null,
      netWeightKg: source.netWeight ?? null,
      isOpeningStock: Boolean(source.isOpeningStock),
    },
  };
}

async function enrichCutoverLines(client, lines) {
  const enriched = [];
  for (const line of lines) {
    const balance = await getConingAvailability(client, line.sourceId);
    const snapshots = sourceSnapshots(balance);
    enriched.push({
      ...line,
      sourceBarcode: line.sourceBarcode || snapshots.sourceBarcode,
      sourceItemSnapshot: Object.keys(line.sourceItemSnapshot).length ? line.sourceItemSnapshot : snapshots.sourceItemSnapshot,
      sourceLotSnapshot: Object.keys(line.sourceLotSnapshot).length ? line.sourceLotSnapshot : snapshots.sourceLotSnapshot,
      sourceConeSnapshot: Object.keys(line.sourceConeSnapshot).length ? line.sourceConeSnapshot : snapshots.sourceConeSnapshot,
      balance,
    });
  }
  return enriched;
}

function previewLine(line) {
  const before = line.balance.available;
  const after = {
    count: before.count + line.countDelta,
    weight: before.weight + line.weightDeltaKg,
  };
  const errors = [];
  if (line.balance.invariantBroken) errors.push('source_balance_invariant_broken');
  if (after.count < -EPSILON) errors.push('negative_adjusted_count');
  if (after.weight < -0.001) errors.push('negative_adjusted_weight');
  return {
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    sourceBarcode: line.sourceBarcode,
    delta: { count: line.countDelta, weight: line.weightDeltaKg },
    before,
    after,
    valid: errors.length === 0,
    errors,
  };
}

async function draftConingSettlementCount(client) {
  return client.contractorSettlement.count({ where: { process: 'coning', status: 'draft' } });
}

async function recordCutoverAudit(client, { action, actorUserId, payload }) {
  return client.auditLog.create({
    data: {
      entityType: 'packing_cutover',
      entityId: PACKING_LAUNCH_STATE_ID,
      action,
      actorUserId: actorUserId ? String(actorUserId) : null,
      payload: serialize(payload || {}),
    },
  });
}

async function enterWritesGated({ actorUserId = null, reason, allowActive = false, client = prisma } = {}) {
  const current = await readLaunchState(client);
  if (current?.status === 'ACTIVE' && !allowActive) {
    throw conflict('cutover_already_active', 'Packing cutover is already ACTIVE. Reverse it before starting another cutover.');
  }
  const state = await transitionLaunchState({
    status: 'WRITES_GATED',
    affectedWritesPaused: true,
    lastError: null,
    actorUserId,
    client,
  });
  await recordCutoverAudit(client, {
    action: 'writes_gated',
    actorUserId,
    payload: { reason: normalizeReason(reason, 'Packing cutover') },
  });
  return state;
}

async function markCutoverFailed({ actorUserId = null, error, adjustmentBatchId, client = prisma } = {}) {
  const message = String(error?.message || error || 'Packing cutover failed.').slice(0, 2000);
  try {
    const state = await transitionLaunchState({
      status: 'FAILED',
      affectedWritesPaused: true,
      adjustmentBatchId,
      lastError: message,
      actorUserId,
      client,
    });
    await recordCutoverAudit(client, {
      action: 'failed',
      actorUserId,
      payload: { adjustmentBatchId: adjustmentBatchId || null, error: message },
    });
    return state;
  } catch (stateError) {
    console.error('[PackingCutover] Failed to persist FAILED launch state:', stateError);
    return null;
  }
}

async function findBatchByIdempotencyKey(client, idempotencyKey) {
  return client.inventoryAdjustmentBatch.findUnique({
    where: { idempotencyKey },
    select: ADJUSTMENT_BATCH_HEADER_SELECT,
  });
}

async function findAdjustmentBatchHeader(client, id) {
  const batch = await client.inventoryAdjustmentBatch.findUnique({
    where: { id: String(id) },
    select: ADJUSTMENT_BATCH_HEADER_SELECT,
  });
  if (!batch) throw notFound('reconciliation_batch_not_found', 'Reconciliation batch not found.', { id });
  return batch;
}

async function findIdempotentResult(client, operation, idempotencyKey) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT "payload"
    FROM "AuditLog"
    WHERE "entityType" = 'packing_idempotency'
      AND "action" = ${operation}
      AND "payload"->>'idempotencyKey' = ${idempotencyKey}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  const payload = rows?.[0]?.payload;
  return payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')
    ? payload.result
    : undefined;
}

async function findCutoverAuditByIdempotencyKey(client, action, idempotencyKey) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT "payload"
    FROM "AuditLog"
    WHERE "entityType" = 'packing_cutover'
      AND "action" = ${action}
      AND "payload"->>'idempotencyKey' = ${idempotencyKey}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  const payload = rows?.[0]?.payload;
  return payload && typeof payload === 'object' ? payload : undefined;
}

async function findLatestBatch(client, kind) {
  return client.inventoryAdjustmentBatch.findFirst({
    where: { kind },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: ADJUSTMENT_BATCH_HEADER_SELECT,
  });
}

async function countLinkedOpeningBalanceBatches(client, cutoverBatchId) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "InventoryAdjustmentBatch"
    WHERE ${openingBalanceKindPredicate(OPENING_BALANCE_KIND)}
      AND "evidenceSnapshot"->>'cutoverBatchId' = ${String(cutoverBatchId)}
  `);
  return Number(rows[0]?.count || 0);
}

async function findLinkedOpeningBalanceBatches(client, cutoverBatchId, { limit = LINKED_OPENING_BATCH_SCAN_LIMIT } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || LINKED_OPENING_BATCH_SCAN_LIMIT, 1), LINKED_OPENING_BATCH_REVERSE_LIMIT);
  // WP-01 indexes kind/status; filter the immutable cutover link in JSON and
  // cap the header scan. Lines are deliberately loaded only by a selected
  // batch operation such as the WP-02 reverse/import service.
  return client.$queryRaw(Prisma.sql`
    SELECT "id", "batchNo", "kind", "status", "effectiveAt", "evidenceSnapshot", "idempotencyKey", "appliedAt", "reversedAt", "createdAt", "updatedAt"
    FROM "InventoryAdjustmentBatch"
    WHERE ${openingBalanceKindPredicate(OPENING_BALANCE_KIND)}
      AND "evidenceSnapshot"->>'cutoverBatchId' = ${String(cutoverBatchId)}
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT ${boundedLimit}
  `);
}

function activationEvidence(payload) {
  const evidence = normalizeEvidence(payload?.activationEvidence || payload?.evidence || payload?.evidenceSnapshot);
  const step10 = normalizeEvidence(payload?.step10Evidence || evidence.step10Evidence || evidence.step10);
  return { evidence, step10 };
}

export function requireSuccessfulEvidence(section, name) {
  const value = normalizeEvidence(section);
  const status = String(value.status || '').trim().toUpperCase();
  const successful = value.ok === true || value.verified === true || value.accepted === true || ['APPLIED', 'COMPLETED', 'PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED'].includes(status);
  if (!successful) throw badRequest('activation_evidence_incomplete', `${name} evidence must be explicitly successful.`, { evidence: name });
  return value;
}

function finiteEvidenceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function requireZeroEvidenceDifference(section, name) {
  const countDifference = finiteEvidenceNumber(section.countDifference ?? section.countMismatch ?? section.unreconciledCount);
  const weightDifference = finiteEvidenceNumber(section.weightDifferenceKg ?? section.weightMismatchKg ?? section.weightDifference);
  if (countDifference === null || weightDifference === null || Math.abs(countDifference) > 0 || Math.abs(weightDifference) > 0.001) {
    throw badRequest('activation_evidence_incomplete', `${name} evidence must prove zero unreconciled count and weight difference.`, { evidence: name });
  }
}

async function verifyHistoricalDispatchMigration(client, section) {
  const evidence = requireWp03Evidence(section, 'historicalDispatchMigration');
  const durableRows = await client.dispatch.findMany({ select: { id: true, stage: true, stageBarcode: true } });
  const representedRows = evidence.representedRows || evidence.compatibilityRows || evidence.rows;
  if (!Array.isArray(representedRows) || representedRows.length !== durableRows.length) {
    throw conflict('dispatch_representation_incomplete', 'WP-03 must provide one durable compatibility record for every historical Dispatch row.', {
      durableRows: durableRows.length,
      representedRows: Array.isArray(representedRows) ? representedRows.length : null,
    });
  }
  const durableById = new Map(durableRows.map((row) => [row.id, row]));
  const seen = new Set();
  const v2LineReferences = [];
  const coningRows = [];
  for (const represented of representedRows) {
    const legacyDispatchId = represented?.legacyDispatchId || represented?.dispatchId || represented?.id;
    const durable = durableById.get(legacyDispatchId);
    if (!legacyDispatchId || !durable || seen.has(legacyDispatchId)) {
      throw conflict('dispatch_representation_invalid', 'Each WP-03 historical compatibility record must identify one distinct durable Dispatch row.', { legacyDispatchId });
    }
    seen.add(legacyDispatchId);
    const representation = String(represented.representation || represented.mode || '').trim().toUpperCase();
    const stage = String(represented.stage || durable.stage || '').trim().toLowerCase();
    if (represented.stage && stage !== String(durable.stage || '').trim().toLowerCase()) {
      throw conflict('dispatch_representation_invalid', 'Each WP-03 compatibility record must preserve the durable historical Dispatch stage.', { legacyDispatchId, representedStage: stage, durableStage: durable.stage });
    }
    if (stage === 'coning') {
      if (!['HISTORICAL_READ_ONLY', 'LEGACY_READ_ONLY', 'READ_ONLY'].includes(representation)
        || represented.historicalRecordsReadable !== true
        || (represented.newConingSourceSelection ?? represented.sourceSelectionEnabled) !== false) {
        throw conflict('historical_coning_unverified', 'Historical Coning compatibility records must remain read-only and non-selectable.', { legacyDispatchId, representation });
      }
      coningRows.push(legacyDispatchId);
    } else {
      if (!['V2', 'MIGRATED', 'LEGACY_RECONSTRUCTION'].includes(representation) || !represented.dispatchLineId) {
        throw conflict('dispatch_representation_invalid', 'Non-Coning historical rows require a WP-03 V2 or reconstruction representation with a DispatchLine reference.', { legacyDispatchId, representation });
      }
      v2LineReferences.push({ legacyDispatchId, dispatchLineId: represented.dispatchLineId });
    }
  }
  if (seen.size !== durableRows.length) throw conflict('dispatch_representation_incomplete', 'Historical Dispatch compatibility records do not cover every durable Dispatch row.');
  if (v2LineReferences.length > 0) {
    const lines = await client.dispatchLine.findMany({
      where: { id: { in: v2LineReferences.map((reference) => reference.dispatchLineId) } },
      select: { id: true, legacyDispatchId: true },
    });
    const linesById = new Map(lines.map((line) => [line.id, line]));
    for (const reference of v2LineReferences) {
      if (linesById.get(reference.dispatchLineId)?.legacyDispatchId !== reference.legacyDispatchId) {
        throw conflict('dispatch_representation_invalid', 'Each WP-03 DispatchLine representation must point back to its exact historical Dispatch row.', reference);
      }
    }
  }
  return { legacyDispatchRows: durableRows.length, representedRows: representedRows.length, historicalConingRows: coningRows.length, v2RepresentedRows: v2LineReferences.length };
}

function requireWp03Evidence(section, name) {
  const evidence = requireSuccessfulEvidence(section, name);
  const packet = evidence.packet || evidence.sourcePacket || evidence.producer;
  if (packet !== 'WP-03') {
    throw badRequest('wp03_evidence_required', `${name} evidence must be produced by WP-03.`, { evidence: name, packet });
  }
  return evidence;
}

async function verifyHistoricalConingCompatibility(client, section) {
  const evidence = requireWp03Evidence(section, 'historicalConing');
  const durableRows = await client.dispatch.findMany({ where: { stage: 'coning' }, select: { id: true } });
  const representedRows = evidence.representedRows || evidence.compatibilityRows || evidence.rows;
  const newSourceSelection = evidence.newConingSourceSelection ?? evidence.newSourceSelection ?? evidence.sourceSelectionEnabled;
  const readable = evidence.historicalRecordsReadable ?? evidence.readOnlyCompatibility;
  const representedIds = new Set(Array.isArray(representedRows) ? representedRows.map((row) => row?.legacyDispatchId || row?.dispatchId || row?.id).filter(Boolean) : []);
  if (!Array.isArray(representedRows) || representedRows.length !== durableRows.length || representedIds.size !== durableRows.length
    || durableRows.some((row) => !representedIds.has(row.id)) || newSourceSelection !== false || readable !== true) {
    throw conflict('historical_coning_unverified', 'WP-03 evidence must prove historical Coning records remain readable without enabling new Coning source selection.', {
      legacyConingRows: durableRows.length,
      representedRows: Array.isArray(representedRows) ? representedRows.length : null,
      newSourceSelection,
      historicalRecordsReadable: readable,
    });
  }
  return { legacyConingRows: durableRows.length, representedRows: representedRows.length, newConingSourceSelection: false, historicalRecordsReadable: true };
}

export async function verifyBarcodeUniqueness(client, section) {
  const evidence = requireSuccessfulEvidence(section, 'barcodeUniqueness');
  const duplicateRows = await client.$queryRaw(Prisma.sql`
    SELECT barcode, COUNT(*)::int AS occurrences
    FROM (${OWNER_BARCODE_SQL}) AS barcode_values
    GROUP BY barcode
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  const reportedDuplicates = finiteEvidenceNumber(evidence.duplicateCount ?? evidence.duplicates);
  if (reportedDuplicates === null || reportedDuplicates !== 0 || duplicateRows.length > 0) {
    throw conflict('barcode_uniqueness_unverified', 'Barcode uniqueness evidence is incomplete or durable duplicate barcodes remain.', {
      reportedDuplicates,
      durableDuplicates: duplicateRows,
    });
  }
  return { durableDuplicates: 0 };
}

export async function verifySnapshotOwnerReferences(client, section) {
  const evidence = requireSuccessfulEvidence(section, 'snapshotOwners');
  const failures = await client.$queryRaw(Prisma.sql`
    WITH owners AS (${OWNER_BARCODE_SQL}), refs AS (
      SELECT 'DISPATCH' AS reference_type, "id" AS reference_id, "stageBarcode" AS barcode
      FROM "Dispatch"
      WHERE "stageBarcode" IS NOT NULL
      UNION ALL
      SELECT 'DISPATCH_LINE', "id", COALESCE("sourceBarcode", "sourceDisplaySnapshot"->>'barcode')
      FROM "DispatchLine"
      WHERE COALESCE("sourceBarcode", "sourceDisplaySnapshot"->>'barcode') IS NOT NULL
      UNION ALL
      SELECT 'ADJUSTMENT_LINE', "id", "sourceBarcode"
      FROM "InventoryAdjustmentLine"
      WHERE "sourceBarcode" IS NOT NULL
    )
    SELECT refs.reference_type, refs.reference_id, refs.barcode, COUNT(owners.barcode)::int AS owner_count
    FROM refs
    LEFT JOIN owners ON owners.barcode = refs.barcode
    GROUP BY refs.reference_type, refs.reference_id, refs.barcode
    HAVING COUNT(owners.barcode) <> 1
    LIMIT 50
  `);
  const reportedFailures = finiteEvidenceNumber(evidence.ownerCountFailures ?? evidence.unresolvedCount ?? evidence.failureCount);
  if (reportedFailures === null || reportedFailures !== 0 || failures.length > 0) {
    throw conflict('snapshot_owner_unverified', 'Dispatch, DispatchLine, and adjustment snapshots must reference exactly one owning identity.', {
      reportedFailures,
      durableFailures: failures,
    });
  }
  return { ownerCountFailures: 0 };
}

async function verifyPackedDispatchLineage(client, section) {
  const evidence = requireSuccessfulEvidence(section, 'packedDispatchLineage');
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE source."id" IS NULL)::int AS orphaned_source_count,
      COUNT(*) FILTER (WHERE line."parentPackedUnitId" IS NOT NULL AND parent."id" IS NULL)::int AS orphaned_parent_count,
      COUNT(*) FILTER (WHERE source."id" IS NOT NULL AND (line."sourceBarcode" IS NULL OR source."barcode" IS DISTINCT FROM line."sourceBarcode"))::int AS barcode_mismatch_count
    FROM "DispatchLine" line
    LEFT JOIN "PackedUnit" source ON source."id" = line."sourceId"
    LEFT JOIN "PackedUnit" parent ON parent."id" = line."parentPackedUnitId"
    WHERE line."sourceType" = 'PACKED'
  `);
  const durable = {
    orphanedSourceCount: Number(rows[0]?.orphaned_source_count || 0),
    orphanedParentCount: Number(rows[0]?.orphaned_parent_count || 0),
    barcodeMismatchCount: Number(rows[0]?.barcode_mismatch_count || 0),
  };
  const reported = {
    orphanedSourceCount: finiteEvidenceNumber(evidence.orphanedSourceCount ?? evidence.sourceOrphans),
    orphanedParentCount: finiteEvidenceNumber(evidence.orphanedParentCount ?? evidence.parentOrphans),
    barcodeMismatchCount: finiteEvidenceNumber(evidence.barcodeMismatchCount ?? evidence.barcodeMismatches),
  };
  if (reported.orphanedSourceCount === null || reported.orphanedParentCount === null || reported.barcodeMismatchCount === null
    || reported.orphanedSourceCount !== durable.orphanedSourceCount
    || reported.orphanedParentCount !== durable.orphanedParentCount
    || reported.barcodeMismatchCount !== durable.barcodeMismatchCount
    || Object.values(durable).some((value) => value !== 0)) {
    throw conflict('packed_dispatch_lineage_unverified', 'Every PACKED DispatchLine must reference a PackedUnit source, an optional existing parent, and a matching barcode.', { reported, durable });
  }
  return durable;
}

async function verifyReconciliationTotals(client, batchId, section) {
  const evidence = requireSuccessfulEvidence(section, 'reconciliationTotals');
  requireZeroEvidenceDifference(evidence, 'reconciliationTotals');
  const aggregate = await client.inventoryAdjustmentLine.aggregate({
    where: { batchId },
    _sum: { countDelta: true, weightDeltaKg: true },
  });
  const appliedCountDelta = finiteEvidenceNumber(evidence.appliedCountDelta ?? evidence.countDelta);
  const appliedWeightDelta = finiteEvidenceNumber(evidence.appliedWeightDeltaKg ?? evidence.weightDeltaKg);
  const durableCountDelta = Number(aggregate._sum.countDelta || 0);
  const durableWeightDelta = Number(aggregate._sum.weightDeltaKg || 0);
  if (appliedCountDelta === null || appliedWeightDelta === null || appliedCountDelta !== durableCountDelta || Math.abs(appliedWeightDelta - durableWeightDelta) > 0.001) {
    throw conflict('reconciliation_totals_unverified', 'Reconciliation evidence does not match the durable LEGACY_CUTOVER adjustment totals.', {
      batchId,
      appliedCountDelta,
      durableCountDelta,
      appliedWeightDelta,
      durableWeightDelta,
    });
  }
  return {
    appliedCountDelta,
    appliedWeightDeltaKg: appliedWeightDelta,
    durableCountDelta,
    durableWeightDeltaKg: durableWeightDelta,
    countDifference: Number(evidence.countDifference ?? evidence.countMismatch ?? evidence.unreconciledCount),
    weightDifferenceKg: Number(evidence.weightDifferenceKg ?? evidence.weightMismatchKg ?? evidence.weightDifference),
  };
}

async function verifyLineage(client, section) {
  const evidence = requireSuccessfulEvidence(section, 'lineage');
  const unresolved = finiteEvidenceNumber(evidence.unresolvedCount ?? evidence.unresolved ?? 0);
  const orphaned = finiteEvidenceNumber(evidence.orphanedCount ?? evidence.orphaned ?? 0);
  const [sourceOrphans, dispatchOrphans] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "PackingBatchSource" source
      LEFT JOIN "ReceiveFromConingMachineRow" coning
        ON source."sourceType" = 'CONING_RECEIVE' AND coning."id" = source."sourceId"
      LEFT JOIN "PackedUnit" packed
        ON source."sourceType" = 'PACKED_UNIT' AND packed."id" = source."sourceId"
      WHERE (source."sourceType" = 'CONING_RECEIVE' AND coning."id" IS NULL)
         OR (source."sourceType" = 'PACKED_UNIT' AND packed."id" IS NULL)
    `),
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM "DispatchLine" line
      LEFT JOIN "PackedUnit" packed ON packed."id" = line."parentPackedUnitId"
      WHERE line."sourceType" = 'PACKED'
        AND line."parentPackedUnitId" IS NOT NULL
        AND packed."id" IS NULL
    `),
  ]);
  const durableOrphaned = Number(sourceOrphans[0]?.count || 0) + Number(dispatchOrphans[0]?.count || 0);
  if (unresolved !== 0 || orphaned !== 0 || durableOrphaned !== 0) {
    throw badRequest('lineage_unverified', 'Lineage evidence and durable source relationships must prove zero unresolved or orphaned records.', { unresolved, orphaned, durableOrphaned });
  }
  return { unresolved, orphaned, durableOrphaned };
}

function verifyMigrationState(section, readiness) {
  const evidence = requireSuccessfulEvidence(section, 'migrationState');
  const migrationName = evidence.migrationName || evidence.expectedMigration || evidence.name;
  const status = String(evidence.status || '').trim().toUpperCase();
  if (migrationName !== REQUIRED_PACKING_MIGRATION || !['APPLIED', 'COMPLETED', 'SUCCESS', 'SUCCEEDED'].includes(status) || readiness.checks.migration.applied !== true) {
    throw conflict('migration_state_unverified', 'Migration-state evidence must identify the applied Packing migration and match runtime readiness.', {
      expectedMigration: REQUIRED_PACKING_MIGRATION,
      migrationName,
      status,
      runtimeApplied: readiness.checks.migration.applied,
    });
  }
  return { migrationName, status };
}

function verifyReadinessHealth(section, readiness) {
  const evidence = requireSuccessfulEvidence(section, 'readinessHealth');
  const local = normalizeEvidence(evidence.local || evidence.localReadiness);
  const publicCheck = normalizeEvidence(evidence.public || evidence.publicReadiness);
  const health = normalizeEvidence(evidence.health);
  const localOk = local.ok === true || evidence.localOk === true;
  const publicOk = publicCheck.ok === true || evidence.publicOk === true;
  const backendHealthy = health.backend === true || health.backendHealthy === true || evidence.backendHealthy === true;
  const frontendHealthy = health.frontend === true || health.frontendHealthy === true || evidence.frontendHealthy === true;
  if (!readiness.ok || !localOk || !publicOk || !backendHealthy || !frontendHealthy) {
    throw conflict('readiness_health_unverified', 'Activation requires successful runtime readiness and local/public backend and container health evidence.', {
      runtimeReadiness: readiness.ok,
      localOk,
      publicOk,
      backendHealthy,
      frontendHealthy,
    });
  }
  return { localOk, publicOk, backendHealthy, frontendHealthy, runtimeReadiness: readiness.ok };
}

function verifyAppendOnlyAcceptedEvidence(section) {
  const evidence = requireSuccessfulEvidence(section, 'appendOnlyAcceptedEvidence');
  const eventIds = Array.isArray(evidence.eventIds) ? evidence.eventIds.filter(Boolean) : [];
  if (evidence.accepted !== true || eventIds.length === 0) {
    throw badRequest('append_only_evidence_required', 'Activation requires explicit accepted append-only evidence event IDs.', { evidence: 'appendOnlyAcceptedEvidence' });
  }
  return { accepted: true, eventIds };
}

async function verifyActivationEvidence({ payload, client, cutoverBatchId }) {
  const { evidence, step10 } = activationEvidence(payload);
  if (step10.complete !== true) throw badRequest('step10_evidence_incomplete', 'Complete step-10 cutover evidence is required before activation.');

  const readiness = await checkBackendReadiness({ client });
  const verification = {
    historicalDispatchMigration: await verifyHistoricalDispatchMigration(client, step10.historicalDispatchMigration || evidence.historicalDispatchMigration || evidence.dispatchMigration),
    historicalConing: await verifyHistoricalConingCompatibility(client, step10.historicalConing || evidence.historicalConing),
    reconciliationTotals: await verifyReconciliationTotals(client, cutoverBatchId, step10.reconciliationTotals || evidence.reconciliationTotals),
    barcodeUniqueness: await verifyBarcodeUniqueness(client, step10.barcodeUniqueness || evidence.barcodeUniqueness),
    snapshotOwners: await verifySnapshotOwnerReferences(client, step10.snapshotOwners || evidence.snapshotOwners),
    lineage: await verifyLineage(client, step10.lineage || evidence.lineage),
    packedDispatchLineage: await verifyPackedDispatchLineage(client, step10.packedDispatchLineage || evidence.packedDispatchLineage),
    migrationState: verifyMigrationState(step10.migrationState || evidence.migrationState, readiness),
    readinessHealth: verifyReadinessHealth(step10.readinessHealth || evidence.readinessHealth, readiness),
    appendOnlyAcceptedEvidence: verifyAppendOnlyAcceptedEvidence(step10.appendOnlyAcceptedEvidence || evidence.appendOnlyAcceptedEvidence),
  };
  return { evidence, step10, verification };
}

export async function getCutoverStatus({ client = prisma } = {}) {
  const [launchState, latestCutover, latestOpeningBalance] = await Promise.all([
    readLaunchState(client),
    findLatestBatch(client, LEGACY_CUTOVER_KIND),
    findLatestBatch(client, OPENING_BALANCE_KIND),
  ]);
  return {
    launchState: serialize(launchState || {
      id: PACKING_LAUNCH_STATE_ID,
      status: 'PREPARATION',
      affectedWritesPaused: false,
      cutoffAt: null,
      adjustmentBatchId: null,
      lastError: null,
    }),
    latestCutover: serialize(latestCutover),
    latestOpeningBalance: serialize(latestOpeningBalance),
  };
}

export async function previewCutover({ payload = {}, batchId = null, client = prisma } = {}) {
  const launchState = await readLaunchState(client);
  const draftSettlements = await draftConingSettlementCount(client);
  const selectedBatchId = batchId || payload.batchId || null;

  if (selectedBatchId) {
    const batch = await getReconciliationBatch(selectedBatchId, client);
    if (batch.kind !== LEGACY_CUTOVER_KIND) throw conflict('invalid_cutover_batch_kind', 'The selected batch is not a LEGACY_CUTOVER batch.');
    const preview = await previewReconciliationBatch({ id: selectedBatchId, payload, client });
    const blockers = [];
    if (draftSettlements > 0) blockers.push({ code: 'draft_coning_settlements_exist', count: draftSettlements });
    if (batch.status !== 'DRAFT') blockers.push({ code: 'adjustment_not_draft', status: batch.status });
    return serialize({
      mode: 'existing_batch',
      batch,
      launchState,
      draftConingSettlements: draftSettlements,
      blockers,
      ...preview,
      valid: preview.valid && blockers.length === 0,
    });
  }

  const lines = await enrichCutoverLines(client, normalizeCutoverLines(payload));
  const previewLines = lines.map(previewLine);
  const errors = previewLines.flatMap((line) => line.errors.map((error) => ({ sourceId: line.sourceId, error })));
  const blockers = [];
  if (draftSettlements > 0) blockers.push({ code: 'draft_coning_settlements_exist', count: draftSettlements });
  if (launchState?.status === 'ACTIVE') blockers.push({ code: 'cutover_already_active' });
  if (isAffectedWriteGated(launchState) && launchState?.status !== 'WRITES_GATED') blockers.push({ code: 'cutover_state_not_preparation', status: launchState.status });

  return serialize({
    mode: 'new_batch',
    batch: null,
    launchState,
    draftConingSettlements: draftSettlements,
    lines: previewLines,
    errors,
    blockers,
    valid: errors.length === 0 && blockers.length === 0,
  });
}

export async function applyCutover({ payload = {}, batchId = null, actorUserId = null, idempotencyKey, client = prisma } = {}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const batchOperationKey = `packing-cutover:batch:${key}`;
  const applyOperationKey = `packing-cutover:apply:${key}`;
  const suppliedBatchId = batchId || payload.batchId || null;
  const storedApplyResult = await findIdempotentResult(client, 'reconciliation.batch.apply', applyOperationKey);
  if (storedApplyResult !== undefined) {
    return { replay: true, batch: serialize(storedApplyResult), launchState: serialize(await readLaunchState(client)) };
  }
  let batch = suppliedBatchId ? await getReconciliationBatch(suppliedBatchId, client) : await findBatchByIdempotencyKey(client, batchOperationKey);

  if (batch && batch.kind !== LEGACY_CUTOVER_KIND) throw conflict('invalid_cutover_batch_kind', 'The selected batch is not a LEGACY_CUTOVER batch.');
  if (batch?.status === 'APPLIED') {
    if (suppliedBatchId) throw conflict('cutover_already_applied', 'The selected cutover batch is already applied.', { batchId: batch.id });
    return { replay: true, batch: serialize(batch), launchState: serialize(await readLaunchState(client)) };
  }
  if (batch?.status === 'REVERSED') throw conflict('cutover_already_reversed', 'The selected cutover batch has already been reversed.', { batchId: batch.id });

  let preparedLines = null;
  if (!batch) {
    preparedLines = await enrichCutoverLines(client, normalizeCutoverLines(payload));
  }

  await enterWritesGated({ actorUserId, reason: payload.reason, client });
  try {
    const effectiveAt = parseDate(payload.effectiveAt || new Date(), 'effectiveAt');
    const reason = normalizeReason(payload.reason, 'Legacy Coning cutover');
    const evidenceSnapshot = {
      ...normalizeEvidence(payload.evidenceSnapshot),
      command: 'packingCutover.apply',
      idempotencyKey: key,
    };

    if (!batch) {
      const createdResult = await createReconciliationBatch({
        payload: {
          kind: LEGACY_CUTOVER_KIND,
          reason,
          effectiveAt,
          evidenceSnapshot,
          lines: preparedLines.map(({ balance, ...line }) => line),
        },
        actorUserId,
        idempotencyKey: batchOperationKey,
        client,
      });
      batch = unwrap(createdResult);
    }

    if (batch.status !== 'DRAFT') throw conflict('adjustment_not_draft', 'Only a DRAFT cutover batch can be applied.', { status: batch.status });
    const appliedResult = await applyReconciliationBatch({
      id: batch.id,
      payload: {},
      actorUserId,
      idempotencyKey: applyOperationKey,
      client,
    });
    const applied = unwrap(appliedResult);
    let launchState = await readLaunchState(client);
    if (launchState?.status !== 'CUTOVER_APPLIED' || !launchState.affectedWritesPaused) {
      launchState = await transitionLaunchState({
        status: 'CUTOVER_APPLIED',
        affectedWritesPaused: true,
        cutoffAt: effectiveAt,
        adjustmentBatchId: applied.id,
        actorUserId,
        client,
      });
    }
    await recordCutoverAudit(client, {
      action: 'applied',
      actorUserId,
      payload: { batchId: applied.id, batchNo: applied.batchNo, idempotencyKey: key },
    });
    return {
      replay: Boolean(appliedResult?.replay),
      batch: serialize(applied),
      launchState: serialize(launchState),
    };
  } catch (error) {
    await markCutoverFailed({ actorUserId, error, adjustmentBatchId: batch?.id, client });
    throw error;
  }
}

export async function reverseCutover({ batchId, payload = {}, actorUserId = null, idempotencyKey, client = prisma } = {}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const selectedBatchId = requireNonEmptyString(batchId, 'batchId', 100);
  const reverseOperationKey = `packing-cutover:reverse:${key}`;
  const storedReverseResult = await findIdempotentResult(client, 'reconciliation.batch.reverse', reverseOperationKey);
  if (storedReverseResult !== undefined) {
    return { replay: true, ...serialize(storedReverseResult), launchState: serialize(await readLaunchState(client)) };
  }
  const batch = await getReconciliationBatch(selectedBatchId, client);
  if (batch.kind !== LEGACY_CUTOVER_KIND) throw conflict('invalid_cutover_batch_kind', 'The selected batch is not a LEGACY_CUTOVER batch.');
  if (batch.status === 'REVERSED') throw conflict('cutover_already_reversed', 'The selected cutover batch has already been reversed.', { batchId: selectedBatchId });

  await enterWritesGated({ actorUserId, reason: payload.reason || 'Legacy Coning cutover reversal', allowActive: true, client });
  try {
    const linkedOpeningBatchCount = await countLinkedOpeningBalanceBatches(client, selectedBatchId);
    if (linkedOpeningBatchCount > LINKED_OPENING_BATCH_REVERSE_LIMIT) {
      throw conflict('multiple_opening_balance_batches', 'Linked OPENING_BALANCE batches exceed the bounded reversal safety limit.', { cutoverBatchId: selectedBatchId, count: linkedOpeningBatchCount });
    }
    const linkedOpeningBatches = await findLinkedOpeningBalanceBatches(client, selectedBatchId, { limit: Math.max(linkedOpeningBatchCount, 1) });
    if (linkedOpeningBatches.length !== linkedOpeningBatchCount) {
      throw conflict('opening_batch_scan_incomplete', 'The bounded linked OPENING_BALANCE scan did not return every linked batch.', { cutoverBatchId: selectedBatchId, count: linkedOpeningBatchCount, scanned: linkedOpeningBatches.length });
    }
    const invalidOpeningBatches = linkedOpeningBatches.filter((openingBatch) => !['APPLIED', 'REVERSED'].includes(openingBatch.status));
    if (invalidOpeningBatches.length > 0) {
      throw conflict('opening_batch_not_applied', 'Every linked OPENING_BALANCE batch must be APPLIED or already REVERSED before cutover reversal.', {
        cutoverBatchId: selectedBatchId,
        batchIds: invalidOpeningBatches.map((openingBatch) => openingBatch.id),
      });
    }
    const openingReversals = [];
    for (const openingBatch of linkedOpeningBatches) {
      if (openingBatch.status === 'REVERSED') continue;
      const openingResult = await reverseReconciliationBatch({
        id: openingBatch.id,
        payload: { reason: normalizeReason(payload.reason, 'Legacy Coning cutover reversal') },
        actorUserId,
        idempotencyKey: `${reverseOperationKey}:opening:${openingBatch.id}`,
        client,
      });
      openingReversals.push(unwrap(openingResult));
    }
    const result = await reverseReconciliationBatch({
      id: selectedBatchId,
      payload: { reason: normalizeReason(payload.reason, 'Legacy Coning cutover reversal') },
      actorUserId,
      idempotencyKey: reverseOperationKey,
      client,
    });
    let launchState = await readLaunchState(client);
    if (launchState?.status !== 'REVERSED' || !launchState.affectedWritesPaused) {
      launchState = await transitionLaunchState({ status: 'REVERSED', affectedWritesPaused: true, lastError: null, actorUserId, client });
    }
    await recordCutoverAudit(client, {
      action: 'reversed',
      actorUserId,
      payload: { batchId: selectedBatchId, idempotencyKey: key, affectedWritesPaused: true },
    });
    return { replay: Boolean(result?.replay), ...serialize(unwrap(result)), openingReversals: serialize(openingReversals), launchState: serialize(launchState) };
  } catch (error) {
    await markCutoverFailed({ actorUserId, error, adjustmentBatchId: selectedBatchId, client });
    throw error;
  }
}

export async function acceptCutoverRecovery({ batchId = null, payload = {}, actorUserId = null, idempotencyKey, client = prisma } = {}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const stored = await findCutoverAuditByIdempotencyKey(client, 'recovery_accepted', key);
  if (stored) return { replay: true, launchState: serialize(await readLaunchState(client)) };
  if (payload.ownerAccepted !== true && payload.confirm !== true) {
    throw badRequest('owner_acceptance_required', 'Explicit owner acceptance is required before legacy-compatible writes resume.');
  }

  const state = await readLaunchState(client);
  if (state?.status === 'REVERSED' && !state.affectedWritesPaused) {
    return { replay: true, launchState: serialize(state) };
  }
  if (state?.status !== 'REVERSED' || !state.affectedWritesPaused) {
    throw conflict('recovery_not_ready', 'Recovery acceptance is allowed only after append-only cutover reversal has completed while writes remain gated.', {
      status: state?.status || 'PREPARATION',
      affectedWritesPaused: Boolean(state?.affectedWritesPaused),
    });
  }

  const selectedBatchId = batchId || payload.batchId || state.adjustmentBatchId;
  if (!selectedBatchId) throw conflict('cutover_batch_required', 'A reversed LEGACY_CUTOVER batch is required before recovery acceptance.');
  const batch = await getReconciliationBatch(selectedBatchId, client);
  if (batch.kind !== LEGACY_CUTOVER_KIND || batch.status !== 'REVERSED') {
    throw conflict('recovery_not_ready', 'The selected LEGACY_CUTOVER batch has not been reversed.', { batchId: selectedBatchId, status: batch.status });
  }

  const launchState = await transitionLaunchState({
    status: 'PREPARATION',
    affectedWritesPaused: false,
    lastError: null,
    actorUserId,
    client,
  });
  await recordCutoverAudit(client, {
    action: 'recovery_accepted',
    actorUserId,
    payload: { batchId: selectedBatchId, idempotencyKey: key, ownerAccepted: true, affectedWritesPaused: false },
  });
  return { replay: false, launchState: serialize(launchState) };
}

export async function importCutoverOpeningBalances({
  payload = {},
  cutoverBatchId = null,
  openingBatchId = null,
  actorUserId = null,
  idempotencyKey,
  client = prisma,
} = {}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const selectedCutoverId = cutoverBatchId || payload.cutoverBatchId || null;
  const selectedOpeningId = openingBatchId || payload.openingBatchId || null;
  const importOperationKey = `packing-opening-balance:import:${key}`;
  const storedImportResult = await findIdempotentResult(client, 'reconciliation.batch.import_opening_balances', importOperationKey);
  if (storedImportResult !== undefined) {
    return { replay: true, ...serialize(storedImportResult), cutoverBatchId: selectedCutoverId };
  }
  const state = await readLaunchState(client);
  if (!state || !isAffectedWriteGated(state)) throw conflict('writes_gate_required', 'Opening balances may be imported only while affected writes are gated by the launch singleton.');

  if (!selectedCutoverId) throw conflict('cutover_batch_required', 'An already APPLIED LEGACY_CUTOVER batch must be supplied for opening-balance import.');
  const cutover = await getReconciliationBatch(selectedCutoverId, client);
  if (cutover.kind !== LEGACY_CUTOVER_KIND) throw conflict('invalid_cutover_batch_kind', 'The selected batch is not a LEGACY_CUTOVER batch.');
  if (cutover.status !== 'APPLIED') throw conflict('cutover_not_applied', 'The LEGACY_CUTOVER batch must be applied before opening balances are imported.');

  const openingBatchKey = `packing-opening-balance:batch:${key}`;
  const linkedOpeningBatches = await findLinkedOpeningBalanceBatches(client, selectedCutoverId);
  if (linkedOpeningBatches.length > 1) {
    throw conflict('multiple_opening_balance_batches', 'A LEGACY_CUTOVER may have exactly one linked OPENING_BALANCE batch.', { cutoverBatchId: selectedCutoverId, batchIds: linkedOpeningBatches.map((batch) => batch.id) });
  }
  let openingBatch = selectedOpeningId
    ? await findAdjustmentBatchHeader(client, selectedOpeningId)
    : (linkedOpeningBatches[0] || await findBatchByIdempotencyKey(client, openingBatchKey));
  if (openingBatch && openingBatch.kind !== OPENING_BALANCE_KIND) {
    throw conflict('invalid_opening_batch_kind', 'Opening-balance import requires a dedicated OPENING_BALANCE batch.', { batchId: openingBatch.id, kind: openingBatch.kind });
  }
  if (openingBatch && openingBatch.evidenceSnapshot?.cutoverBatchId !== selectedCutoverId) {
    throw conflict('opening_batch_not_linked', 'The OPENING_BALANCE batch must link to the already APPLIED LEGACY_CUTOVER batch.', { openingBatchId: openingBatch.id, cutoverBatchId: selectedCutoverId });
  }
  if (openingBatch?.status === 'APPLIED') {
    return { replay: true, batch: serialize(openingBatch), cutoverBatchId: selectedCutoverId };
  }
  if (openingBatch?.status === 'REVERSED') {
    throw conflict('opening_batch_already_reversed', 'The linked OPENING_BALANCE batch has already been reversed and cannot be reused.', { openingBatchId: openingBatch.id });
  }

  try {
    const evidenceSnapshot = {
      ...normalizeEvidence(payload.evidenceSnapshot),
      ...(selectedCutoverId ? { cutoverBatchId: selectedCutoverId } : {}),
      command: 'importPackingOpeningBalance',
      idempotencyKey: key,
    };
    if (!openingBatch) {
      // WP-02's importer atomically applies its target batch. Keep the
      // reversible LEGACY_CUTOVER batch immutable and link a separate
      // OPENING_BALANCE batch to it through the evidence snapshot.
      const createdResult = await createReconciliationBatch({
        payload: {
          kind: OPENING_BALANCE_KIND,
          reason: normalizeReason(payload.reason, 'Verified opening balance import'),
          effectiveAt: parseDate(payload.effectiveAt || new Date(), 'effectiveAt'),
          evidenceSnapshot,
        },
        actorUserId,
        idempotencyKey: openingBatchKey,
        client,
      });
      openingBatch = unwrap(createdResult);
    }
    if (openingBatch.status !== 'DRAFT') throw conflict('adjustment_not_draft', 'Opening-balance imports require a DRAFT adjustment batch.', { status: openingBatch.status });

    const importedResult = await importOpeningBalancesBatch({
      id: openingBatch.id,
      payload: {
        ...payload,
        evidenceSnapshot,
      },
      actorUserId,
      idempotencyKey: importOperationKey,
      client,
    });
    const imported = unwrap(importedResult);
    await recordCutoverAudit(client, {
      action: 'opening_balances_imported',
      actorUserId,
      payload: { cutoverBatchId: selectedCutoverId, openingBatchId: openingBatch.id, idempotencyKey: key },
    });
    return { replay: Boolean(importedResult?.replay), ...serialize(imported), cutoverBatchId: selectedCutoverId };
  } catch (error) {
    await markCutoverFailed({ actorUserId, error, adjustmentBatchId: cutover?.id || openingBatch?.id, client });
    throw error;
  }
}

export async function activateCutover({ batchId = null, payload = {}, actorUserId = null, idempotencyKey, client = prisma } = {}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const acceptedEvidence = await findCutoverAuditByIdempotencyKey(client, 'activation_evidence_accepted', key);
  const state = await readLaunchState(client);
  if (state?.status === 'ACTIVE' && !state.affectedWritesPaused) {
    if (acceptedEvidence) return { replay: true, launchState: serialize(state) };
    throw conflict('activation_evidence_missing', 'ACTIVE launch state has no durable accepted activation evidence for this operation.');
  }
  if (payload.ownerAccepted !== true && payload.confirm !== true) {
    throw badRequest('owner_acceptance_required', 'Explicit owner acceptance is required before affected writes are released.');
  }
  if (state?.status !== 'CUTOVER_APPLIED' || !state.affectedWritesPaused) throw conflict('cutover_not_ready_for_activation', 'Cutover must be applied and remain write-gated before it can become ACTIVE.', { status: state?.status || 'PREPARATION', affectedWritesPaused: Boolean(state?.affectedWritesPaused) });
  const selectedBatchId = batchId || state.adjustmentBatchId;
  if (!selectedBatchId) throw conflict('cutover_batch_required', 'An APPLIED LEGACY_CUTOVER batch is required before activation.');
  const batch = await getReconciliationBatch(selectedBatchId, client);
  if (batch.kind !== LEGACY_CUTOVER_KIND || batch.status !== 'APPLIED') throw conflict('cutover_not_ready_for_activation', 'The selected cutover batch is not APPLIED.');
  const linkedOpeningBatches = await findLinkedOpeningBalanceBatches(client, selectedBatchId);
  if (linkedOpeningBatches.length !== 1 || linkedOpeningBatches[0].status !== 'APPLIED') {
    throw conflict('opening_balance_import_required', 'Exactly one APPLIED OPENING_BALANCE batch linked to this cutover is required before activation.', {
      cutoverBatchId: selectedBatchId,
      linkedBatchIds: linkedOpeningBatches.map((openingBatch) => openingBatch.id),
      linkedBatchStatuses: linkedOpeningBatches.map((openingBatch) => openingBatch.status),
    });
  }

  const verifiedEvidence = await verifyActivationEvidence({ payload, client, cutoverBatchId: selectedBatchId });
  if (!acceptedEvidence) {
    await recordCutoverAudit(client, {
      action: 'activation_evidence_accepted',
      actorUserId,
      payload: {
        batchId: selectedBatchId,
        idempotencyKey: key,
        ownerAccepted: true,
        step10EvidenceComplete: true,
        evidence: verifiedEvidence.evidence,
        step10: verifiedEvidence.step10,
        verification: verifiedEvidence.verification,
      },
    });
  }
  const launchState = await transitionLaunchState({ status: 'ACTIVE', affectedWritesPaused: false, actorUserId, client });
  await recordCutoverAudit(client, {
    action: 'activated',
    actorUserId,
    payload: { batchId: selectedBatchId, idempotencyKey: key, ownerAccepted: true },
  });
  return { replay: false, launchState: serialize(launchState) };
}
