import { createHash } from 'node:crypto';
import { computeIssueBalancesBatch } from './issueBalances.js';
import { assertIssueEditable } from './contractorPayments/service.js';

const EPSILON = 1e-6;
const refsOf = (value) => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
};
const sumWeight = (refs) => refs.reduce((sum, ref) => sum + Number(ref.issueWeight || 0), 0);

export class ConingBatchError extends Error {
  constructor(message, statusCode = 409) { super(message); this.statusCode = statusCode; }
}

// Read upstream lineage rather than assuming the coning parent's cut is populated.
export async function resolveConingBatchMaterial(client, rowIds, visited = new Set()) {
  const ids = [...new Set(rowIds.filter(Boolean))].filter((id) => !visited.has(id));
  ids.forEach((id) => visited.add(id));
  const [holo, coning] = await Promise.all([
    client.receiveFromHoloMachineRow.findMany({ where: { id: { in: ids }, isDeleted: false, issue: { isDeleted: false } }, include: { issue: true } }),
    client.receiveFromConingMachineRow.findMany({ where: { id: { in: ids }, isDeleted: false, issue: { isDeleted: false } }, include: { issue: true } }),
  ]);
  const cuts = new Set();
  const yarns = new Set();
  const items = new Set();
  const ancestors = new Set();
  let complete = holo.length + coning.length === ids.length;
  for (const row of holo) {
    const issue = row.issue;
    items.add(issue.itemId);
    if (issue.yarnId) yarns.add(issue.yarnId); else complete = false;
    const cutterIds = refsOf(issue.receivedRowRefs).map((ref) => ref.rowId).filter(Boolean);
    const cutterRows = cutterIds.length ? await client.receiveFromCutterMachineRow.findMany({ where: { id: { in: cutterIds }, isDeleted: false }, select: { cutId: true, cut: true } }) : [];
    if (cutterIds.length) {
      const names = [...new Set(cutterRows.filter((row) => !row.cutId).map((row) => row.cut).filter(Boolean))];
      const masters = names.length ? await client.cut.findMany({ where: { name: { in: names } }, select: { id: true, name: true } }) : [];
      const cutByName = new Map(masters.map((master) => [master.name, master.id]));
      complete = complete && cutterRows.length === new Set(cutterIds).size;
      for (const cutterRow of cutterRows) {
        const cutId = cutterRow.cutId || cutByName.get(cutterRow.cut);
        if (cutId) cuts.add(cutId); else complete = false;
      }
      if (!cutterRows.length && issue.cutId) cuts.add(issue.cutId);
    } else if (issue.cutId) cuts.add(issue.cutId);
    else complete = false;
  }
  for (const row of coning) {
    ancestors.add(row.issueId);
    items.add(row.issue.itemId);
    const upstream = refsOf(row.issue.receivedRowRefs).map((ref) => ref.rowId).filter(Boolean);
    if (upstream.length) {
      const material = await resolveConingBatchMaterial(client, upstream, visited);
      material.cutIds.forEach((id) => cuts.add(id));
      material.yarnIds.forEach((id) => yarns.add(id));
      material.ancestorIssueIds.forEach((id) => ancestors.add(id));
      complete = complete && material.complete;
    } else {
      if (row.issue.cutId) cuts.add(row.issue.cutId); else complete = false;
      if (row.issue.yarnId) yarns.add(row.issue.yarnId); else complete = false;
    }
  }
  return { complete, itemIds: [...items], cutIds: [...cuts], yarnIds: [...yarns], ancestorIssueIds: [...ancestors] };
}

export function coningBatchKey({ date, shift, operatorId, machineId, itemId, cutId, yarnId, coneTypeId, wrapperId, requiredPerConeNetWeight }) {
  const weight = Number(requiredPerConeNetWeight);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !String(shift || '').trim()
    || !operatorId || !machineId || !itemId || !cutId || !yarnId || !coneTypeId || !Number.isFinite(weight) || weight <= 0) return null;
  // Twist and box deliberately do not identify a physical production pool.
  return createHash('sha256').update(JSON.stringify([
    date, String(shift).trim().toLowerCase(), operatorId, machineId, itemId, cutId, yarnId,
    coneTypeId, wrapperId || null, weight,
  ])).digest('hex');
}

export async function findConingBatchCandidates(client, key, excludeIssueIds = []) {
  if (!key) return [];
  const issues = await client.issueToConingMachine.findMany({
    where: { isDeleted: false, coningBatchEnabled: true, coningBatchOpen: true, coningBatchKey: key, id: { notIn: excludeIssueIds } },
    include: { machine: { select: { name: true } }, operator: { select: { name: true } }, _count: { select: { supplies: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const balances = await computeIssueBalancesBatch(client, 'coning', issues);
  return issues.map((issue) => ({ id: issue.id, barcode: issue.barcode, date: issue.date, shift: issue.shift,
    machineName: issue.machine?.name || '', operatorName: issue.operator?.name || '',
    issuedWeight: sumWeight(refsOf(issue.receivedRowRefs)), pendingWeight: balances.get(issue.id)?.pendingWeight || 0,
    supplyCount: issue._count.supplies, createdAt: issue.createdAt }));
}

export function mergeConingSourceRefs(existing, additions) {
  const refs = existing.map((ref) => ({ ...ref }));
  for (const ref of additions) {
    const same = refs.find((candidate) => candidate.rowId === ref.rowId);
    if (same) {
      same.issueRolls = Number(same.issueRolls || 0) + Number(ref.issueRolls || 0);
      same.issueWeight = Number((Number(same.issueWeight || 0) + Number(ref.issueWeight || 0)).toFixed(3));
    } else refs.push({ ...ref });
  }
  return refs;
}

export async function lockConingBatch(client, id) {
  await client.$queryRaw`SELECT id FROM "IssueToConingMachine" WHERE id = ${id} FOR UPDATE`;
  return client.issueToConingMachine.findFirst({ where: { id, isDeleted: false } });
}

// The caller owns the transaction. Never rewrite receives or remove allocations:
// each supply is append-only and the production issue remains the stable pool.
export async function commitConingSupply(client, { issueData, crates, mode = 'new', selectedBatchId, allocateBarcode, loadIssuedToConing, actorUserId }) {
  if (!['new', 'auto', 'existing'].includes(mode)) throw new ConingBatchError('Invalid batch choice', 400);
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('glintex-coning-supply'))`;
  const ids = [...new Set(crates.map((ref) => ref.rowId))].sort();
  await client.$queryRaw`SELECT id FROM "ReceiveFromHoloMachineRow" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  await client.$queryRaw`SELECT id FROM "ReceiveFromConingMachineRow" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const [holo, coning, issued] = await Promise.all([
    client.receiveFromHoloMachineRow.findMany({ where: { id: { in: ids }, isDeleted: false, issue: { isDeleted: false } } }),
    client.receiveFromConingMachineRow.findMany({ where: { id: { in: ids }, isDeleted: false, issue: { isDeleted: false } } }),
    loadIssuedToConing(client, ids),
  ]);
  const sources = new Map([...holo, ...coning].map((row) => [row.id, row]));
  const planned = new Map();
  for (const ref of crates) {
    const source = sources.get(ref.rowId);
    if (!source) throw new ConingBatchError('A source crate is no longer available');
    const prior = issued.get(ref.rowId) || {};
    const request = planned.get(ref.rowId) || { count: 0, weight: 0 };
    request.count += Number(ref.issueRolls);
    request.weight += Number(ref.issueWeight);
    planned.set(ref.rowId, request);
    const count = Number(source.rollCount ?? source.coneCount ?? 0) - Number(source.dispatchedCount || 0) - Number(prior.issuedRolls || 0);
    const weight = Number(source.rollWeight ?? source.netWeight ?? source.coneWeight ?? 0) - Number(source.dispatchedWeight || 0) - Number(prior.issuedWeight || 0);
    if (request.count > count || request.weight > weight + EPSILON) throw new ConingBatchError('A source crate no longer has enough available rolls or weight. Scan it again.');
  }
  const material = await resolveConingBatchMaterial(client, ids);
  const single = (values) => values.length === 1 ? values[0] : null;
  const uniformPackaging = crates.every((ref) => ref.coneTypeId === crates[0]?.coneTypeId && ref.wrapperId === crates[0]?.wrapperId);
  const key = material.complete && uniformPackaging ? coningBatchKey({ ...issueData, cutId: single(material.cutIds), yarnId: single(material.yarnIds),
    coneTypeId: crates[0]?.coneTypeId, wrapperId: crates[0]?.wrapperId }) : null;
  const candidates = mode === 'new' ? [] : await findConingBatchCandidates(client, key, material.ancestorIssueIds);
  let target = null;
  if (mode === 'existing') {
    target = candidates.find((candidate) => candidate.id === selectedBatchId);
    if (!target) throw new ConingBatchError('The selected batch has closed or no longer matches. Reload the batch choices.');
  } else if (mode === 'auto') {
    if (candidates.length > 1) throw new ConingBatchError('Several open batches match. Select a batch or choose a separate batch.');
    target = candidates[0] || null;
  }
  const barcode = await allocateBarcode(client);
  const rolls = crates.reduce((sum, ref) => sum + Number(ref.issueRolls), 0);
  const weight = sumWeight(crates);
  let issue;
  if (target) {
    await assertIssueEditable(client, 'coning', target.id);
    const existing = await lockConingBatch(client, target.id);
    if (!existing?.coningBatchOpen || existing.coningBatchKey !== key) throw new ConingBatchError('The batch changed while you were issuing. Reload the batch choices.');
    const refs = mergeConingSourceRefs(refsOf(existing.receivedRowRefs), crates);
    const lots = [...new Set(refs.map((ref) => ref.lotNo).filter(Boolean))];
    issue = await client.issueToConingMachine.update({ where: { id: existing.id }, data: {
      receivedRowRefs: refs, rollsIssued: existing.rollsIssued + rolls,
      expectedCones: Math.floor(sumWeight(refs) * 1000 / existing.requiredPerConeNetWeight),
      lotNo: lots.length === 1 ? lots[0] : 'MIXED',
      twistId: existing.twistId === issueData.twistId ? existing.twistId : null,
      updatedByUserId: actorUserId || null,
    } });
  } else {
    issue = await client.issueToConingMachine.create({ data: { ...issueData, barcode,
      receivedRowRefs: mergeConingSourceRefs([], crates), rollsIssued: rolls,
      expectedCones: Math.floor(weight * 1000 / issueData.requiredPerConeNetWeight),
      cutId: single(material.cutIds) || issueData.cutId, yarnId: single(material.yarnIds) || issueData.yarnId,
      coningBatchEnabled: true, coningBatchOpen: true, coningBatchKey: key,
      createdByUserId: actorUserId || null, updatedByUserId: actorUserId || null,
    } });
  }
  const supply = await client.coningIssueSupply.create({ data: { issueId: issue.id, barcode, date: issueData.date,
    rollsIssued: rolls, issuedWeight: weight, receivedRowRefs: crates,
    specification: { machineId: issueData.machineId, operatorId: issueData.operatorId, shift: issueData.shift,
      itemId: issueData.itemId, cutId: single(material.cutIds), yarnId: single(material.yarnIds), twistId: issueData.twistId,
      coneTypeId: crates[0]?.coneTypeId, wrapperId: crates[0]?.wrapperId, requiredPerConeNetWeight: issueData.requiredPerConeNetWeight, note: issueData.note },
    createdByUserId: actorUserId || null } });
  return { issue, supply, addedToBatch: Boolean(target) };
}
