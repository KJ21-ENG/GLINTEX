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
  stickerCarryPrintedFor: true, stickerCarryPrintedAt: true, stickerCarryPrintedCopies: true,
};

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
  const rows = (await describeIssues(client, issues)).map((row, index) => ({ ...row, status: stickerStatus(issues[index]) }));
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
  })).filter((issue) => !inRangeIds.has(issue.id) && isBeforeRange(issue, params)
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
    };
  });
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
    select: { id: true, receivedRowRefs: true, coningBatchRevision: true },
  });
  if (issues.length !== byId.size) throw new ConingStickerRunError('Some barcodes were deleted. Reload the list.', 409);
  const now = new Date();
  // Record the revision the printed stickers showed, so a batch that grew after the list loaded
  // still shows as changed instead of silently counting as printed.
  await Promise.all(issues.map((issue) => {
    const { copies, revision, carryOver } = byId.get(issue.id);
    // A carry-over reprint is recorded against the day it was printed for, so the original
    // print record stays and the batch can carry over again tomorrow if still not finished.
    if (carryOver) {
      return client.issueToConingMachine.update({
        where: { id: issue.id },
        data: { stickerCarryPrintedFor: printedFor, stickerCarryPrintedAt: now, stickerCarryPrintedCopies: copies },
      });
    }
    const printedRevision = Math.min(revision, issue.coningBatchRevision);
    return client.issueToConingMachine.update({
      where: { id: issue.id },
      data: {
        stickerPrintedAt: now,
        stickerPrintedCopies: copies,
        stickerPrintedCrates: refsOf(issue.receivedRowRefs).length,
        stickerPrintedRevision: printedRevision,
        stickerPrintedByUserId: actorUserId || null,
      },
    });
  }));
  return { printedAt: now, count: issues.length };
}
