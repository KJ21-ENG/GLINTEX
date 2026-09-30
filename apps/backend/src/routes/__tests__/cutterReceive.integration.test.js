import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

const databaseUrl = process.env.CUTTER_RECEIVE_TEST_DATABASE_URL;
if (!databaseUrl) {
  test('cutter receive integration (set CUTTER_RECEIVE_TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Cutter integration tests require a local disposable database');
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.LOCAL_DISABLE_INTEGRATIONS = '1';
  const { default: prisma } = await import('../../lib/prisma.js');
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.match(db, /^glintex_cutter_workers_.*_test$/);
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  assert.equal(settings?.whatsappEnabled, false, 'Disable messaging in the disposable clone first');
  assert.equal(settings?.telegramEnabled, false, 'Disable messaging in the disposable clone first');
  const { default: app } = await import('../../app.js');
  const request = (await import('supertest')).default;
  const { hashSessionToken } = await import('../../utils/auth.js');
  const { createCutterReceiveBatch } = await import('../../services/cutterReceive.js');
  after(() => prisma.$disconnect());
  const route = '/api/receive_from_cutter_machine/bulk';

  async function fixture(weight = 200) {
    const suffix = randomUUID();
    const role = await prisma.role.findUnique({ where: { key: 'admin' } });
    const user = await prisma.user.create({ data: {
      username: `cutter-qa-${suffix}`, passwordHash: 'not-a-login-password',
      roles: { create: { roleId: role.id } },
    } });
    const token = randomUUID();
    await prisma.userSession.create({ data: {
      userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000),
    } });
    const item = await prisma.item.create({ data: { name: `Cutter QA ${suffix}` } });
    const cut = await prisma.cut.create({ data: { name: `QA cut ${suffix}` } });
    const operatorA = await prisma.operator.create({ data: { name: `QA A ${suffix}`, role: 'operator', processType: 'cutter' } });
    const operatorB = await prisma.operator.create({ data: { name: `QA B ${suffix}`, role: 'operator', processType: 'cutter' } });
    const helper = await prisma.operator.create({ data: { name: `QA helper ${suffix}`, role: 'helper', processType: 'cutter' } });
    const bobbin = await prisma.bobbin.create({ data: { name: `QA bobbin ${suffix}`, weight: 0.01 } });
    const box = await prisma.box.create({ data: { name: `QA box ${suffix}`, weight: 1, processType: 'cutter' } });
    const piece = await prisma.inboundItem.create({ data: {
      id: `qa-piece-${suffix}`, lotNo: `QA-${suffix}`, itemId: item.id, weight,
      status: 'issued', seq: 1, barcode: `INB-QA-${suffix}`, issuedToCutterWeight: weight,
    } });
    const issue = await prisma.issueToCutterMachine.create({ data: {
      id: randomUUID(), date: '2026-09-30', itemId: item.id, lotNo: piece.lotNo,
      cutId: cut.id, count: 1, totalWeight: weight, pieceIds: piece.id,
      reason: 'Disposable cutter QA', operatorId: operatorA.id, barcode: `ICU-QA-${suffix}`,
      lines: { create: { pieceId: piece.id, issuedWeight: weight } },
    } });
    const entry = (operatorId = operatorA.id, netWeight = 10, helperId = '') => ({
      pieceId: piece.id, issueId: issue.id, operatorId, helperId, cutId: cut.id,
      bobbinId: bobbin.id, boxId: box.id, bobbinQuantity: 20, grossWeight: netWeight + 1.2,
      receiveDate: '2026-09-30', shift: 'Day',
    });
    return { user, auth: `Bearer ${token}`, piece, issue, operatorA, operatorB, helper, cut, entry };
  }
  const save = (f, entries) => request(app).post(route).set('Authorization', f.auth).send({ entries });
  async function assertEmpty(f) {
    assert.equal(await prisma.receiveFromCutterMachineRow.count({ where: { pieceId: f.piece.id } }), 0);
    assert.equal(await prisma.receiveFromCutterMachineChallan.count({ where: { pieceId: f.piece.id } }), 0);
    assert.equal(await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: f.piece.id } }), null);
  }

  test('one save keeps six crates per operator, ordered barcodes and original issue attribution', async () => {
    const f = await fixture();
    const entries = Array.from({ length: 12 }, (_, index) => f.entry(index % 2 ? f.operatorB.id : f.operatorA.id));
    const result = await save(f, entries).expect(200);
    assert.equal(result.body.challans.length, 2);
    assert.equal(result.body.challan.id, result.body.challans[0].id);
    assert.equal(result.body.rowsCreated, 12);
    for (const challan of result.body.challans) {
      assert.equal(challan.totalNetWeight, 60);
      assert.equal(challan.totalBobbinQty, 120);
      assert.equal(challan.helperId, null);
    }
    const rows = await prisma.receiveFromCutterMachineRow.findMany({ where: { pieceId: f.piece.id } });
    rows.sort((a, b) => Number(a.barcode.match(/-C(\d+)$/)[1]) - Number(b.barcode.match(/-C(\d+)$/)[1]));
    assert.deepEqual(rows.map(row => row.operatorId), entries.map(entry => entry.operatorId));
    assert.equal(new Set(rows.map(row => row.barcode)).size, 12);
    assert.equal(rows[11].barcode.endsWith('-C012'), true);
    assert.ok(rows.every(row => row.issueId === f.issue.id));
    for (const challan of result.body.challans) {
      assert.equal(rows.filter(row => row.challanId === challan.id).length, 6);
    }
    assert.equal((await prisma.issueToCutterMachine.findUnique({ where: { id: f.issue.id } })).operatorId, f.operatorA.id);
    const totals = await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: f.piece.id } });
    assert.equal(totals.totalNetWeight, 120);
    assert.equal(totals.totalBob, 240);
    const report = await request(app).get('/api/reports/production')
      .set('Authorization', f.auth)
      .query({ process: 'cutter', view: 'operator', from: '2026-09-30', to: '2026-09-30' }).expect(200);
    assert.equal(report.body.report.data.find(row => row.operatorId === f.operatorA.id).received, 60);
    assert.equal(report.body.report.data.find(row => row.operatorId === f.operatorB.id).received, 60);
  });

  test('a blank helper remains blank when another crate has a helper', async () => {
    const f = await fixture();
    const result = await save(f, [f.entry(), f.entry(f.operatorA.id, 10, f.helper.id)]).expect(200);
    assert.equal(result.body.challans.length, 2);
    const rows = await prisma.receiveFromCutterMachineRow.findMany({ where: { pieceId: f.piece.id } });
    assert.deepEqual(rows.map(row => row.helperId).sort(), [null, f.helper.id].sort());
  });

  test('each challan preserves its crates date and cut', async () => {
    const f = await fixture();
    const otherCut = await prisma.cut.create({ data: { name: `QA other cut ${randomUUID()}` } });
    const result = await save(f, [f.entry(), { ...f.entry(), receiveDate: '2026-09-29', cutId: otherCut.id }]).expect(200);
    assert.deepEqual(result.body.challans.map(challan => [challan.date, challan.cutId]), [
      ['2026-09-30', f.cut.id], ['2026-09-29', otherCut.id],
    ]);
    const rows = await prisma.receiveFromCutterMachineRow.findMany({ where: { pieceId: f.piece.id } });
    assert.ok(rows.some(row => row.date === '2026-09-29' && row.cutId === otherCut.id));
  });

  test('an invalid second operator rejects the entire batch without writes', async () => {
    const f = await fixture();
    await save(f, [f.entry(), f.entry(f.helper.id)]).expect(400);
    await assertEmpty(f);
  });

  test('invalid helper roles and operators from another process are rejected', async () => {
    const f = await fixture();
    await save(f, [f.entry(f.operatorA.id, 10, f.operatorB.id)]).expect(400);
    await prisma.operator.update({ where: { id: f.operatorB.id }, data: { processType: 'holo' } });
    await save(f, [f.entry(f.operatorB.id)]).expect(400);
    await assertEmpty(f);
  });

  test('combined weight and invalid later crate validation leave no partial challans', async () => {
    const f = await fixture(15);
    await save(f, [f.entry(), f.entry(f.operatorB.id)]).expect(400);
    await save(f, [f.entry(), { ...f.entry(f.operatorB.id), grossWeight: 0 }]).expect(400);
    await assertEmpty(f);
  });

  test('failure while creating the second challan rolls back upload, first challan and sequence', async () => {
    const f = await fixture();
    const sequenceId = `qa-sequence-${randomUUID()}`;
    let calls = 0;
    await assert.rejects(createCutterReceiveBatch(prisma, [f.entry(), f.entry(f.operatorB.id)], {
      actorUserId: f.user.id,
      loadIssueAllocations: async () => [{ issueId: f.issue.id, remainingWeight: 200 }],
      allocateChallanNumber: async (tx) => {
        if (++calls === 2) throw new Error('Injected second-challan failure');
        await tx.sequence.create({ data: { id: sequenceId, nextValue: 1 } });
        return { challanNo: sequenceId, sequence: 1, fiscalYear: '26-27' };
      },
      normalizeWastageNote: value => value || null,
    }), /Injected second-challan failure/);
    await assertEmpty(f);
    assert.equal(await prisma.sequence.findUnique({ where: { id: sequenceId } }), null);
    assert.equal(await prisma.receiveFromCutterMachineUpload.count({ where: { createdByUserId: f.user.id } }), 0);
  });

  test('concurrent saves serialize balances and crate numbering for the same piece', async () => {
    const f = await fixture(20);
    const results = await Promise.all([save(f, [f.entry(f.operatorA.id, 15)]), save(f, [f.entry(f.operatorB.id, 15)])]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    assert.equal(await prisma.receiveFromCutterMachineRow.count({ where: { pieceId: f.piece.id } }), 1);
    await save(f, [f.entry(f.operatorB.id, 5)]).expect(200);
    const rows = await prisma.receiveFromCutterMachineRow.findMany({ where: { pieceId: f.piece.id } });
    assert.equal(new Set(rows.map(row => row.barcode)).size, 2);
    assert.equal((await prisma.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId: f.piece.id } })).totalNetWeight, 20);
  });

  test('single-operator legacy clients retain a singular challan response', async () => {
    const f = await fixture();
    const { issueId, ...entry } = f.entry();
    const result = await save(f, [entry, entry]).expect(200);
    assert.equal(result.body.challans.length, 1);
    assert.equal(result.body.challan.totalNetWeight, 20);
  });

  test('remaining wastage is marked once after all worker groups and closes the piece', async () => {
    const f = await fixture(50);
    const close = { ...f.entry(f.operatorB.id), isWastage: true, wastageNote: 'QA close' };
    const result = await save(f, [f.entry(), f.entry(f.operatorB.id), close]).expect(200);
    assert.equal(result.body.challans.length, 2);
    assert.equal(result.body.wastageMarked, 30);
    assert.equal(result.body.challans.reduce((sum, challan) => sum + challan.wastageNetWeight, 0), 30);
    assert.equal(await prisma.wastageEvent.count({ where: { pieceId: f.piece.id, eventType: 'mark' } }), 1);
    await save(f, [f.entry()]).expect(400);
  });

  test('selected issue lineage is preserved when a piece has two open issues', async () => {
    const f = await fixture(100);
    await prisma.issueToCutterMachine.update({ where: { id: f.issue.id }, data: { totalWeight: 60 } });
    await prisma.issueToCutterMachineLine.updateMany({ where: { issueId: f.issue.id }, data: { issuedWeight: 60 } });
    const second = await prisma.issueToCutterMachine.create({ data: {
      id: randomUUID(), date: '2026-09-30', itemId: f.piece.itemId, lotNo: f.piece.lotNo,
      count: 1, totalWeight: 40, pieceIds: f.piece.id, reason: 'QA second issue',
      operatorId: f.operatorA.id, barcode: `ICU-QA-${randomUUID()}`,
      lines: { create: { pieceId: f.piece.id, issuedWeight: 40 } },
    } });
    await save(f, [{ ...f.entry(f.operatorB.id), issueId: second.id }]).expect(200);
    const row = await prisma.receiveFromCutterMachineRow.findFirst({ where: { pieceId: f.piece.id } });
    assert.equal(row.issueId, second.id);
    await save(f, [{ ...f.entry(), issueId: randomUUID() }]).expect(400);
  });
}
