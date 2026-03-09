import {
  buildItemSummary,
  buildMachineSummary,
  buildYarnSummary,
  normalizeMachineLabel,
  sortByLabel,
} from './productionDailyExportSummary.js';

const PROCESS_LABELS = {
  cutter: 'Cutter',
  holo: 'Holo',
  coning: 'Coning',
};

function defaultParseRefs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createBuilderContext(helpers = {}) {
  return {
    parseRefs: typeof helpers.parseRefs === 'function' ? helpers.parseRefs : defaultParseRefs,
    resolveHoloIssueDetails: typeof helpers.resolveHoloIssueDetails === 'function' ? helpers.resolveHoloIssueDetails : null,
    resolveConingTraceDetails: typeof helpers.resolveConingTraceDetails === 'function' ? helpers.resolveConingTraceDetails : null,
    resolveLotNoFromPieceId: typeof helpers.resolveLotNoFromPieceId === 'function' ? helpers.resolveLotNoFromPieceId : null,
    traceCaches: {
      cutNames: new Map(),
      yarnNames: new Map(),
      twistNames: new Map(),
      rollTypeNames: new Map(),
    },
    holoIssueDetailsCache: new Map(),
    coningIssueTraceCache: new Map(),
  };
}

function asTrimmedText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

let prismaModulePromise = null;

async function getDefaultDb() {
  if (!prismaModulePromise) {
    prismaModulePromise = import('../../lib/prisma.js').then((module) => module.default);
  }
  return prismaModulePromise;
}

function roundTo3Decimals(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function buildMeta(rows = []) {
  const totals = rows.reduce((acc, row) => {
    acc.totalQuantity += Number(row.quantity || 0);
    acc.totalGross += Number(row.gross || 0);
    acc.totalTare += Number(row.tare || 0);
    acc.totalNet += Number(row.net || 0);
    return acc;
  }, {
    totalQuantity: 0,
    totalGross: 0,
    totalTare: 0,
    totalNet: 0,
  });

  return {
    noData: rows.length === 0,
    rowCount: rows.length,
    totalQuantity: roundTo3Decimals(totals.totalQuantity),
    totalGross: roundTo3Decimals(totals.totalGross),
    totalTare: roundTo3Decimals(totals.totalTare),
    totalNet: roundTo3Decimals(totals.totalNet),
  };
}

async function getItemNameMap(db, itemIds = []) {
  const uniqueIds = Array.from(new Set((itemIds || []).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const items = await db.item.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true },
  });
  return new Map(items.map((item) => [item.id, item.name || '']));
}

async function resolveCutterPieceFallbacks(rows = [], context, db) {
  const pieceIds = Array.from(new Set(rows.map((row) => row.pieceId).filter(Boolean)));
  const inboundItems = pieceIds.length > 0
    ? await db.inboundItem.findMany({
      where: { id: { in: pieceIds } },
      select: { id: true, itemId: true, lotNo: true },
    })
    : [];
  const pieceMap = new Map(inboundItems.map((piece) => [piece.id, piece]));

  const unresolvedPieceIds = pieceIds.filter((pieceId) => !pieceMap.has(pieceId));
  const lotByPiece = new Map();
  if (context.resolveLotNoFromPieceId && unresolvedPieceIds.length > 0) {
    const resolvedLots = await Promise.all(
      unresolvedPieceIds.map(async (pieceId) => [pieceId, await context.resolveLotNoFromPieceId(pieceId)])
    );
    resolvedLots.forEach(([pieceId, lotNo]) => {
      if (lotNo) lotByPiece.set(pieceId, lotNo);
    });
  }

  const lotNos = Array.from(new Set([
    ...inboundItems.map((piece) => piece.lotNo).filter(Boolean),
    ...Array.from(lotByPiece.values()).filter(Boolean),
  ]));
  const lots = lotNos.length > 0
    ? await db.lot.findMany({
      where: { lotNo: { in: lotNos } },
      select: { lotNo: true, itemId: true },
    })
    : [];
  const lotMap = new Map(lots.map((lot) => [lot.lotNo, lot]));

  const itemIds = Array.from(new Set([
    ...inboundItems.map((piece) => piece.itemId).filter(Boolean),
    ...lots.map((lot) => lot.itemId).filter(Boolean),
    ...rows.map((row) => row.issue?.itemId).filter(Boolean),
  ]));
  const itemNameMap = await getItemNameMap(db, itemIds);

  return {
    pieceMap,
    lotByPiece,
    lotMap,
    itemNameMap,
  };
}

async function loadCutterRows({ date, context, db }) {
  const rows = await db.receiveFromCutterMachineRow.findMany({
    where: {
      isDeleted: false,
      date,
    },
    include: {
      box: true,
      bobbin: true,
      operator: true,
      cutMaster: true,
      issue: {
        select: {
          id: true,
          itemId: true,
          lotNo: true,
          machine: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { machineNo: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  const fallbackContext = await resolveCutterPieceFallbacks(rows, context, db);

  return rows.map((row) => {
    const inboundPiece = fallbackContext.pieceMap.get(row.pieceId);
    const lotNo = inboundPiece?.lotNo || fallbackContext.lotByPiece.get(row.pieceId) || row.issue?.lotNo || '';
    const lot = lotNo ? fallbackContext.lotMap.get(lotNo) : null;
    const item = asTrimmedText(
      row.itemName
      || (inboundPiece?.itemId ? fallbackContext.itemNameMap.get(inboundPiece.itemId) : '')
      || (row.issue?.itemId ? fallbackContext.itemNameMap.get(row.issue.itemId) : '')
      || (lot?.itemId ? fallbackContext.itemNameMap.get(lot.itemId) : '')
    );

    return {
      yarn: asTrimmedText(row.yarnName),
      item,
      cut: asTrimmedText(row.cut || row.cutMaster?.name),
      machine: asTrimmedText(row.machineNo || row.issue?.machine?.name),
      worker: asTrimmedText(row.operator?.name || row.employee),
      crates: asTrimmedText(row.box?.name),
      rollType: asTrimmedText(row.bobbin?.name || row.pktTypeName || row.pcsTypeName),
      quantity: asNumber(row.bobbinQuantity) || 0,
      gross: asNumber(row.grossWt),
      tare: asNumber(row.tareWt),
      net: asNumber(row.netWt) || 0,
    };
  });
}

async function loadHoloRows({ date, context, db }) {
  const rows = await db.receiveFromHoloMachineRow.findMany({
    where: {
      isDeleted: false,
      date,
    },
    include: {
      box: true,
      rollType: true,
      operator: true,
      issue: {
        include: {
          machine: true,
          cut: true,
          yarn: true,
          twist: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
    ],
  });

  const itemNameMap = await getItemNameMap(db, rows.map((row) => row.issue?.itemId));

  const resolveIssueTrace = async (issue) => {
    if (!issue?.id) return null;
    if (context.holoIssueDetailsCache.has(issue.id)) {
      return context.holoIssueDetailsCache.get(issue.id);
    }

    let resolved = null;
    if (context.resolveHoloIssueDetails && context.parseRefs(issue.receivedRowRefs).length > 0) {
      resolved = await context.resolveHoloIssueDetails(issue, context.traceCaches);
    }
    if (!resolved) {
      resolved = {
        cutName: issue.cut?.name || '',
        yarnName: issue.yarn?.name || '',
        twistName: issue.twist?.name || '',
        yarnKg: asNumber(issue.yarnKg),
      };
    }

    context.holoIssueDetailsCache.set(issue.id, resolved);
    return resolved;
  };

  const normalizedRows = [];
  for (const row of rows) {
    const trace = await resolveIssueTrace(row.issue);
    const gross = asNumber(row.grossWeight);
    const tare = asNumber(row.tareWeight);
    const net = asNumber(row.rollWeight);
    normalizedRows.push({
      yarn: asTrimmedText(row.issue?.yarn?.name || trace?.yarnName),
      item: asTrimmedText(itemNameMap.get(row.issue?.itemId), 'Unassigned'),
      cut: asTrimmedText(row.issue?.cut?.name || trace?.cutName),
      machine: asTrimmedText(row.issue?.machine?.name || row.machineNo),
      worker: asTrimmedText(row.operator?.name),
      crates: asTrimmedText(row.box?.name),
      rollType: asTrimmedText(row.rollType?.name),
      quantity: asNumber(row.rollCount) || 0,
      gross,
      tare,
      net: net ?? roundTo3Decimals((gross || 0) - (tare || 0)),
    });
  }

  return normalizedRows;
}

async function loadConingRows({ date, context, db }) {
  const rows = await db.receiveFromConingMachineRow.findMany({
    where: {
      isDeleted: false,
      date,
    },
    include: {
      box: true,
      operator: true,
      issue: {
        include: {
          machine: true,
          cut: true,
          yarn: true,
          twist: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
    ],
  });

  const itemNameMap = await getItemNameMap(db, rows.map((row) => row.issue?.itemId));

  const resolveIssueTrace = async (issue) => {
    if (!issue?.id) return null;
    if (context.coningIssueTraceCache.has(issue.id)) {
      return context.coningIssueTraceCache.get(issue.id);
    }

    let resolved = null;
    if (context.resolveConingTraceDetails && context.parseRefs(issue.receivedRowRefs).length > 0) {
      resolved = await context.resolveConingTraceDetails(issue, {
        caches: context.traceCaches,
        holoIssueDetailsCache: context.holoIssueDetailsCache,
      });
    }
    if (!resolved) {
      resolved = {
        cutName: issue.cut?.name || '',
        yarnName: issue.yarn?.name || '',
        twistName: issue.twist?.name || '',
        rollTypeName: '',
        yarnKg: null,
      };
    }

    context.coningIssueTraceCache.set(issue.id, resolved);
    return resolved;
  };

  const normalizedRows = [];
  for (const row of rows) {
    const trace = await resolveIssueTrace(row.issue);
    normalizedRows.push({
      yarn: asTrimmedText(trace?.yarnName || row.issue?.yarn?.name),
      item: asTrimmedText(itemNameMap.get(row.issue?.itemId), 'Unassigned'),
      cut: asTrimmedText(row.issue?.cut?.name || trace?.cutName),
      machine: asTrimmedText(row.issue?.machine?.name || row.machineNo),
      worker: asTrimmedText(row.operator?.name),
      crates: asTrimmedText(row.box?.name),
      rollType: asTrimmedText(trace?.rollTypeName, 'Cones'),
      quantity: asNumber(row.coneCount) || 0,
      gross: asNumber(row.grossWeight),
      tare: asNumber(row.tareWeight),
      net: asNumber(row.netWeight) || 0,
    });
  }

  return normalizedRows;
}

const PROCESS_LOADERS = {
  cutter: loadCutterRows,
  holo: loadHoloRows,
  coning: loadConingRows,
};

export async function buildProductionDailyExportData({ process, date, helpers = {}, db } = {}) {
  const normalizedProcess = String(process || '').trim().toLowerCase();
  const loader = PROCESS_LOADERS[normalizedProcess];
  if (!loader) {
    throw new Error(`Unsupported production export process: ${process}`);
  }
  if (!date) {
    throw new Error('date is required');
  }

  const context = createBuilderContext(helpers);
  const activeDb = db || await getDefaultDb();
  const rows = await loader({ date, context, db: activeDb });
  const sortedRows = rows.sort((a, b) => {
    const yarnSort = sortByLabel(a.yarn, b.yarn);
    if (yarnSort !== 0) return yarnSort;
    const itemSort = sortByLabel(a.item, b.item);
    if (itemSort !== 0) return itemSort;
    const cutSort = sortByLabel(a.cut, b.cut);
    if (cutSort !== 0) return cutSort;
    const machineSort = sortByLabel(normalizeMachineLabel(a.machine), normalizeMachineLabel(b.machine));
    if (machineSort !== 0) return machineSort;
    const workerSort = sortByLabel(a.worker, b.worker);
    if (workerSort !== 0) return workerSort;
    return sortByLabel(a.rollType, b.rollType);
  });

  return {
    process: normalizedProcess,
    processLabel: PROCESS_LABELS[normalizedProcess] || normalizedProcess,
    date,
    rows: sortedRows,
    machineSummary: buildMachineSummary(sortedRows),
    itemSummary: buildItemSummary(sortedRows),
    yarnSummary: buildYarnSummary(sortedRows),
    meta: buildMeta(sortedRows),
  };
}
