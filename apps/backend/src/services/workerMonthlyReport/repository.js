import { validDate } from './filters.js';
import { MAX_TRACE_DEPTH, refIds, sourceSelection } from './lineage.js';

const BATCH_SIZE = 1000;
async function readIds(model, ids, options = {}) {
  const result = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    result.push(...await model.findMany({ where: { id: { in: ids.slice(i, i + BATCH_SIZE) } }, ...options }));
  }
  return result;
}

export async function loadSources(client, filters) {
  // Dates are nullable strings. The slim audit is necessary to discover malformed
  // dates outside the lexical month range, without silently assigning a period.
  const dateIndex = await client.receiveFromConingMachineRow.findMany({ select: { id: true, date: true, isDeleted: true } });
  const invalidDateIds = dateIndex.filter(row => !row.isDeleted && !validDate(row.date)).map(row => row.id);
  const periodRows = await client.receiveFromConingMachineRow.findMany({
    where: { date: { gte: filters.period.startInclusive, lt: filters.period.effectiveEndExclusive } },
    include: { issue: { include: { machine: true } }, operator: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const undatedRows = await readIds(client.receiveFromConingMachineRow, invalidDateIds,
    { include: { issue: { include: { machine: true } }, operator: true } });
  const graph = new Map();
  for (const row of periodRows) graph.set(row.id, { stage: 'coning', row });
  let frontier = [...new Set(periodRows.flatMap(row => sourceSelection(row).ids))];
  const loaded = new Set();
  for (let depth = 0; frontier.length && depth < MAX_TRACE_DEPTH; depth++) {
    const ids = frontier.filter(id => !loaded.has(id));
    if (!ids.length) break;
    ids.forEach(id => loaded.add(id));
    const [holo, coning, cutter] = await Promise.all([
      readIds(client.receiveFromHoloMachineRow, ids, { include: { issue: true } }),
      readIds(client.receiveFromConingMachineRow, ids, { include: { issue: true } }),
      readIds(client.receiveFromCutterMachineRow, ids, { include: { issue: true } }),
    ]);
    frontier = [];
    for (const [stage, rows] of [['holo', holo], ['coning', coning], ['cutter', cutter]]) {
      for (const row of rows) {
        graph.set(row.id, { stage, row });
        if (!row.isDeleted && !row.issue?.isDeleted) {
          frontier.push(...(stage === 'coning' ? sourceSelection(row).ids : stage === 'holo' && !row.issue?.cutId ? refIds(row.issue?.receivedRowRefs) : []));
        }
      }
    }
    frontier = [...new Set(frontier)];
  }
  // Master tables are batch reads; no worker process/active filter is applied.
  const [items, yarns, twists, cuts, coneTypes] = await Promise.all([
    client.item.findMany(), client.yarn.findMany(), client.twist.findMany(), client.cut.findMany(), client.coneType.findMany(),
  ]);
  return { periodRows, undatedRows, graph, items, yarns, twists, cuts, coneTypes,
    metrics: { auditedDateRows: dateIndex.length, periodSourceRows: periodRows.length, lineageRows: graph.size } };
}
