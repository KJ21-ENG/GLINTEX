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

  test.after(async () => { await prisma.$disconnect(); });
}
