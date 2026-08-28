// Set-based batched aggregator for issue balances.
//
// Replaces the per-issue loop in routes/index.js:buildIssueBalancesByStage,
// which used to call getIssuePending once per issue (3 sub-queries each).
// On a 5,500-issue Holo dataset that meant ~16,500 sequential round-trips
// inside one HTTP request and 30+ second responses.
//
// This module exposes a single function:
//   computeIssueBalancesBatch(client, stage, issues) -> Map<issueId, balance>
//
// where `balance` matches the legacy buildIssueBalancesByStage shape so no
// downstream code or frontend consumer needs to change.
//
// Total queries per call (regardless of issue count):
//   cutter : up to 5
//   holo   : 2
//   coning : 3

const TAKE_BACK_EPSILON = 1e-6;

function clampZero(val) {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return 0;
  return num <= TAKE_BACK_EPSILON ? 0 : num;
}

function parseJsonArraySafe(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parsePieceIdsCsv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function emptyBalance(stage, issueId, asOf) {
  return {
    stage,
    issueId,
    asOf,
    originalCount: 0,
    originalWeight: 0,
    takeBackCount: 0,
    takeBackWeight: 0,
    netIssuedCount: 0,
    netIssuedWeight: 0,
    receivedCount: 0,
    receivedWeight: 0,
    wastageCount: 0,
    wastageWeight: 0,
    pendingCount: 0,
    pendingWeight: 0,
  };
}

function finalizeBalance(stage, issueId, parts, asOf) {
  const original = parts.original || { count: 0, weight: 0 };
  const takeBack = parts.takeBack || { count: 0, weight: 0 };
  const received = parts.received || { count: 0, weight: 0 };
  const wastage = parts.wastage || { count: 0, weight: 0 };

  const netIssuedCount = clampZero(original.count - takeBack.count);
  const netIssuedWeight = clampZero(original.weight - takeBack.weight);
  // Holo issue counts are input bobbins, while receive counts are output rolls.
  // Preserve count availability for input take-backs and enforce production
  // consumption through the shared weight unit.
  const accountedCount = stage === 'holo'
    ? 0
    : clampZero(received.count + wastage.count);
  const accountedWeight = clampZero(received.weight + wastage.weight);

  return {
    stage,
    issueId,
    asOf,
    originalCount: clampZero(original.count),
    originalWeight: clampZero(original.weight),
    takeBackCount: clampZero(takeBack.count),
    takeBackWeight: clampZero(takeBack.weight),
    netIssuedCount,
    netIssuedWeight,
    receivedCount: clampZero(received.count),
    receivedWeight: clampZero(received.weight),
    wastageCount: clampZero(wastage.count),
    wastageWeight: clampZero(wastage.weight),
    pendingCount: clampZero(netIssuedCount - accountedCount),
    pendingWeight: clampZero(netIssuedWeight - accountedWeight),
  };
}

// One query: active take-back totals per issue. "Active" = not a reverse and not
// itself reversed, matching getIssueTakeBackSnapshot's activeCount/activeWeight.
async function loadTakeBackTotals(client, stage, issueIds) {
  const result = new Map();
  if (issueIds.length === 0) return result;
  const rows = await client.issueTakeBack.findMany({
    where: {
      stage,
      issueId: { in: issueIds },
      isReverse: false,
      isReversed: false,
    },
    select: { issueId: true, totalCount: true, totalWeight: true },
  });
  for (const row of rows) {
    const id = row.issueId;
    const acc = result.get(id) || { count: 0, weight: 0 };
    acc.count += Number(row.totalCount || 0);
    acc.weight += Number(row.totalWeight || 0);
    result.set(id, acc);
  }
  return result;
}

// Cutter original: prefer issueToCutterMachineLine totals; fall back to
// issue.totalWeight / issue.count for legacy issues that have no lines.
async function loadCutterOriginalTotals(client, issues) {
  const map = new Map();
  for (const issue of issues) map.set(issue.id, { count: 0, weight: 0 });
  if (issues.length === 0) return map;

  const ids = issues.map((i) => i.id);
  const grouped = await client.issueToCutterMachineLine.groupBy({
    by: ['issueId'],
    where: { issueId: { in: ids } },
    _sum: { issuedWeight: true },
    _count: { _all: true },
  });
  const fromLines = new Map();
  for (const g of grouped) {
    fromLines.set(g.issueId, {
      count: Number(g._count?._all || 0),
      weight: Number(g._sum?.issuedWeight || 0),
    });
  }

  for (const issue of issues) {
    const lineTotals = fromLines.get(issue.id);
    if (lineTotals && lineTotals.count > 0) {
      map.set(issue.id, {
        count: Number(issue.count || 0) || lineTotals.count,
        weight: lineTotals.weight,
      });
    } else {
      const pieceIds = parsePieceIdsCsv(issue.pieceIds);
      map.set(issue.id, {
        count: Number(issue.count || 0) || pieceIds.length,
        weight: Number(issue.totalWeight || 0),
      });
    }
  }
  return map;
}

// Cutter received: linked rows by issueId + fallback rows where issueId is NULL
// but pieceId matches an issue's pieceIds list and createdAt >= issue.createdAt.
// Wastage: from ReceiveFromCutterMachineChallan, deterministically attributed
// to a single issue per piece (latest issue created on or before challan time)
// to match the legacy per-issue algorithm.
async function loadCutterReceivedAndWastage(client, issues) {
  const received = new Map();
  const wastage = new Map();
  for (const issue of issues) {
    received.set(issue.id, { count: 0, weight: 0 });
    wastage.set(issue.id, { count: 0, weight: 0 });
  }
  if (issues.length === 0) return { received, wastage };

  const ids = issues.map((i) => i.id);

  // (1) Linked receive rows.
  const linkedGrouped = await client.receiveFromCutterMachineRow.groupBy({
    by: ['issueId'],
    where: { issueId: { in: ids }, isDeleted: false },
    _sum: { bobbinQuantity: true, netWt: true },
  });
  for (const g of linkedGrouped) {
    const acc = received.get(g.issueId);
    if (!acc) continue;
    acc.count += Number(g._sum?.bobbinQuantity || 0);
    acc.weight += Number(g._sum?.netWt || 0);
  }

  // (2) Fallback rows: per-piece map -> { issueId, issueCreatedAt }[].
  const issuesByPiece = new Map();
  const allPieceIds = new Set();
  let earliestCreatedAt = null;
  for (const issue of issues) {
    const pieceIds = parsePieceIdsCsv(issue.pieceIds);
    if (pieceIds.length === 0) continue;
    const issueCreatedAt = new Date(issue.createdAt || 0);
    if (!earliestCreatedAt || issueCreatedAt < earliestCreatedAt) {
      earliestCreatedAt = issueCreatedAt;
    }
    for (const pieceId of pieceIds) {
      const pid = String(pieceId).trim();
      if (!pid) continue;
      allPieceIds.add(pid);
      const list = issuesByPiece.get(pid) || [];
      list.push({ issueId: issue.id, createdAtMs: issueCreatedAt.getTime() });
      issuesByPiece.set(pid, list);
    }
  }
  // De-dup and sort each piece's issue list by createdAt asc, issueId asc.
  for (const [pid, list] of issuesByPiece.entries()) {
    const dedup = Array.from(
      new Map(list.map((entry) => [entry.issueId, entry])).values(),
    );
    dedup.sort(
      (a, b) =>
        a.createdAtMs - b.createdAtMs ||
        String(a.issueId).localeCompare(String(b.issueId)),
    );
    issuesByPiece.set(pid, dedup);
  }

  if (allPieceIds.size > 0 && earliestCreatedAt) {
    const fallbackRows = await client.receiveFromCutterMachineRow.findMany({
      where: {
        issueId: null,
        pieceId: { in: Array.from(allPieceIds) },
        isDeleted: false,
        createdAt: { gte: earliestCreatedAt },
      },
      select: { pieceId: true, bobbinQuantity: true, netWt: true, createdAt: true },
    });
    // Legacy attribution: the per-issue version filters by the SPECIFIC issue's
    // createdAt, so a fallback row counts toward every issue created on or before
    // that row's createdAt for the same piece. Mirror that here.
    for (const row of fallbackRows) {
      const pid = String(row.pieceId || '').trim();
      const candidates = issuesByPiece.get(pid);
      if (!candidates) continue;
      const rowMs = new Date(row.createdAt || 0).getTime();
      for (const cand of candidates) {
        if (cand.createdAtMs <= rowMs) {
          const acc = received.get(cand.issueId);
          if (!acc) continue;
          acc.count += Number(row.bobbinQuantity || 0);
          acc.weight += Number(row.netWt || 0);
        }
      }
    }
  }

  // (3) Wastage attribution from challans, deterministic to a single issue per piece.
  if (allPieceIds.size > 0 && earliestCreatedAt) {
    const challans = await client.receiveFromCutterMachineChallan.findMany({
      where: {
        pieceId: { in: Array.from(allPieceIds) },
        isDeleted: false,
        createdAt: { gte: earliestCreatedAt },
      },
      select: { pieceId: true, wastageNetWeight: true, createdAt: true },
    });
    for (const ch of challans) {
      const pid = String(ch.pieceId || '').trim();
      const candidates = issuesByPiece.get(pid);
      if (!candidates) continue;
      const chMs = new Date(ch.createdAt || 0).getTime();
      // latest issue with createdAt <= challan time
      const assigned = [...candidates]
        .reverse()
        .find((c) => c.createdAtMs <= chMs);
      if (!assigned) continue;
      const wt = Number(ch.wastageNetWeight || 0);
      if (wt <= 0) continue;
      const acc = wastage.get(assigned.issueId);
      if (!acc) continue;
      acc.weight += wt;
    }
  }

  return { received, wastage };
}

function loadHoloOrConingOriginal(stage, issues) {
  const map = new Map();
  for (const issue of issues) {
    let count = 0;
    let weight = 0;
    const refs = parseJsonArraySafe(issue.receivedRowRefs);
    if (stage === 'holo') {
      for (const ref of refs) {
        count += Number(ref?.issuedBobbins || 0);
        weight += Number(ref?.issuedBobbinWeight || 0);
      }
      if (count <= 0) count = Number(issue.metallicBobbins || 0);
      if (weight <= 0) weight = Number(issue.metallicBobbinsWeight || 0);
      weight += Number(issue.yarnKg || 0);
    } else {
      for (const ref of refs) {
        count += Number(ref?.issueRolls || 0);
        weight += Number(ref?.issueWeight || 0);
      }
      if (count <= 0) count = Number(issue.rollsIssued || 0);
    }
    map.set(issue.id, { count, weight });
  }
  return map;
}

// Holo received/wastage. We need rollType names to split wastage vs received,
// matching the legacy logic — so we fetch the rows with rollType joined, then
// reduce in memory.
async function loadHoloReceivedAndWastage(client, issues) {
  const received = new Map();
  const wastage = new Map();
  for (const issue of issues) {
    received.set(issue.id, { count: 0, weight: 0 });
    wastage.set(issue.id, { count: 0, weight: 0 });
  }
  if (issues.length === 0) return { received, wastage };

  const rows = await client.receiveFromHoloMachineRow.findMany({
    where: { issueId: { in: issues.map((i) => i.id) }, isDeleted: false },
    select: {
      issueId: true,
      rollCount: true,
      rollWeight: true,
      grossWeight: true,
      tareWeight: true,
      rollType: { select: { name: true } },
    },
  });
  for (const row of rows) {
    const count = Number(row.rollCount || 0);
    const weight = Number.isFinite(Number(row.rollWeight))
      ? Number(row.rollWeight)
      : Number(row.grossWeight || 0) - Number(row.tareWeight || 0);
    const isWastage = String(row.rollType?.name || '').toLowerCase().includes('wastage');
    const target = isWastage ? wastage.get(row.issueId) : received.get(row.issueId);
    if (!target) continue;
    target.count += count;
    target.weight += weight;
  }
  return { received, wastage };
}

// Coning received: from receiveFromConingMachineRow + per-piece wastage totals.
// receivedCount comes from per-row sourceRowRefs jsonb (rolls), receivedWeight
// from netWeight. wastageWeight from ReceiveFromConingMachinePieceTotal keyed
// by pieceId == issue.id (legacy schema quirk, preserved).
async function loadConingReceivedAndWastage(client, issues) {
  const received = new Map();
  const wastage = new Map();
  for (const issue of issues) {
    received.set(issue.id, { count: 0, weight: 0 });
    wastage.set(issue.id, { count: 0, weight: 0 });
  }
  if (issues.length === 0) return { received, wastage };

  const ids = issues.map((i) => i.id);

  const rows = await client.receiveFromConingMachineRow.findMany({
    where: { issueId: { in: ids }, isDeleted: false },
    select: { issueId: true, netWeight: true, sourceRowRefs: true },
  });
  for (const row of rows) {
    const acc = received.get(row.issueId);
    if (!acc) continue;
    acc.weight += Number(row.netWeight || 0);
    const refs = parseJsonArraySafe(row.sourceRowRefs);
    for (const ref of refs) {
      const rolls = Number(ref?.rolls || 0);
      if (rolls > 0) acc.count += rolls;
    }
  }

  const totals = await client.receiveFromConingMachinePieceTotal.findMany({
    where: { pieceId: { in: ids } },
    select: { pieceId: true, wastageNetWeight: true },
  });
  for (const t of totals) {
    const acc = wastage.get(t.pieceId);
    if (!acc) continue;
    acc.weight += Number(t.wastageNetWeight || 0);
  }

  return { received, wastage };
}

export async function computeIssueBalancesBatch(client, stage, issues = []) {
  const out = new Map();
  if (!Array.isArray(issues) || issues.length === 0) return out;
  const asOf = new Date().toISOString();
  for (const issue of issues) out.set(issue.id, emptyBalance(stage, issue.id, asOf));

  const ids = issues.map((i) => i.id);
  const takeBack = await loadTakeBackTotals(client, stage, ids);

  let original;
  let received;
  let wastage;

  if (stage === 'cutter') {
    original = await loadCutterOriginalTotals(client, issues);
    const cutter = await loadCutterReceivedAndWastage(client, issues);
    received = cutter.received;
    wastage = cutter.wastage;
  } else if (stage === 'holo') {
    original = loadHoloOrConingOriginal('holo', issues);
    const holo = await loadHoloReceivedAndWastage(client, issues);
    received = holo.received;
    wastage = holo.wastage;
  } else {
    original = loadHoloOrConingOriginal('coning', issues);
    const coning = await loadConingReceivedAndWastage(client, issues);
    received = coning.received;
    wastage = coning.wastage;
  }

  for (const issue of issues) {
    const id = issue.id;
    out.set(
      id,
      finalizeBalance(stage, id, {
        original: original.get(id),
        takeBack: takeBack.get(id),
        received: received.get(id),
        wastage: wastage.get(id),
      }, asOf),
    );
  }
  return out;
}
