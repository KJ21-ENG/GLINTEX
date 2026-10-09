import { assertIssueEditable } from './contractorPayments/service.js';
import { ConingBatchError, coningBatchKey, lockConingBatch, mergeConingSourceRefs, resolveConingBatchMaterial } from './coningBatches.js';

const EPSILON = 1e-6;
const roundKg = (value) => Number(Number(value).toFixed(3));
const refsOf = (value) => Array.isArray(value) ? value : [];
const metaFields = ['date', 'machineId', 'operatorId', 'shift', 'note'];
const metadata = (issue) => Object.fromEntries(metaFields.map((field) => [field, issue[field] ?? null]));
async function metadataNames(client, value) {
  const [machine, operator] = await Promise.all([
    value.machineId ? client.machine.findUnique({ where: { id: value.machineId }, select: { name: true } }) : null,
    value.operatorId ? client.operator.findUnique({ where: { id: value.operatorId }, select: { name: true } }) : null,
  ]);
  return { machineName: machine?.name || '', operatorName: operator?.name || '' };
}

export function effectiveConingSupply(supply) {
  const latest = [...(supply.corrections || [])].sort((a, b) => b.revision - a.revision)[0];
  return { ...supply, current: latest?.after || {
    receivedRowRefs: supply.receivedRowRefs, rollsIssued: supply.rollsIssued, issuedWeight: supply.issuedWeight,
  } };
}

export async function coningDeliveryCorrectionLock(client, issue) {
  // Receiving has started even if an earlier receive was subsequently deleted.
  if (await client.receiveFromConingMachineRow.count({ where: { issueId: issue.id } })) {
    return 'Receiving has started for this batch. Delivery crates and quantities are locked.';
  }
  if (await client.issueTakeBack.count({ where: { stage: 'coning', issueId: issue.id, isReverse: false, isReversed: false } })) {
    return 'Delivery quantities cannot be corrected while active take-backs exist.';
  }
  const total = await client.receiveFromConingMachinePieceTotal.findUnique({ where: { pieceId: issue.id } });
  if (Number(total?.wastageNetWeight || 0) > EPSILON) return 'Reverse the batch wastage before correcting delivery quantities.';
  if (!issue.coningBatchOpen) return 'Reopen this batch before correcting a delivery.';
  return null;
}

async function validateMetadata(client, patch) {
  const data = {};
  for (const field of metaFields) {
    if (patch[field] !== undefined) data[field] = patch[field] == null || patch[field] === '' ? null : String(patch[field]).trim();
  }
  if ('date' in data && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')
    || Number.isNaN(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date)) {
    throw new ConingBatchError('Enter a valid issue date', 400);
  }
  if (data.shift && !['Day', 'Night'].includes(data.shift)) throw new ConingBatchError('Select Day or Night shift', 400);
  for (const [field, model] of [['machineId', 'machine'], ['operatorId', 'operator']]) {
    if (!data[field]) continue;
    const master = await client[model].findUnique({ where: { id: data[field] } });
    if (!master || !['all', 'coning'].includes(master.processType)) throw new ConingBatchError(`Select a valid coning ${model}`, 400);
  }
  return data;
}

async function prepareCrates(client, input, issue, currentRefs) {
  if (!Array.isArray(input) || !input.length) throw new ConingBatchError('Keep at least one source crate in this delivery', 400);
  const ids = input.map((ref) => typeof ref.rowId === 'string' ? ref.rowId.trim() : '');
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new ConingBatchError('Each source crate must have a unique row ID. Scan it again.', 400);
  // Same advisory/source lock order as issue creation. Stock counters and the
  // allocations used by dispatch and future issues are read again under lock.
  const sorted = [...new Set([...ids, ...currentRefs.map((ref) => ref.rowId)])].sort();
  await client.$queryRaw`SELECT id FROM "ReceiveFromHoloMachineRow" WHERE id = ANY(${sorted}::text[]) ORDER BY id FOR UPDATE`;
  await client.$queryRaw`SELECT id FROM "ReceiveFromConingMachineRow" WHERE id = ANY(${sorted}::text[]) ORDER BY id FOR UPDATE`;
  const [holo, coning] = await Promise.all([
    client.receiveFromHoloMachineRow.findMany({ where: { id: { in: ids }, isDeleted: false, issue: { isDeleted: false } }, include: { issue: true } }),
    client.receiveFromConingMachineRow.findMany({ where: { id: { in: ids }, isDeleted: false, issue: { isDeleted: false } }, include: { issue: true } }),
  ]);
  const sources = new Map([...holo, ...coning].map((row) => [row.id, row]));
  const first = currentRefs[0] || refsOf(issue.receivedRowRefs)[0] || {};
  const priorById = new Map(currentRefs.map((ref) => [ref.rowId, ref]));
  const crates = input.map((ref, index) => {
    const source = sources.get(ids[index]);
    const previous = priorById.get(ids[index]) || first;
    if (!source) throw new ConingBatchError('A source crate is no longer available. Scan it again.');
    const rolls = Number(ref.issueRolls);
    const weight = roundKg(ref.issueWeight);
    if (!Number.isInteger(rolls) || rolls <= 0 || !Number.isFinite(weight) || weight <= 0) {
      throw new ConingBatchError('Enter positive whole rolls and a positive weight for every crate', 400);
    }
    // These corrections change allocations, not the batch's cone specification.
    if ((ref.coneTypeId !== undefined && (ref.coneTypeId || null) !== (previous.coneTypeId || null))
      || (ref.wrapperId !== undefined && (ref.wrapperId || null) !== (previous.wrapperId || null))) {
      throw new ConingBatchError('Delivery corrections must retain the batch cone type and wrapper', 400);
    }
    return {
      rowId: source.id, barcode: source.barcode || source.notes || ref.barcode || '',
      lotNo: source.issue.lotNo, itemId: source.issue.itemId,
      coneTypeId: previous.coneTypeId || null, wrapperId: previous.wrapperId || null,
      boxId: previous.boxId || null, issueRolls: rolls, issueWeight: weight,
      baseRolls: Number(source.rollCount ?? source.coneCount ?? 0),
      baseWeight: Number(source.rollWeight ?? source.netWeight ?? source.coneWeight ?? 0),
      dispatchedCount: Number(source.dispatchedCount || 0), dispatchedWeight: Number(source.dispatchedWeight || 0),
    };
  });
  return { crates, sources };
}

async function batchIdentity(client, issue, refs) {
  const material = await resolveConingBatchMaterial(client, refs.map((ref) => ref.rowId));
  const uniform = refs.every((ref) => ref.coneTypeId === refs[0]?.coneTypeId && ref.wrapperId === refs[0]?.wrapperId);
  const single = (ids) => ids.length === 1 ? ids[0] : null;
  return { material, key: material.complete && uniform ? coningBatchKey({ ...issue,
    cutId: single(material.cutIds), yarnId: single(material.yarnIds),
    coneTypeId: refs[0]?.coneTypeId, wrapperId: refs[0]?.wrapperId,
  }) : null };
}

// The caller owns one transaction. Original supplies are immutable; a correction
// stores before/after snapshots and replaces only that delivery in the aggregate.
export async function correctConingIssue(client, { issueId, patch = {}, supplyId, crates: input, reason, expectedRevision, actorUserId, loadIssuedToConing }) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('glintex-coning-supply'))`;
  // Keep the established receive-row -> issue lock order for paid settlements.
  await assertIssueEditable(client, 'coning', issueId);
  const issue = await lockConingBatch(client, issueId);
  if (!issue) throw new ConingBatchError('Coning issue not found', 404);
  if (!issue.coningBatchEnabled) throw new ConingBatchError('This issue uses the original issue editor', 400);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== issue.coningBatchRevision) {
    throw new ConingBatchError('This batch changed while the editor was open. Reload it before saving.');
  }
  const data = await validateMetadata(client, patch);
  const beforeMeta = metadata(issue);
  const nextMeta = { ...beforeMeta, ...data };
  let before = { ...beforeMeta, ...(await metadataNames(client, beforeMeta)) };
  let after = { ...nextMeta, ...(await metadataNames(client, nextMeta)) };
  let deliveryChanged = false;
  if (supplyId) {
    const lockReason = await coningDeliveryCorrectionLock(client, issue);
    if (lockReason) throw new ConingBatchError(lockReason);
    if (!String(reason || '').trim()) throw new ConingBatchError('Enter a reason for the delivery correction', 400);
    const supplies = await client.coningIssueSupply.findMany({ where: { issueId }, include: { corrections: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const selected = supplies.find((supply) => supply.id === supplyId);
    if (!selected) throw new ConingBatchError('This delivery does not belong to the selected batch', 404);
    const current = effectiveConingSupply(selected).current;
    const { crates, sources } = await prepareCrates(client, input, issue, refsOf(current.receivedRowRefs));
    const issued = await loadIssuedToConing(client, [...sources.keys()]);
    const originalById = new Map(mergeConingSourceRefs([], refsOf(current.receivedRowRefs)).map((ref) => [ref.rowId, ref]));
    for (const ref of crates) {
      const prior = issued.get(ref.rowId) || {};
      const replaced = originalById.get(ref.rowId) || {};
      const count = ref.baseRolls - ref.dispatchedCount - Number(prior.issuedRolls || 0) + Number(replaced.issueRolls || 0);
      const weight = ref.baseWeight - ref.dispatchedWeight - Number(prior.issuedWeight || 0) + Number(replaced.issueWeight || 0);
      if (ref.issueRolls > count || ref.issueWeight > weight + EPSILON) {
        throw new ConingBatchError('A source crate no longer has enough available rolls or weight. Reload it before correcting.');
      }
    }
    let combined = [];
    for (const supply of supplies) combined = mergeConingSourceRefs(combined, supply.id === supplyId ? crates : refsOf(effectiveConingSupply(supply).current.receivedRowRefs));
    const { material, key } = await batchIdentity(client, { ...issue, ...data }, combined);
    if (material.itemIds.length !== 1 || material.cutIds.length > 1 || material.yarnIds.length > 1) {
      throw new ConingBatchError('All deliveries in the batch must retain a single item, cut and yarn', 400);
    }
    if (material.ancestorIssueIds.includes(issueId)) throw new ConingBatchError('Re-coning output cannot be allocated to its own ancestor batch', 400);
    const lots = [...new Set(combined.map((ref) => ref.lotNo).filter(Boolean))];
    const combinedWeight = roundKg(combined.reduce((sum, ref) => sum + ref.issueWeight, 0));
    Object.assign(data, {
      itemId: material.itemIds[0], cutId: material.cutIds.length === 1 ? material.cutIds[0] : null,
      yarnId: material.yarnIds.length === 1 ? material.yarnIds[0] : null,
      // Twists may differ across the physical pool. Trace display uses sources.
      twistId: material.twistIds.length === 1 ? material.twistIds[0] : null,
      lotNo: lots.length === 1 ? lots[0] : 'MIXED', receivedRowRefs: combined,
      rollsIssued: combined.reduce((sum, ref) => sum + ref.issueRolls, 0),
      expectedCones: Math.floor(combinedWeight * 1000 / issue.requiredPerConeNetWeight), coningBatchKey: key,
    });
    const snapshot = {
      receivedRowRefs: crates, rollsIssued: crates.reduce((sum, ref) => sum + ref.issueRolls, 0),
      issuedWeight: roundKg(crates.reduce((sum, ref) => sum + ref.issueWeight, 0)),
    };
    // Ignore refreshed source counters when deciding whether allocations changed.
    const allocations = (refs) => refs.map((ref) => [ref.rowId, Number(ref.issueRolls), Number(ref.issueWeight)]).sort((a, b) => a[0].localeCompare(b[0]));
    deliveryChanged = JSON.stringify(allocations(refsOf(current.receivedRowRefs))) !== JSON.stringify(allocations(crates));
    before = { ...before, receivedRowRefs: current.receivedRowRefs, rollsIssued: current.rollsIssued, issuedWeight: current.issuedWeight };
    after = { ...after, ...snapshot };
  } else {
    const { key } = await batchIdentity(client, { ...issue, ...data }, refsOf(issue.receivedRowRefs));
    data.coningBatchKey = key;
  }
  const changedMeta = metaFields.filter((field) => beforeMeta[field] !== nextMeta[field]);
  const changed = deliveryChanged || changedMeta.length > 0;
  if (!changed) return { issue, correction: null, requiresStickerReprint: false };
  const requiresStickerReprint = deliveryChanged || changedMeta.some((field) => field !== 'note');
  const revision = issue.coningBatchRevision + 1;
  const updated = await client.issueToConingMachine.update({ where: { id: issueId }, data: {
    ...data, coningBatchRevision: revision, updatedByUserId: actorUserId || null,
  } });
  const correction = await client.coningIssueCorrection.create({ data: {
    issueId, supplyId: supplyId || null, revision, before, after, reason: String(reason || '').trim() || null,
    requiresStickerReprint, createdByUserId: actorUserId || null,
  } });
  return { issue: updated, correction, requiresStickerReprint };
}
