import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('coning batches integration requires TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = url;
  const { default: prisma } = await import('../../lib/prisma.js');
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.match(db, /_test$/, 'Only a disposable test database may run these fixtures');
  const request = (await import('supertest')).default;
  const { default: app } = await import('../../app.js');
  const { hashSessionToken } = await import('../../utils/auth.js');
  const { coningBatchKey } = await import('../../services/coningBatches.js');
  const unique = randomUUID().slice(0, 8);
  const role = await prisma.role.upsert({ where: { key: 'admin' }, update: {}, create: { key: 'admin', name: 'Admin', permissions: {} } });
  const user = await prisma.user.create({ data: { username: `batch-test-${unique}`, passwordHash: 'test', isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = randomUUID();
  await prisma.userSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) } });
  const api = (method, path, body) => request(app)[method](path).set('Authorization', `Bearer ${token}`).send(body);
  const createPath = '/api/issue_to_coning_machine';
  const receivePath = '/api/receive_from_coning_machine/manual';
  let sequence = 0;

  async function scenario() {
    const name = `${unique}-${++sequence}`;
    const item = await prisma.item.create({ data: { name: `Batch item ${name}`, side: 'SINGLE' } });
    const yarn = await prisma.yarn.create({ data: { name: `Batch yarn ${name}` } });
    const cut = await prisma.cut.create({ data: { name: `Batch cut ${name}` } });
    const machine = await prisma.machine.create({ data: { name: `Batch machine ${name}`, processType: 'coning' } });
    const operator = await prisma.operator.create({ data: { name: `Batch worker ${name}`, processType: 'coning' } });
    const cone = await prisma.coneType.create({ data: { name: `Batch cone ${name}`, weight: 0.01 } });
    const wrapper = await prisma.wrapper.create({ data: { name: `Batch wrapper ${name}` } });
    const box = await prisma.box.create({ data: { name: `Batch box ${name}`, weight: 0.5, processType: 'coning' } });
    const twistA = await prisma.twist.create({ data: { name: `Z ${name}` } });
    const twistB = await prisma.twist.create({ data: { name: `S ${name}` } });
    const base = { date: '2026-10-08', shift: 'Day', machineId: machine.id, operatorId: operator.id, requiredPerConeNetWeight: 500, batchMode: 'auto' };
    async function source(weight = 40, twistId = twistA.id, lotNo = '160', changes = {}) {
      const n = ++sequence;
      const issue = await prisma.issueToHoloMachine.create({ data: { date: base.date, itemId: item.id, cutId: cut.id, yarnId: yarn.id, twistId, lotNo, barcode: `IHO-QA-${unique}-${n}`, ...changes } });
      return prisma.receiveFromHoloMachineRow.create({ data: { issueId: issue.id, rollCount: 2, rollWeight: weight, grossWeight: weight, tareWeight: 0, barcode: `RHO-QA-${unique}-${n}` } });
    }
    const crate = (row, weight = row.rollWeight, rolls = row.rollCount) => ({ rowId: row.id, barcode: row.barcode, issueRolls: rolls, issueWeight: weight, coneTypeId: cone.id, wrapperId: wrapper.id, boxId: box.id });
    async function issue(row, changes = {}) {
      const response = await api('post', createPath, { ...base, crates: [crate(row)], ...changes });
      assert.equal(response.status, 200, response.text);
      return response.body;
    }
    async function candidates(row, changes = {}) {
      const response = await api('post', `${createPath}/batch_candidates`, { ...base, rowIds: [row.id], coneTypeId: cone.id, wrapperId: wrapper.id, ...changes });
      assert.equal(response.status, 200, response.text);
      return response.body;
    }
    async function receive(issueId, kg, count = 20) {
      return api('post', receivePath, { issueId, pieceId: issueId, coneCount: count, boxId: box.id, grossWeight: kg + 0.5 + count * 0.01, date: base.date });
    }
    return { item, yarn, cut, cone, wrapper, box, twistA, twistB, base, source, crate, issue, candidates, receive };
  }

  test('batch key excludes twist and box, but separates all required specifications', () => {
    const fields = { date: '2026-10-08', shift: 'Day', operatorId: 'worker', machineId: 'machine', itemId: 'item', cutId: 'cut', yarnId: 'yarn', coneTypeId: 'cone', wrapperId: 'wrap', requiredPerConeNetWeight: 125 };
    assert.equal(coningBatchKey(fields), coningBatchKey({ ...fields, twistId: 'different', boxId: 'other', shift: ' day ' }));
    for (const field of ['date', 'shift', 'operatorId', 'machineId', 'itemId', 'cutId', 'yarnId', 'coneTypeId', 'wrapperId', 'requiredPerConeNetWeight']) {
      const changed = field === 'date' ? '2026-10-09' : field === 'requiredPerConeNetWeight' ? 250 : 'other';
      assert.notEqual(coningBatchKey(fields), coningBatchKey({ ...fields, [field]: changed }), field);
    }
    assert.equal(coningBatchKey({ ...fields, operatorId: null }), null);
  });

  test('same-shift different twists and lots share one receiving barcode and preserve both supplies', async () => {
    const f = await scenario();
    const firstSource = await f.source(36.612);
    const secondSource = await f.source(36.310, f.twistB.id, '161');
    const first = await f.issue(firstSource);
    const match = await f.candidates(secondSource);
    assert.equal(match.candidates.length, 1);
    assert.equal(match.candidates[0].barcode, first.issueToConingMachine.barcode);
    const second = await f.issue(secondSource, { batchMode: 'existing', batchId: first.issueToConingMachine.id });
    assert.equal(second.addedToBatch, true);
    assert.equal(second.issueToConingMachine.id, first.issueToConingMachine.id);
    assert.notEqual(second.supply.barcode, first.supply.barcode);
    assert.equal(second.issueToConingMachine.rollsIssued, 4);
    const lookup = await api('get', `${createPath}/lookup?barcode=${second.supply.barcode}`);
    assert.equal(lookup.status, 200, lookup.text);
    assert.equal(lookup.body.barcode, first.issueToConingMachine.barcode);
    assert.equal(lookup.body.supplies.length, 2);
    assert.equal(lookup.body.supplies[0].issuedWeight, 36.612);
    assert.equal(lookup.body.issueBalance.originalWeight, 72.922);
    assert.deepEqual(new Set(lookup.body.lotNos), new Set(['160', '161']));
    assert.match(lookup.body.twistName, /Z /);
    assert.match(lookup.body.twistName, /S /);
    const saved = await f.receive(first.issueToConingMachine.id, 40);
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.pieceTotal.totalCones, 20);
    assert.equal(saved.body.issueBalance.pendingWeight, 32.922);
    assert.equal(await prisma.receiveFromConingMachineRow.count({ where: { issueId: first.issueToConingMachine.id } }), 1);
  });

  test('matching traces cutter cut names before stale parent fields and skips incomplete lineage', async () => {
    const f = await scenario();
    const staleCut = await prisma.cut.create({ data: { name: `Stale cut ${unique}-${++sequence}` } });
    const upload = await prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: 'batch-lineage-test.csv' } });
    const cutterRow = await prisma.receiveFromCutterMachineRow.create({ data: { uploadId: upload.id, pieceId: 'lineage-test', vchNo: `batch-lineage-${unique}`, cut: f.cut.name } });
    const source = await f.source(40, f.twistA.id, '160', { cutId: staleCut.id, receivedRowRefs: [{ rowId: cutterRow.id }] });
    const first = await f.issue(source);
    assert.equal(first.issueToConingMachine.cutId, f.cut.id);
    const next = await f.source();
    assert.equal((await f.candidates(next)).candidates[0].id, first.issueToConingMachine.id);
    const incomplete = await f.source(40, f.twistA.id, '160', { receivedRowRefs: [{ rowId: 'missing-source-row' }] });
    assert.equal((await f.candidates(incomplete)).eligible, false);
  });

  test('partial receiving allows a top-up without modifying earlier receives; source reuse merges quantities', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row, { crates: [f.crate(row, 20, 1)] });
    const received = await f.receive(first.issueToConingMachine.id, 10);
    assert.equal(received.status, 200, received.text);
    const before = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: received.body.row.id } });
    const second = await f.issue(row, { crates: [f.crate(row, 20, 1)] });
    assert.equal(second.addedToBatch, true);
    assert.equal(second.issueToConingMachine.receivedRowRefs.length, 1);
    assert.equal(second.issueToConingMachine.receivedRowRefs[0].issueRolls, 2);
    assert.equal(second.issueToConingMachine.receivedRowRefs[0].issueWeight, 40);
    assert.deepEqual(await prisma.receiveFromConingMachineRow.findUnique({ where: { id: before.id } }), before);
    const lookup = await api('get', `${createPath}/lookup?barcode=${first.issueToConingMachine.barcode}`);
    assert.equal(lookup.body.issueBalance.pendingWeight, 30);
    assert.equal(lookup.body.pieceTotal.totalCones, 20);
    const over = await api('post', createPath, { ...f.base, crates: [f.crate(row)] });
    assert.ok([400, 409].includes(over.status));
  });

  test('opt-out creates a separate pool; ambiguous matches require an explicit choice', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const second = await f.issue(await f.source(), { batchMode: 'new' });
    assert.notEqual(first.issueToConingMachine.id, second.issueToConingMachine.id);
    const next = await f.source();
    assert.equal((await f.candidates(next)).candidates.length, 2);
    const ambiguous = await api('post', createPath, { ...f.base, crates: [f.crate(next)] });
    assert.equal(ambiguous.status, 409, ambiguous.text);
    const chosen = await f.issue(next, { batchMode: 'existing', batchId: second.issueToConingMachine.id });
    assert.equal(chosen.issueToConingMachine.id, second.issueToConingMachine.id);
  });

  test('finish requires zero pending; a finished batch cannot be received into or topped up', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const id = first.issueToConingMachine.id;
    assert.equal((await api('post', `${createPath}/${id}/finish_batch`)).status, 409);
    assert.equal((await f.receive(id, 40)).status, 200);
    assert.equal((await api('post', `${createPath}/${id}/finish_batch`)).status, 200);
    assert.equal((await f.receive(id, 1)).status, 409);
    const next = await f.source();
    assert.equal((await f.candidates(next)).candidates.length, 0);
    assert.equal((await api('post', createPath, { ...f.base, crates: [f.crate(next)], batchMode: 'existing', batchId: id })).status, 409);
    const newBatch = await f.issue(next);
    assert.notEqual(newBatch.issueToConingMachine.id, id);
  });

  test('receive corrections can explicitly reopen a finished batch without losing supply history', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const id = first.issueToConingMachine.id;
    const saved = await f.receive(id, 40);
    assert.equal(saved.status, 200, saved.text);
    assert.equal((await api('post', `${createPath}/${id}/finish_batch`)).status, 200);
    assert.equal((await api('post', `${createPath}/${id}/reopen_batch`)).status, 409);
    const corrected = await api('put', `/api/receive_from_coning_machine/rows/${saved.body.row.id}`, { grossWeight: 30.7 });
    assert.equal(corrected.status, 200, corrected.text);
    const reopened = await api('post', `${createPath}/${id}/reopen_batch`);
    assert.equal(reopened.status, 200, reopened.text);
    assert.equal(reopened.body.issue.coningBatchOpen, true);
    assert.equal((await f.receive(id, 10)).status, 200);
    const lookup = await api('get', `${createPath}/lookup?barcode=${first.issueToConingMachine.barcode}`);
    assert.equal(lookup.body.issueBalance.pendingWeight, 0);
    assert.equal(lookup.body.supplies.length, 1);
  });

  test('wastage closes the combined remaining balance; explicit reversal reopens it', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const id = first.issueToConingMachine.id;
    await f.issue(await f.source());
    assert.equal((await f.receive(id, 60)).status, 200);
    const marked = await api('post', '/api/receive_from_coning_machine/mark_wastage', { issueId: id, note: 'Finished mixed pool' });
    assert.equal(marked.status, 200, marked.text);
    assert.equal(marked.body.marked, 20);
    assert.equal((await prisma.issueToConingMachine.findUnique({ where: { id } })).coningBatchOpen, false);
    const reversed = await api('post', '/api/receive_from_coning_machine/revert_wastage', { issueId: id, reason: 'Material located after closing' });
    assert.equal(reversed.status, 200, reversed.text);
    assert.equal((await prisma.issueToConingMachine.findUnique({ where: { id } })).coningBatchOpen, true);
  });

  test('concurrent supplies and receives neither oversubscribe source stock nor duplicate crate barcodes', async () => {
    const f = await scenario();
    const row = await f.source();
    const attempts = await Promise.all([1, 2].map(() => api('post', createPath, { ...f.base, crates: [f.crate(row)] })));
    assert.equal(attempts.filter((r) => r.status === 200).length, 1, attempts.map((r) => r.text).join('\n'));
    const id = attempts.find((r) => r.status === 200).body.issueToConingMachine.id;
    const receives = await Promise.all([f.receive(id, 10), f.receive(id, 10)]);
    receives.forEach((r) => assert.equal(r.status, 200, r.text));
    assert.notEqual(receives[0].body.row.barcode, receives[1].body.row.barcode);
    const total = await prisma.receiveFromConingMachinePieceTotal.findUnique({ where: { pieceId: id } });
    assert.equal(total.totalNetWeight, 20);
    assert.equal(total.totalCones, 40);
  });

  test('take-backs reduce pooled pending weight before final wastage is marked', async () => {
    const f = await scenario();
    const firstSource = await f.source();
    const first = await f.issue(firstSource);
    const id = first.issueToConingMachine.id;
    await f.issue(await f.source());
    assert.equal((await f.receive(id, 60)).status, 200);
    const returned = await api('post', `${createPath}/${id}/take_back`, { date: f.base.date, reason: 'Unused material returned', lines: [{ sourceId: firstSource.id, count: 1, weight: 10 }] });
    assert.equal(returned.status, 200, returned.text);
    const marked = await api('post', '/api/receive_from_coning_machine/mark_wastage', { issueId: id });
    assert.equal(marked.status, 200, marked.text);
    assert.equal(marked.body.marked, 10);
    const lookup = await api('get', `${createPath}/lookup?barcode=${first.issueToConingMachine.barcode}`);
    assert.equal(lookup.body.issueBalance.takeBackWeight, 10);
    assert.equal(lookup.body.issueBalance.pendingWeight, 0);
  });

  test('re-coning traces upstream material but cannot add finished cones back to their own ancestor batch', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const received = await f.receive(first.issueToConingMachine.id, 20);
    assert.equal(received.status, 200, received.text);
    const row = received.body.row;
    const matches = await f.candidates(row);
    assert.equal(matches.eligible, true);
    assert.equal(matches.candidates.length, 0);
    const second = await f.issue(row, { crates: [f.crate(row, 20, row.coneCount)] });
    assert.notEqual(second.issueToConingMachine.id, first.issueToConingMachine.id);
    assert.equal(second.issueToConingMachine.cutId, f.cut.id);
    assert.equal(second.issueToConingMachine.yarnId, f.yarn.id);
  });

  test('legacy records stay separate, ordinary batch edits are blocked, and permission checks apply', async () => {
    const f = await scenario();
    const source = await f.source();
    const legacy = await prisma.issueToConingMachine.create({ data: { ...f.base, batchMode: undefined, itemId: f.item.id, lotNo: 'legacy', cutId: f.cut.id, yarnId: f.yarn.id, barcode: `ICO-${9000000 + parseInt(unique.slice(0, 4), 16)}`, receivedRowRefs: [] } });
    assert.equal((await f.candidates(source)).candidates.length, 0);
    const first = await f.issue(source);
    assert.notEqual(first.issueToConingMachine.id, legacy.id);
    const edit = await api('put', `${createPath}/${first.issueToConingMachine.id}`, { crates: [] });
    assert.equal(edit.status, 409);
    assert.equal((await request(app).post(`${createPath}/batch_candidates`).send({})).status, 401);
    const badReceive = await api('post', receivePath, { issueId: first.issueToConingMachine.id, pieceId: 'wrong', coneCount: 1, grossWeight: 1 });
    assert.equal(badReceive.status, 400);
    const supplyCount = await prisma.coningIssueSupply.count();
    const imported = await api('post', '/api/import', { items: [] });
    assert.equal(imported.status, 409, imported.text);
    assert.equal(await prisma.coningIssueSupply.count(), supplyCount);
  });

  const lookup = async (issue) => {
    const result = await api('get', `${createPath}/lookup?barcode=${issue.barcode}`);
    assert.equal(result.status, 200, result.text);
    return result.body;
  };
  const correct = (issue, supply, crates, changes = {}) => api('post', `${createPath}/${issue.id}/supplies/${supply.id}/corrections`, {
    expectedRevision: issue.coningBatchRevision, crates, reason: 'Correct recorded allocation', ...changes,
  });
  const availability = async (row) => {
    const result = await api('get', `${createPath}/source-row/lookup?barcode=${row.barcode}`);
    assert.ok([200, 409].includes(result.status), result.text);
    assert.ok(result.body.availability);
    return result.body.availability;
  };
  const specifications = (issue, changes) => api('put', `${createPath}/${issue.id}`, {
    expectedRevision: issue.coningBatchRevision, reason: 'Correct recorded cone specifications', ...changes,
  });
  async function newPackaging() {
    const name = `${unique}-${++sequence}`;
    const cone = await prisma.coneType.create({ data: { name: `Correct cone ${name}`, weight: 0.02 } });
    const wrapper = await prisma.wrapper.create({ data: { name: `Correct wrapper ${name}` } });
    const box = await prisma.box.create({ data: { name: `Correct box ${name}`, weight: 0.75, processType: 'coning' } });
    return { cone, wrapper, box };
  }

  test('single unreceived batch restores specifications and box corrections with the reported 55 rolls / 16.467 kg', async () => {
    const f = await scenario();
    const row = await f.source(16.467);
    row.rollCount = 55;
    await prisma.receiveFromHoloMachineRow.update({ where: { id: row.id }, data: { rollCount: 55 } });
    const first = await f.issue(row);
    const original = await prisma.coningIssueSupply.findUnique({ where: { id: first.supply.id } });
    const stock = await availability(row);
    const { cone, wrapper, box } = await newPackaging();
    const saved = await correct(first.issueToConingMachine, first.supply, undefined, {
      coneTypeId: cone.id, wrapperId: wrapper.id, boxId: box.id, requiredPerConeNetWeight: 125,
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.issueToConingMachine.expectedCones, 131);
    assert.equal(saved.body.issueToConingMachine.barcode, first.issueToConingMachine.barcode);
    assert.equal(saved.body.requiresStickerReprint, true);
    assert.equal(saved.body.correction.after.coneTypeName, cone.name);
    assert.equal(saved.body.correction.before.boxName, f.box.name);
    assert.equal(saved.body.correction.after.boxName, box.name);
    const detail = await lookup(first.issueToConingMachine);
    assert.equal(detail.canCorrectSpecifications, true);
    assert.equal(detail.coneTypeId, cone.id);
    assert.equal(detail.wrapperId, wrapper.id);
    assert.equal(detail.supplies[0].current.receivedRowRefs[0].boxId, box.id);
    assert.equal(detail.supplies[0].current.rollsIssued, 55);
    assert.equal(detail.issueBalance.originalWeight, 16.467);
    assert.deepEqual(await availability(row), stock);
    assert.deepEqual(await prisma.coningIssueSupply.findUnique({ where: { id: first.supply.id } }), original);
  });

  test('batch-wide specification corrections survive delivery corrections and future top-ups with a stable ICO', async () => {
    const f = await scenario();
    const a = await f.source();
    const b = await f.source(40, f.twistB.id, '161');
    const first = await f.issue(a);
    const second = await f.issue(b);
    const originals = await prisma.coningIssueSupply.findMany({ where: { issueId: first.issueToConingMachine.id }, orderBy: { id: 'asc' } });
    const { cone, wrapper } = await newPackaging();
    const fields = { coneTypeId: cone.id, wrapperId: wrapper.id, requiredPerConeNetWeight: 250 };
    const saved = await specifications(second.issueToConingMachine, fields);
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.correction.supplyId, null);
    assert.equal(saved.body.issueToConingMachine.expectedCones, 320);
    let detail = await lookup(first.issueToConingMachine);
    assert.ok(detail.supplies.every((supply) => supply.current.receivedRowRefs.every((ref) => ref.coneTypeId === cone.id && ref.wrapperId === wrapper.id)));
    const corrected = await correct(saved.body.issueToConingMachine, first.supply, [{ rowId: a.id, issueRolls: 1, issueWeight: 20 }]);
    assert.equal(corrected.status, 200, corrected.text);
    assert.equal(corrected.body.issueToConingMachine.expectedCones, 240);
    detail = await lookup(first.issueToConingMachine);
    assert.ok(detail.supplies.every((supply) => supply.current.receivedRowRefs.every((ref) => ref.coneTypeId === cone.id && ref.wrapperId === wrapper.id)));
    assert.equal((await availability(a)).availableWeight, 20);
    assert.deepEqual(await prisma.coningIssueSupply.findMany({ where: { issueId: first.issueToConingMachine.id }, orderBy: { id: 'asc' } }), originals);
    const next = await f.source();
    assert.equal((await f.candidates(next)).candidates.length, 0);
    assert.equal((await f.candidates(next, fields)).candidates[0].id, first.issueToConingMachine.id);
    const topup = await f.issue(next, { requiredPerConeNetWeight: 250,
      crates: [{ ...f.crate(next), coneTypeId: cone.id, wrapperId: wrapper.id }],
    });
    assert.equal(topup.issueToConingMachine.barcode, first.issueToConingMachine.barcode);
    assert.equal(topup.issueToConingMachine.expectedCones, 400);
    assert.equal((await lookup(first.issueToConingMachine)).supplies.length, 3);
    // Receiving uses the corrected cone tare, and never rewrites the historical supplies.
    const received = await api('post', receivePath, { issueId: first.issueToConingMachine.id,
      pieceId: first.issueToConingMachine.id, coneCount: 10, boxId: f.box.id, grossWeight: 10.7, date: f.base.date });
    assert.equal(received.status, 200, received.text);
    assert.equal(received.body.row.netWeight, 10);
    assert.equal(received.body.row.tareWeight, 0.7);
  });

  test('box-only corrections affect one delivery without changing allocations, target or matching key', async () => {
    const f = await scenario();
    const a = await f.source();
    const b = await f.source();
    const first = await f.issue(a);
    const second = await f.issue(b);
    const stocks = await Promise.all([availability(a), availability(b)]);
    const { box } = await newPackaging();
    const saved = await correct(second.issueToConingMachine, second.supply, undefined, { boxId: box.id });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.issueToConingMachine.coningBatchKey, second.issueToConingMachine.coningBatchKey);
    assert.equal(saved.body.issueToConingMachine.expectedCones, 160);
    assert.equal(saved.body.correction.after.batchSpecification, undefined);
    const detail = await lookup(first.issueToConingMachine);
    assert.equal(detail.supplies[0].current.receivedRowRefs[0].boxId, f.box.id);
    assert.equal(detail.supplies[1].current.receivedRowRefs[0].boxId, box.id);
    assert.deepEqual(await Promise.all([availability(a), availability(b)]), stocks);
    const changed = await specifications(saved.body.issueToConingMachine, { requiredPerConeNetWeight: 250 });
    assert.equal(changed.status, 200, changed.text);
    assert.equal((await lookup(first.issueToConingMachine)).supplies[1].current.receivedRowRefs[0].boxId, box.id);
    const quantity = await correct(changed.body.issueToConingMachine, first.supply, [{ rowId: a.id, issueRolls: 1, issueWeight: 20 }]);
    assert.equal(quantity.status, 200, quantity.text);
    assert.equal((await lookup(first.issueToConingMachine)).supplies[1].current.receivedRowRefs[0].boxId, box.id);
  });

  test('combined specification, quantity and box correction commits one consistent revision', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row);
    const { cone, wrapper, box } = await newPackaging();
    const saved = await correct(first.issueToConingMachine, first.supply, [{ rowId: row.id, issueRolls: 1, issueWeight: 20 }], {
      coneTypeId: cone.id, wrapperId: wrapper.id, boxId: box.id, requiredPerConeNetWeight: 250,
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.issueToConingMachine.expectedCones, 80);
    assert.equal(saved.body.correction.revision, 1);
    const detail = await lookup(first.issueToConingMachine);
    assert.equal(detail.issueBalance.originalWeight, 20);
    assert.equal(detail.supplies[0].current.receivedRowRefs[0].coneTypeId, cone.id);
    assert.equal(detail.supplies[0].current.receivedRowRefs[0].boxId, box.id);
    assert.equal((await availability(row)).availableWeight, 20);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: first.issueToConingMachine.id } }), 1);
  });

  test('missing reasons, invalid specifications and delivery-less box edits never mutate the batch', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const { cone } = await newPackaging();
    for (const changes of [{ requiredPerConeNetWeight: 0 }, { requiredPerConeNetWeight: -5 },
      { requiredPerConeNetWeight: 'invalid' }, { coneTypeId: null }, { coneTypeId: 'missing' }, { wrapperId: 'missing' },
      { requiredPerConeNetWeight: 250, reason: '' }]) {
      const result = await specifications(first.issueToConingMachine, changes);
      assert.equal(result.status, 400, result.text);
    }
    const wrongBox = await prisma.box.create({ data: { name: `Cutter box ${unique}`, weight: 1, processType: 'cutter' } });
    assert.equal((await correct(first.issueToConingMachine, first.supply, undefined, { boxId: wrongBox.id })).status, 400);
    assert.equal((await specifications(first.issueToConingMachine, { boxId: f.box.id })).status, 409);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: first.issueToConingMachine.id } }), 0);
    const saved = await specifications(first.issueToConingMachine, { coneTypeId: cone.id, wrapperId: null });
    assert.equal(saved.status, 200, saved.text);
    assert.equal((await lookup(first.issueToConingMachine)).wrapperId, null);
    const unchanged = await specifications(saved.body.issueToConingMachine, { coneTypeId: cone.id, wrapperId: null });
    assert.equal(unchanged.status, 200, unchanged.text);
    assert.equal(unchanged.body.correction, null);
  });

  test('receives including deleted ones keep all specifications and delivery boxes locked', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const { cone, wrapper, box } = await newPackaging();
    const received = await f.receive(first.issueToConingMachine.id, 10);
    assert.equal(received.status, 200, received.text);
    for (const deleted of [false, true]) {
      if (deleted) assert.equal((await api('delete', `/api/receive_from_coning_machine/rows/${received.body.row.id}`)).status, 200);
      for (const changes of [{ coneTypeId: cone.id }, { wrapperId: wrapper.id }, { requiredPerConeNetWeight: 250 }]) {
        const rejected = await specifications(first.issueToConingMachine, changes);
        assert.equal(rejected.status, 409, rejected.text);
        assert.match(rejected.body.error, /Receiving has started/);
      }
      assert.equal((await correct(first.issueToConingMachine, first.supply, undefined, { boxId: box.id })).status, 409);
      assert.equal((await lookup(first.issueToConingMachine)).canCorrectSpecifications, false);
    }
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: first.issueToConingMachine.id } }), 0);
  });

  test('batch metadata corrections restore prior edits after receiving and update future matching with the stable ICO', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const issue = first.issueToConingMachine;
    const received = await f.receive(issue.id, 10);
    assert.equal(received.status, 200, received.text);
    const receiveBefore = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: received.body.row.id } });
    const supplyBefore = await prisma.coningIssueSupply.findUnique({ where: { id: first.supply.id } });
    const machine = await prisma.machine.create({ data: { name: `Correct machine ${unique}`, processType: 'coning' } });
    const operator = await prisma.operator.create({ data: { name: `Correct worker ${unique}`, processType: 'coning' } });
    const changes = { date: '2026-10-09', shift: 'Night', machineId: machine.id, operatorId: operator.id };
    const saved = await api('put', `${createPath}/${issue.id}`, { ...changes, expectedRevision: issue.coningBatchRevision });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.issueToConingMachine.barcode, issue.barcode);
    assert.notEqual(saved.body.issueToConingMachine.coningBatchKey, issue.coningBatchKey);
    assert.equal(saved.body.requiresStickerReprint, true);
    assert.equal(saved.body.correction.createdByUserId, user.id);
    assert.equal(saved.body.correction.before.operatorId, issue.operatorId);
    assert.equal(saved.body.correction.after.operatorId, operator.id);
    assert.deepEqual(await prisma.coningIssueSupply.findUnique({ where: { id: first.supply.id } }), supplyBefore);
    assert.deepEqual(await prisma.receiveFromConingMachineRow.findUnique({ where: { id: receiveBefore.id } }), receiveBefore);
    const next = await f.source();
    assert.equal((await f.candidates(next)).candidates.length, 0);
    assert.equal((await f.candidates(next, changes)).candidates[0].id, issue.id);
    assert.equal((await f.issue(next, changes)).issueToConingMachine.id, issue.id);
  });

  test('repeated corrections replace only the selected delivery, retaining original history and releasing source stock once', async () => {
    const f = await scenario();
    const row = await f.source(100);
    row.rollCount = 10;
    await prisma.receiveFromHoloMachineRow.update({ where: { id: row.id }, data: { rollCount: 10 } });
    const first = await f.issue(row, { crates: [f.crate(row, 60, 6)] });
    const second = await f.issue(row, { crates: [f.crate(row, 20, 2)] });
    const original = await prisma.coningIssueSupply.findUnique({ where: { id: first.supply.id } });
    const secondOriginal = await prisma.coningIssueSupply.findUnique({ where: { id: second.supply.id } });
    const changed = await correct(second.issueToConingMachine, first.supply, [f.crate(row, 30, 3)]);
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.body.issueToConingMachine.rollsIssued, 5);
    assert.equal(changed.body.issueToConingMachine.expectedCones, 100);
    assert.equal((await availability(row)).availableRolls, 5);
    assert.equal((await availability(row)).availableWeight, 50);
    const repeated = await correct(changed.body.issueToConingMachine, first.supply, [f.crate(row, 20, 2)]);
    assert.equal(repeated.status, 200, repeated.text);
    assert.equal(repeated.body.correction.before.issuedWeight, 30);
    assert.equal(repeated.body.correction.after.issuedWeight, 20);
    const detail = await lookup(first.issueToConingMachine);
    assert.equal(detail.issueBalance.originalWeight, 40);
    assert.equal(detail.supplies[0].issuedWeight, 60);
    assert.equal(detail.supplies[0].current.issuedWeight, 20);
    assert.equal(detail.supplies[0].corrections.length, 2);
    assert.equal(detail.supplies[1].current.issuedWeight, 20);
    assert.equal((await availability(row)).availableWeight, 60);
    assert.deepEqual(await prisma.coningIssueSupply.findUnique({ where: { id: first.supply.id } }), original);
    assert.deepEqual(await prisma.coningIssueSupply.findUnique({ where: { id: second.supply.id } }), secondOriginal);
    const topup = await f.issue(row, { crates: [f.crate(row, 60, 6)] });
    assert.equal(topup.issueToConingMachine.id, first.issueToConingMachine.id);
    assert.equal((await availability(row)).availableRolls, 0);
    assert.equal((await availability(row)).availableWeight, 0);
    assert.equal((await lookup(first.issueToConingMachine)).issueBalance.originalWeight, 100);
  });

  test('replacing a delivery crate updates both source balances and matching lineage atomically', async () => {
    const f = await scenario();
    const oldRow = await f.source();
    const first = await f.issue(oldRow);
    const cut = await prisma.cut.create({ data: { name: `Replacement cut ${unique}` } });
    const newRow = await f.source(30, f.twistB.id, 'replacement', { cutId: cut.id });
    const saved = await correct(first.issueToConingMachine, first.supply, [f.crate(newRow)]);
    assert.equal(saved.status, 200, saved.text);
    const issue = saved.body.issueToConingMachine;
    assert.equal(issue.cutId, cut.id);
    assert.equal(issue.barcode, first.issueToConingMachine.barcode);
    assert.equal((await availability(oldRow)).availableWeight, 40);
    assert.equal((await availability(newRow)).availableWeight, 0);
    const detail = await lookup(issue);
    assert.equal(detail.supplies[0].receivedRowRefs[0].rowId, oldRow.id);
    assert.equal(detail.supplies[0].current.receivedRowRefs[0].rowId, newRow.id);
    assert.equal(detail.issueBalance.originalWeight, 30);
    assert.equal((await f.candidates(await f.source())).candidates.length, 0);
    const matching = await f.source(40, f.twistA.id, 'next', { cutId: cut.id });
    assert.equal((await f.candidates(matching)).candidates[0].id, issue.id);
    await prisma.receiveFromHoloMachineRow.update({ where: { id: oldRow.id }, data: { dispatchedCount: 1, dispatchedWeight: 30 } });
    const rejected = await correct(issue, first.supply, [f.crate(oldRow, 20, 1)]);
    assert.equal(rejected.status, 409, rejected.text);
    assert.equal((await lookup(issue)).issueBalance.originalWeight, 30);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: issue.id } }), 1);
  });

  test('a correction cannot mix incompatible deliveries and invalid corrections leave stock and history untouched', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const second = await f.issue(await f.source());
    const issue = second.issueToConingMachine;
    const cut = await prisma.cut.create({ data: { name: `Incompatible ${unique}` } });
    const wrong = await f.source(40, f.twistA.id, 'wrong', { cutId: cut.id });
    for (const crates of [[f.crate(wrong)], [], [f.crate(wrong, -5, 1)], [f.crate(wrong, 5, 0.5)]]) {
      const rejected = await correct(issue, first.supply, crates);
      assert.equal(rejected.status, 400, rejected.text);
    }
    const missingReason = await correct(issue, first.supply, [f.crate(wrong)], { reason: '' });
    assert.equal(missingReason.status, 400);
    assert.equal((await lookup(issue)).issueBalance.originalWeight, 80);
    assert.equal((await availability(wrong)).availableWeight, 40);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: issue.id } }), 0);
  });

  test('a receive saved while the editor is open rejects quantities at save time, even after receive deletion', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row);
    const opened = await lookup(first.issueToConingMachine);
    assert.equal(opened.canCorrectDeliveries, true);
    const received = await f.receive(opened.id, 10);
    assert.equal(received.status, 200);
    const rejected = await correct(opened, first.supply, [f.crate(row, 20, 1)]);
    assert.equal(rejected.status, 409, rejected.text);
    assert.match(rejected.body.error, /Receiving has started/);
    assert.equal((await lookup(opened)).issueBalance.originalWeight, 40);
    assert.equal((await lookup(opened)).canCorrectDeliveries, false);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: opened.id } }), 0);
    assert.equal((await api('delete', `/api/receive_from_coning_machine/rows/${received.body.row.id}`)).status, 200);
    assert.equal((await correct(opened, first.supply, [f.crate(row, 20, 1)])).status, 409);
  });

  test('active take-backs and wastage prohibit delivery corrections; reversal restores eligibility', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row);
    const issue = first.issueToConingMachine;
    const returned = await api('post', `${createPath}/${issue.id}/take_back`, { date: f.base.date, reason: 'Return', lines: [{ sourceId: row.id, count: 1, weight: 10 }] });
    assert.equal(returned.status, 200, returned.text);
    const rejected = await correct(issue, first.supply, [f.crate(row, 20, 1)]);
    assert.equal(rejected.status, 409, rejected.text);
    assert.match(rejected.body.error, /take-backs/);
    assert.equal((await specifications(issue, { requiredPerConeNetWeight: 250 })).status, 409);
    const takenBack = await prisma.issueTakeBack.findFirst({ where: { issueId: issue.id, isReverse: false } });
    assert.equal((await api('post', `/api/issue_take_backs/${takenBack.id}/reverse`, { reason: 'Incorrect return' })).status, 200);
    const wastage = await api('post', '/api/receive_from_coning_machine/mark_wastage', { issueId: issue.id });
    assert.equal(wastage.status, 200, wastage.text);
    const wasteRejected = await correct(issue, first.supply, [f.crate(row, 20, 1)]);
    assert.equal(wasteRejected.status, 409, wasteRejected.text);
    assert.match(wasteRejected.body.error, /wastage/);
    assert.equal((await specifications(issue, { requiredPerConeNetWeight: 250 })).status, 409);
    const reversed = await api('post', '/api/receive_from_coning_machine/revert_wastage', { issueId: issue.id, reason: 'Material found' });
    assert.equal(reversed.status, 200, reversed.text);
    assert.equal((await correct(issue, first.supply, [f.crate(row, 20, 1)])).status, 200);
  });

  test('concurrent corrections reject stale revisions instead of overwriting a delivery twice', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row);
    const responses = await Promise.all([20, 30].map((kg) => correct(first.issueToConingMachine, first.supply, [f.crate(row, kg, 1)])));
    assert.equal(responses.filter((result) => result.status === 200).length, 1, responses.map((r) => r.text).join('\n'));
    assert.equal(responses.filter((result) => result.status === 409).length, 1);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: first.issueToConingMachine.id } }), 1);
    const winner = responses.find((result) => result.status === 200).body;
    assert.equal((await lookup(first.issueToConingMachine)).issueBalance.originalWeight, winner.correction.after.issuedWeight);
    const staleMeta = await api('put', `${createPath}/${first.issueToConingMachine.id}`, { shift: 'Night', expectedRevision: 0 });
    assert.equal(staleMeta.status, 409);
  });

  test('a correction and a new issue competing for released stock cannot oversubscribe its source', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row, { crates: [f.crate(row, 20, 1)] });
    const responses = await Promise.all([
      correct(first.issueToConingMachine, first.supply, [f.crate(row, 40, 2)]),
      api('post', createPath, { ...f.base, batchMode: 'new', crates: [f.crate(row, 20, 1)] }),
    ]);
    assert.equal(responses.filter((result) => result.status === 200).length, 1, responses.map((r) => r.text).join('\n'));
    assert.ok(responses.every((result) => [200, 400, 409].includes(result.status)));
    const balance = await availability(row);
    assert.equal(balance.issuedToConingRolls, 2);
    assert.equal(balance.issuedToConingWeight, 40);
    assert.equal(balance.availableRolls, 0);
    assert.equal(balance.availableWeight, 0);
  });

  test('cleared matching fields disable future joining and unchanged saves create no correction', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const issue = first.issueToConingMachine;
    const unchanged = await api('put', `${createPath}/${issue.id}`, { shift: 'Day', expectedRevision: issue.coningBatchRevision });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.correction, null);
    const cleared = await api('put', `${createPath}/${issue.id}`, { operatorId: null, expectedRevision: issue.coningBatchRevision });
    assert.equal(cleared.status, 200, cleared.text);
    assert.equal(cleared.body.issueToConingMachine.coningBatchKey, null);
    assert.equal(cleared.body.issueToConingMachine.barcode, issue.barcode);
    assert.equal((await f.candidates(await f.source())).candidates.length, 0);
  });

  async function waitForBlocked(pid, minimum = 1) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const [{ count }] = await prisma.$queryRaw`WITH RECURSIVE blocked AS (
        SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT COUNT(*)::int AS count FROM blocked`;
      if (count >= minimum) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Expected API request to block on the fixture row lock');
  }

  test('a receive that wins the batch lock blocks an editor specification correction at save time', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const issue = first.issueToConingMachine;
    let release, ready;
    const held = new Promise((resolve) => { ready = resolve; });
    const hold = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssueToConingMachine" WHERE id = ${issue.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await new Promise((resolve) => { release = resolve; });
    });
    const pid = await held;
    let receiving, correcting;
    try {
      receiving = f.receive(issue.id, 10).then((result) => result);
      await waitForBlocked(pid);
      correcting = specifications(issue, { requiredPerConeNetWeight: 250 }).then((result) => result);
      await waitForBlocked(pid, 2);
    } finally { release(); await hold; }
    assert.equal((await receiving).status, 200);
    const rejected = await correcting;
    assert.equal(rejected.status, 409, rejected.text);
    assert.match(rejected.body.error, /Receiving has started/);
    assert.equal((await lookup(issue)).requiredPerConeNetWeight, 500);
    assert.equal(await prisma.coningIssueCorrection.count({ where: { issueId: issue.id } }), 0);
  });

  test('a specification correction that wins the lock makes simultaneous receiving use the corrected cone tare', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const issue = first.issueToConingMachine;
    const { cone } = await newPackaging();
    let release, ready;
    const held = new Promise((resolve) => { ready = resolve; });
    const hold = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssueToConingMachine" WHERE id = ${issue.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await new Promise((resolve) => { release = resolve; });
    });
    const pid = await held;
    let receiving, correcting;
    try {
      correcting = specifications(issue, { coneTypeId: cone.id, requiredPerConeNetWeight: 250 }).then((result) => result);
      await waitForBlocked(pid);
      receiving = f.receive(issue.id, 10).then((result) => result);
      await waitForBlocked(pid, 2);
    } finally { release(); await hold; }
    const saved = await correcting;
    const received = await receiving;
    assert.equal(saved.status, 200, saved.text);
    assert.equal(received.status, 200, received.text);
    assert.ok(Math.abs(received.body.row.tareWeight - 0.9) < 1e-9);
    assert.ok(Math.abs(received.body.row.netWeight - 9.8) < 1e-9);
    assert.equal((await lookup(issue)).expectedCones, 160);
  });

  test('a simultaneously saving receive wins the batch lock and blocks the waiting quantity correction', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row);
    const issue = first.issueToConingMachine;
    let release, ready;
    const held = new Promise((resolve) => { ready = resolve; });
    const hold = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssueToConingMachine" WHERE id = ${issue.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await new Promise((resolve) => { release = resolve; });
    });
    const pid = await held;
    let receiving, correcting;
    try {
      receiving = f.receive(issue.id, 10).then((result) => result);
      await waitForBlocked(pid);
      correcting = correct(issue, first.supply, [f.crate(row, 20, 1)]).then((result) => result);
      await waitForBlocked(pid, 2);
    } finally { release(); await hold; }
    const received = await receiving;
    const rejected = await correcting;
    assert.equal(received.status, 200, received.text);
    assert.equal(rejected.status, 409, rejected.text);
    assert.match(rejected.body.error, /Receiving has started/);
    const detail = await lookup(issue);
    assert.equal(detail.issueBalance.originalWeight, 40);
    assert.equal(detail.issueBalance.pendingWeight, 30);
    assert.equal(detail.corrections.length, 0);
  });

  test('a correction that wins the lock commits its allocation before simultaneous receiving consumes it', async () => {
    const f = await scenario();
    const row = await f.source();
    const first = await f.issue(row);
    const issue = first.issueToConingMachine;
    let release, ready;
    const held = new Promise((resolve) => { ready = resolve; });
    const hold = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReceiveFromHoloMachineRow" WHERE id = ${row.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      ready(pid);
      await new Promise((resolve) => { release = resolve; });
    });
    const pid = await held;
    let receiving, correcting;
    try {
      correcting = correct(issue, first.supply, [f.crate(row, 20, 1)]).then((result) => result);
      await waitForBlocked(pid);
      receiving = f.receive(issue.id, 10).then((result) => result);
    } finally { release(); await hold; }
    const saved = await correcting;
    const received = await receiving;
    assert.equal(saved.status, 200, saved.text);
    assert.equal(received.status, 200, received.text);
    const detail = await lookup(issue);
    assert.equal(detail.issueBalance.originalWeight, 20);
    assert.equal(detail.issueBalance.pendingWeight, 10);
    assert.equal(detail.corrections.length, 1);
    assert.equal(received.body.row.sourceRowRefs[0].weight, 10);
  });

  test('paid issues retain their edit protection and note-only corrections do not demand reprinting', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const issue = first.issueToConingMachine;
    const note = await api('put', `${createPath}/${issue.id}`, { note: 'Supervisor note', expectedRevision: issue.coningBatchRevision });
    assert.equal(note.status, 200, note.text);
    assert.equal(note.body.requiresStickerReprint, false);
    const received = await f.receive(issue.id, 10);
    assert.equal(received.status, 200);
    const contractor = await prisma.contractor.create({ data: { name: `Paid guard ${unique}` } });
    await prisma.contractorSettlement.create({ data: { contractorId: contractor.id, process: 'coning', periodFrom: f.base.date,
      periodTo: f.base.date, status: 'paid', lines: { create: { process: 'coning', sourceRowId: received.body.row.id, netKg: 10, ratePerKg: 1, amount: 10 } } } });
    const rejected = await api('put', `${createPath}/${issue.id}`, { shift: 'Night', expectedRevision: note.body.issueToConingMachine.coningBatchRevision });
    assert.equal(rejected.status, 409, rejected.text);
    assert.match(rejected.body.error, /PAID/);
    const specRejected = await specifications(note.body.issueToConingMachine, { requiredPerConeNetWeight: 250 });
    assert.equal(specRejected.status, 409, specRejected.text);
    assert.match(specRejected.body.error, /PAID/);
    assert.equal((await lookup(issue)).shift, 'Day');
    assert.equal((await request(app).post(`${createPath}/${issue.id}/supplies/${first.supply.id}/corrections`).send({})).status, 401);
  });

  test('payment protection rechecks a receive committed and paid between the row scan and acquiring the issue lock', async () => {
    const f = await scenario();
    const first = await f.issue(await f.source());
    const issue = first.issueToConingMachine;
    const { correctConingIssue } = await import('../../services/coningCorrections.js');
    let inserted = false;
    await assert.rejects(prisma.$transaction(async (tx) => {
      const receiving = new Proxy(tx.receiveFromConingMachineRow, { get(model, field) {
        if (field !== 'findMany') return model[field];
        return async (query) => {
          const originalRows = await model.findMany(query);
          if (!inserted) {
            inserted = true;
            assert.equal(originalRows.length, 0);
            const received = await f.receive(issue.id, 10);
            assert.equal(received.status, 200, received.text);
            const contractor = await prisma.contractor.create({ data: { name: `Payment race ${unique}` } });
            await prisma.contractorSettlement.create({ data: { contractorId: contractor.id, process: 'coning', periodFrom: f.base.date,
              periodTo: f.base.date, status: 'paid', lines: { create: { process: 'coning', sourceRowId: received.body.row.id, netKg: 10, ratePerKg: 1, amount: 10 } } } });
          }
          return originalRows;
        };
      } });
      const client = new Proxy(tx, { get(target, field) { return field === 'receiveFromConingMachineRow' ? receiving : target[field]; } });
      return correctConingIssue(client, { issueId: issue.id, patch: { shift: 'Night' }, expectedRevision: issue.coningBatchRevision, actorUserId: user.id });
    }), (error) => error.statusCode === 409 && /PAID/.test(error.message));
    assert.equal((await lookup(issue)).shift, 'Day');
    assert.equal((await lookup(issue)).corrections.length, 0);
  });

  test.after(async () => { await prisma.$disconnect(); });
}
