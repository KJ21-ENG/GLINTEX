// Morning sticker run for coning issues: the issuer prints every batch barcode of a date/shift
// range in one go and hands the stack to the coning supervisor.
const SHIFTS = ['Day', 'Night'];
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

export async function listConingStickerRun(client, params) {
  const where = stickerRunWhere(params);
  const issues = await client.issueToConingMachine.findMany({
    where,
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ROWS + 1,
    select: {
      id: true, date: true, shift: true, barcode: true, lotNo: true, itemId: true, cutId: true, yarnId: true, twistId: true,
      machineId: true, operatorId: true, rollsIssued: true, expectedCones: true, requiredPerConeNetWeight: true,
      receivedRowRefs: true, coningBatchOpen: true, coningBatchEnabled: true, coningBatchRevision: true,
      stickerPrintedAt: true, stickerPrintedCopies: true, stickerPrintedCrates: true, stickerPrintedRevision: true,
    },
  });
  const truncated = issues.length > MAX_ROWS;
  if (truncated) issues.length = MAX_ROWS;

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
      status: stickerStatus(issue),
      printedAt: issue.stickerPrintedAt,
      printedCopies: issue.stickerPrintedCopies,
      printedCrates: issue.stickerPrintedCrates,
    };
  });
  return { rows, truncated };
}

export async function markConingStickersPrinted(client, entries, actorUserId) {
  if (!Array.isArray(entries) || !entries.length) throw new ConingStickerRunError('Choose at least one barcode');
  if (entries.length > MAX_ROWS) throw new ConingStickerRunError('Too many barcodes in one print');
  const byId = new Map();
  for (const entry of entries) {
    const copies = Number(entry?.copies);
    const revision = Number(entry?.revision);
    if (typeof entry?.id !== 'string' || !Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES || !Number.isInteger(revision)) {
      throw new ConingStickerRunError('Each barcode needs between 1 and 100 copies');
    }
    byId.set(entry.id, { copies, revision });
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
    const { copies, revision } = byId.get(issue.id);
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
