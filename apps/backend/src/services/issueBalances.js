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
//   cutter : up to 4
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
  const pieceIdsByIssue = new Map();
  for (const issue of issues) map.set(issue.id, { count: 0, weight: 0 });
  if (issues.length === 0) return { totals: map, pieceIdsByIssue };

  const ids = issues.map((i) => i.id);
  const lines = await client.issueToCutterMachineLine.findMany({
    where: { issueId: { in: ids } },
    select: { issueId: true, pieceId: true, issuedWeight: true },
  });
  const fromLines = new Map();
  for (const line of lines) {
    const current = fromLines.get(line.issueId) || { count: 0, weight: 0 };
    current.count += 1;
    current.weight += Number(line.issuedWeight || 0);
    fromLines.set(line.issueId, current);
    const pieceIds = pieceIdsByIssue.get(line.issueId) || [];
    pieceIds.push(line.pieceId);
    pieceIdsByIssue.set(line.issueId, pieceIds);
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
  return { totals: map, pieceIdsByIssue };
}

// Cutter received: linked rows by issueId + fallback rows where issueId is NULL,
// deterministically attributed to the latest active issue for the piece created
// on or before the row. Wastage uses the same one-issue attribution rule.
async function loadCutterReceivedAndWastage(client, issues, linePieceIdsByIssue) {
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

  // (2) Legacy receive rows and challan wastage are assigned to exactly one
  // issue: the latest active issue for the piece created on or before the
  // event. The single SQL query builds the global candidate set before
  // restricting the aggregate to this selected issue page, so page-sized
  // balance requests cannot claim events belonging to later issues.
  const allPieceIds = new Set();
  const selectedCandidates = [];
  for (const issue of issues) {
    const pieceIds = Array.from(new Set([
      ...parsePieceIdsCsv(issue.pieceIds),
      ...(linePieceIdsByIssue.get(issue.id) || []),
    ].map((pieceId) => String(pieceId || '').trim()).filter(Boolean)));
    if (pieceIds.length === 0) continue;
    const issueCreatedAt = new Date(issue.createdAt || 0);
    for (const pieceId of pieceIds) {
      const pid = String(pieceId).trim();
      if (!pid) continue;
      allPieceIds.add(pid);
      selectedCandidates.push({
        issueId: issue.id,
        pieceId: pid,
        createdAt: issueCreatedAt.toISOString(),
      });
    }
  }

  if (allPieceIds.size > 0) {
    const pieceIds = Array.from(allPieceIds);
    const candidateJson = JSON.stringify(selectedCandidates);
    const rows = await client.$queryRaw`
      WITH selected_candidates AS (
        SELECT
          candidate."issueId" AS issue_id,
          candidate."pieceId" AS piece_id,
          candidate."createdAt"::timestamptz AS created_at
        FROM jsonb_to_recordset(${candidateJson}::jsonb)
          AS candidate("issueId" text, "pieceId" text, "createdAt" text)
      ),
      candidates AS (
        SELECT DISTINCT issue_id, piece_id, created_at
        FROM (
          SELECT
            line."issueId" AS issue_id,
            line."pieceId" AS piece_id,
            issue."createdAt" AS created_at
          FROM "IssueToCutterMachineLine" line
          JOIN "IssueToCutterMachine" issue ON issue.id = line."issueId"
          WHERE line."pieceId" = ANY(${pieceIds}::text[])
            AND issue."isDeleted" = false
          UNION ALL
          SELECT issue_id, piece_id, created_at
          FROM selected_candidates
        ) all_candidates
      ),
      events AS (
        SELECT
          row."pieceId" AS piece_id,
          row."createdAt" AS created_at,
          COALESCE(row.bobbin_quantity, 0)::double precision AS received_count,
          COALESCE(row."netWt", 0)::double precision AS received_weight,
          0::double precision AS wastage_weight
        FROM "ReceiveFromCutterMachineRow" row
        WHERE row."issueId" IS NULL
          AND row."pieceId" = ANY(${pieceIds}::text[])
          AND row."isDeleted" = false
        UNION ALL
        SELECT
          challan."pieceId" AS piece_id,
          challan."createdAt" AS created_at,
          0::double precision AS received_count,
          0::double precision AS received_weight,
          COALESCE(challan."wastageNetWeight", 0)::double precision AS wastage_weight
        FROM "ReceiveFromCutterMachineChallan" challan
        WHERE challan."pieceId" = ANY(${pieceIds}::text[])
          AND challan."isDeleted" = false
      ),
      assigned AS (
        SELECT event.*, owner.issue_id
        FROM events event
        JOIN LATERAL (
          SELECT candidate.issue_id
          FROM candidates candidate
          WHERE candidate.piece_id = event.piece_id
            AND candidate.created_at <= event.created_at
          ORDER BY candidate.created_at DESC, candidate.issue_id DESC
          LIMIT 1
        ) owner ON true
      )
      SELECT
        assigned.issue_id AS "issueId",
        SUM(assigned.received_count)::double precision AS "receivedCount",
        SUM(assigned.received_weight)::double precision AS "receivedWeight",
        SUM(assigned.wastage_weight)::double precision AS "wastageWeight"
      FROM assigned
      WHERE assigned.issue_id = ANY(${ids}::text[])
      GROUP BY assigned.issue_id
    `;
    for (const row of rows) {
      const receiveAcc = received.get(row.issueId);
      const wastageAcc = wastage.get(row.issueId);
      if (receiveAcc) {
        receiveAcc.count += Number(row.receivedCount || 0);
        receiveAcc.weight += Number(row.receivedWeight || 0);
      }
      if (wastageAcc) {
        wastageAcc.weight += Number(row.wastageWeight || 0);
      }
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

// Holo received/wastage uses the persisted row bucket. NULL is intentional for
// legacy rows, which were historically accumulated as ordinary receive weight
// even when their roll-type label contained "wastage".
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
      isWastage: true,
    },
  });
  for (const row of rows) {
    const count = Number(row.rollCount || 0);
    const weight = Number.isFinite(Number(row.rollWeight))
      ? Number(row.rollWeight)
      : Number(row.grossWeight || 0) - Number(row.tareWeight || 0);
    const isWastage = row.isWastage === true;
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
    const cutterOriginal = await loadCutterOriginalTotals(client, issues);
    original = cutterOriginal.totals;
    const cutter = await loadCutterReceivedAndWastage(client, issues, cutterOriginal.pieceIdsByIssue);
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
