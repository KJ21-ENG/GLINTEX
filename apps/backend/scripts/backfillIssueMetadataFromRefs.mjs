import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const stageArg = argv.find((a) => a.startsWith('--stage='));
  const stage = stageArg ? stageArg.split('=')[1] : 'all';
  if (!['all', 'holo', 'coning'].includes(stage)) {
    throw new Error(`Invalid --stage value "${stage}". Use all|holo|coning.`);
  }
  return { apply, stage };
}

function parseRefs(raw) {
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

function uniqueValues(values) {
  return Array.from(new Set(values.filter((v) => v != null && String(v).trim() !== '')));
}

async function backfillHolo({ apply }) {
  const issues = await prisma.issueToHoloMachine.findMany({
    where: { isDeleted: false },
    select: { id: true, cutId: true, receivedRowRefs: true },
  });

  let scanned = 0;
  let changed = 0;
  let ambiguous = 0;

  for (const issue of issues) {
    scanned += 1;
    const refs = parseRefs(issue.receivedRowRefs);
    const rowIds = uniqueValues(refs.map((r) => r?.rowId));
    if (rowIds.length === 0) continue;

    const rows = await prisma.receiveFromCutterMachineRow.findMany({
      where: { id: { in: rowIds }, isDeleted: false },
      select: { cutId: true, cut: true },
    });

    const cutIds = uniqueValues(rows.map((r) => r.cutId));
    let nextCutId = null;

    if (cutIds.length > 1) {
      ambiguous += 1;
      nextCutId = null;
    } else if (cutIds.length === 1) {
      nextCutId = cutIds[0];
    } else {
      const cutNames = uniqueValues(rows.map((r) => String(r.cut || '').trim()));
      if (cutNames.length > 1) {
        ambiguous += 1;
        nextCutId = null;
      } else if (cutNames.length === 1) {
        const cut = await prisma.cut.findUnique({ where: { name: cutNames[0] }, select: { id: true } });
        nextCutId = cut?.id || null;
      }
    }

    const currentCutId = issue.cutId || null;
    if (currentCutId !== (nextCutId || null)) {
      changed += 1;
      if (apply) {
        await prisma.issueToHoloMachine.update({
          where: { id: issue.id },
          data: { cutId: nextCutId || null },
        });
      }
    }
  }

  return { scanned, changed, ambiguous };
}

async function backfillConing({ apply }) {
  const issues = await prisma.issueToConingMachine.findMany({
    where: { isDeleted: false },
    select: { id: true, cutId: true, yarnId: true, twistId: true, receivedRowRefs: true },
  });

  let scanned = 0;
  let changed = 0;
  let ambiguous = 0;

  for (const issue of issues) {
    scanned += 1;
    const refs = parseRefs(issue.receivedRowRefs);
    const holoRowIds = uniqueValues(refs.map((r) => r?.rowId));
    if (holoRowIds.length === 0) continue;

    const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
      where: { id: { in: holoRowIds }, isDeleted: false },
      select: { issueId: true },
    });
    const sourceIssueIds = uniqueValues(holoRows.map((r) => r.issueId));
    if (sourceIssueIds.length === 0) continue;

    const sourceIssues = await prisma.issueToHoloMachine.findMany({
      where: { id: { in: sourceIssueIds }, isDeleted: false },
      select: { cutId: true, yarnId: true, twistId: true },
    });

    const cutIds = uniqueValues(sourceIssues.map((s) => s.cutId));
    const yarnIds = uniqueValues(sourceIssues.map((s) => s.yarnId));
    const twistIds = uniqueValues(sourceIssues.map((s) => s.twistId));

    if (cutIds.length > 1 || yarnIds.length > 1 || twistIds.length > 1) {
      ambiguous += 1;
    }

    const nextCutId = cutIds.length === 1 ? cutIds[0] : null;
    const nextYarnId = yarnIds.length === 1 ? yarnIds[0] : null;
    const nextTwistId = twistIds.length === 1 ? twistIds[0] : null;

    const currentCutId = issue.cutId || null;
    const currentYarnId = issue.yarnId || null;
    const currentTwistId = issue.twistId || null;

    const hasChange =
      currentCutId !== (nextCutId || null) ||
      currentYarnId !== (nextYarnId || null) ||
      currentTwistId !== (nextTwistId || null);

    if (hasChange) {
      changed += 1;
      if (apply) {
        await prisma.issueToConingMachine.update({
          where: { id: issue.id },
          data: {
            cutId: nextCutId || null,
            yarnId: nextYarnId || null,
            twistId: nextTwistId || null,
          },
        });
      }
    }
  }

  return { scanned, changed, ambiguous };
}

async function main() {
  const { apply, stage } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`Backfill issue metadata from refs (${mode})`);
  console.log(`Stage: ${stage}`);

  const result = {};
  if (stage === 'all' || stage === 'holo') {
    result.holo = await backfillHolo({ apply });
  }
  if (stage === 'all' || stage === 'coning') {
    result.coning = await backfillConing({ apply });
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
