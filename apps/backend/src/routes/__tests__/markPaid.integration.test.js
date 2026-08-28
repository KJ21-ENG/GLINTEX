// Route-level integration test for the Mark-Paid lifecycle, exercised against a
// REAL Postgres so it covers the atomic transaction, the draft->paid status
// guard, and the stale-production 409 — things the stub-based unit tests can't.
//
// Skipped unless TEST_DATABASE_URL is set (so the default `npm test` stays green
// without a database). The suite wipes and reseeds whole tables, so it REFUSES
// to run unless the connected database's actual name ends in `_test`. To run it:
//   createdb glintex_cp_test
//   DATABASE_URL=postgresql://postgres@localhost:5432/glintex_cp_test \
//     npx prisma db push --skip-generate
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/glintex_cp_test \
//     node --test src/routes/__tests__/markPaid.integration.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test('mark-paid route integration (skipped — set TEST_DATABASE_URL to run)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  const { default: prisma } = await import('../../lib/prisma.js');

  // Destructive-cleanup guard: this suite deleteMany()s business tables, so
  // verify the database we are ACTUALLY connected to (not just the URL string)
  // follows the disposable-test-database convention before importing the app
  // or touching any data.
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (!/_test$/.test(db)) {
    await prisma.$disconnect();
    throw new Error(
      `TEST_DATABASE_URL is connected to database "${db}", which does not end in "_test". `
      + 'Refusing to run destructive integration cleanup against a non-disposable database.',
    );
  }

  const request = (await import('supertest')).default;
  const { default: app } = await import('../../app.js');
  const { hashSessionToken } = await import('../../utils/auth.js');

  const CP = '/api/contractor-payments';
  let auth; // Authorization header value

  // Seed a self-contained coning production scenario and an admin session.
  async function seed() {
    // Clean slate (child-first for FK safety).
    await prisma.contractorSettlementRevision.deleteMany({});
    await prisma.contractorSettlementLine.deleteMany({});
    await prisma.contractorSettlementAdjustment.deleteMany({});
    await prisma.contractorSettlement.deleteMany({});
    await prisma.contractorRate.deleteMany({});
    await prisma.contractorAssignment.deleteMany({});
    await prisma.contractor.deleteMany({});
    await prisma.receiveFromConingMachinePieceTotal.deleteMany({});
    await prisma.receiveFromConingMachineRow.deleteMany({});
    await prisma.issueToConingMachine.deleteMany({});
    await prisma.box.deleteMany({});
    await prisma.userSession.deleteMany({});
    await prisma.userRole.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.role.deleteMany({});
    await prisma.item.deleteMany({});
    await prisma.yarn.deleteMany({});
    await prisma.cut.deleteMany({});
    await prisma.twist.deleteMany({});
    await prisma.coneType.deleteMany({});

    await prisma.receiveFromHoloMachineRow.deleteMany({});
    await prisma.issueToHoloMachine.deleteMany({});

    const role = await prisma.role.create({ data: { key: 'admin', name: 'Admin', permissions: {} } });
    const user = await prisma.user.create({ data: { username: 'tester', passwordHash: 'x', isActive: true } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = 'test-token-abc';
    await prisma.userSession.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    });
    auth = `Bearer ${token}`;

    const item = await prisma.item.create({ data: { name: 'S/S 40', side: 'SINGLE' } });
    const yarn = await prisma.yarn.create({ data: { name: '40s' } });
    const cut = await prisma.cut.create({ data: { name: '40' } });
    const coneType = await prisma.coneType.create({ data: { name: 'Test cone', weight: 0.1 } });
    const box = await prisma.box.create({ data: { name: 'Test box', weight: 1, processType: 'coning' } });
    const contractor = await prisma.contractor.create({ data: { name: 'Ravi' } });
    await prisma.contractorAssignment.create({ data: { contractorId: contractor.id, process: 'coning' } });
    await prisma.contractorRate.create({
      data: { contractorId: contractor.id, process: 'coning', yarnId: yarn.id, cutId: cut.id, side: 'SINGLE', ratePerKg: 8 },
    });

    async function makeRow(suffix, netWeight) {
      const issue = await prisma.issueToConingMachine.create({
        data: {
          date: '2026-03-15', itemId: item.id, lotNo: `L-${suffix}`, yarnId: yarn.id, cutId: cut.id,
          barcode: `CI-${suffix}`, receivedRowRefs: [{ coneTypeId: coneType.id }],
        },
      });
      const row = await prisma.receiveFromConingMachineRow.create({
        data: {
          issueId: issue.id,
          boxId: box.id,
          coneCount: 1,
          grossWeight: netWeight + 1.1,
          tareWeight: 1.1,
          coneWeight: netWeight,
          netWeight,
          date: '2026-03-15',
          barcode: `CR-${suffix}`,
          createdBy: 'manual',
        },
      });
      // The production row-edit routes require the per-issue receive totals.
      await prisma.receiveFromConingMachinePieceTotal.create({
        data: { pieceId: issue.id, totalCones: 1, totalNetWeight: netWeight, wastageNetWeight: 0 },
      });
      return row.id;
    }
    return { contractorId: contractor.id, rowA: await makeRow('A', 10), rowB: await makeRow('B', 10) };
  }

  // Create a user with a given (non-admin) role permission set; returns its auth header.
  async function makeUserSession(username, roleKey, permissions) {
    const role = await prisma.role.create({ data: { key: roleKey, name: roleKey, permissions } });
    const user = await prisma.user.create({ data: { username, passwordHash: 'x', isActive: true } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = `tok-${username}`;
    await prisma.userSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) } });
    return `Bearer ${token}`;
  }

  const base = { process: 'coning', date: '2026-03-15' };

  // Run `mutate(tx)` on a SECOND connection and hold the transaction open
  // (uncommitted) while `during()` runs; then commit the held edit and return
  // during()'s settled result. Reproduces "in-flight edit vs Mark Paid" races.
  async function withHeldEdit(mutate, during) {
    const { PrismaClient } = await import('@prisma/client');
    const editor = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    try {
      let releaseHold; const hold = new Promise((r) => { releaseHold = r; });
      let signalApplied; const applied = new Promise((r) => { signalApplied = r; });
      const editTx = editor.$transaction(async (tx) => {
        await mutate(tx);
        signalApplied();
        await hold; // keep the edit uncommitted while during() runs
      }, { timeout: 15000 });
      // Race against editTx so a mutate() failure rejects instead of hanging.
      await Promise.race([applied, editTx]);
      const pending = during(); // must start the request eagerly (a Promise)
      // Give the request time to reach the lock, then commit the held edit.
      await new Promise((r) => setTimeout(r, 400));
      releaseHold();
      await editTx;
      return await pending;
    } finally {
      await editor.$disconnect();
    }
  }

  test('preview surfaces the eligible coning row', async () => {
    const { contractorId, rowA } = await seed();
    const res = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.lines.length, 2);
    assert.ok(res.body.lines.some((l) => l.sourceRowId === rowA && l.amount === 80));
  });

  test('create draft then Mark Paid succeeds and flips status', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.status, 'draft');
    assert.equal(draft.body.finalPayable, 80);

    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'paid');

    // Re-paying the now-paid settlement is rejected by the status guard.
    const again = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(again.status, 409);
  });

  test('Mark Paid returns 409 when the underlying production changed after drafting', async () => {
    const { contractorId, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowB] });
    assert.equal(draft.status, 200);

    // Simulate an out-of-band production edit AFTER the snapshot: change the KG.
    await prisma.receiveFromConingMachineRow.update({ where: { id: rowB }, data: { netWeight: 7 } });

    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 409);
    assert.ok(Array.isArray(paid.body.mismatches) && paid.body.mismatches.length === 1);
    // The draft stayed a draft (not paid on stale data).
    const still = await prisma.contractorSettlement.findUnique({ where: { id: draft.body.id } });
    assert.equal(still.status, 'draft');
  });

  test('Mark Paid returns 409 when Side changes but the amount stays the same', async () => {
    const { contractorId, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowB] });
    assert.equal(draft.status, 200);

    // Add a BOTH rate at the same ₹8 and flip the item's Side to BOTH: amount is
    // identical, but the payment identity changed — must still block.
    const row = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowB }, include: { issue: true } });
    const yarnId = row.issue.yarnId; const cutId = row.issue.cutId;
    await prisma.contractorRate.create({ data: { contractorId, process: 'coning', yarnId, cutId, side: 'BOTH', ratePerKg: 8 } });
    await prisma.item.update({ where: { id: row.issue.itemId }, data: { side: 'BOTH' } });

    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 409);
  });

  test('Mark Paid cannot race an in-flight production edit (row locks serialize them)', async () => {
    const { contractorId, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowB] });
    assert.equal(draft.status, 200);

    // An UNCOMMITTED 10→7 KG edit on the claimed row — the interleaving where
    // Mark Paid used to validate against the old committed 10 KG, pay ₹80,
    // and then have the 7 KG edit land afterwards.
    const paid = await withHeldEdit(
      (tx) => tx.receiveFromConingMachineRow.update({ where: { id: rowB }, data: { netWeight: 7 } }),
      () => request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
        .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' }).then((r) => r),
    );
    assert.equal(paid.status, 409); // revalidation must see the committed 7 KG
    const still = await prisma.contractorSettlement.findUnique({ where: { id: draft.body.id } });
    assert.equal(still.status, 'draft');
    const row = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowB } });
    assert.equal(Number(row.netWeight), 7);
  });

  test('Mark Paid cannot race an in-flight Item Side change (masters are locked too)', async () => {
    const { contractorId, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowB] });
    assert.equal(draft.status, 200);
    const item = await prisma.item.findFirst({ where: { name: 'S/S 40' } });

    // An UNCOMMITTED SINGLE→BOTH Side flip: the payment identity of the drafted
    // line changes, so Mark Paid must wait for it and then refuse.
    const paid = await withHeldEdit(
      (tx) => tx.item.update({ where: { id: item.id }, data: { side: 'BOTH' } }),
      () => request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
        .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' }).then((r) => r),
    );
    assert.equal(paid.status, 409);
    const still = await prisma.contractorSettlement.findUnique({ where: { id: draft.body.id } });
    assert.equal(still.status, 'draft');
    assert.equal((await prisma.item.findUnique({ where: { id: item.id } })).side, 'BOTH');
  });

  test('Mark Paid cannot race an in-flight rate change (advisory locks serialize rate config)', async () => {
    const { contractorId, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowB] });
    assert.equal(draft.status, 200);
    const rate = await prisma.contractorRate.findFirst({ where: { contractorId, process: 'coning' } });

    // An UNCOMMITTED ₹8→₹9 rate change, held under the same advisory lock the
    // rate routes take — exactly what an in-flight PUT /rates/:id holds.
    const paid = await withHeldEdit(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contractor_rate:${contractorId}:coning`}))`;
        await tx.contractorRate.update({ where: { id: rate.id }, data: { ratePerKg: 9 } });
      },
      () => request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
        .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' }).then((r) => r),
    );
    assert.equal(paid.status, 409); // drafted at ₹8, current rate is ₹9
    const still = await prisma.contractorSettlement.findUnique({ where: { id: draft.body.id } });
    assert.equal(still.status, 'draft');
    assert.equal(Number((await prisma.contractorRate.findUnique({ where: { id: rate.id } })).ratePerKg), 9);
  });

  // A coning receive row whose Cut is only correct via the holo lineage: the
  // coning issue carries a STALE cutId (40) but refs a holo row whose holo
  // issue says Cut 60. Rate: Cut 60 @ ₹12 (the seed's Cut-40 @ ₹8 must lose).
  async function seedLineage(contractorId) {
    const yarn = await prisma.yarn.findFirst();
    const item = await prisma.item.findFirst(); // side SINGLE
    const cut40 = await prisma.cut.findFirst(); // '40' — the stale denormalized value
    const cut60 = await prisma.cut.create({ data: { name: '60' } });
    const holoIssue = await prisma.issueToHoloMachine.create({
      data: { date: '2026-03-10', itemId: item.id, lotNo: 'L-H1', yarnId: yarn.id, cutId: cut60.id, barcode: 'HI-1' },
    });
    const holoRow = await prisma.receiveFromHoloMachineRow.create({
      data: { issueId: holoIssue.id, rollCount: 1, rollWeight: 10, date: '2026-03-10', barcode: 'HR-1' },
    });
    const coningIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-03-15', itemId: item.id, lotNo: 'L-T1', yarnId: yarn.id, cutId: cut40.id,
        barcode: 'CI-T1', receivedRowRefs: [{ rowId: holoRow.id, coneTypeId: null }],
      },
    });
    const row = await prisma.receiveFromConingMachineRow.create({
      data: { issueId: coningIssue.id, coneCount: 1, netWeight: 10, date: '2026-03-15', barcode: 'CR-T1', createdBy: 'manual' },
    });
    await prisma.receiveFromConingMachinePieceTotal.create({
      data: { pieceId: coningIssue.id, totalCones: 1, totalNetWeight: 10, wastageNetWeight: 0 },
    });
    await prisma.contractorRate.create({
      data: { contractorId, process: 'coning', yarnId: yarn.id, cutId: cut60.id, side: 'SINGLE', ratePerKg: 12 },
    });
    return { row, holoIssue, coningIssue, cut60 };
  }

  test('coning preview prices the Cut traced through holo lineage, not the stale issue cutId', async () => {
    const { contractorId } = await seed();
    const { row, cut60 } = await seedLineage(contractorId);

    const res = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.equal(res.status, 200);
    const line = res.body.lines.find((l) => l.sourceRowId === row.id);
    assert.ok(line, 'lineage-traced row should be payable');
    assert.equal(line.cutId, cut60.id);
    assert.equal(line.ratePerKg, 12);
    assert.equal(line.amount, 120);
  });

  test('Mark Paid cannot race an in-flight coning issue quality change (issue locks)', async () => {
    const { contractorId, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowB] });
    assert.equal(draft.status, 200);
    const row = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowB }, select: { issueId: true } });
    const cut60 = await prisma.cut.create({ data: { name: '60-race' } });

    // An UNCOMMITTED Cut change on the row's coning issue: the drafted line's
    // rate identity changes, so Mark Paid must wait for it and then refuse.
    const paid = await withHeldEdit(
      (tx) => tx.issueToConingMachine.update({ where: { id: row.issueId }, data: { cutId: cut60.id } }),
      () => request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
        .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' }).then((r) => r),
    );
    assert.equal(paid.status, 409);
    const still = await prisma.contractorSettlement.findUnique({ where: { id: draft.body.id } });
    assert.equal(still.status, 'draft');
    assert.equal((await prisma.issueToConingMachine.findUnique({ where: { id: row.issueId } })).cutId, cut60.id);
  });

  test('editing or deleting a coning issue behind a PAID settlement is rejected', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowA] });
    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 200);
    const row = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowA }, select: { issueId: true } });

    const edit = await request(app).put(`/api/issue_to_coning_machine/${row.issueId}`)
      .set('Authorization', auth).send({ note: 'tweak' });
    assert.equal(edit.status, 409, JSON.stringify(edit.body));
    // Deletion is refused: 400 by the pre-existing receives-exist rule, or 409
    // by the paid guard (which also covers soft-deleted-receives edge cases).
    const del = await request(app).delete(`/api/issue_to_coning_machine/${row.issueId}`)
      .set('Authorization', auth);
    assert.ok(del.status === 400 || del.status === 409, `expected refusal, got ${del.status}`);
    assert.equal((await prisma.issueToConingMachine.findUnique({ where: { id: row.issueId } })).isDeleted, false);
  });

  test('editing a holo issue upstream of a PAID coning settlement is rejected', async () => {
    const { contractorId } = await seed();
    const { row, holoIssue } = await seedLineage(contractorId);
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [row.id] });
    assert.equal(draft.status, 200);
    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 200);

    // The paid coning line's Cut came from THIS holo issue via lineage — its
    // quality must be frozen too.
    const edit = await request(app).put(`/api/issue_to_holo_machine/${holoIssue.id}`)
      .set('Authorization', auth).send({ note: 'tweak' });
    assert.equal(edit.status, 409, JSON.stringify(edit.body));
    // Deletion is refused: 400 by the pre-existing receives-exist rule, or 409
    // by the paid guard.
    const del = await request(app).delete(`/api/issue_to_holo_machine/${holoIssue.id}`)
      .set('Authorization', auth);
    assert.ok(del.status === 400 || del.status === 409, `expected refusal, got ${del.status}`);
    assert.equal((await prisma.issueToHoloMachine.findUnique({ where: { id: holoIssue.id } })).isDeleted, false);
  });

  test('editing a holo issue above a PAID re-coning descendant is rejected (recursive guard)', async () => {
    const { contractorId } = await seed();
    const { row: parentRow, holoIssue } = await seedLineage(contractorId);
    // Re-coning child: a coning issue referencing the PARENT coning receive
    // row; the CHILD's receive row is the one that gets paid. Its Cut traces
    // child → parent row → parent issue → holo row → holo issue (cut60, ₹12).
    const yarn = await prisma.yarn.findFirst();
    const item = await prisma.item.findFirst();
    const childIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-03-20', itemId: item.id, lotNo: 'L-T2', yarnId: yarn.id, cutId: null,
        barcode: 'CI-T2', receivedRowRefs: [{ rowId: parentRow.id, coneTypeId: null }],
      },
    });
    const childRow = await prisma.receiveFromConingMachineRow.create({
      data: { issueId: childIssue.id, coneCount: 1, netWeight: 5, date: '2026-03-20', barcode: 'CR-T2', createdBy: 'manual' },
    });
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, process: 'coning', date: '2026-03-20', sourceRowIds: [childRow.id] });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 200);

    // The holo issue is now frozen through TWO levels of coning lineage.
    const edit = await request(app).put(`/api/issue_to_holo_machine/${holoIssue.id}`)
      .set('Authorization', auth).send({ note: 'tweak' });
    assert.equal(edit.status, 409, JSON.stringify(edit.body));
  });

  test('a failing import rolls back completely (no partial restore)', async () => {
    const { rowA } = await seed();
    const itemsBefore = await prisma.item.count();
    assert.ok(itemsBefore >= 1);
    // A lot referencing a missing Item/Firm makes the recreation fail after
    // the destructive deletes — the whole import must roll back as one unit.
    const res = await request(app).post('/api/import').set('Authorization', auth)
      .send({ lots: [{ lotNo: 'X-1', date: '2026-01-01', itemId: 'missing-item', firmId: 'missing-firm' }] });
    assert.ok(res.status >= 400, `import should fail, got ${res.status}`);
    assert.equal(await prisma.item.count(), itemsBefore); // deletes rolled back
    assert.ok(await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowA } }));
  });

  test('draft creation prices under the settlement-lines lock (no stale rows past an import)', async () => {
    const { contractorId, rowB } = await seed();
    // Emulate an in-flight import: exclusive settlement-lines lock plus a row
    // removal, held uncommitted while the draft request runs. Pricing must
    // happen AFTER the shared lock, so the draft sees the committed removal.
    const res = await withHeldEdit(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contractor_payments:settlement_lines'}))`;
        await tx.receiveFromConingMachineRow.update({ where: { id: rowB }, data: { isDeleted: true } });
      },
      () => request(app).post(`${CP}/settlements`).set('Authorization', auth)
        .send({ contractorId, ...base, sourceRowIds: [rowB] }).then((r) => r),
    );
    assert.equal(res.status, 400, JSON.stringify(res.body)); // row no longer eligible
    // No settlement line was created against the removed row.
    assert.equal(await prisma.contractorSettlementLine.count({ where: { sourceRowId: rowB } }), 0);
  });

  test('import cannot race a concurrent settlement-line creation (global lock)', async () => {
    const { contractorId, rowA } = await seed();
    // A settlement with NO lines yet — the first line lands inside a held
    // transaction, invisible to a naive count(). The import must serialize on
    // the shared lock and then see it.
    const settlement = await prisma.contractorSettlement.create({
      data: { contractorId, process: 'coning', periodFrom: base.date, periodTo: base.date, status: 'draft' },
    });
    const res = await withHeldEdit(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${'contractor_payments:settlement_lines'}))`;
        await tx.contractorSettlementLine.create({
          data: { settlementId: settlement.id, process: 'coning', sourceRowId: rowA, netKg: 10, ratePerKg: 8, amount: 80 },
        });
      },
      () => request(app).post('/api/import').set('Authorization', auth).send({ items: [] }).then((r) => r),
    );
    assert.equal(res.status, 409);
    // The freshly-claimed production row survived.
    assert.ok(await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowA } }));
  });

  test('destructive full import is rejected while contractor settlement lines exist', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(draft.status, 200);

    const res = await request(app).post('/api/import').set('Authorization', auth).send({ items: [] });
    assert.equal(res.status, 409);
    // Nothing was deleted.
    assert.equal(await prisma.receiveFromConingMachineRow.count(), 2);
    assert.ok(await prisma.item.count() >= 1);
  });

  test('production row edit/delete is rejected once the row is in a PAID settlement', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(draft.status, 200);
    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth)
      .send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 200);

    // Production mutations must refuse; corrections go through admin paid-edit.
    const edit = await request(app).put(`/api/receive_from_coning_machine/rows/${rowA}`)
      .set('Authorization', auth).send({ coneCount: 1, grossWeight: 7 });
    assert.equal(edit.status, 409, JSON.stringify(edit.body));
    const del = await request(app).delete(`/api/receive_from_coning_machine/rows/${rowA}`)
      .set('Authorization', auth);
    assert.equal(del.status, 409);
    // The paid row is untouched.
    const row = await prisma.receiveFromConingMachineRow.findUnique({ where: { id: rowA } });
    assert.equal(Number(row.netWeight), 10);
    assert.equal(row.isDeleted, false);
  });

  test('admin paid-edit records an immutable revision with the correct delta', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    const paid = await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth).send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    assert.equal(paid.status, 200);

    const detail = await request(app).get(`${CP}/settlements/${draft.body.id}`).set('Authorization', auth);
    const lineId = detail.body.lines[0].id;
    // Override KG 10 -> 5 at ₹8 => amount 40; previous final was 80.
    const edit = await request(app).put(`${CP}/settlements/${draft.body.id}/paid-edit`).set('Authorization', auth)
      .send({ reason: 'Corrected weight', lineOverrides: [{ lineId, netKg: 5 }] });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.settlement.finalPayable, 40);
    assert.equal(edit.body.delta, -40);
    assert.equal(edit.body.revision.previousTotal, 80);
    assert.equal(edit.body.revision.newTotal, 40);

    const after = await request(app).get(`${CP}/settlements/${draft.body.id}`).set('Authorization', auth);
    assert.equal(after.body.revisions.length, 1);
    assert.equal(after.body.revisions[0].delta, -40);
    assert.equal(after.body.status, 'paid'); // stays paid

    // A paid-edit requires a reason.
    const noReason = await request(app).put(`${CP}/settlements/${draft.body.id}/paid-edit`).set('Authorization', auth)
      .send({ lineOverrides: [{ lineId, netKg: 6 }] });
    assert.equal(noReason.status, 400);
  });

  test('admin paid-edit can ADD a production line (resolved in-lock) and updates the delta', async () => {
    const { contractorId, rowA, rowB } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', auth).send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });

    const edit = await request(app).put(`${CP}/settlements/${draft.body.id}/paid-edit`).set('Authorization', auth)
      .send({ reason: 'Add a missed row', addSourceRowIds: [rowB] });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.settlement.lines.length, 2);
    assert.equal(edit.body.settlement.finalPayable, 160); // 80 + 80
    assert.equal(edit.body.delta, 80);
    assert.equal(edit.body.revision.previousTotal, 80);
    assert.equal(edit.body.revision.newTotal, 160);
    // rowB is now claimed by this settlement → no longer available.
    const p = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.ok(!p.body.lines.some((l) => l.sourceRowId === rowB));
  });

  test('create draft applies itemized adjustments to the final payable', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth)
      .send({ contractorId, ...base, sourceRowIds: [rowA], adjustments: [{ type: 'bonus', amount: 20, reason: 'incentive' }, { type: 'deduction', amount: 5, reason: 'shortfall' }] });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.productionAmount, 80);
    assert.equal(draft.body.adjustmentsTotal, 15); // +20 − 5
    assert.equal(draft.body.finalPayable, 95);
  });

  test('a production row cannot be claimed by two settlements (double-pay prevented)', async () => {
    const { contractorId, rowA } = await seed();
    const d1 = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(d1.status, 200);
    const d2 = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(d2.status, 400); // rowA already claimed → unavailable
  });

  test('deleting a draft frees its rows; a paid settlement cannot be deleted', async () => {
    const { contractorId, rowA } = await seed();
    const d1 = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(d1.status, 200);
    // Claimed → not in preview.
    const p1 = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.ok(!p1.body.lines.some((l) => l.sourceRowId === rowA));
    // Delete frees it.
    const del = await request(app).delete(`${CP}/settlements/${d1.body.id}`).set('Authorization', auth);
    assert.equal(del.status, 200);
    const p2 = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.ok(p2.body.lines.some((l) => l.sourceRowId === rowA));

    // Re-claim, pay, then confirm a PAID settlement cannot be deleted.
    const d2 = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    assert.equal(d2.status, 200);
    await request(app).post(`${CP}/settlements/${d2.body.id}/mark-paid`).set('Authorization', auth).send({ paymentDate: '2026-04-01', paymentMode: 'Cash' });
    const delPaid = await request(app).delete(`${CP}/settlements/${d2.body.id}`).set('Authorization', auth);
    assert.equal(delPaid.status, 400);
    const still = await prisma.contractorSettlement.findUnique({ where: { id: d2.body.id } });
    assert.equal(still.status, 'paid');
  });

  test('permissions: a contractor_payments READ-only user is blocked from writes', async () => {
    const { contractorId, rowA } = await seed();
    // Draft to target for delete/paid-edit attempts.
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    const viewer = await makeUserSession('viewer', 'viewer', { contractor_payments: 1 }); // READ only

    // READ endpoints allowed.
    assert.equal((await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', viewer)).status, 200);
    assert.equal((await request(app).get(`${CP}/settlements`).set('Authorization', viewer)).status, 200);
    // WRITE / DELETE / admin endpoints blocked (403).
    assert.equal((await request(app).post(`${CP}/settlements`).set('Authorization', viewer).send({ contractorId, ...base, sourceRowIds: [] })).status, 403);
    assert.equal((await request(app).post(`${CP}/settlements/${draft.body.id}/mark-paid`).set('Authorization', viewer).send({ paymentDate: '2026-04-01', paymentMode: 'Cash' })).status, 403);
    assert.equal((await request(app).delete(`${CP}/settlements/${draft.body.id}`).set('Authorization', viewer)).status, 403);
    assert.equal((await request(app).put(`${CP}/settlements/${draft.body.id}/paid-edit`).set('Authorization', viewer).send({ reason: 'x' })).status, 403);
    // A user with no contractor_payments permission at all can't even preview.
    const none = await makeUserSession('nobody', 'nobody', { masters: 0 });
    assert.equal((await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', none)).status, 403);
  });

  test('a second current owner is rejected per process', async () => {
    const { contractorId } = await seed(); // seed already gives this contractor the current coning owner
    const other = await prisma.contractor.create({ data: { name: 'Other' } });
    // A second current coning owner for a DIFFERENT contractor → 409.
    const clash = await request(app).post(`${CP}/assignments`).set('Authorization', auth)
      .send({ contractorId: other.id, process: 'coning' });
    assert.equal(clash.status, 409);
    // A different process is fine.
    const ok = await request(app).post(`${CP}/assignments`).set('Authorization', auth)
      .send({ contractorId: other.id, process: 'holo' });
    assert.equal(ok.status, 200);
  });

  test('rate cross-override conflict is rejected at creation (409)', async () => {
    const { contractorId } = await seed();
    const row = await prisma.receiveFromConingMachineRow.findFirst({ include: { issue: true } });
    const { yarnId, cutId } = row.issue;
    // seed created a base SINGLE rate. A twist-only and a cone-only override at
    // the same specificity intersect → the second must be rejected.
    const twist = await prisma.twist.create({ data: { name: 'TW-x' } });
    const cone = await prisma.coneType.create({ data: { name: 'Cone-x' } });
    const r1 = await request(app).post(`${CP}/rates`).set('Authorization', auth)
      .send({ contractorId, process: 'coning', yarnId, cutId, side: 'SINGLE', twistId: twist.id, ratePerKg: 9 });
    assert.equal(r1.status, 200);
    const r2 = await request(app).post(`${CP}/rates`).set('Authorization', auth)
      .send({ contractorId, process: 'coning', yarnId, cutId, side: 'SINGLE', coneTypeId: cone.id, ratePerKg: 11 });
    assert.equal(r2.status, 409);
  });

  test('multi-yarn rate creation creates one rate row per selected yarn', async () => {
    const { contractorId } = await seed();
    const yarnA = await prisma.yarn.create({ data: { name: '60s' } });
    const yarnB = await prisma.yarn.create({ data: { name: '80s' } });
    const selectedIds = [yarnA.id, yarnB.id];

    const response = await request(app).post(`${CP}/rates`).set('Authorization', auth)
      .send({ contractorId, process: 'holo', yarnIds: selectedIds, ratePerKg: 9 });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.equal(response.body.length, 2);
    assert.deepEqual(response.body.map((rate) => rate.yarnId).sort(), selectedIds.sort());

    const rows = await prisma.contractorRate.findMany({ where: { contractorId, process: 'holo' } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((rate) => rate.yarnId).sort(), selectedIds.sort());
    assert.ok(rows.every((rate) => Number(rate.ratePerKg) === 9));
  });

  test('multi-yarn, side, and cone-type rate creation expands all combinations', async () => {
    const { contractorId } = await seed();
    const yarnA = await prisma.yarn.create({ data: { name: '60s-combo' } });
    const yarnB = await prisma.yarn.create({ data: { name: '80s-combo' } });
    const coneA = await prisma.coneType.create({ data: { name: 'Cone-A-combo' } });
    const coneB = await prisma.coneType.create({ data: { name: 'Cone-B-combo' } });
    const yarnIds = [yarnA.id, yarnB.id];
    const sides = ['SINGLE', 'BOTH'];
    const coneTypeIds = [coneA.id, coneB.id];

    const response = await request(app).post(`${CP}/rates`).set('Authorization', auth)
      .send({ contractorId, process: 'coning', yarnIds, sides, coneTypeIds, ratePerKg: 10 });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.equal(response.body.length, 8);
    const expectedKeys = yarnIds.flatMap((yarnId) => sides.flatMap((side) => coneTypeIds.map((coneTypeId) => `${yarnId}:${side}:${coneTypeId}`))).sort();
    const responseKeys = response.body.map((rate) => `${rate.yarnId}:${rate.side}:${rate.coneTypeId}`).sort();
    assert.deepEqual(responseKeys, expectedKeys);

    const rows = await prisma.contractorRate.findMany({
      where: { contractorId, process: 'coning', yarnId: { in: yarnIds } },
    });
    assert.equal(rows.length, 8);
    assert.ok(rows.every((rate) => Number(rate.ratePerKg) === 10));
  });

  test('empty cone-type selection creates the existing Any wildcard rate', async () => {
    const { contractorId } = await seed();
    const yarn = await prisma.yarn.create({ data: { name: 'wildcard-combo' } });

    const response = await request(app).post(`${CP}/rates`).set('Authorization', auth)
      .send({ contractorId, process: 'coning', yarnIds: [yarn.id], sides: ['SINGLE'], coneTypeIds: [], ratePerKg: 11 });

    assert.equal(response.status, 200);
    assert.equal(response.body.yarnId, yarn.id);
    assert.equal(response.body.side, 'SINGLE');
    assert.equal(response.body.coneTypeId, null);
  });

  test('deleted production rows are excluded from the preview', async () => {
    const { contractorId } = await seed();
    // Mark every coning receive row deleted → nothing eligible.
    await prisma.receiveFromConingMachineRow.updateMany({ data: { isDeleted: true } });
    const res = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.lines.length, 0);
  });

  test('settlements are separated per process (coning preview excludes other processes)', async () => {
    const { contractorId } = await seed();
    // The coning preview only ever queries coning receive rows; a holo/cutter row
    // on the same date is structurally absent. Assert every previewed line is coning.
    const res = await request(app).get(`${CP}/preview`).query({ contractorId, ...base }).set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.ok(res.body.lines.length > 0);
    assert.ok(res.body.lines.every((l) => l.process === 'coning'));
    // A cutter preview cannot resolve a process owner until one is assigned.
    const cutter = await request(app).get(`${CP}/preview`).query({ contractorId, process: 'cutter', date: base.date }).set('Authorization', auth);
    assert.equal(cutter.status, 409);
    assert.match(cutter.body.error, /No contractor is assigned/);
  });

  test('settlement PDF endpoint returns a PDF document', async () => {
    const { contractorId, rowA } = await seed();
    const draft = await request(app).post(`${CP}/settlements`).set('Authorization', auth).send({ contractorId, ...base, sourceRowIds: [rowA] });
    const pdf = await request(app).get(`${CP}/settlements/${draft.body.id}/pdf`).set('Authorization', auth).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers['content-type'], /application\/pdf/);
    assert.ok(pdf.body.length > 100 && pdf.body.slice(0, 5).toString() === '%PDF-');
  });

  test('migration Side backfill maps S/S->SINGLE, B/S->BOTH, leaves others UNKNOWN', async () => {
    // Execute the ACTUAL migration artifact's backfill statements (so drift in
    // the migration file is what this test validates), against own fixtures:
    // seed() wiped the Item table, and the only UNKNOWN-side rows in this
    // disposable test database are the ones created here. Assertions stay
    // scoped to the fixture ids.
    const { readFile } = await import('node:fs/promises');
    const migrationSql = await readFile(
      new URL('../../../prisma/migrations/20260711090000_add_contractor_payments/migration.sql', import.meta.url),
      'utf8',
    );
    const backfillStatements = migrationSql.split('\n')
      .filter((line) => !line.trim().startsWith('--')) // comments may contain ';'
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.includes('UPDATE "Item" SET "side"'));
    assert.equal(backfillStatements.length, 2, 'migration must contain exactly the two Side backfill statements');

    const fixtures = await Promise.all([
      prisma.item.create({ data: { name: 'S/S 40 Gold MIGFIX' } }),
      prisma.item.create({ data: { name: ' b/s lower MIGFIX ' } }),
      prisma.item.create({ data: { name: 'Plain Item MIGFIX' } }),
    ]); // all default to UNKNOWN
    const ids = fixtures.map((f) => f.id);
    for (const stmt of backfillStatements) {
      await prisma.$executeRawUnsafe(stmt);
    }
    const byName = Object.fromEntries(
      (await prisma.item.findMany({ where: { id: { in: ids } } })).map((i) => [i.name.trim(), i.side]),
    );
    assert.equal(byName['S/S 40 Gold MIGFIX'], 'SINGLE');
    assert.equal(byName['b/s lower MIGFIX'], 'BOTH');
    assert.equal(byName['Plain Item MIGFIX'], 'UNKNOWN');
    await prisma.item.deleteMany({ where: { id: { in: ids } } });
  });

  test.after(async () => { await prisma.$disconnect(); });
}
