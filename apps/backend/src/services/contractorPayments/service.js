// Database orchestration for contractor KG payments. Pure math lives in
// calc.js; this module reads production rows and rates, resolves quality keys,
// and produces the payable preview / draft snapshot inputs.

import {
  PROCESSES,
  resolveNetKg,
  isOpeningStockRow,
  isPurchasedRow,
  matchRate,
  computeAmount,
  computeTotals,
  qualityGroupKey,
  roundKg,
  roundCurrency,
} from './calc.js';

const ROW_FETCH_LIMIT = 20000;

export function isValidProcess(process) {
  return PROCESSES.includes(process);
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Build a normalized-name -> id index, but only for names that are unique.
// Ambiguous names map to null so they resolve to "unknown" (a blocker) rather
// than silently picking an arbitrary master.
function buildUniqueNameIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (!key) continue;
    if (index.has(key)) index.set(key, null); // ambiguous
    else index.set(key, row.id);
  }
  return index;
}

// Load the master lookup maps used to snapshot names and resolve coning Side.
export async function loadMasterMaps(prisma) {
  const [items, yarns, cuts, twists, coneTypes] = await Promise.all([
    prisma.item.findMany({ select: { id: true, name: true, side: true } }),
    prisma.yarn.findMany({ select: { id: true, name: true } }),
    prisma.cut.findMany({ select: { id: true, name: true } }),
    prisma.twist.findMany({ select: { id: true, name: true } }),
    prisma.coneType.findMany({ select: { id: true, name: true } }),
  ]);
  const toMap = (rows) => new Map(rows.map((r) => [r.id, r]));
  return {
    items: toMap(items),
    yarns: toMap(yarns),
    cuts: toMap(cuts),
    twists: toMap(twists),
    coneTypes: toMap(coneTypes),
    itemsByName: buildUniqueNameIndex(items),
  };
}

// Resolve an Item id from a denormalized item name (unique match only).
function resolveItemIdByName(maps, name) {
  const key = normalizeName(name);
  return key ? (maps.itemsByName.get(key) || null) : null;
}

function nameOf(map, id) {
  if (!id) return null;
  const rec = map.get(id);
  return rec ? rec.name : null;
}

// Contractor settlement QTY is the process-specific physical count, not the
// number of source rows: cutter=bobbins, holo=rolls, coning=cones.
export function resolveQuantity(process, row) {
  const raw = process === 'cutter'
    ? row?.bobbinQuantity
    : process === 'holo'
      ? row?.rollCount
      : process === 'coning'
        ? row?.coneCount
        : null;
  if (raw === null || raw === undefined || raw === '') return null;
  const quantity = Number(raw);
  return Number.isFinite(quantity) ? Math.trunc(quantity) : null;
}

// A coning issue records exactly one cone type in receivedRowRefs[0].coneTypeId
// (enforced at issue creation). Parse it defensively (refs may be a JSON string).
export function resolveConeTypeId(issue) {
  let refs = issue?.receivedRowRefs;
  if (typeof refs === 'string') {
    try { refs = JSON.parse(refs || '[]'); } catch { return null; }
  }
  if (Array.isArray(refs) && refs.length > 0) return refs[0]?.coneTypeId || null;
  return null;
}

// Extract the referenced receive-row ids from a receivedRowRefs value
// (Json array or legacy JSON string).
function parseRefRowIds(refs) {
  if (typeof refs === 'string') {
    try { refs = JSON.parse(refs || '[]'); } catch { return []; }
  }
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => (typeof ref?.rowId === 'string' ? ref.rowId : null))
    .filter(Boolean);
}

// Resolve a set of coning issues' Cut through their refs, batched per level.
// Each ref row id may be a HOLO receive row (→ holo issue cutId, or — when the
// holo issue has no cutId — onward through ITS refs to cutter rows, whose
// cutId falls back to the cutter issue's) or a CONING receive row (re-coning →
// the parent coning issue, recursively; a ref-less parent terminates at its
// own cutId). Soft-deleted rows/issues are excluded, matching the app's
// lineage walks. `visited` guards against ref cycles (a revisited issue counts
// as unresolved). Returns Map<issueId, {matchedAny, unresolved, cuts:Set}>.
async function resolveConingIssueCuts(prisma, issueRefIds, visited) {
  const result = new Map();
  const frontier = Array.from(new Set([].concat(...issueRefIds.values())));
  if (!frontier.length) return result;

  const [holoRows, coningRows] = await Promise.all([
    prisma.receiveFromHoloMachineRow.findMany({
      where: { id: { in: frontier }, isDeleted: false },
      select: { id: true, issueId: true },
    }),
    prisma.receiveFromConingMachineRow.findMany({
      where: { id: { in: frontier }, isDeleted: false },
      select: { id: true, issueId: true },
    }),
  ]);
  const holoIssueIdByRow = new Map(holoRows.map((r) => [r.id, r.issueId]));
  const parentIssueIdByRow = new Map(coningRows.map((r) => [r.id, r.issueId]));

  // Holo issues; the cut-less ones continue to cutter rows (then cutter issues).
  const holoIssueIds = Array.from(new Set(holoRows.map((r) => r.issueId).filter(Boolean)));
  const holoIssues = holoIssueIds.length
    ? await prisma.issueToHoloMachine.findMany({
      where: { id: { in: holoIssueIds }, isDeleted: false },
      select: { id: true, cutId: true, receivedRowRefs: true },
    })
    : [];
  const cutterIdsNeeded = new Set();
  const cutterRefsByHoloIssue = new Map();
  for (const hi of holoIssues) {
    if (hi.cutId) continue;
    const refIds = parseRefRowIds(hi.receivedRowRefs);
    cutterRefsByHoloIssue.set(hi.id, refIds);
    refIds.forEach((id) => cutterIdsNeeded.add(id));
  }
  const cutterRows = cutterIdsNeeded.size
    ? await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: Array.from(cutterIdsNeeded) }, isDeleted: false },
      select: { id: true, cutId: true, issueId: true },
    })
    : [];
  const cutterIssueIds = Array.from(new Set(
    cutterRows.filter((r) => !r.cutId && r.issueId).map((r) => r.issueId),
  ));
  const cutterIssues = cutterIssueIds.length
    ? await prisma.issueToCutterMachine.findMany({
      where: { id: { in: cutterIssueIds }, isDeleted: false },
      select: { id: true, cutId: true },
    })
    : [];
  const cutterIssueCut = new Map(cutterIssues.map((i) => [i.id, i.cutId || null]));
  const cutterById = new Map(cutterRows.map((r) => [r.id, r]));

  const holoIssueCut = new Map();
  for (const hi of holoIssues) {
    if (hi.cutId) { holoIssueCut.set(hi.id, { cuts: new Set([hi.cutId]), unresolved: false }); continue; }
    const refIds = cutterRefsByHoloIssue.get(hi.id) || [];
    const cuts = new Set();
    let unresolved = !refIds.length; // in-lineage but no cut derivable
    for (const rid of refIds) {
      const cr = cutterById.get(rid);
      const cut = cr ? (cr.cutId || cutterIssueCut.get(cr.issueId) || null) : null;
      if (cut) cuts.add(cut); else unresolved = true;
    }
    holoIssueCut.set(hi.id, { cuts, unresolved });
  }

  // Re-coning parents: recurse (visited prevents cycles / re-entering roots).
  const parentIssueIds = Array.from(new Set(coningRows.map((r) => r.issueId).filter(Boolean)))
    .filter((id) => !visited.has(id));
  parentIssueIds.forEach((id) => visited.add(id));
  const parentCut = new Map();
  if (parentIssueIds.length) {
    const parentIssues = await prisma.issueToConingMachine.findMany({
      where: { id: { in: parentIssueIds }, isDeleted: false },
      select: { id: true, cutId: true, receivedRowRefs: true },
    });
    const parentRefs = new Map();
    for (const pi of parentIssues) {
      const refIds = parseRefRowIds(pi.receivedRowRefs);
      if (refIds.length) parentRefs.set(pi.id, refIds);
    }
    const parentTraced = parentRefs.size
      ? await resolveConingIssueCuts(prisma, parentRefs, visited)
      : new Map();
    for (const pi of parentIssues) {
      const traced = parentTraced.get(pi.id);
      if (traced && traced.matchedAny) {
        parentCut.set(pi.id, { cuts: traced.cuts, unresolved: traced.unresolved });
      } else if (pi.cutId) {
        // No available lineage on the parent → its own cutId is the terminal.
        parentCut.set(pi.id, { cuts: new Set([pi.cutId]), unresolved: false });
      } else {
        parentCut.set(pi.id, { cuts: new Set(), unresolved: true });
      }
    }
  }

  for (const [issueId, refIds] of issueRefIds.entries()) {
    const cuts = new Set();
    let matchedAny = false;
    let unresolved = false;
    for (const rid of refIds) {
      if (holoIssueIdByRow.has(rid)) {
        matchedAny = true;
        const hres = holoIssueCut.get(holoIssueIdByRow.get(rid));
        if (!hres) { unresolved = true; continue; } // holo issue missing/deleted
        hres.cuts.forEach((c) => cuts.add(c));
        if (hres.unresolved) unresolved = true;
      } else if (parentIssueIdByRow.has(rid)) {
        matchedAny = true;
        const pres = parentCut.get(parentIssueIdByRow.get(rid));
        if (!pres) { unresolved = true; continue; } // cycle or missing parent
        pres.cuts.forEach((c) => cuts.add(c));
        if (pres.unresolved) unresolved = true;
      }
      // rid matched no row at all → counted below as partially-unavailable
    }
    const unmatched = refIds.some((rid) => !holoIssueIdByRow.has(rid) && !parentIssueIdByRow.has(rid));
    result.set(issueId, { matchedAny, unresolved: unresolved || (matchedAny && unmatched), cuts });
  }
  return result;
}

// Trace each candidate coning issue's Cut through its production lineage. The
// denormalized IssueToConingMachine.cutId is only a FALLBACK, used when the
// refs carry no row ids or none of them matches any receive row (legacy /
// imported data). When ANY lineage is available it must be complete and
// unanimous: partially-resolvable refs or conflicting traced cuts resolve to
// null (→ a visible missing-quality blocker) instead of silently picking a
// rate. Returns Map<coningIssueId, cutId|null>; untraceable issues are absent.
export async function traceConingCuts(prisma, rows) {
  const rootRefIds = new Map();
  for (const row of rows) {
    const issue = row.issue;
    if (!issue?.id || rootRefIds.has(issue.id)) continue;
    const ids = parseRefRowIds(issue.receivedRowRefs);
    if (ids.length) rootRefIds.set(issue.id, ids);
  }
  if (!rootRefIds.size) return new Map();
  // Do NOT seed `visited` with the roots: a parent issue is frequently also a
  // preview candidate, and it must still be resolvable as a re-coning parent.
  // Ref cycles terminate anyway — each recursion level adds its parents to
  // `visited`, so a loop resolves as unresolved (blocked) instead of hanging.
  const resolved = await resolveConingIssueCuts(prisma, rootRefIds, new Set());
  const traced = new Map();
  for (const [issueId, res] of resolved.entries()) {
    if (!res.matchedAny) continue; // no available lineage → denormalized fallback
    if (res.unresolved || res.cuts.size !== 1) traced.set(issueId, null);
    else traced.set(issueId, res.cuts.values().next().value);
  }
  return traced;
}

// Fetch candidate production receive rows for the selected production period.
// The row date falls back to the issue date when the row itself carries none.
async function fetchProductionRows(prisma, process, from, to = from) {
  const dateFilter = from === to ? from : { gte: from, lte: to };
  const rowDateOr = {
    OR: [
      { date: dateFilter },
      { date: null, issue: { is: { date: dateFilter } } },
    ],
  };
  // Deterministic ordering so a truncated fetch is reproducible (createdAt is
  // not unique, so id is the tie-breaker), and take LIMIT+1 to detect (and
  // report) when the daily fetch exceeds the cap.
  const common = { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: ROW_FETCH_LIMIT + 1 };
  if (process === 'cutter') {
    return prisma.receiveFromCutterMachineRow.findMany({
      where: { isDeleted: false, ...rowDateOr },
      include: { issue: true, challan: true },
      ...common,
    });
  }
  if (process === 'holo') {
    return prisma.receiveFromHoloMachineRow.findMany({
      where: { isDeleted: false, ...rowDateOr },
      include: { issue: true },
      ...common,
    });
  }
  return prisma.receiveFromConingMachineRow.findMany({
    where: { isDeleted: false, ...rowDateOr },
    include: { issue: true },
    ...common,
  });
}

// Resolve the quality keys, snapshot names, and metadata for one production row.
export function resolveRow(process, row, maps) {
  const issue = row.issue || null;
  const productionDate = row.date || issue?.date || null;
  const netKg = resolveNetKg(process, row);
  const base = {
    sourceRowId: row.id,
    productionDate,
    netKg,
    quantity: resolveQuantity(process, row),
    createdBy: row.createdBy || null,
    lotNo: issue?.lotNo || row.lotNo || row.challan?.lotNo || null,
    barcode: row.barcode || row.vchNo || null,
    itemId: null,
    itemName: null,
    yarnId: null,
    yarnName: null,
    cutId: null,
    cutName: null,
    twistId: null,
    twistName: null,
    coneTypeId: null,
    coneTypeName: null,
    side: null,
    cutterIssueId: null,
    cutterIssuedRolls: null,
  };

  if (process === 'cutter') {
    // Item comes from the linked issue; unlinked (Excel-imported) rows fall
    // back to a unique match on the row's denormalized item name.
    base.itemId = issue?.itemId || resolveItemIdByName(maps, row.itemName) || null;
    base.itemName = nameOf(maps.items, base.itemId) || row.itemName || null;
    base.cutId = row.cutId || issue?.cutId || null;
    base.cutName = nameOf(maps.cuts, base.cutId);
    // Cutter's input count belongs to the issue, whereas the bobbin count
    // belongs to each received production row. Keep both so quality totals can
    // show issued rolls and received bobbins without double-counting an issue
    // that was received in more than one row.
    base.cutterIssueId = issue?.id || null;
    base.cutterIssuedRolls = resolveIssueCount(issue?.count);
  } else if (process === 'holo') {
    base.yarnId = issue?.yarnId || null;
    base.yarnName = nameOf(maps.yarns, base.yarnId);
    base.cutId = issue?.cutId || null;
    base.cutName = nameOf(maps.cuts, base.cutId);
    base.twistId = issue?.twistId || null;
    base.twistName = nameOf(maps.twists, base.twistId);
  } else if (process === 'coning') {
    base.yarnId = issue?.yarnId || null;
    base.yarnName = nameOf(maps.yarns, base.yarnId);
    // Cut comes from the traced holo lineage when available (traceConingCuts);
    // the coning issue's own denormalized cutId is only a fallback. A
    // conflicting/partial trace (null) marks the row so the preview blocks it
    // — even though Cut itself is optional, a KNOWN-ambiguous Cut must not
    // silently price via a wildcard rate.
    const tracedCut = maps.coningCutTrace && issue?.id && maps.coningCutTrace.has(issue.id)
      ? maps.coningCutTrace.get(issue.id)
      : undefined;
    base.cutId = tracedCut !== undefined ? tracedCut : (issue?.cutId || null);
    base.cutConflict = tracedCut === null;
    base.cutName = nameOf(maps.cuts, base.cutId);
    base.twistId = issue?.twistId || null;
    base.twistName = nameOf(maps.twists, base.twistId);
    // Side is resolved from the coning issue's Item.
    base.itemId = issue?.itemId || null;
    const itemRec = base.itemId ? maps.items.get(base.itemId) : null;
    base.itemName = itemRec ? itemRec.name : null;
    base.side = itemRec ? itemRec.side : null;
    // Cone type comes from the coning issue's receivedRowRefs (one per issue),
    // enabling the optional Cone-Type rate override.
    base.coneTypeId = resolveConeTypeId(issue);
    base.coneTypeName = nameOf(maps.coneTypes, base.coneTypeId);
  }
  return base;
}

function resolveIssueCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) ? Math.trunc(count) : null;
}

// The row's quality keys required by matchRate for this process.
function rowKeysForProcess(process, resolved) {
  if (process === 'cutter') return { itemId: resolved.itemId, cutId: resolved.cutId };
  if (process === 'holo') {
    return { yarnId: resolved.yarnId, cutId: resolved.cutId, twistId: resolved.twistId };
  }
  return {
    yarnId: resolved.yarnId,
    cutId: resolved.cutId,
    side: resolved.side,
    twistId: resolved.twistId,
    coneTypeId: resolved.coneTypeId,
  };
}

// Determine which required quality fields are missing on a resolved row.
// Cut is optional for holo/coning (a cut-less rate is a wildcard), so a
// missing Cut no longer blocks those rows — but a CONFLICTED Cut lineage
// (resolved.cutConflict) still does, handled separately in the preview loop.
function missingQualityFields(process, resolved) {
  const missing = [];
  if (process === 'cutter') {
    if (!resolved.itemId) missing.push('Item');
    if (!resolved.cutId) missing.push('Cut');
  } else if (process === 'holo' || process === 'coning') {
    if (!resolved.yarnId) missing.push('Yarn');
  }
  return missing;
}

// Build a settlement line payload from a resolved row + matched rate.
function buildLine(process, resolved, rate) {
  const ratePerKg = Number(rate.ratePerKg);
  const amount = computeAmount(resolved.netKg, ratePerKg);
  return {
    process,
    sourceRowId: resolved.sourceRowId,
    date: resolved.productionDate,
    quantity: resolved.quantity,
    netKg: roundKg(resolved.netKg),
    ratePerKg,
    amount,
    rateId: rate.id,
    itemId: resolved.itemId,
    itemName: resolved.itemName,
    yarnId: resolved.yarnId,
    yarnName: resolved.yarnName,
    cutId: resolved.cutId,
    cutName: resolved.cutName,
    twistId: resolved.twistId,
    twistName: resolved.twistName,
    coneTypeId: resolved.coneTypeId,
    coneTypeName: resolved.coneTypeName,
    side: resolved.side,
    cutterIssueId: resolved.cutterIssueId,
    cutterIssuedRolls: resolved.cutterIssuedRolls,
    barcode: resolved.barcode,
    lotNo: resolved.lotNo,
  };
}

// Core preview computation. Returns eligible payable lines, per-row blockers,
// quality-wise totals, grand totals, and an exclusion summary for one selected
// production date. The contractorId is explicit for settlement revalidation;
// the preview route resolves it from the current process owner first.
//
// excludeSettlementId: when re-previewing for an existing settlement (admin
// paid-edit "add lines"), rows already claimed by THAT settlement are still
// treated as available.
export async function computePayablePreview(prisma, {
  contractorId,
  process,
  from,
  to,
  date,
  excludeSettlementId = null,
}) {
  // `date` remains supported for older callers; new callers use the explicit
  // period pair so settlement snapshots and revalidation cover the same rows.
  const periodFrom = from || date;
  const periodTo = to || date || periodFrom;
  const [assignments, rates, fetchedRows, maps] = await Promise.all([
    prisma.contractorAssignment.findMany({ where: { contractorId, process } }),
    prisma.contractorRate.findMany({ where: { contractorId, process } }),
    fetchProductionRows(prisma, process, periodFrom, periodTo),
    loadMasterMaps(prisma),
  ]);
  // fetchProductionRows takes LIMIT+1; if we got more than LIMIT for the
  // selected period,
  // results are truncated — surface this instead of silently dropping rows.
  const truncated = fetchedRows.length > ROW_FETCH_LIMIT;
  const rows = truncated ? fetchedRows.slice(0, ROW_FETCH_LIMIT) : fetchedRows;

  // Coning Cut is defined by the holo lineage — resolve it before rate matching.
  if (process === 'coning') {
    maps.coningCutTrace = await traceConingCuts(prisma, rows);
  }

  // Which candidate rows are already claimed by another current settlement.
  const candidateIds = rows.map((r) => r.id);
  const claimLines = candidateIds.length
    ? await prisma.contractorSettlementLine.findMany({
      where: {
        process,
        sourceRowId: { in: candidateIds },
        ...(excludeSettlementId ? { NOT: { settlementId: excludeSettlementId } } : {}),
      },
      select: { sourceRowId: true, settlementId: true },
    })
    : [];
  const claimedRowIds = new Set(claimLines.map((l) => l.sourceRowId));

  const lines = [];
  const blockers = [];
  const excluded = { nonPositiveKg: 0, opening: 0, purchased: 0, claimed: 0 };

  for (const row of rows) {
    const resolved = resolveRow(process, row, maps);
    const marker = { createdBy: resolved.createdBy, lotNo: resolved.lotNo, process };

    // Silent exclusions (non-production income never creates earnings) -------
    if (resolved.netKg === null || resolved.netKg <= 0) { excluded.nonPositiveKg += 1; continue; }
    if (isOpeningStockRow(marker)) { excluded.opening += 1; continue; }
    if (isPurchasedRow(marker)) { excluded.purchased += 1; continue; }
    if (claimedRowIds.has(resolved.sourceRowId)) { excluded.claimed += 1; continue; }

    // Blockers (visible; must be resolved before payment) -------------------
    if (process === 'coning' && (!resolved.side || resolved.side === 'UNKNOWN')) {
      blockers.push({
        sourceRowId: resolved.sourceRowId,
        date: resolved.productionDate,
        netKg: resolved.netKg,
        barcode: resolved.barcode,
        lotNo: resolved.lotNo,
        reason: 'missing_side',
        message: `Item "${resolved.itemName || '—'}" has no Side set (S/S or B/S).`,
      });
      continue;
    }
    if (process === 'coning' && resolved.cutConflict) {
      blockers.push({
        sourceRowId: resolved.sourceRowId,
        date: resolved.productionDate,
        netKg: resolved.netKg,
        barcode: resolved.barcode,
        lotNo: resolved.lotNo,
        reason: 'missing_quality',
        message: 'Conflicting or partially-resolved Cut lineage on this row; fix the referenced holo/coning production data.',
      });
      continue;
    }
    const missing = missingQualityFields(process, resolved);
    if (missing.length) {
      blockers.push({
        sourceRowId: resolved.sourceRowId,
        date: resolved.productionDate,
        netKg: resolved.netKg,
        barcode: resolved.barcode,
        lotNo: resolved.lotNo,
        reason: 'missing_quality',
        message: `Missing ${missing.join(', ')} on the production row.`,
      });
      continue;
    }

    const rowKeys = rowKeysForProcess(process, resolved);
    const match = matchRate(process, rates, rowKeys);
    if (!match.rate) {
      blockers.push({
        sourceRowId: resolved.sourceRowId,
        date: resolved.productionDate,
        netKg: resolved.netKg,
        barcode: resolved.barcode,
        lotNo: resolved.lotNo,
        reason: match.reason, // 'no_rate' | 'ambiguous_rate'
        message: match.reason === 'ambiguous_rate'
          ? 'Multiple equally-specific rates match this row; resolve the overlap.'
          : 'No current rate configured for this quality.',
      });
      continue;
    }
    lines.push(buildLine(process, resolved, match.rate));
  }

  // Quality-wise totals ------------------------------------------------------
  const qualityMap = new Map();
  for (const line of lines) {
    const key = qualityGroupKey(process, line);
    const existing = qualityMap.get(key) || {
      key,
      itemName: line.itemName,
      yarnName: line.yarnName,
      cutName: line.cutName,
      twistName: line.twistName,
      side: line.side,
      coneTypeName: line.coneTypeName,
      ratePerKg: line.ratePerKg,
      netKg: 0,
      amount: 0,
      rowCount: 0,
      issuedRolls: 0,
      issuedRollsKnown: true,
      receivedBobbins: 0,
      receivedBobbinsKnown: true,
      cutterIssueIds: new Set(),
    };
    existing.netKg = roundKg(existing.netKg + line.netKg);
    existing.amount = roundCurrency(existing.amount + line.amount);
    existing.rowCount += 1;
    if (process === 'cutter') {
      const bobbins = resolveQuantity('cutter', { bobbinQuantity: line.quantity });
      if (bobbins === null) existing.receivedBobbinsKnown = false;
      else existing.receivedBobbins += bobbins;

      // The same issue can create several receive rows. Its input roll count
      // must be included once in this quality/rate group, not once per row.
      if (!line.cutterIssueId || line.cutterIssuedRolls === null) {
        existing.issuedRollsKnown = false;
      } else if (!existing.cutterIssueIds.has(line.cutterIssueId)) {
        existing.cutterIssueIds.add(line.cutterIssueId);
        existing.issuedRolls += line.cutterIssuedRolls;
      }
    }
    qualityMap.set(key, existing);
  }
  const qualityTotals = Array.from(qualityMap.values()).map(({ cutterIssueIds, ...total }) => total);

  const productionKg = roundKg(lines.reduce((acc, l) => acc + l.netKg, 0));
  const productionAmount = roundCurrency(lines.reduce((acc, l) => acc + l.amount, 0));
  // These Cutter fields are only needed while aggregating the preview table.
  // Never return them as payable lines: callers persist preview.lines directly
  // into ContractorSettlementLine, whose schema intentionally has no such
  // display-only columns.
  const payableLines = lines.map(({ cutterIssueId, cutterIssuedRolls, ...line }) => line);

  return {
    contractorId,
    process,
    date: periodFrom,
    from: periodFrom,
    to: periodTo,
    hasAssignment: assignments.length > 0,
    assignments,
    lines: payableLines,
    blockers,
    qualityTotals,
    excluded,
    productionKg,
    productionAmount,
    lineCount: lines.length,
    blockerCount: blockers.length,
    truncated,
    rowFetchLimit: ROW_FETCH_LIMIT,
  };
}

// The full payment-defining identity of a line, beyond the numbers. A change to
// any of these must invalidate the snapshot even when the amount is unchanged
// (e.g. Side SINGLE->BOTH at the same ₹ rate, or a different matched rate row).
const LINE_IDENTITY_KEYS = ['rateId', 'itemId', 'yarnId', 'cutId', 'twistId', 'coneTypeId', 'side', 'date', 'quantity'];

function identityValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

// Compare a settlement's stored production lines against a freshly-computed set
// of currently-payable lines and return the lines that no longer reconcile:
// 'no_longer_eligible' (source row deleted / made ineligible / blocked) or
// 'changed' (netKg / rate / amount OR any quality/Side/rate-record/date identity
// drifted from the snapshot). Empty = still valid. Pure so the stale-payment
// guard is directly unit-testable.
export function diffSettlementProduction(storedLines, currentLines) {
  const KG_EPS = 1e-6;
  const RATE_EPS = 1e-6;
  const AMOUNT_EPS = 0.005;
  const currentById = new Map((currentLines || []).map((l) => [l.sourceRowId, l]));
  const mismatches = [];
  for (const line of storedLines || []) {
    const label = line.barcode || line.lotNo || null;
    const cur = currentById.get(line.sourceRowId);
    if (!cur) {
      mismatches.push({ sourceRowId: line.sourceRowId, barcode: label, reason: 'no_longer_eligible' });
      continue;
    }
    const financialDrift = Math.abs(Number(cur.netKg) - Number(line.netKg)) > KG_EPS
      || Math.abs(Number(cur.ratePerKg) - Number(line.ratePerKg)) > RATE_EPS
      || Math.abs(Number(cur.amount) - Number(line.amount)) > AMOUNT_EPS;
    const identityDrift = LINE_IDENTITY_KEYS.some((k) => identityValue(cur[k]) !== identityValue(line[k]));
    if (financialDrift || identityDrift) {
      mismatches.push({ sourceRowId: line.sourceRowId, barcode: label, reason: 'changed' });
    }
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Cross-route production/settlement coordination
// ---------------------------------------------------------------------------

const ROW_TABLES = {
  cutter: 'ReceiveFromCutterMachineRow',
  holo: 'ReceiveFromHoloMachineRow',
  coning: 'ReceiveFromConingMachineRow',
};

// Row-level SELECT ... FOR UPDATE on a table's ids inside an open transaction,
// in sorted order so concurrent lockers acquire consistently (no lock-order
// deadlocks).
async function lockRowsForUpdate(tx, table, ids) {
  const sorted = Array.from(new Set((ids || []).filter(Boolean))).sort();
  if (!sorted.length) return;
  const placeholders = sorted.map((_, i) => `$${i + 1}`).join(', ');
  await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" IN (${placeholders}) FOR UPDATE`, ...sorted);
}

// Take row-level locks on production source rows. Serializes a settlement's
// revalidate-then-pay against concurrent production edit/delete transactions
// on the same rows: an in-flight edit commits (or aborts) before the locker's
// next read, and later edits block until the locking transaction ends.
export async function lockProductionRows(tx, process, rowIds) {
  const table = ROW_TABLES[process];
  if (!table) return;
  await lockRowsForUpdate(tx, table, rowIds);
}

const ISSUE_TABLES = {
  cutter: 'IssueToCutterMachine',
  holo: 'IssueToHoloMachine',
  coning: 'IssueToConingMachine',
};

// Global advisory lock coordinating settlement-line creation with the
// destructive full import: every path that creates settlement lines holds the
// SHARED side inside its transaction; the import holds the EXCLUSIVE side
// around its "no settlement lines exist" check + production deletes, so an
// in-flight claim can neither be missed by the check nor appear afterwards.
const SETTLEMENT_LINES_LOCK = 'contractor_payments:settlement_lines';
export async function lockSettlementLineCreation(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${SETTLEMENT_LINES_LOCK}))`;
}
export async function lockSettlementLinesExclusive(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETTLEMENT_LINES_LOCK}))`;
}

// Advisory lock coordinating Item create/rename/delete with payments whose
// cutter rows resolve their Item by unique NAME (Excel-imported rows without
// an issue link): row locks cannot exclude name-collision phantoms, so writers
// take the exclusive side and cutter payments the shared side.
const ITEM_NAMES_LOCK = 'contractor_payments:item_names';
export async function lockItemNamesShared(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${ITEM_NAMES_LOCK}))`;
}
export async function lockItemNamesExclusive(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ITEM_NAMES_LOCK}))`;
}

// Acquire every lock that stabilizes a settlement's payment inputs inside `tx`:
//  1. advisory locks: the contractor rate (the same key the rate CRUD route
//     holds while mutating), the shared settlement-lines lock, and — for cutter
//     — the shared item-names lock;
//  2. FOR UPDATE locks on the claimed production rows (plus extraRowIds);
//  3. FOR UPDATE locks on the issue rows supplying quality keys — direct
//     issues, and for coning the full Cut lineage (holo rows → holo issues →
//     cutter rows → cutter issues, recursing through re-coning parents);
//  4. FOR UPDATE locks on the Items defining rate identity (line snapshots ∪
//     current issues ∪ name-resolved fallbacks for unlinked cutter rows).
// The acquisition order is fixed (advisories → rows → issues → upstream →
// items); every other path locks a subset in the same relative order, so
// callers cannot deadlock.
// Used by Mark Paid and admin paid-edit before revalidating/pricing.
export async function lockSettlementInputs(tx, settlement, extraRowIds = []) {
  const process = settlement.process;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contractor_rate:${settlement.contractorId}:${process}`}))`;
  await lockSettlementLineCreation(tx);
  if (process === 'cutter') await lockItemNamesShared(tx);
  const rowIds = Array.from(new Set(
    [...(settlement.lines || []).map((l) => l.sourceRowId), ...extraRowIds].filter(Boolean),
  ));
  await lockProductionRows(tx, process, rowIds);
  if (!rowIds.length) return;
  const itemIds = new Set((settlement.lines || []).map((l) => l.itemId).filter(Boolean));

  if (process === 'cutter') {
    const rows = await tx.receiveFromCutterMachineRow.findMany({
      where: { id: { in: rowIds } },
      select: { issueId: true, itemName: true, issue: { select: { itemId: true } } },
    });
    await lockRowsForUpdate(tx, ISSUE_TABLES.cutter, rows.map((r) => r.issueId));
    const fallbackNames = [];
    for (const r of rows) {
      if (r.issue?.itemId) itemIds.add(r.issue.itemId);
      else if (typeof r.itemName === 'string' && r.itemName.trim()) fallbackNames.push(r.itemName.trim().toLowerCase());
    }
    if (fallbackNames.length) {
      const names = Array.from(new Set(fallbackNames));
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const named = await tx.$queryRawUnsafe(
        `SELECT "id" FROM "Item" WHERE LOWER(BTRIM("name")) IN (${placeholders})`, ...names,
      );
      named.forEach((r) => itemIds.add(r.id));
    }
  } else if (process === 'holo') {
    const rows = await tx.receiveFromHoloMachineRow.findMany({
      where: { id: { in: rowIds } }, select: { issueId: true },
    });
    await lockRowsForUpdate(tx, ISSUE_TABLES.holo, rows.map((r) => r.issueId));
    return; // holo rates reference no Item
  } else {
    // Coning: lock-couple down the Cut lineage — lock each level, then read
    // its pointers (stable once locked), then lock the next level.
    const rows = await tx.receiveFromConingMachineRow.findMany({
      where: { id: { in: rowIds } }, select: { issueId: true },
    });
    let issueFrontier = Array.from(new Set(rows.map((r) => r.issueId).filter(Boolean)));
    const visitedIssues = new Set(issueFrontier);
    while (issueFrontier.length) {
      await lockRowsForUpdate(tx, ISSUE_TABLES.coning, issueFrontier);
      const issues = await tx.issueToConingMachine.findMany({
        where: { id: { in: issueFrontier } },
        select: { itemId: true, receivedRowRefs: true },
      });
      issues.forEach((i) => { if (i.itemId) itemIds.add(i.itemId); });
      const refIds = Array.from(new Set(issues.flatMap((i) => parseRefRowIds(i.receivedRowRefs))));
      if (!refIds.length) break;
      await lockRowsForUpdate(tx, ROW_TABLES.holo, refIds);
      await lockRowsForUpdate(tx, ROW_TABLES.coning, refIds);
      const [holoRows, parentRows] = await Promise.all([
        tx.receiveFromHoloMachineRow.findMany({ where: { id: { in: refIds } }, select: { issueId: true } }),
        tx.receiveFromConingMachineRow.findMany({ where: { id: { in: refIds } }, select: { issueId: true } }),
      ]);
      const holoIssueIds = Array.from(new Set(holoRows.map((r) => r.issueId).filter(Boolean)));
      if (holoIssueIds.length) {
        await lockRowsForUpdate(tx, ISSUE_TABLES.holo, holoIssueIds);
        const holoIssues = await tx.issueToHoloMachine.findMany({
          where: { id: { in: holoIssueIds } }, select: { cutId: true, receivedRowRefs: true },
        });
        const cutterIds = Array.from(new Set(
          holoIssues.filter((h) => !h.cutId).flatMap((h) => parseRefRowIds(h.receivedRowRefs)),
        ));
        if (cutterIds.length) {
          await lockRowsForUpdate(tx, ROW_TABLES.cutter, cutterIds);
          const cutterRows = await tx.receiveFromCutterMachineRow.findMany({
            where: { id: { in: cutterIds } }, select: { cutId: true, issueId: true },
          });
          await lockRowsForUpdate(
            tx, ISSUE_TABLES.cutter,
            cutterRows.filter((r) => !r.cutId).map((r) => r.issueId),
          );
        }
      }
      issueFrontier = Array.from(new Set(parentRows.map((r) => r.issueId).filter(Boolean)))
        .filter((id) => !visitedIssues.has(id));
      issueFrontier.forEach((id) => visitedIssues.add(id));
    }
  }
  await lockRowsForUpdate(tx, 'Item', Array.from(itemIds));
}

// Reject (409) when any of the given receive rows is claimed by a PAID
// settlement. Read-only: callers must already hold locks that serialize this
// check against a concurrent Mark Paid.
async function assertRowsNotPaidClaimed(tx, process, rowIds, message) {
  const ids = Array.from(new Set((rowIds || []).filter(Boolean)));
  if (!ids.length) return;
  const claims = await tx.contractorSettlementLine.findMany({
    where: { process, sourceRowId: { in: ids }, settlement: { status: 'paid' } },
    select: { sourceRowId: true, settlementId: true },
  });
  if (claims.length) throw Object.assign(new Error(message), { statusCode: 409, claims });
}

// Coning issues whose receivedRowRefs point at any of the given receive rows.
async function coningIssueIdsReferencingRows(tx, rowIds) {
  if (!rowIds.length) return [];
  const rows = await tx.$queryRaw`
    SELECT id FROM "IssueToConingMachine"
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
      WHERE elem->>'rowId' = ANY (${rowIds}::text[])
    )`;
  return rows.map((r) => r.id);
}
async function holoIssueIdsReferencingRows(tx, rowIds) {
  if (!rowIds.length) return [];
  const rows = await tx.$queryRaw`
    SELECT id FROM "IssueToHoloMachine"
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements("receivedRowRefs") AS elem
      WHERE elem->>'rowId' = ANY (${rowIds}::text[])
    )`;
  return rows.map((r) => r.id);
}
// 409 when any coning receive row DOWNSTREAM of the given receive rows —
// following re-coning refs recursively (a visited set caps ref cycles) — is
// claimed by a PAID settlement. Every descendant's traced quality flows
// through the edited upstream issue, so all of them freeze it, not just the
// first level of referencing coning issues.
async function assertConingDescendantsNotPaid(tx, rowIds, message) {
  let frontier = Array.from(new Set((rowIds || []).filter(Boolean)));
  const visitedIssues = new Set();
  while (frontier.length) {
    const issueIds = (await coningIssueIdsReferencingRows(tx, frontier))
      .filter((id) => !visitedIssues.has(id));
    if (!issueIds.length) return;
    issueIds.forEach((id) => visitedIssues.add(id));
    const rows = await tx.receiveFromConingMachineRow.findMany({
      where: { issueId: { in: issueIds } }, select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    await assertRowsNotPaidClaimed(tx, 'coning', ids, message);
    frontier = ids;
  }
}

// Lock the given production rows, then reject (409) when any of them is
// claimed by a PAID settlement — that money already went out, so production
// corrections must flow through the admin paid-edit workflow (which records an
// immutable revision). Draft claims stay editable: Mark Paid revalidates under
// the same row locks and 409s on drift. MUST run inside the same transaction
// as the production mutation, BEFORE it, so a concurrent Mark Paid either
// commits first (this sees status 'paid' and refuses) or blocks on these row
// locks until this transaction ends and then 409s on the drift it finds.
export async function assertProductionRowsEditable(tx, process, rowIds) {
  const ids = Array.from(new Set((rowIds || []).filter(Boolean)));
  if (!ids.length) return;
  await lockProductionRows(tx, process, ids);
  await assertRowsNotPaidClaimed(
    tx, process, ids,
    'This production row belongs to a PAID contractor settlement. Correct the settlement via the admin paid-edit workflow instead of editing production.',
  );
}

// Guard an issue edit/delete: the issue supplies quality keys (yarn/cut/twist/
// Item/lineage refs) for its receive rows, so it is frozen once any dependent
// row is PAID — directly (its own rows' claims) or downstream through the Cut
// lineage (holo issues feed coning cuts; cutter rows feed cut-less holo
// issues; re-coning parents feed child coning issues). MUST run inside the
// mutation's transaction, first: it locks the issue's rows then the issue row
// itself (same relative order as lockSettlementInputs), so a concurrent Mark
// Paid either committed (seen here → 409) or blocks until this rolls back.
export async function assertIssueEditable(tx, process, issueId) {
  const MSG = 'This issue feeds production rows in a PAID contractor settlement. Correct the settlement via the admin paid-edit workflow instead of editing the issue.';
  const rowModel = process === 'cutter'
    ? tx.receiveFromCutterMachineRow
    : process === 'holo' ? tx.receiveFromHoloMachineRow : tx.receiveFromConingMachineRow;
  const rows = await rowModel.findMany({ where: { issueId }, select: { id: true } });
  const rowIds = rows.map((r) => r.id);
  await lockProductionRows(tx, process, rowIds);
  await lockRowsForUpdate(tx, ISSUE_TABLES[process], [issueId]);
  await assertRowsNotPaidClaimed(tx, process, rowIds, MSG);
  if (!rowIds.length) return;
  if (process === 'holo' || process === 'coning') {
    // Coning issues referencing these rows — and their re-coning descendants,
    // recursively — trace their Cut through this issue.
    await assertConingDescendantsNotPaid(tx, rowIds, MSG);
  } else {
    // Cutter rows feed cut-less holo issues, whose rows feed coning cuts
    // (then re-coning descendants, recursively).
    const holoIssueIds = await holoIssueIdsReferencingRows(tx, rowIds);
    if (holoIssueIds.length) {
      const holoRows = await tx.receiveFromHoloMachineRow.findMany({
        where: { issueId: { in: holoIssueIds } }, select: { id: true },
      });
      await assertConingDescendantsNotPaid(tx, holoRows.map((r) => r.id), MSG);
    }
  }
}

// Recompute a stored settlement's totals from its lines + adjustments.
export function recomputeSettlementTotals(lines, adjustments) {
  const productionKg = roundKg(lines.reduce((acc, l) => acc + Number(l.netKg || 0), 0));
  const productionAmount = roundCurrency(lines.reduce((acc, l) => acc + Number(l.amount || 0), 0));
  const totals = computeTotals(productionAmount, adjustments);
  return {
    productionKg,
    productionAmount: totals.productionAmount,
    adjustmentsTotal: totals.adjustmentsTotal,
    finalPayable: totals.finalPayable,
  };
}
