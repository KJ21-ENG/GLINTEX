import prisma from '../../lib/prisma.js';
import { jsonValue, normalizeString, toNumber } from '../packingReports/reportUtils.js';

const MAX_NODES = 240;
const MAX_CHILDREN_PER_BRANCH = 80;

function normalizeBarcode(value) {
  return normalizeString(value, 200).toUpperCase();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRowRefs(value) {
  return parseJsonArray(value).map((entry) => {
    if (entry && typeof entry === 'object') {
      return {
        rowId: entry.rowId || entry.id || entry.sourceRowId || null,
        barcode: entry.barcode || entry.sourceBarcode || null,
      };
    }
    return { rowId: String(entry || ''), barcode: null };
  }).filter((entry) => entry.rowId || entry.barcode);
}

function refWhere(refs) {
  const ids = Array.from(new Set(refs.map((ref) => ref.rowId).filter(Boolean)));
  const barcodes = Array.from(new Set(refs.map((ref) => ref.barcode).filter(Boolean)));
  const clauses = [];
  if (ids.length) clauses.push({ id: { in: ids } });
  if (barcodes.length) clauses.push({ barcode: { in: barcodes } });
  return clauses;
}

function createContext(client, options = {}) {
  return {
    client,
    maxNodes: Math.max(40, Math.min(MAX_NODES, Number(options.maxNodes) || MAX_NODES)),
    nodes: 0,
    visited: new Set(),
    ancestorVisited: new Set(),
    visitedBatches: new Set(),
    visitedUnits: new Set(),
    cache: {
      inbound: new Map(),
      cutterIssues: new Map(),
      cutterReceives: new Map(),
      holoIssues: new Map(),
      holoReceives: new Map(),
      coningIssues: new Map(),
      coningReceives: new Map(),
      packedUnits: new Map(),
      batches: new Map(),
    },
  };
}

function makeNode(ctx, stage, id, date, barcode, data = {}) {
  const nodeId = `${stage}:${id || barcode || `${ctx.nodes}`}`;
  if (ctx.visited.has(nodeId)) return null;
  if (ctx.nodes >= ctx.maxNodes) return createTruncationMarker(1, 'node_limit');
  ctx.visited.add(nodeId);
  ctx.nodes += 1;
  return {
    id: nodeId,
    stage,
    date: date || null,
    barcode: barcode || null,
    data,
    children: [],
  };
}

export function createTruncationMarker(hiddenCount = 1, reason = 'branch_limit') {
  return { truncated: true, hiddenCount: Math.max(1, Number(hiddenCount) || 1), reason };
}

export function addChild(parent, child) {
  if (!parent || !child || parent.truncated) return;
  if (parent.children.length >= MAX_CHILDREN_PER_BRANCH) {
    if (!parent.children.some((entry) => entry.truncated)) parent.children.push(createTruncationMarker(1, 'children_limit'));
    return;
  }
  parent.children.push(child);
}

function markTruncatedIfNeeded(parent, hadMore) {
  if (hadMore && parent && !parent.truncated && !parent.children.some((entry) => entry.truncated)) {
    parent.children.push(createTruncationMarker(1, 'query_limit'));
  }
}

function nodeWeight(node) {
  return node?.netWeightKg ?? node?.netWeight ?? node?.weight ?? node?.totalWeight ?? null;
}

export function dispatchEventNodeData(event, line = {}) {
  return {
    dispatchEventId: event?.id || null,
    eventType: event?.type || null,
    reason: event?.reason || null,
    payload: jsonValue(event?.payload, {}),
    reversalOfEventId: event?.reversalOfEventId || null,
    idempotencyKey: event?.idempotencyKey || null,
    actorUserId: event?.actorUserId || null,
    lineId: line.id || null,
    challanId: line.challanId || null,
  };
}

export function computeStats(root) {
  const stats = { totalNodes: 0, totalBranches: 0, maxDepth: 0, truncated: false, truncatedNodes: 0, stageBreakdown: {} };
  const visit = (node, depth) => {
    if (!node) return;
    if (node.truncated) {
      stats.truncated = true;
      stats.truncatedNodes += Math.max(1, Number(node.hiddenCount) || 1);
      return;
    }
    stats.totalNodes += 1;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.stageBreakdown[node.stage] = (stats.stageBreakdown[node.stage] || 0) + 1;
    const children = node.children || [];
    const normalChildren = children.filter((child) => !child?.truncated);
    if (normalChildren.length > 1) stats.totalBranches += normalChildren.length - 1;
    children.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 1);
  return stats;
}

function flattenTree(root) {
  const rows = [];
  const visit = (node) => {
    if (!node || node.truncated) return;
    rows.push({
      id: node.id,
      stage: node.stage,
      date: node.date,
      barcode: node.barcode,
      data: node.data,
    });
    (node.children || []).forEach(visit);
  };
  visit(root);
  return rows;
}

async function findUniqueActiveByBarcode(client, model, barcode) {
  if (!barcode) return null;
  const row = await client[model].findUnique({ where: { barcode } });
  return row && row.isDeleted !== true ? row : null;
}

async function findLegacyDispatches(ctx, parent, barcode, stage) {
  if (!barcode) return;
  const rows = await ctx.client.dispatch.findMany({
    where: { stage, stageBarcode: barcode },
    include: { customer: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const dispatch of rows) {
    const child = makeNode(ctx, 'dispatch', dispatch.id, dispatch.createdAt || dispatch.date, dispatch.stageBarcode, {
      dispatchId: dispatch.id,
      challanNo: dispatch.challanNo,
      customerName: dispatch.customer?.name || null,
      sourceStage: dispatch.stage,
      weight: toNumber(dispatch.weight),
      count: dispatch.count,
      notes: dispatch.notes || null,
      legacy: true,
    });
    addChild(parent, child);
  }
}

async function findV2Dispatches(ctx, parent, { sourceType, sourceId, sourceBarcode, packedUnitId }) {
  const or = [];
  if (sourceType && sourceId) or.push({ sourceType, sourceId });
  if (sourceType && sourceBarcode) or.push({ sourceType, sourceBarcode });
  if (packedUnitId) or.push({ parentPackedUnitId: packedUnitId });
  if (!or.length) return;
  const rows = await ctx.client.dispatchLine.findMany({
    where: { OR: or },
    include: {
      challan: { select: { id: true, challanNo: true, businessDate: true, status: true, isLegacyReconstruction: true, customer: { select: { name: true } } } },
      events: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, reason: true, payload: true, reversalOfEventId: true, idempotencyKey: true, actorUserId: true, createdAt: true },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const line of rows) {
    const child = makeNode(ctx, 'dispatch_v2', line.id, line.challan?.businessDate || line.createdAt, line.sourceBarcode, {
      dispatchLineId: line.id,
      challanId: line.challanId,
      challanNo: line.challan?.challanNo || null,
      challanStatus: line.challan?.status || null,
      customerName: line.challan?.customer?.name || null,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sourceBarcode: line.sourceBarcode || null,
      sourceDisplaySnapshot: jsonValue(line.sourceDisplaySnapshot, {}),
      baseCount: line.baseCount,
      netWeightKg: toNumber(line.netWeightKg),
      parentPackedUnitId: line.parentPackedUnitId || null,
      isLegacyReconstruction: line.challan?.isLegacyReconstruction || false,
    });
    addChild(parent, child);
    for (const event of line.events || []) {
      addChild(child, makeNode(ctx, 'dispatch_event', event.id, event.createdAt, line.sourceBarcode, dispatchEventNodeData(event, line)));
    }
  }
}

async function findAdjustmentLines(ctx, parent, { sourceId, sourceBarcode, replacementUnitId }) {
  const or = [];
  if (sourceId) or.push({ sourceId });
  if (sourceBarcode) or.push({ sourceBarcode });
  if (replacementUnitId) or.push({ replacementUnitId });
  if (!or.length) return;
  const rows = await ctx.client.inventoryAdjustmentLine.findMany({
    where: { OR: or },
    include: { batch: { select: { id: true, batchNo: true, kind: true, status: true, effectiveAt: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const line of rows) {
    const child = makeNode(ctx, 'inventory_adjustment', line.id, line.batch?.effectiveAt || line.createdAt, line.sourceBarcode, {
      adjustmentLineId: line.id,
      adjustmentBatchId: line.batchId,
      batchNo: line.batch?.batchNo || null,
      kind: line.batch?.kind || null,
      status: line.batch?.status || null,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      countDelta: line.countDelta,
      weightDeltaKg: toNumber(line.weightDeltaKg),
      replacementSourceId: line.replacementSourceId || null,
      replacementUnitId: line.replacementUnitId || null,
      sourceItemSnapshot: jsonValue(line.sourceItemSnapshot, {}),
      sourceLotSnapshot: jsonValue(line.sourceLotSnapshot, {}),
      sourceConeSnapshot: jsonValue(line.sourceConeSnapshot, {}),
    });
    addChild(parent, child);
  }
}

async function addPackedUnitEvents(ctx, parent, unitId) {
  const events = await ctx.client.packedUnitEvent.findMany({
    where: { unitId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
    select: { id: true, type: true, reason: true, payload: true, createdAt: true },
  });
  for (const event of events) {
    const child = makeNode(ctx, 'packing_event', event.id, event.createdAt, null, {
      eventType: event.type,
      reason: event.reason || null,
      payload: jsonValue(event.payload, {}),
    });
    addChild(parent, child);
  }
}

async function fetchPackedUnit(ctx, id) {
  if (!id) return null;
  if (ctx.cache.packedUnits.has(id)) return ctx.cache.packedUnits.get(id);
  const unit = await ctx.client.packedUnit.findUnique({
    where: { id },
    include: {
      batch: { select: { id: true, batchNo: true, kind: true, status: true, deliveryMode: true, customerId: true } },
      recipe: { select: { familyKey: true, version: true, deliveryMode: true } },
      packageType: { select: { name: true, kind: true } },
      parentUnit: { select: { id: true, barcode: true, packageType: { select: { name: true, kind: true } }, status: true } },
      item: { select: { name: true } },
      wrapper: { select: { name: true } },
      color: { select: { name: true } },
      coneType: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  ctx.cache.packedUnits.set(id, unit || null);
  return unit;
}

async function buildPackedUnitNode(ctx, unit, options = {}) {
  if (!unit) return null;
  const node = makeNode(ctx, 'packed_unit', unit.id, unit.sealedAt || unit.createdAt, unit.barcode, {
    unitId: unit.id,
    batchNo: unit.batch?.batchNo || null,
    packageKind: unit.packageType?.kind || null,
    packageTypeName: unit.packageType?.name || null,
    levelIndex: unit.levelIndex,
    isStockUnit: unit.isStockUnit,
    status: unit.status,
    itemName: unit.item?.name || null,
    brandName: unit.wrapper?.name || null,
    colorName: unit.color?.name || null,
    coneTypeName: unit.coneType?.name || null,
    customerName: unit.customer?.name || null,
    baseCount: unit.baseCount,
    grossWeightKg: toNumber(unit.grossWeightKg),
    tareWeightKg: toNumber(unit.tareWeightKg),
    netWeightKg: toNumber(unit.netWeightKg),
    parentUnitId: unit.parentUnitId || null,
    splitFromUnitId: unit.splitFromUnitId || null,
    replacedByUnitId: unit.replacedByUnitId || null,
  });
  if (!node) return null;
  if (options.includeEvents !== false) await addPackedUnitEvents(ctx, node, unit.id);
  await findV2Dispatches(ctx, node, { sourceType: 'PACKED', sourceId: unit.id, sourceBarcode: unit.barcode, packedUnitId: unit.id });
  await findAdjustmentLines(ctx, node, { sourceId: unit.id, sourceBarcode: unit.barcode, replacementUnitId: unit.id });
  return node;
}

async function buildPackedHierarchy(ctx, unit) {
  const node = await buildPackedUnitNode(ctx, unit);
  if (!node || !unit.parentUnitId) return node;
  const parent = await fetchPackedUnit(ctx, unit.parentUnitId);
  if (!parent) return node;
  const parentNode = await buildPackedUnitNode(ctx, parent);
  if (!parentNode) return node;
  addChild(parentNode, node);
  return parentNode;
}

async function fetchBatch(ctx, id) {
  if (!id) return null;
  if (ctx.cache.batches.has(id)) return ctx.cache.batches.get(id);
  const batch = await ctx.client.packingBatch.findUnique({
    where: { id },
    include: {
      recipe: { select: { familyKey: true, version: true, deliveryMode: true, stockUnitLevelIndex: true } },
      customer: { select: { name: true } },
      sources: true,
    },
  });
  ctx.cache.batches.set(id, batch || null);
  return batch;
}

async function buildBatchNode(ctx, batch, options = {}) {
  if (!batch || ctx.visitedBatches.has(batch.id)) return null;
  ctx.visitedBatches.add(batch.id);
  const node = makeNode(ctx, 'packing_batch', batch.id, batch.completedAt || batch.createdAt, batch.batchNo, {
    batchId: batch.id,
    batchNo: batch.batchNo,
    kind: batch.kind,
    status: batch.status,
    recipeFamilyKey: batch.recipe?.familyKey || null,
    recipeVersion: batch.recipe?.version || null,
    deliveryMode: batch.deliveryMode,
    customerName: batch.customer?.name || null,
    plannedBaseCount: batch.plannedBaseCount,
    plannedNetWeightKg: toNumber(batch.plannedNetWeightKg),
    targetAmendmentReason: batch.targetAmendmentReason || null,
    shortCloseReason: batch.shortCloseReason || null,
    voidReason: batch.voidReason || null,
  });
  if (!node) return null;

  for (const source of (batch.sources || []).slice(0, MAX_CHILDREN_PER_BRANCH)) {
    if (source.sourceType === 'CONING_RECEIVE') {
      const receive = await fetchConingReceive(ctx, source.sourceId);
      if (receive) {
        const origin = await buildConingOrigin(ctx, receive, { skipBatchId: batch.id });
        addChild(node, origin || await buildConingReceiveNode(ctx, receive, { skipPacking: true }));
      } else {
        addChild(node, makeNode(ctx, 'packing_source', source.id, source.createdAt, source.sourceBarcode, {
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceBarcode: source.sourceBarcode || null,
          reservedBaseCount: source.reservedBaseCount,
          reservedNetWeightKg: toNumber(source.reservedNetWeightKg),
        }));
      }
    } else if (source.sourceType === 'PACKED_UNIT') {
      const sourceUnit = await fetchPackedUnit(ctx, source.sourceId);
      if (sourceUnit) {
        const sourceNode = await buildPackedUnitNode(ctx, sourceUnit);
        addChild(node, sourceNode);
        if (sourceUnit.batchId && sourceUnit.batchId !== batch.id && !ctx.visitedBatches.has(sourceUnit.batchId)) {
          const sourceBatch = await fetchBatch(ctx, sourceUnit.batchId);
          addChild(node, await buildBatchNode(ctx, sourceBatch));
        }
      }
    }
  }

  let outputUnits = [];
  if (options.focusUnitId) {
    const focused = await fetchPackedUnit(ctx, options.focusUnitId);
    if (focused) outputUnits = [focused];
  } else {
    outputUnits = await ctx.client.packedUnit.findMany({
      where: { batchId: batch.id, status: { not: 'VOIDED' }, isStockUnit: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_CHILDREN_PER_BRANCH,
      include: {
        batch: { select: { id: true, batchNo: true, kind: true, status: true, deliveryMode: true, customerId: true } },
        recipe: { select: { familyKey: true, version: true, deliveryMode: true } },
        packageType: { select: { name: true, kind: true } },
        parentUnit: { select: { id: true, barcode: true, packageType: { select: { name: true, kind: true } }, status: true } },
        item: { select: { name: true } },
        wrapper: { select: { name: true } },
        color: { select: { name: true } },
        coneType: { select: { name: true } },
        customer: { select: { name: true } },
      },
    });
  }
  for (const unit of outputUnits) addChild(node, await buildPackedHierarchy(ctx, unit));
  const events = await ctx.client.packedUnitEvent.findMany({
    where: { batchId: batch.id, unitId: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
    select: { id: true, type: true, reason: true, payload: true, createdAt: true },
  });
  for (const event of events) {
    addChild(node, makeNode(ctx, 'packing_event', event.id, event.createdAt, null, {
      eventType: event.type,
      reason: event.reason || null,
      payload: jsonValue(event.payload, {}),
    }));
  }
  return node;
}

async function fetchConingReceive(ctx, id) {
  if (!id) return null;
  if (ctx.cache.coningReceives.has(id)) return ctx.cache.coningReceives.get(id);
  const row = await ctx.client.receiveFromConingMachineRow.findUnique({
    where: { id },
    include: { issue: { include: { machine: true, operator: true, yarn: true, twist: true, cut: true } }, operator: true, box: true },
  });
  ctx.cache.coningReceives.set(id, row || null);
  return row;
}

async function fetchHoloReceive(ctx, id) {
  if (!id) return null;
  if (ctx.cache.holoReceives.has(id)) return ctx.cache.holoReceives.get(id);
  const row = await ctx.client.receiveFromHoloMachineRow.findUnique({
    where: { id },
    include: { issue: { include: { machine: true, operator: true, yarn: true, twist: true, cut: true } }, operator: true, rollType: true, box: true },
  });
  ctx.cache.holoReceives.set(id, row || null);
  return row;
}

async function fetchCutterReceive(ctx, id) {
  if (!id) return null;
  if (ctx.cache.cutterReceives.has(id)) return ctx.cache.cutterReceives.get(id);
  const row = await ctx.client.receiveFromCutterMachineRow.findUnique({
    where: { id },
    include: { issue: { include: { machine: true, operator: true, cut: true } }, bobbin: true, box: true, operator: true, helper: true, challan: true },
  });
  ctx.cache.cutterReceives.set(id, row || null);
  return row;
}

async function referencedIssueIds(ctx, stage, refs) {
  const ids = Array.from(new Set(refs.map((ref) => ref.rowId).filter(Boolean)));
  const barcodes = Array.from(new Set(refs.map((ref) => ref.barcode).filter(Boolean)));
  if (!ids.length && !barcodes.length) return [];
  const idParam = ids.length ? ids : ['__none__'];
  const barcodeParam = barcodes.length ? barcodes : ['__none__'];
  let rows;
  if (stage === 'holo') {
    rows = await ctx.client.$queryRaw`
      SELECT "id" FROM "IssueToHoloMachine"
      WHERE "isDeleted" = false
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
          WHERE elem->>'rowId' = ANY(${idParam}::text[])
             OR elem->>'id' = ANY(${idParam}::text[])
             OR elem->>'barcode' = ANY(${barcodeParam}::text[])
        )
      ORDER BY "createdAt" ASC
    `;
  } else {
    rows = await ctx.client.$queryRaw`
      SELECT "id" FROM "IssueToConingMachine"
      WHERE "isDeleted" = false
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
          WHERE elem->>'rowId' = ANY(${idParam}::text[])
             OR elem->>'id' = ANY(${idParam}::text[])
             OR elem->>'barcode' = ANY(${barcodeParam}::text[])
        )
      ORDER BY "createdAt" ASC
    `;
  }
  return rows.map((row) => row.id).filter(Boolean);
}

async function referencedReceiveRows(ctx, stage, refs) {
  const clauses = refWhere(refs);
  if (!clauses.length) return [];
  if (stage === 'holo') {
    return ctx.client.receiveFromHoloMachineRow.findMany({
      where: { isDeleted: false, OR: clauses },
      include: { issue: { include: { machine: true, operator: true, yarn: true, twist: true, cut: true } }, operator: true, rollType: true, box: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_CHILDREN_PER_BRANCH,
    });
  }
  return ctx.client.receiveFromCutterMachineRow.findMany({
    where: { isDeleted: false, OR: clauses },
    include: { issue: { include: { machine: true, operator: true, cut: true } }, bobbin: true, box: true, operator: true, helper: true, challan: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
}

async function coningIssuesForHoloReceive(ctx, receive) {
  const ids = await referencedIssueIds(ctx, 'coning', [{ rowId: receive.id, barcode: receive.barcode }]);
  if (!ids.length) return [];
  return ctx.client.issueToConingMachine.findMany({
    where: { id: { in: ids }, isDeleted: false },
    include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function holoIssuesForCutterReceive(ctx, receive) {
  const ids = await referencedIssueIds(ctx, 'holo', [{ rowId: receive.id, barcode: receive.barcode }]);
  if (!ids.length) return [];
  return ctx.client.issueToHoloMachine.findMany({
    where: { id: { in: ids }, isDeleted: false },
    include: { machine: true, operator: true, yarn: true, twist: true, cut: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function buildInboundNode(ctx, item) {
  if (!item) return null;
  if (ctx.cache.inbound.has(item.id)) return ctx.cache.inbound.get(item.id);
  const lot = item.lotNo ? await ctx.client.lot.findUnique({ where: { lotNo: item.lotNo }, include: { item: true, firm: true, supplier: true } }) : null;
  const node = makeNode(ctx, 'inbound', item.id, lot?.date || item.createdAt, item.barcode, {
    pieceId: item.id,
    lotNo: item.lotNo,
    itemName: lot?.item?.name || null,
    firmName: lot?.firm?.name || null,
    supplierName: lot?.supplier?.name || null,
    weight: toNumber(item.weight),
    status: item.status,
    isOpeningStock: item.isOpeningStock,
    dispatchedWeight: toNumber(item.dispatchedWeight),
  });
  ctx.cache.inbound.set(item.id, node);
  if (!node) return null;
  const issues = await ctx.client.issueToCutterMachine.findMany({
    where: { pieceIds: { contains: item.id }, isDeleted: false },
    include: { machine: true, operator: true, cut: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const issue of issues) addChild(node, await buildCutterIssueNode(ctx, issue));
  await findLegacyDispatches(ctx, node, item.barcode, 'inbound');
  await findV2Dispatches(ctx, node, { sourceType: 'INBOUND', sourceId: item.id, sourceBarcode: item.barcode });
  await findAdjustmentLines(ctx, node, { sourceId: item.id, sourceBarcode: item.barcode });
  return node;
}

async function buildCutterIssueNode(ctx, issue) {
  if (!issue) return null;
  const node = makeNode(ctx, 'cutter_issue', issue.id, issue.date || issue.createdAt, issue.barcode, {
    issueId: issue.id,
    lotNo: issue.lotNo,
    itemId: issue.itemId,
    machineName: issue.machine?.name || null,
    operatorName: issue.operator?.name || null,
    cutName: issue.cut?.name || null,
    pieceCount: issue.count,
    totalWeight: toNumber(issue.totalWeight),
  });
  if (!node) return null;
  const rows = await ctx.client.receiveFromCutterMachineRow.findMany({
    where: { OR: [{ issueId: issue.id }, { pieceId: { in: String(issue.pieceIds || '').split(',').map((entry) => entry.trim()).filter(Boolean) } }], isDeleted: false },
    include: { bobbin: true, box: true, operator: true, helper: true, challan: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const row of rows) addChild(node, await buildCutterReceiveNode(ctx, row));
  await findLegacyDispatches(ctx, node, issue.barcode, 'cutter');
  await findV2Dispatches(ctx, node, { sourceType: 'CUTTER', sourceId: issue.id, sourceBarcode: issue.barcode });
  return node;
}

async function buildCutterReceiveNode(ctx, row) {
  if (!row) return null;
  const node = makeNode(ctx, 'cutter_receive', row.id, row.date || row.createdAt, row.barcode || row.vchNo, {
    receiveId: row.id,
    vchNo: row.vchNo,
    bobbinQuantity: row.bobbinQuantity,
    netWeight: toNumber(row.netWt),
    itemName: row.itemName || null,
    yarnName: row.yarnName || null,
    cutName: row.cut || row.cutMaster?.name || null,
    machineNo: row.machineNo || null,
    operatorName: row.operator?.name || null,
    helperName: row.helper?.name || null,
    dispatchedWeight: toNumber(row.dispatchedWeight),
    issuedToHoloWeight: toNumber(row.issuedBobbinWeight),
  });
  if (!node) return null;
  const issues = await holoIssuesForCutterReceive(ctx, row);
  for (const issue of issues) addChild(node, await buildHoloIssueNode(ctx, issue));
  await findLegacyDispatches(ctx, node, row.barcode || row.vchNo, 'cutter');
  await findV2Dispatches(ctx, node, { sourceType: 'CUTTER', sourceId: row.id, sourceBarcode: row.barcode || row.vchNo });
  return node;
}

async function buildHoloIssueNode(ctx, issue) {
  if (!issue) return null;
  const node = makeNode(ctx, 'holo_issue', issue.id, issue.date || issue.createdAt, issue.barcode, {
    issueId: issue.id,
    lotNo: issue.lotNo,
    machineName: issue.machine?.name || null,
    operatorName: issue.operator?.name || null,
    yarnName: issue.yarn?.name || null,
    twistName: issue.twist?.name || null,
    cutName: issue.cut?.name || null,
    yarnKg: toNumber(issue.yarnKg),
    shift: issue.shift || null,
    rollsProducedEstimate: issue.rollsProducedEstimate,
  });
  if (!node) return null;
  const rows = await ctx.client.receiveFromHoloMachineRow.findMany({
    where: { issueId: issue.id, isDeleted: false },
    include: { operator: true, rollType: true, box: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const row of rows) addChild(node, await buildHoloReceiveNode(ctx, row));
  await findLegacyDispatches(ctx, node, issue.barcode, 'holo');
  await findV2Dispatches(ctx, node, { sourceType: 'HOLO', sourceId: issue.id, sourceBarcode: issue.barcode });
  return node;
}

async function buildHoloReceiveNode(ctx, row) {
  if (!row) return null;
  const netWeight = row.rollWeight ?? ((row.grossWeight || 0) - (row.tareWeight || 0));
  const node = makeNode(ctx, 'holo_receive', row.id, row.date || row.createdAt, row.barcode, {
    receiveId: row.id,
    rollCount: row.rollCount,
    netWeight: toNumber(netWeight),
    rollTypeName: row.rollType?.name || null,
    operatorName: row.operator?.name || null,
    boxName: row.box?.name || null,
    dispatchedWeight: toNumber(row.dispatchedWeight),
  });
  if (!node) return null;
  const issues = await coningIssuesForHoloReceive(ctx, row);
  for (const issue of issues) addChild(node, await buildConingIssueNode(ctx, issue));
  await findLegacyDispatches(ctx, node, row.barcode, 'holo');
  await findV2Dispatches(ctx, node, { sourceType: 'HOLO', sourceId: row.id, sourceBarcode: row.barcode });
  return node;
}

async function buildConingIssueNode(ctx, issue) {
  if (!issue) return null;
  const node = makeNode(ctx, 'coning_issue', issue.id, issue.date || issue.createdAt, issue.barcode, {
    issueId: issue.id,
    lotNo: issue.lotNo,
    machineName: issue.machine?.name || null,
    operatorName: issue.operator?.name || null,
    yarnName: issue.yarn?.name || null,
    twistName: issue.twist?.name || null,
    cutName: issue.cut?.name || null,
    yarnKg: toNumber(issue.requiredPerConeNetWeight),
    rollsIssued: issue.rollsIssued,
    expectedCones: issue.expectedCones,
    shift: issue.shift || null,
  });
  if (!node) return null;
  const rows = await ctx.client.receiveFromConingMachineRow.findMany({
    where: { issueId: issue.id, isDeleted: false },
    include: { operator: true, box: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const row of rows) addChild(node, await buildConingReceiveNode(ctx, row));
  await findLegacyDispatches(ctx, node, issue.barcode, 'coning');
  return node;
}

async function buildConingReceiveNode(ctx, row, options = {}) {
  if (!row) return null;
  const node = makeNode(ctx, 'coning_receive', row.id, row.date || row.createdAt, row.barcode, {
    receiveId: row.id,
    coneCount: row.coneCount,
    coneWeight: toNumber(row.coneWeight),
    netWeight: toNumber(row.netWeight),
    operatorName: row.operator?.name || null,
    boxName: row.box?.name || null,
    isOpeningStock: row.isOpeningStock,
    dispatchedWeight: toNumber(row.dispatchedWeight),
    dispatchedCount: row.dispatchedCount,
  });
  if (!node) return null;
  if (!options.skipPacking) await addPackingBatchesForConingReceive(ctx, node, row);
  await findLegacyDispatches(ctx, node, row.barcode, 'coning');
  await findAdjustmentLines(ctx, node, { sourceId: row.id, sourceBarcode: row.barcode });
  return node;
}

async function addPackingBatchesForConingReceive(ctx, parent, row) {
  const sources = await ctx.client.packingBatchSource.findMany({
    where: { sourceType: 'CONING_RECEIVE', sourceId: row.id },
    include: {
      batch: {
        include: {
          recipe: { select: { familyKey: true, version: true, deliveryMode: true, stockUnitLevelIndex: true } },
          customer: { select: { name: true } },
          sources: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_CHILDREN_PER_BRANCH,
  });
  for (const source of sources) {
    if (source.batch?.id && source.batch.id === ctx.skipBatchId) continue;
    addChild(parent, await buildBatchNode(ctx, source.batch, { focusUnitId: null }));
  }
}

async function resolveInboundAncestor(ctx, type, entity) {
  if (!entity) return null;
  const key = `${type}:${entity.id || entity.barcode || entity.vchNo || ''}`;
  if (ctx.ancestorVisited.has(key)) return null;
  ctx.ancestorVisited.add(key);
  if (type === 'inbound') return entity;
  if (type === 'cutter_receive') return entity.pieceId ? ctx.client.inboundItem.findUnique({ where: { id: entity.pieceId } }) : null;
  if (type === 'cutter_issue') {
    const pieceId = String(entity.pieceIds || '').split(',').map((value) => value.trim()).find(Boolean);
    return pieceId ? ctx.client.inboundItem.findUnique({ where: { id: pieceId } }) : null;
  }
  if (type === 'holo_receive') {
    const issue = entity.issueId ? await ctx.client.issueToHoloMachine.findUnique({ where: { id: entity.issueId }, select: { receivedRowRefs: true } }) : null;
    const rows = issue ? await referencedReceiveRows(ctx, 'cutter', normalizeRowRefs(issue.receivedRowRefs)) : [];
    return rows.length ? resolveInboundAncestor(ctx, 'cutter_receive', rows[0]) : null;
  }
  if (type === 'holo_issue') {
    const rows = await referencedReceiveRows(ctx, 'cutter', normalizeRowRefs(entity.receivedRowRefs));
    return rows.length ? resolveInboundAncestor(ctx, 'cutter_receive', rows[0]) : null;
  }
  if (type === 'coning_receive') {
    const issue = entity.issueId ? await ctx.client.issueToConingMachine.findUnique({ where: { id: entity.issueId }, select: { receivedRowRefs: true } }) : null;
    const rows = issue ? await referencedReceiveRows(ctx, 'holo', normalizeRowRefs(issue.receivedRowRefs)) : [];
    return rows.length ? resolveInboundAncestor(ctx, 'holo_receive', rows[0]) : null;
  }
  if (type === 'coning_issue') {
    const rows = await referencedReceiveRows(ctx, 'holo', normalizeRowRefs(entity.receivedRowRefs));
    return rows.length ? resolveInboundAncestor(ctx, 'holo_receive', rows[0]) : null;
  }
  return null;
}

async function buildConingOrigin(ctx, receive, { skipBatchId = null } = {}) {
  const ancestor = await resolveInboundAncestor(ctx, 'coning_receive', receive);
  if (ancestor) {
    const previous = ctx.skipBatchId;
    ctx.skipBatchId = skipBatchId;
    const node = await buildInboundNode(ctx, ancestor);
    ctx.skipBatchId = previous;
    return node;
  }
  const issue = receive.issue || (receive.issueId ? await ctx.client.issueToConingMachine.findUnique({ where: { id: receive.issueId }, include: { machine: true, operator: true, yarn: true, twist: true, cut: true } }) : null);
  if (issue) {
    const previous = ctx.skipBatchId;
    ctx.skipBatchId = skipBatchId;
    const node = await buildConingIssueNode(ctx, issue);
    ctx.skipBatchId = previous;
    return node;
  }
  return buildConingReceiveNode(ctx, receive, { skipPacking: true });
}

async function buildPackedRoot(ctx, unit) {
  const batch = await fetchBatch(ctx, unit.batchId);
  if (!batch) return buildPackedHierarchy(ctx, unit);
  return buildBatchNode(ctx, batch, { focusUnitId: unit.id });
}

async function findRootByBarcode(ctx, barcode) {
  const packed = await findUniqueActiveByBarcode(ctx.client, 'packedUnit', barcode);
  if (packed) return { type: 'packed_unit', entity: await fetchPackedUnit(ctx, packed.id), resolvedBarcode: packed.barcode, searchedStage: 'packed_unit' };

  const coningReceive = await findUniqueActiveByBarcode(ctx.client, 'receiveFromConingMachineRow', barcode);
  if (coningReceive) return { type: 'coning_receive', entity: await fetchConingReceive(ctx, coningReceive.id), resolvedBarcode: coningReceive.barcode, searchedStage: 'coning_receive' };
  const coningIssue = await findUniqueActiveByBarcode(ctx.client, 'issueToConingMachine', barcode);
  if (coningIssue) return { type: 'coning_issue', entity: coningIssue, resolvedBarcode: coningIssue.barcode, searchedStage: 'coning_issue' };

  const holoReceive = await findUniqueActiveByBarcode(ctx.client, 'receiveFromHoloMachineRow', barcode);
  if (holoReceive) return { type: 'holo_receive', entity: await fetchHoloReceive(ctx, holoReceive.id), resolvedBarcode: holoReceive.barcode, searchedStage: 'holo_receive' };
  const holoIssue = await findUniqueActiveByBarcode(ctx.client, 'issueToHoloMachine', barcode);
  if (holoIssue) return { type: 'holo_issue', entity: holoIssue, resolvedBarcode: holoIssue.barcode, searchedStage: 'holo_issue' };

  const cutterReceiveInclude = { issue: { include: { machine: true, operator: true, cut: true } }, bobbin: true, box: true, operator: true, helper: true, challan: true };
  const cutterReceiveByBarcode = await ctx.client.receiveFromCutterMachineRow.findFirst({
    where: { isDeleted: false, barcode },
    include: cutterReceiveInclude,
  });
  const cutterReceive = cutterReceiveByBarcode || await ctx.client.receiveFromCutterMachineRow.findUnique({
    where: { vchNo: barcode },
    include: cutterReceiveInclude,
  });
  if (cutterReceive) return { type: 'cutter_receive', entity: cutterReceive, resolvedBarcode: cutterReceive.barcode || cutterReceive.vchNo, searchedStage: 'cutter_receive' };
  const cutterIssue = await findUniqueActiveByBarcode(ctx.client, 'issueToCutterMachine', barcode);
  if (cutterIssue) return { type: 'cutter_issue', entity: cutterIssue, resolvedBarcode: cutterIssue.barcode, searchedStage: 'cutter_issue' };

  const inbound = await findUniqueActiveByBarcode(ctx.client, 'inboundItem', barcode);
  if (inbound) return { type: 'inbound', entity: inbound, resolvedBarcode: inbound.barcode, searchedStage: 'inbound' };

  const adjustment = await ctx.client.inventoryAdjustmentLine.findFirst({
    where: { sourceBarcode: barcode },
    include: { batch: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (adjustment) return { type: 'inventory_adjustment', entity: adjustment, resolvedBarcode: adjustment.sourceBarcode, searchedStage: 'inventory_adjustment' };

  const line = await ctx.client.dispatchLine.findFirst({
    where: { sourceBarcode: barcode },
    include: {
      challan: { select: { id: true, challanNo: true, businessDate: true, status: true, isLegacyReconstruction: true, customer: { select: { name: true } } } },
      events: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, reason: true, payload: true, reversalOfEventId: true, idempotencyKey: true, actorUserId: true, createdAt: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (line) return { type: 'dispatch_v2', entity: line, resolvedBarcode: line.sourceBarcode, searchedStage: 'dispatch_v2' };

  const legacy = await ctx.client.dispatch.findFirst({
    where: { stageBarcode: barcode },
    include: { customer: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (legacy) return { type: 'dispatch', entity: legacy, resolvedBarcode: legacy.stageBarcode, searchedStage: 'dispatch' };
  return null;
}

async function buildRoot(ctx, found) {
  if (!found) return null;
  if (found.type === 'packed_unit') return buildPackedRoot(ctx, found.entity);
  if (found.type === 'inbound') return buildInboundNode(ctx, found.entity);
  if (found.type === 'cutter_issue') {
    const ancestor = await resolveInboundAncestor(ctx, found.type, found.entity);
    return ancestor ? buildInboundNode(ctx, ancestor) : buildCutterIssueNode(ctx, found.entity);
  }
  if (found.type === 'cutter_receive') {
    const ancestor = await resolveInboundAncestor(ctx, found.type, found.entity);
    return ancestor ? buildInboundNode(ctx, ancestor) : buildCutterReceiveNode(ctx, found.entity);
  }
  if (found.type === 'holo_issue') {
    const ancestor = await resolveInboundAncestor(ctx, found.type, found.entity);
    return ancestor ? buildInboundNode(ctx, ancestor) : buildHoloIssueNode(ctx, found.entity);
  }
  if (found.type === 'holo_receive') {
    const ancestor = await resolveInboundAncestor(ctx, found.type, found.entity);
    return ancestor ? buildInboundNode(ctx, ancestor) : buildHoloReceiveNode(ctx, found.entity);
  }
  if (found.type === 'coning_issue') {
    const ancestor = await resolveInboundAncestor(ctx, found.type, found.entity);
    return ancestor ? buildInboundNode(ctx, ancestor) : buildConingIssueNode(ctx, found.entity);
  }
  if (found.type === 'coning_receive') return buildConingOrigin(ctx, found.entity);
  if (found.type === 'dispatch_v2') {
    const line = found.entity;
    if (line.sourceType === 'PACKED') {
      const unit = await fetchPackedUnit(ctx, line.sourceId);
      if (unit) return buildPackedRoot(ctx, unit);
    }
    if (line.sourceType === 'INBOUND') {
      const item = await ctx.client.inboundItem.findUnique({ where: { id: line.sourceId } });
      if (item) return buildInboundNode(ctx, item);
    }
    if (line.sourceType === 'CUTTER') {
      const row = await fetchCutterReceive(ctx, line.sourceId);
      if (row) return buildRoot(ctx, { type: 'cutter_receive', entity: row });
    }
    if (line.sourceType === 'HOLO') {
      const row = await fetchHoloReceive(ctx, line.sourceId);
      if (row) return buildRoot(ctx, { type: 'holo_receive', entity: row });
    }
    const root = makeNode(ctx, 'dispatch_v2', line.id, line.challan?.businessDate || line.createdAt, line.sourceBarcode, {
      dispatchLineId: line.id,
      challanNo: line.challan?.challanNo || null,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sourceDisplaySnapshot: jsonValue(line.sourceDisplaySnapshot, {}),
      netWeightKg: toNumber(line.netWeightKg),
      isLegacyReconstruction: line.challan?.isLegacyReconstruction || false,
    });
    if (root) {
      for (const event of line.events || []) {
        addChild(root, makeNode(ctx, 'dispatch_event', event.id, event.createdAt, line.sourceBarcode, dispatchEventNodeData(event, line)));
      }
      await findAdjustmentLines(ctx, root, { sourceId: line.sourceId, sourceBarcode: line.sourceBarcode });
    }
    return root;
  }
  if (found.type === 'dispatch') {
    const legacy = found.entity;
    const stage = legacy.stage;
    const source = stage === 'inbound'
      ? await ctx.client.inboundItem.findUnique({ where: { barcode: legacy.stageBarcode } })
      : stage === 'cutter'
        ? await ctx.client.receiveFromCutterMachineRow.findFirst({ where: { OR: [{ barcode: legacy.stageBarcode }, { vchNo: legacy.stageBarcode }] }, include: { issue: true } })
        : stage === 'holo'
          ? await ctx.client.receiveFromHoloMachineRow.findFirst({ where: { barcode: legacy.stageBarcode }, include: { issue: true } })
          : await ctx.client.receiveFromConingMachineRow.findFirst({ where: { barcode: legacy.stageBarcode }, include: { issue: true } });
    if (source) {
      const sourceRoot = stage === 'inbound' ? await buildInboundNode(ctx, source)
        : stage === 'cutter' ? await buildRoot(ctx, { type: 'cutter_receive', entity: source })
          : stage === 'holo' ? await buildRoot(ctx, { type: 'holo_receive', entity: source })
            : await buildRoot(ctx, { type: 'coning_receive', entity: source });
      return sourceRoot;
    }
    return makeNode(ctx, 'dispatch', legacy.id, legacy.createdAt || legacy.date, legacy.stageBarcode, { challanNo: legacy.challanNo, customerName: legacy.customer?.name || null, weight: toNumber(legacy.weight), count: legacy.count, legacy: true });
  }
  if (found.type === 'inventory_adjustment') {
    const line = found.entity;
    if (line.replacementUnitId) {
      const unit = await fetchPackedUnit(ctx, line.replacementUnitId);
      if (unit) return buildPackedRoot(ctx, unit);
    }
    const root = makeNode(ctx, 'inventory_adjustment', line.id, line.batch?.effectiveAt || line.createdAt, line.sourceBarcode, {
      adjustmentLineId: line.id,
      batchNo: line.batch?.batchNo || null,
      kind: line.batch?.kind || null,
      countDelta: line.countDelta,
      weightDeltaKg: toNumber(line.weightDeltaKg),
      sourceId: line.sourceId,
    });
    return root;
  }
  return null;
}

function markSearched(root, barcode) {
  if (!root || root.truncated) return;
  const visit = (node) => {
    if (!node || node.truncated) return;
    if (node.barcode === barcode) node.isSearched = true;
    (node.children || []).forEach(visit);
  };
  visit(root);
}

export async function traceBarcodeHistory(rawBarcode, options = {}, client = prisma) {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) {
    const error = new Error('barcode is required');
    error.code = 'invalid_barcode';
    throw error;
  }
  const ctx = createContext(client, options);
  const found = await findRootByBarcode(ctx, barcode);
  const history = {
    barcode,
    resolvedBarcode: found?.resolvedBarcode || null,
    searchedStage: found?.searchedStage || null,
    found: Boolean(found),
    lineage: [],
    truncated: false,
  };
  if (!found) return history;
  const root = await buildRoot(ctx, found);
  if (!root) return history;
  markSearched(root, history.resolvedBarcode || barcode);
  history.lineage = flattenTree(root);
  history.tree = root;
  history.stats = computeStats(root);
  history.truncated = history.stats.truncated;
  return history;
}

export async function getBarcodeLineage(rawBarcode, options = {}, client = prisma) {
  return traceBarcodeHistory(rawBarcode, options, client);
}

export { normalizeBarcode };
