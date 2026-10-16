import { computeIssueBalancesBatch } from './issueBalances.js';

// Morning sticker run for coning issues: the issuer prints every batch barcode of a date/shift
// range in one go and hands the stack to the coning supervisor. Unused stickers are thrown away
// at the end of the shift; batches with material still to receive are carried over and get
// fresh stickers in the next run.
const SHIFTS = ['Day', 'Night'];
// Batches older than this are not looked at for carry-over; older than STALE_DAYS are flagged.
const CARRY_LOOKBACK_DAYS = 14;
export const STALE_DAYS = 2;
const PENDING_EPSILON_KG = 0.001;
const MAX_ROWS = 500;
const MAX_COPIES = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ConingStickerRunError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

const refsOf = (value) => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
};

const normalizeShifts = (value) => {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return SHIFTS.filter((shift) => list.some((entry) => String(entry).trim().toLowerCase() === shift.toLowerCase()));
};

// Shift is optional on coning issues: an issue without one belongs to its whole date, so it is
// listed whenever any shift of that date is in range (printed tracking keeps it from printing twice).
const dayClause = (date, shifts) => {
  if (shifts.length === SHIFTS.length) return { date };
  return { date, OR: [{ shift: { in: shifts } }, { shift: null }, { shift: '' }] };
};

export function stickerRunWhere({ dateFrom, dateTo, fromShifts, toShifts }) {
  if (!DATE_RE.test(dateFrom || '') || !DATE_RE.test(dateTo || '')) throw new ConingStickerRunError('Choose a from and to date');
  if (dateFrom > dateTo) throw new ConingStickerRunError('The from date is after the to date');
  const from = normalizeShifts(fromShifts);
  const to = normalizeShifts(toShifts);
  if (!from.length || !to.length) throw new ConingStickerRunError('Choose at least one shift for each date');
  if (dateFrom === dateTo) {
    const shifts = SHIFTS.filter((shift) => from.includes(shift) || to.includes(shift));
    return { isDeleted: false, ...dayClause(dateFrom, shifts) };
  }
  return {
    isDeleted: false,
    OR: [dayClause(dateFrom, from), dayClause(dateTo, to), { date: { gt: dateFrom, lt: dateTo } }],
  };
}

export function stickerStatus(issue) {
  if (!issue.stickerPrintedAt) return 'not_printed';
  return issue.coningBatchRevision > issue.stickerPrintedRevision ? 'changed' : 'printed';
}

const nameMap = async (delegate, ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await delegate.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
};

// Roll type lives on the source crates (holo receive rows, or coning receive rows for re-coning).
async function rollTypeNamesByIssue(client, issues) {
  const rowIdsByIssue = new Map(issues.map((issue) => [issue.id, refsOf(issue.receivedRowRefs).map((ref) => ref.rowId).filter(Boolean)]));
  const allIds = [...new Set([...rowIdsByIssue.values()].flat())];
  if (!allIds.length) return new Map();
  const holoRows = await client.receiveFromHoloMachineRow.findMany({
    where: { id: { in: allIds } }, select: { id: true, rollType: { select: { name: true } } },
  });
  const typeByRow = new Map(holoRows.map((row) => [row.id, row.rollType?.name || '']));
  const result = new Map();
  for (const [issueId, rowIds] of rowIdsByIssue) {
    result.set(issueId, [...new Set(rowIds.map((id) => typeByRow.get(id)).filter(Boolean))].join(', '));
  }
  return result;
}

const ISSUE_SELECT = {
  id: true, date: true, shift: true, barcode: true, lotNo: true, itemId: true, cutId: true, yarnId: true, twistId: true,
  machineId: true, operatorId: true, rollsIssued: true, expectedCones: true, requiredPerConeNetWeight: true,
  receivedRowRefs: true, coningBatchOpen: true, coningBatchEnabled: true, coningBatchRevision: true,
  stickerPrintedAt: true, stickerPrintedCopies: true, stickerPrintedCrates: true, stickerPrintedRevision: true,
  stickerCarryPrintedFor: true, stickerCarryPrintedAt: true, stickerCarryPrintedCopies: true, note: true,
};

// Opening-stock coning receives create a placeholder issue (note "Opening Stock", no source
// crate) only so the receive has a barcode. Nothing was issued to a worker, so no sticker.
export const isOpeningStockEntry = (issue) => issue.note === 'Opening Stock'
  && !refsOf(issue.receivedRowRefs).some((ref) => ref && ref.rowId);

const shiftRank = (shift) => (shift === 'Night' ? 1 : 0);
const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const isoDaysBefore = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

// A shift that ended before the range starts: an earlier date, or the Day shift of the first
// date when the range starts with that date's Night shift.
export const isBeforeRange = (issue, { dateFrom, fromShifts }) => {
  const from = normalizeShifts(fromShifts);
  if (issue.date < dateFrom) return true;
  if (issue.date > dateFrom) return false;
  const startRank = Math.min(...from.map(shiftRank));
  return Boolean(issue.shift) && shiftRank(issue.shift) < startRank;
};

// Containers still to come: the material left over the average container received so far.
export const estimateContainers = (pendingWeight, receivedWeight, receivedContainers) => {
  if (!(receivedContainers > 0) || !(receivedWeight > 0)) return null;
  return Math.max(1, Math.ceil(pendingWeight / (receivedWeight / receivedContainers)));
};

export async function listConingStickerRun(client, params) {
  const where = stickerRunWhere(params);
  const issues = await client.issueToConingMachine.findMany({
    where,
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ROWS + 1,
    select: ISSUE_SELECT,
  });
  const truncated = issues.length > MAX_ROWS;
  if (truncated) issues.length = MAX_ROWS;
  const stickered = issues.filter((issue) => !isOpeningStockEntry(issue));
  const reprints = await reprintSummary(client, stickered.map((issue) => issue.id));
  const rows = (await describeIssues(client, stickered)).map((row, index) => ({
    ...row, status: stickerStatus(stickered[index]), ...(reprints.get(row.id) || { reprintCopies: 0, lastReprintAt: null }),
  }));
  // Apps from before carry-over (desktop 1.2.7 and older) do not ask for it and would misread it.
  const carryOver = params.includeCarryOver ? await listCarryOver(client, params, new Set(issues.map((issue) => issue.id))) : [];
  return { rows: [...carryOver, ...rows], truncated };
}

async function listCarryOver(client, params, inRangeIds) {
  const candidates = (await client.issueToConingMachine.findMany({
    where: { isDeleted: false, date: { gte: isoDaysBefore(params.dateFrom, CARRY_LOOKBACK_DAYS), lte: params.dateFrom } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ROWS,
    select: ISSUE_SELECT,
  })).filter((issue) => !inRangeIds.has(issue.id) && !isOpeningStockEntry(issue) && isBeforeRange(issue, params)
    && (!issue.coningBatchEnabled || issue.coningBatchOpen));
  if (!candidates.length) return [];
  const balances = await computeIssueBalancesBatch(client, 'coning', candidates);
  const open = candidates.filter((issue) => Number(balances.get(issue.id)?.pendingWeight || 0) > PENDING_EPSILON_KG);
  if (!open.length) return [];
  const received = await client.receiveFromConingMachineRow.groupBy({
    by: ['issueId'], where: { issueId: { in: open.map((issue) => issue.id) }, isDeleted: false },
    _count: { _all: true }, _sum: { netWeight: true },
  });
  const receivedById = new Map(received.map((r) => [r.issueId, { containers: r._count._all, weight: Number(r._sum.netWeight || 0) }]));
  const described = await describeIssues(client, open);
  const reprints = await reprintSummary(client, open.map((issue) => issue.id));
  return described.map((row, index) => {
    const issue = open[index];
    const pendingWeight = Number(Number(balances.get(issue.id).pendingWeight).toFixed(3));
    const got = receivedById.get(issue.id) || { containers: 0, weight: 0 };
    const ageDays = dayNumber(params.dateTo) - dayNumber(issue.date);
    const printed = issue.stickerCarryPrintedFor === params.dateTo;
    return {
      ...row,
      carryOver: true,
      status: printed ? 'carry_printed' : 'carry_over',
      pendingWeight,
      receivedWeight: Number(got.weight.toFixed(3)),
      receivedContainers: got.containers,
      estimatedContainers: estimateContainers(pendingWeight, got.weight, got.containers),
      ageDays,
      stale: ageDays > STALE_DAYS,
      printedAt: printed ? issue.stickerCarryPrintedAt : null,
      printedCopies: printed ? issue.stickerCarryPrintedCopies : 0,
      ...(reprints.get(issue.id) || { reprintCopies: 0, lastReprintAt: null }),
    };
  });
}

// Reprints never replace the original print record; they are listed beside it.
async function reprintSummary(client, issueIds) {
  if (!issueIds.length || !client.coningStickerPrint) return new Map();
  const logs = await client.coningStickerPrint.findMany({
    where: { issueId: { in: issueIds }, kind: { in: ['reprint', 'carry_reprint'] } },
    select: { issueId: true, copies: true, createdAt: true },
  });
  const out = new Map();
  for (const log of logs) {
    const acc = out.get(log.issueId) || { reprintCopies: 0, lastReprintAt: null };
    acc.reprintCopies += log.copies;
    if (!acc.lastReprintAt || log.createdAt > acc.lastReprintAt) acc.lastReprintAt = log.createdAt;
    out.set(log.issueId, acc);
  }
  return out;
}

async function describeIssues(client, issues) {
  if (!issues.length) return [];
  const refsById = new Map(issues.map((issue) => [issue.id, refsOf(issue.receivedRowRefs)]));
  const firstRef = (issue) => refsById.get(issue.id)[0] || {};
  const [items, cuts, yarns, twists, machines, operators, coneTypes, wrappers, rollTypes] = await Promise.all([
    nameMap(client.item, issues.map((issue) => issue.itemId)),
    nameMap(client.cut, issues.map((issue) => issue.cutId)),
    nameMap(client.yarn, issues.map((issue) => issue.yarnId)),
    nameMap(client.twist, issues.map((issue) => issue.twistId)),
    nameMap(client.machine, issues.map((issue) => issue.machineId)),
    nameMap(client.operator, issues.map((issue) => issue.operatorId)),
    nameMap(client.coneType, issues.map((issue) => firstRef(issue).coneTypeId)),
    nameMap(client.wrapper, issues.map((issue) => firstRef(issue).wrapperId)),
    rollTypeNamesByIssue(client, issues),
  ]);

  const rows = issues.map((issue) => {
    const refs = refsById.get(issue.id);
    const ref = refs[0] || {};
    const netWeight = Number(refs.reduce((sum, item) => sum + Number(item.issueWeight || 0), 0).toFixed(3));
    return {
      id: issue.id,
      barcode: issue.barcode,
      date: issue.date,
      shift: issue.shift || '',
      lotNo: issue.lotNo,
      operatorName: operators.get(issue.operatorId) || '',
      machineName: machines.get(issue.machineId) || '',
      itemName: items.get(issue.itemId) || '',
      cut: cuts.get(issue.cutId) || '',
      yarnName: yarns.get(issue.yarnId) || '',
      twist: twists.get(issue.twistId) || '',
      coneType: coneTypes.get(ref.coneTypeId) || '',
      wrapperName: wrappers.get(ref.wrapperId) || '',
      rollType: rollTypes.get(issue.id) || '',
      crates: refs.length,
      rollCount: issue.rollsIssued,
      netWeight,
      expectedCones: issue.expectedCones,
      perConeTargetG: issue.requiredPerConeNetWeight,
      batchOpen: issue.coningBatchEnabled ? issue.coningBatchOpen : null,
      revision: issue.coningBatchRevision,
      carryOver: false,
      printedAt: issue.stickerPrintedAt,
      printedCopies: issue.stickerPrintedCopies,
      printedCrates: issue.stickerPrintedCrates,
    };
  });
  return rows;
}

// What a confirmed print was, decided from the record rather than the screen, so an older app
// cannot overwrite the original print: first print, extra copies for crates added after it,
// a reprint of stickers already printed, or the day's carry-over stickers.
export const printKind = (issue, { carryOver, printedFor }) => {
  if (carryOver) return issue.stickerCarryPrintedFor === printedFor ? 'carry_reprint' : 'carry_over';
  if (!issue.stickerPrintedAt) return 'first';
  return issue.coningBatchRevision > issue.stickerPrintedRevision ? 'top_up' : 'reprint';
};

const printUpdate = (issue, kind, { copies, revision, printedFor, now, actorUserId }) => {
  const crates = refsOf(issue.receivedRowRefs).length;
  // The revision the printed stickers showed, so a batch that grew after the list loaded
  // still shows as changed instead of silently counting as printed.
  const printedRevision = Math.min(revision, issue.coningBatchRevision);
  if (kind === 'first') {
    return { stickerPrintedAt: now, stickerPrintedCopies: copies, stickerPrintedCrates: crates, stickerPrintedRevision: printedRevision, stickerPrintedByUserId: actorUserId || null };
  }
  if (kind === 'top_up') {
    return { stickerPrintedCopies: (issue.stickerPrintedCopies || 0) + copies, stickerPrintedCrates: crates, stickerPrintedRevision: printedRevision };
  }
  if (kind === 'carry_over') {
    return { stickerCarryPrintedFor: printedFor, stickerCarryPrintedAt: now, stickerCarryPrintedCopies: copies };
  }
  return null;
};

export async function markConingStickersPrinted(client, entries, actorUserId, printedFor) {
  if (!Array.isArray(entries) || !entries.length) throw new ConingStickerRunError('Choose at least one barcode');
  if (entries.some((entry) => entry?.carryOver) && !DATE_RE.test(printedFor || '')) throw new ConingStickerRunError('Carried-over stickers need the date they were printed for');
  if (entries.length > MAX_ROWS) throw new ConingStickerRunError('Too many barcodes in one print');
  const byId = new Map();
  for (const entry of entries) {
    const copies = Number(entry?.copies);
    const revision = Number(entry?.revision);
    if (typeof entry?.id !== 'string' || !Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES || !Number.isInteger(revision)) {
      throw new ConingStickerRunError('Each barcode needs between 1 and 100 copies');
    }
    byId.set(entry.id, { copies, revision, carryOver: entry.carryOver === true });
  }
  const issues = await client.issueToConingMachine.findMany({
    where: { id: { in: [...byId.keys()] }, isDeleted: false },
    select: {
      id: true, receivedRowRefs: true, coningBatchRevision: true, stickerPrintedAt: true, stickerPrintedCopies: true,
      stickerPrintedRevision: true, stickerCarryPrintedFor: true,
    },
  });
  if (issues.length !== byId.size) throw new ConingStickerRunError('Some barcodes were deleted. Reload the list.', 409);
  const now = new Date();
  const kinds = {};
  const run = typeof client.$transaction === 'function' ? (fn) => client.$transaction(fn) : (fn) => fn(client);
  await run(async (tx) => {
    for (const issue of issues) {
      const { copies, revision, carryOver } = byId.get(issue.id);
      const kind = printKind(issue, { carryOver, printedFor });
      kinds[kind] = (kinds[kind] || 0) + 1;
      const data = printUpdate(issue, kind, { copies, revision, printedFor, now, actorUserId });
      if (data) await tx.issueToConingMachine.update({ where: { id: issue.id }, data });
      if (tx.coningStickerPrint) {
        await tx.coningStickerPrint.create({ data: {
          issueId: issue.id, kind, copies, printedFor: carryOver ? printedFor : null, createdByUserId: actorUserId || null,
        } });
      }
    }
  });
  return { printedAt: now, count: issues.length, kinds };
}
