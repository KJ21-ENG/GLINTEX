import { createHash } from 'node:crypto';
import { validateFilters, validDate, ReportInputError } from './filters.js';
import { quantities, totals } from './quantities.js';
import { createCutResolver, parseRefs } from './lineage.js';
import { loadSources } from './repository.js';

const byId = rows => new Map(rows.map(row => [row.id, row]));
const compare = (a, b) => String(a).localeCompare(String(b), 'en');
const normalize = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

function dimension(ids, master, context, partial = false) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  const values = unique.map(id => ({ id, name: normalize(master.get(id)?.name) || `Unknown (${id})` }));
  const unresolved = partial || unique.some(id => !master.has(id));
  const state = unresolved ? (unique.length ? 'partial' : 'unresolved') : unique.length > 1 ? 'mixed' : unique.length ? 'resolved' : 'missing';
  return { state, values, label: values.length ? `${state === 'mixed' ? 'Mixed: ' : state === 'partial' ? 'Partial: ' : ''}${values.map(v => v.name).join(' / ')}` : 'Unresolved',
    key: JSON.stringify([state, unique, state !== 'resolved' && state !== 'mixed' ? context : null]) };
}

function openingReason(row) {
  const marker = normalize(row.createdBy || '').toLowerCase();
  if (['opening', 'opening_bulk'].includes(marker)) return 'coning_opening_stock';
  // The bulk opening writer creates no row.createdBy marker. Its own-stage
  // synthetic issue note is authoritative; upstream OP-/CP- lots are not.
  const note = normalize(row.issue?.note || '').toLowerCase();
  if (['opening stock', 'opening stock bulk'].includes(note)) return 'coning_opening_stock';
  return null;
}

function qualityFor(row, sources, resolveCut, resolveYarn, resolveTwist) {
  const issue = row.issue;
  const context = issue.id;
  const item = dimension([issue.itemId], sources.items, context);
  const sideValue = sources.items.get(issue.itemId)?.side;
  const side = ['SINGLE', 'BOTH'].includes(sideValue) ? sideValue : 'UNKNOWN';
  const yarnTrace = issue.yarnId ? null : resolveYarn(row);
  const twistTrace = issue.twistId ? null : resolveTwist(row);
  const yarn = dimension(issue.yarnId ? [issue.yarnId] : yarnTrace.ids, sources.yarns, JSON.stringify([context, yarnTrace?.paths || []]), yarnTrace?.unresolved);
  const twist = dimension(issue.twistId ? [issue.twistId] : twistTrace.ids, sources.twists, JSON.stringify([context, twistTrace?.paths || []]), twistTrace?.unresolved);
  const trace = resolveCut(row);
  const cut = dimension(trace.ids, sources.cuts, `${context}:${trace.paths.join(',')}`, trace.unresolved);
  const refs = parseRefs(issue.receivedRowRefs, { allowConeMetadata: true });
  const coneType = dimension(refs.refs.map(ref => ref?.coneTypeId), sources.coneTypes, context,
    refs.malformed || (refs.refs.some(ref => ref?.coneTypeId) && refs.refs.some(ref => !ref?.coneTypeId)));
  const rawTarget = issue.requiredPerConeNetWeight;
  const targetSizeGrams = typeof rawTarget === 'number' && Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : null;
  const quality = { item, side, yarn, cut, twist, coneType, targetSizeGrams };
  const key = JSON.stringify([item.key, side, yarn.key, cut.key, twist.key, coneType.key, targetSizeGrams, targetSizeGrams === null ? context : null]);
  return { quality: { ...quality, key }, provenance: { cut: trace, yarn: yarnTrace, twist: twistTrace, yarnBasis: yarnTrace ? 'source_trace' : 'issue_recorded', twistBasis: twistTrace ? 'source_trace' : 'issue_recorded', coneTypeBasis: 'issue_receivedRowRefs', targetSizeUnit: 'grams' },
    flags: [...new Set([...trace.flags, ...['item', 'yarn', 'cut', 'twist', 'coneType'].filter(d => quality[d].state !== 'resolved').map(d => `${d}_${quality[d].state}`),
      ...(side === 'UNKNOWN' ? ['side_unknown'] : []), ...(targetSizeGrams === null ? ['target_size_missing'] : [])])] };
}


// Worker payloads retain public quality labels/states and opaque grouping keys,
// but never internal issue IDs or trace paths embedded in office grouping keys.
function workerQuality(quality) {
  const result = { side: quality.side, targetSizeGrams: quality.targetSizeGrams,
    key: createHash('sha256').update(quality.key).digest('hex') };
  for (const name of ['item', 'yarn', 'cut', 'twist', 'coneType']) {
    const { state, values, label } = quality[name];
    result[name] = { state, values, label };
  }
  return result;
}

function aggregate(rows, keyOf, labelOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].sort(([a], [b]) => compare(a, b)).map(([key, entries]) => ({ key, ...labelOf(entries[0]), totals: totals(entries) }));
}

export function normalizeReport(sources, filters) {
  const masters = { ...sources, items: byId(sources.items), yarns: byId(sources.yarns), twists: byId(sources.twists), cuts: byId(sources.cuts), coneTypes: byId(sources.coneTypes) };
  const resolveCut = createCutResolver(sources.graph);
  const resolveYarn = createCutResolver(sources.graph, 'yarnId');
  const resolveTwist = createCutResolver(sources.graph, 'twistId');
  const details = [];
  const exceptions = [];
  const excluded = [];
  const workers = new Map();
  const seen = new Set();
  for (const row of [...sources.periodRows, ...sources.undatedRows]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const quantity = quantities(row);
    const base = { receiveRowId: row.id, issueId: row.issueId, workerId: row.operatorId || null,
      date: validDate(row.date) ? row.date : null, recordedDate: row.date,
      lotNo: row.issue?.lotNo || null, receiveBarcode: row.barcode || null, issueBarcode: row.issue?.barcode || null,
      cones: quantity.cones, netKg: quantity.netKg, netGrams: quantity.netGrams, weightSource: quantity.weightSource,
      recordedQuantities: Object.fromEntries(['coneCount', 'netWeight', 'coneWeight', 'grossWeight', 'tareWeight'].map(key =>
        [key, typeof row[key] === 'number' && !Number.isFinite(row[key]) ? String(row[key]) : row[key] ?? null])) };
    const inPeriod = base.date && base.date >= filters.period.startInclusive && base.date < filters.period.effectiveEndExclusive;
    if (base.date && !inPeriod) continue;
    const excludedReason = row.isDeleted ? 'deleted_receive' : openingReason(row);
    if (excludedReason) { if (inPeriod) excluded.push({ ...base, reasons: [excludedReason] }); continue; }
    const reasons = [];
    if (!base.date) reasons.push('invalid_work_date');
    if (!row.issue) reasons.push('missing_issue');
    if (row.issue?.isDeleted) reasons.push('deleted_issue');
    if (!row.operatorId || row.operator?.id !== row.operatorId) reasons.push('missing_worker');
    if (quantity.invalid) reasons.push(...quantity.flags.filter(f => f !== 'unknown_net_weight'));
    if (reasons.length) {
      exceptions.push({ ...base, periodAssignment: base.date ? 'selected_month' : 'unassigned', reasons });
      continue;
    }
    const resolved = qualityFor(row, masters, resolveCut, resolveYarn, resolveTwist);
    workers.set(row.operatorId, { id: row.operatorId, name: row.operator.name, reference: row.operatorId });
    details.push({ ...base, workerName: row.operator.name,
      machine: { id: row.issue.machineId || null, name: normalize(row.machineNo) || row.issue.machine?.name || 'Unrecorded' },
      quality: resolved.quality, provenance: { ...resolved.provenance, weightSource: quantity.weightSource }, flags: [...quantity.flags, ...resolved.flags] });
  }
  details.sort((a, b) => compare(a.date, b.date) || compare(a.receiveRowId, b.receiveRowId));
  const workerOptions = [...workers.values()].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
  const selected = filters.workerId === 'all' ? details : details.filter(row => row.workerId === filters.workerId);
  const selectedWorkers = workerOptions.filter(worker => filters.workerId === 'all' || worker.id === filters.workerId);
  const statements = selectedWorkers.map(worker => {
    const rows = selected.filter(row => row.workerId === worker.id);
    return { worker, rows: rows.map(({ date, machine, quality, cones, netKg, netGrams }) => ({ date, machine, quality: workerQuality(quality), cones, netKg, netGrams })),
      qualitySummary: aggregate(rows, row => workerQuality(row.quality).key, row => ({ quality: workerQuality(row.quality) })),
      dailyTotals: aggregate(rows, row => row.date, row => ({ date: row.date })), monthlyTotals: totals(rows) };
  });
  const periodExceptions = exceptions.filter(row => row.periodAssignment === 'selected_month');
  const unassigned = exceptions.filter(row => row.periodAssignment === 'unassigned');
  return {
    process: 'coning', month: filters.month, workerId: filters.workerId, period: filters.period, generatedAt: filters.generatedAt,
    workerOptions, statements,
    office: { details: selected, exceptions: periodExceptions, unassignedPeriodExceptions: unassigned, excluded,
      totals: totals(details), selectedTotals: totals(selected), exceptionTotals: totals(periodExceptions), excludedTotals: totals(excluded),
      reconciliation: { periodAccounted: totals([...details, ...periodExceptions, ...excluded]), eligibleRowCount: details.length,
        exceptionRowCount: periodExceptions.length, excludedRowCount: excluded.length, unassignedRowCount: unassigned.length } },
    metrics: sources.metrics,
  };
}

export async function buildWorkerMonthlyReport(prisma, input = {}, { now = new Date() } = {}) {
  const filters = validateFilters(input, now);
  // Every report/export is derived inside one repeatable-read snapshot. Never
  // truncate here: pagination is an API presentation concern only.
  return prisma.$transaction(async client => normalizeReport(await loadSources(client, filters), filters),
    { isolationLevel: 'RepeatableRead', timeout: 60000, maxWait: 10000 });
}

export function toWorkerStatement(report, workerId) {
  const statement = report.statements.find(entry => entry.worker.id === workerId);
  if (!statement) throw new ReportInputError('No qualifying work for the selected worker');
  return { title: 'Coning — Monthly Work Statement', companyName: 'GLINTEX', process: report.process,
    month: report.month, period: report.period, generatedAt: report.generatedAt, ...statement };
}
