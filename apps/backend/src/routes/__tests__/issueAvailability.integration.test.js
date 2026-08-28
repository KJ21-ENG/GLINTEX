import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DB = process.env.TEST_PERFORMANCE_DATABASE_URL;

if (!TEST_DB) {
  test('concurrent issue availability integration (skipped - set TEST_PERFORMANCE_DATABASE_URL)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  const { default: prisma } = await import('../../lib/prisma.js');
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (!/_perf_test$/.test(db)) {
    await prisma.$disconnect();
    throw new Error(`Refusing concurrency tests against database "${db}" because its name does not end in _perf_test.`);
  }

  const request = (await import('supertest')).default;
  const { default: app } = await import('../../app.js');
  const { hashSessionToken } = await import('../../utils/auth.js');

  async function ensureAdminRole() {
    const existing = await prisma.role.findUnique({ where: { key: 'admin' } });
    if (existing) return existing;
    try {
      return await prisma.role.create({ data: { key: 'admin', name: 'Admin', permissions: {} } });
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
      return prisma.role.findUniqueOrThrow({ where: { key: 'admin' } });
    }
  }

  async function adminAuth(suffix) {
    const role = await ensureAdminRole();
    const user = await prisma.user.create({ data: { username: `perf-user-${suffix}`, passwordHash: 'x', isActive: true } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = `perf-token-${suffix}`;
    await prisma.userSession.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return `Bearer ${token}`;
  }

  test('two Holo submissions cannot consume the same Cutter availability', async () => {
    const suffix = `${Date.now()}-holo`;
    const auth = await adminAuth(suffix);
    const [item, twist, cut] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.twist.create({ data: { name: `Perf Twist ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut ${suffix}` } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    await prisma.lot.create({ data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 10 } });
    const pieceId = `${lotNo}-1`;
    await prisma.inboundItem.create({
      data: { id: pieceId, lotNo, itemId: item.id, weight: 10, status: 'consumed', seq: 1, barcode: `IN-${suffix}` },
    });
    const upload = await prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: 'perf', rowCount: 1 } });
    const source = await prisma.receiveFromCutterMachineRow.create({
      data: {
        uploadId: upload.id,
        pieceId,
        vchNo: `VCH-${suffix}`,
        barcode: `CUT-REC-${suffix}`,
        bobbinQuantity: 10,
        netWt: 10,
        cutId: cut.id,
        cut: cut.name,
      },
    });
    const body = {
      date: '2026-08-27',
      twistId: twist.id,
      crates: [{ rowId: source.id, issuedBobbins: 10 }],
    };
    const responses = await Promise.all([
      request(app).post('/api/issue_to_holo_machine').set('Authorization', auth).send(body),
      request(app).post('/api/issue_to_holo_machine').set('Authorization', auth).send(body),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(responses.find((response) => response.status === 409)?.body.outcome, 'availability_changed');
    assert.equal(await prisma.issueToHoloMachine.count({ where: { lotNo, itemId: item.id } }), 1);
  });

  test('two Coning submissions cannot consume the same Holo availability', async () => {
    const suffix = `${Date.now()}-coning`;
    const auth = await adminAuth(suffix);
    const [item, twist, yarn, cut, coneType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.twist.create({ data: { name: `Perf Twist ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Perf Yarn ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
    ]);
    const holoIssue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27',
        itemId: item.id,
        lotNo: `PERF-${suffix}`,
        yarnId: yarn.id,
        twistId: twist.id,
        cutId: cut.id,
        barcode: `HI-${suffix}`,
        metallicBobbins: 10,
        metallicBobbinsWeight: 10,
        receivedRowRefs: [],
      },
    });
    const source = await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId: holoIssue.id,
        pieceId: `PERF-${suffix}-1`,
        barcode: `HOLO-REC-${suffix}`,
        rollCount: 10,
        rollWeight: 10,
        grossWeight: 10,
        tareWeight: 0,
      },
    });
    const body = {
      date: '2026-08-27',
      requiredPerConeNetWeight: 10,
      crates: [{ rowId: source.id, barcode: source.barcode, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id }],
    };
    const missingConeType = await request(app)
      .post('/api/issue_to_coning_machine')
      .set('Authorization', auth)
      .send({
        ...body,
        crates: [{ rowId: source.id, barcode: source.barcode, issueRolls: 10, issueWeight: 10 }],
      });
    assert.equal(missingConeType.status, 400, missingConeType.text);
    assert.match(missingConeType.body.error, /cone type/i);
    const responses = await Promise.all([
      request(app).post('/api/issue_to_coning_machine').set('Authorization', auth).send(body),
      request(app).post('/api/issue_to_coning_machine').set('Authorization', auth).send(body),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(responses.find((response) => response.status === 409)?.body.outcome, 'availability_changed');
    assert.equal(await prisma.issueToConingMachine.count({ where: { lotNo: holoIssue.lotNo, itemId: item.id } }), 1);
  });

  test('Coning issue creation derives lineage from the locked parent issue', async () => {
    const suffix = `${Date.now()}-coning-parent-lineage-lock`;
    const auth = await adminAuth(suffix);
    const [item, cutA, cutB, yarn, twist, coneType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut A ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut B ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Perf Yarn ${suffix}` } }),
      prisma.twist.create({ data: { name: `Perf Twist ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
    ]);
    const holoIssue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`,
        cutId: cutA.id, yarnId: yarn.id, twistId: twist.id,
        barcode: `HI-PARENT-${suffix}`, metallicBobbins: 10, metallicBobbinsWeight: 10, receivedRowRefs: [],
      },
    });
    const source = await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId: holoIssue.id, pieceId: `${holoIssue.lotNo}-1`, barcode: `HOLO-PARENT-${suffix}`,
        rollCount: 10, rollWeight: 10, grossWeight: 10, tareWeight: 0,
      },
    });

    let releaseLock;
    let lockedResolve;
    const locked = new Promise((resolve) => { lockedResolve = resolve; });
    const release = new Promise((resolve) => { releaseLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssueToHoloMachine" WHERE id = ${holoIssue.id} FOR UPDATE`;
      lockedResolve();
      await release;
      await tx.issueToHoloMachine.update({ where: { id: holoIssue.id }, data: { cutId: cutB.id } });
    });
    await locked;
    const createRequest = request(app)
      .post('/api/issue_to_coning_machine')
      .set('Authorization', auth)
      .send({
        date: '2026-08-27', requiredPerConeNetWeight: 10,
        crates: [{ rowId: source.id, barcode: source.barcode, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id }],
      })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseLock();
    const response = await createRequest;
    await blocker;
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.issueToConingMachine.cutId, cutB.id);
    assert.equal(response.body.issueToConingMachine.yarnId, yarn.id);
    assert.equal(response.body.issueToConingMachine.twistId, twist.id);
  });

  test('Holo issue and Cutter dispatch serialize on the same source row', async () => {
    const suffix = `${Date.now()}-issue-dispatch`;
    const auth = await adminAuth(suffix);
    const [item, twist, cut, customer] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.twist.create({ data: { name: `Perf Twist ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut ${suffix}` } }),
      prisma.customer.create({ data: { name: `Perf Customer ${suffix}` } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    await prisma.lot.create({ data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 10 } });
    const pieceId = `${lotNo}-1`;
    await prisma.inboundItem.create({
      data: { id: pieceId, lotNo, itemId: item.id, weight: 10, status: 'consumed', seq: 1, barcode: `IN-${suffix}` },
    });
    const upload = await prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: 'perf', rowCount: 1 } });
    const source = await prisma.receiveFromCutterMachineRow.create({
      data: {
        uploadId: upload.id,
        pieceId,
        vchNo: `VCH-${suffix}`,
        barcode: `CUT-REC-${suffix}`,
        bobbinQuantity: 10,
        netWt: 10,
        cutId: cut.id,
        cut: cut.name,
      },
    });
    const [issueResponse, dispatchResponse] = await Promise.all([
      request(app).post('/api/issue_to_holo_machine').set('Authorization', auth).send({
        date: '2026-08-27',
        twistId: twist.id,
        crates: [{ rowId: source.id, issuedBobbins: 10 }],
      }),
      request(app).post('/api/dispatch').set('Authorization', auth).send({
        customerId: customer.id,
        stage: 'cutter',
        stageItemId: source.id,
        count: 10,
        weight: 10,
        date: '2026-08-27',
      }),
    ]);
    assert.deepEqual([issueResponse.status, dispatchResponse.status].sort(), [200, 409]);
    assert.equal([issueResponse, dispatchResponse].find((response) => response.status === 409)?.body.outcome, 'availability_changed');
    const finalSource = await prisma.receiveFromCutterMachineRow.findUnique({ where: { id: source.id } });
    assert.ok(Number(finalSource.issuedBobbinWeight || 0) + Number(finalSource.dispatchedWeight || 0) <= 10.000001);
  });

  test('re-coning issue and Coning dispatch serialize on the same source row', async () => {
    const suffix = `${Date.now()}-reconing-dispatch`;
    const auth = await adminAuth(suffix);
    const [item, coneType, customer] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
      prisma.customer.create({ data: { name: `Perf Customer ${suffix}` } }),
    ]);
    const parentIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`,
        barcode: `ICO-${6_000_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `holo-${suffix}`, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id, stage: 'holo' }],
      },
    });
    const source = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId: parentIssue.id,
        barcode: `RCO-${6_500_000 + Number(String(Date.now()).slice(-6))}-C001`,
        coneCount: 10, netWeight: 10, coneWeight: 10, grossWeight: 10, tareWeight: 0,
        sourceRowRefs: [],
      },
    });

    const [issueResponse, dispatchResponse] = await Promise.all([
      request(app).post('/api/issue_to_coning_machine').set('Authorization', auth).send({
        date: '2026-08-27', requiredPerConeNetWeight: 10,
        crates: [{ rowId: source.id, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id }],
      }),
      request(app).post('/api/dispatch').set('Authorization', auth).send({
        customerId: customer.id,
        stage: 'coning',
        stageItemId: source.id,
        count: 10,
        weight: 10,
        date: '2026-08-27',
      }),
    ]);

    assert.deepEqual([issueResponse.status, dispatchResponse.status].sort(), [200, 409]);
    assert.equal([issueResponse, dispatchResponse].find((response) => response.status === 409)?.body.outcome, 'availability_changed');
    const [finalSource, childIssues] = await Promise.all([
      prisma.receiveFromConingMachineRow.findUnique({ where: { id: source.id } }),
      prisma.issueToConingMachine.findMany({ where: { isDeleted: false }, select: { receivedRowRefs: true } }),
    ]);
    const issuedWeight = childIssues.reduce((sum, issue) => {
      const refs = Array.isArray(issue.receivedRowRefs) ? issue.receivedRowRefs : [];
      return sum + refs
        .filter((ref) => ref?.rowId === source.id)
        .reduce((refSum, ref) => refSum + Number(ref.issueWeight || 0), 0);
    }, 0);
    assert.ok(issuedWeight + Number(finalSource.dispatchedWeight || 0) <= 10.000001);

    const allocatedSource = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId: parentIssue.id,
        barcode: `RCO-${6_500_000 + Number(String(Date.now()).slice(-6))}-C002`,
        coneCount: 10, netWeight: 10, coneWeight: 10, grossWeight: 10, tareWeight: 0,
        sourceRowRefs: [],
      },
    });
    const allocatedIssue = await request(app)
      .post('/api/issue_to_coning_machine')
      .set('Authorization', auth)
      .send({
        date: '2026-08-27', requiredPerConeNetWeight: 10,
        crates: [{ rowId: allocatedSource.id, issueRolls: 8, issueWeight: 8, coneTypeId: coneType.id }],
      });
    assert.equal(allocatedIssue.status, 200, allocatedIssue.text);

    const availableResponse = await request(app)
      .get('/api/dispatch/available/coning')
      .set('Authorization', auth);
    assert.equal(availableResponse.status, 200, availableResponse.text);
    const allocatedAvailability = availableResponse.body.items.find((item) => item.id === allocatedSource.id);
    assert.equal(allocatedAvailability.availableCount, 2);
    assert.equal(allocatedAvailability.availableWeight, 2);

    const blockedDispatch = await request(app)
      .post('/api/dispatch')
      .set('Authorization', auth)
      .send({
        customerId: customer.id,
        stage: 'coning',
        stageItemId: allocatedSource.id,
        count: 3,
        weight: 3,
        date: '2026-08-27',
      });
    assert.equal(blockedDispatch.status, 409, blockedDispatch.text);
    assert.equal(blockedDispatch.body.outcome, 'availability_changed');
  });

  test('re-coning count availability is capped by remaining source weight', async () => {
    const suffix = `${Date.now()}-reconing-weight-cap`;
    const auth = await adminAuth(suffix);
    const [item, coneType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
    ]);
    const parentIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`,
        barcode: `ICO-${6_700_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `holo-${suffix}`, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id, stage: 'holo' }],
      },
    });
    const source = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId: parentIssue.id,
        barcode: `RCO-${6_800_000 + Number(String(Date.now()).slice(-6))}-C001`,
        coneCount: 10,
        netWeight: 10,
        coneWeight: 10,
        grossWeight: 10,
        tareWeight: 0,
        dispatchedCount: 2,
        dispatchedWeight: 5,
        sourceRowRefs: [],
      },
    });
    const response = await request(app)
      .post('/api/issue_to_coning_machine')
      .set('Authorization', auth)
      .send({
        date: '2026-08-27',
        requiredPerConeNetWeight: 10,
        crates: [{ rowId: source.id, issueRolls: 8, issueWeight: 5, coneTypeId: coneType.id }],
      });
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.outcome, 'availability_changed');
    assert.equal(response.body.crates[0].availableRolls, 5);
    assert.equal(response.body.crates[0].availableWeight, 5);
  });

  test('two Holo receives cannot exceed one issue balance', async () => {
    const suffix = `${Date.now()}-holo-receive`;
    const issueSeries = 2_000_000 + Number(String(Date.now()).slice(-6));
    const auth = await adminAuth(suffix);
    const [item, rollType, box] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.rollType.create({ data: { name: `Perf Roll ${suffix}`, weight: 0.1 } }),
      prisma.box.create({ data: { name: `Perf Box ${suffix}`, weight: 1, processType: 'holo' } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    const pieceId = `${lotNo}-1`;
    await prisma.inboundItem.create({
      data: { id: pieceId, lotNo, itemId: item.id, weight: 10, status: 'consumed', seq: 1, barcode: `IN-${suffix}` },
    });
    const issue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27',
        itemId: item.id,
        lotNo,
        barcode: `IHO-${issueSeries}`,
        metallicBobbins: 10,
        metallicBobbinsWeight: 10,
        yarnKg: 3,
        rollsProducedEstimate: 20,
        receivedRowRefs: [],
      },
    });
    const body = {
      issueId: issue.id,
      pieceId,
      rollTypeId: rollType.id,
      boxId: box.id,
      rollCount: 20,
      grossWeight: 15,
      date: '2026-08-27',
    };
    const responses = await Promise.all([
      request(app).post('/api/receive_from_holo_machine/manual').set('Authorization', auth).send(body),
      request(app).post('/api/receive_from_holo_machine/manual').set('Authorization', auth).send(body),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(responses.find((response) => response.status === 409)?.body.outcome, 'availability_changed');
    assert.equal(await prisma.receiveFromHoloMachineRow.count({ where: { issueId: issue.id, isDeleted: false } }), 1);
    assert.equal(responses.find((response) => response.status === 200)?.body.row.rollCount, 20);
    assert.equal(responses.find((response) => response.status === 200)?.body.issueBalance.originalWeight, 13);
    assert.equal(responses.find((response) => response.status === 200)?.body.issueBalance.receivedWeight, 12);
  });

  test('Holo receive revalidates source-piece lineage after locking the issue', async () => {
    const suffix = `${Date.now()}-holo-lineage-lock`;
    const issueSeries = 2_500_000 + Number(String(Date.now()).slice(-6));
    const auth = await adminAuth(suffix);
    const [item, rollType, box, upload] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.rollType.create({ data: { name: `Perf Roll ${suffix}`, weight: 0 } }),
      prisma.box.create({ data: { name: `Perf Box ${suffix}`, weight: 1, processType: 'holo' } }),
      prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: `lineage-${suffix}`, rowCount: 2 } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    const oldPieceId = `${lotNo}-1`;
    const newPieceId = `${lotNo}-2`;
    const [oldSource, newSource] = await Promise.all([
      prisma.receiveFromCutterMachineRow.create({
        data: { uploadId: upload.id, pieceId: oldPieceId, vchNo: `VCH-OLD-${suffix}`, barcode: `CUT-OLD-${suffix}`, bobbinQuantity: 10, netWt: 10 },
      }),
      prisma.receiveFromCutterMachineRow.create({
        data: { uploadId: upload.id, pieceId: newPieceId, vchNo: `VCH-NEW-${suffix}`, barcode: `CUT-NEW-${suffix}`, bobbinQuantity: 10, netWt: 10 },
      }),
    ]);
    const issue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo, barcode: `IHO-${issueSeries}`,
        metallicBobbins: 10, metallicBobbinsWeight: 10,
        receivedRowRefs: [{ rowId: oldSource.id, issuedBobbins: 10, issuedBobbinWeight: 10 }],
      },
    });

    let releaseLock;
    let lockedResolve;
    const locked = new Promise((resolve) => { lockedResolve = resolve; });
    const release = new Promise((resolve) => { releaseLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssueToHoloMachine" WHERE id = ${issue.id} FOR UPDATE`;
      lockedResolve();
      await release;
      await tx.issueToHoloMachine.update({
        where: { id: issue.id },
        data: { receivedRowRefs: [{ rowId: newSource.id, issuedBobbins: 10, issuedBobbinWeight: 10 }] },
      });
    });
    await locked;
    const receiveRequest = request(app)
      .post('/api/receive_from_holo_machine/manual')
      .set('Authorization', auth)
      .send({ issueId: issue.id, pieceId: oldPieceId, rollTypeId: rollType.id, boxId: box.id, rollCount: 5, grossWeight: 6 })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseLock();
    const response = await receiveRequest;
    await blocker;
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.outcome, 'availability_changed');
    assert.equal(await prisma.receiveFromHoloMachineRow.count({ where: { issueId: issue.id, isDeleted: false } }), 0);
  });

  test('Holo take-back may use any issued source while the issue pending cap stays authoritative', async () => {
    const suffix = `${Date.now()}-holo-free-takeback-source`;
    const auth = await adminAuth(suffix);
    const [item, upload] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: `takeback-${suffix}`, rowCount: 2 } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    const [firstSource, secondSource] = await Promise.all([
      prisma.receiveFromCutterMachineRow.create({
        data: {
          uploadId: upload.id, pieceId: `${lotNo}-1`, vchNo: `VCH-A-${suffix}`, barcode: `CUT-A-${suffix}`,
          bobbinQuantity: 5, netWt: 5, issuedBobbins: 5, issuedBobbinWeight: 5,
        },
      }),
      prisma.receiveFromCutterMachineRow.create({
        data: {
          uploadId: upload.id, pieceId: `${lotNo}-2`, vchNo: `VCH-B-${suffix}`, barcode: `CUT-B-${suffix}`,
          bobbinQuantity: 5, netWt: 5, issuedBobbins: 5, issuedBobbinWeight: 5,
        },
      }),
    ]);
    const issue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo, barcode: `IHO-TB-${suffix}`,
        metallicBobbins: 10, metallicBobbinsWeight: 10,
        receivedRowRefs: [
          { rowId: firstSource.id, issuedBobbins: 5, issuedBobbinWeight: 5 },
          { rowId: secondSource.id, issuedBobbins: 5, issuedBobbinWeight: 5 },
        ],
      },
    });
    await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId: issue.id, pieceId: `${lotNo}-1`, barcode: `RHO-TB-${suffix}`,
        rollCount: 5, rollWeight: 5, grossWeight: 5, tareWeight: 0,
      },
    });

    const response = await request(app)
      .post(`/api/issue_to_holo_machine/${issue.id}/take_back`)
      .set('Authorization', auth)
      .send({
        date: '2026-08-27', reason: 'Return selected physical source',
        lines: [{ sourceId: firstSource.id, sourceBarcode: firstSource.barcode, count: 5, weight: 5 }],
      });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.issue_balance.pendingWeight, 0);
    const [updatedFirst, updatedSecond] = await Promise.all([
      prisma.receiveFromCutterMachineRow.findUnique({ where: { id: firstSource.id } }),
      prisma.receiveFromCutterMachineRow.findUnique({ where: { id: secondSource.id } }),
    ]);
    assert.equal(updatedFirst.issuedBobbinWeight, 0);
    assert.equal(updatedSecond.issuedBobbinWeight, 5);
  });

  test('two Coning receives cannot exceed one issue balance', async () => {
    const suffix = `${Date.now()}-coning-receive`;
    const issueSeries = 3_000_000 + Number(String(Date.now()).slice(-6));
    const auth = await adminAuth(suffix);
    const [item, coneType, box] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
      prisma.box.create({ data: { name: `Perf Box ${suffix}`, weight: 0.5, processType: 'coning' } }),
    ]);
    const issue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27',
        itemId: item.id,
        lotNo: `PERF-${suffix}`,
        barcode: `ICO-${issueSeries}`,
        rollsIssued: 10,
        requiredPerConeNetWeight: 10,
        expectedCones: 1000,
        receivedRowRefs: [{ rowId: `source-${suffix}`, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id }],
      },
    });
    const body = {
      issueId: issue.id,
      pieceId: issue.id,
      coneCount: 100,
      boxId: box.id,
      grossWeight: 10,
      date: '2026-08-27',
    };
    const responses = await Promise.all([
      request(app).post('/api/receive_from_coning_machine/manual').set('Authorization', auth).send(body),
      request(app).post('/api/receive_from_coning_machine/manual').set('Authorization', auth).send(body),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(responses.find((response) => response.status === 409)?.body.outcome, 'availability_changed');
    assert.equal(await prisma.receiveFromConingMachineRow.count({ where: { issueId: issue.id, isDeleted: false } }), 1);
  });

  test('Coning receive derives tare from the cone type on the locked issue', async () => {
    const suffix = `${Date.now()}-coning-tare-lock`;
    const issueSeries = 3_500_000 + Number(String(Date.now()).slice(-6));
    const auth = await adminAuth(suffix);
    const [item, oldConeType, newConeType, box] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone Old ${suffix}`, weight: 0.01 } }),
      prisma.coneType.create({ data: { name: `Perf Cone New ${suffix}`, weight: 0.02 } }),
      prisma.box.create({ data: { name: `Perf Box ${suffix}`, weight: 0.5, processType: 'coning' } }),
    ]);
    const issue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`, barcode: `ICO-${issueSeries}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `source-${suffix}`, issueRolls: 10, issueWeight: 10, coneTypeId: oldConeType.id }],
      },
    });

    let releaseLock;
    let lockedResolve;
    const locked = new Promise((resolve) => { lockedResolve = resolve; });
    const release = new Promise((resolve) => { releaseLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IssueToConingMachine" WHERE id = ${issue.id} FOR UPDATE`;
      lockedResolve();
      await release;
      await tx.issueToConingMachine.update({
        where: { id: issue.id },
        data: { receivedRowRefs: [{ rowId: `source-${suffix}`, issueRolls: 10, issueWeight: 10, coneTypeId: newConeType.id }] },
      });
    });
    await locked;
    const receiveRequest = request(app)
      .post('/api/receive_from_coning_machine/manual')
      .set('Authorization', auth)
      .send({ issueId: issue.id, pieceId: issue.id, coneCount: 100, boxId: box.id, grossWeight: 10, date: '2026-08-27' })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseLock();
    const response = await receiveRequest;
    await blocker;
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.row.tareWeight, 2.5);
    assert.equal(response.body.row.netWeight, 7.5);
  });

  test('receive creation rejects missing tare masters and invalid physical counts', async () => {
    const suffix = `${Date.now()}-tare-validation`;
    const auth = await adminAuth(suffix);
    const [item, coningBox, coningConeType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.box.create({ data: { name: `Perf Coning Box ${suffix}`, weight: 1, processType: 'coning' } }),
      prisma.coneType.create({ data: { name: `Perf Legacy Cone ${suffix}`, weight: 0.01 } }),
    ]);
    const holoIssue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-H-${suffix}`, barcode: `IHO-${4_000_000 + Number(String(Date.now()).slice(-6))}`,
        metallicBobbins: 10, metallicBobbinsWeight: 10, receivedRowRefs: [],
      },
    });
    const holoMissingMasters = await request(app)
      .post('/api/receive_from_holo_machine/manual')
      .set('Authorization', auth)
      .send({ issueId: holoIssue.id, pieceId: `${holoIssue.lotNo}-1`, rollCount: 10, grossWeight: 5 });
    assert.equal(holoMissingMasters.status, 400);

    const coningIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-C-${suffix}`, barcode: `ICO-${5_000_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `source-${suffix}`, issueRolls: 10, issueWeight: 10 }],
      },
    });
    const invalidConing = await request(app)
      .post('/api/receive_from_coning_machine/manual')
      .set('Authorization', auth)
      .send({ issueId: coningIssue.id, pieceId: coningIssue.id, coneCount: -10, grossWeight: 5 });
    assert.equal(invalidConing.status, 400);

    const missingConeType = await request(app)
      .post('/api/receive_from_coning_machine/manual')
      .set('Authorization', auth)
      .send({
        issueId: coningIssue.id,
        pieceId: coningIssue.id,
        coneCount: 10,
        boxId: coningBox.id,
        grossWeight: 5,
      });
    assert.equal(missingConeType.status, 400, missingConeType.text);
    assert.match(missingConeType.body.error, /select a cone type/i);

    const repairedLegacyReceive = await request(app)
      .post('/api/receive_from_coning_machine/manual')
      .set('Authorization', auth)
      .send({
        issueId: coningIssue.id,
        pieceId: coningIssue.id,
        coneCount: 10,
        boxId: coningBox.id,
        grossWeight: 5,
        coneTypeId: coningConeType.id,
      });
    assert.equal(repairedLegacyReceive.status, 200, repairedLegacyReceive.text);
    assert.equal(repairedLegacyReceive.body.row.tareWeight, 1.1);
    assert.equal(repairedLegacyReceive.body.issueToConingMachine.receivedRowRefs[0].coneTypeId, coningConeType.id);
    const repairedIssue = await prisma.issueToConingMachine.findUnique({ where: { id: coningIssue.id } });
    assert.equal(repairedIssue.receivedRowRefs[0].coneTypeId, coningConeType.id);

    const partiallyReceivedLegacyIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-PC-${suffix}`, barcode: `ICO-${5_100_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `partial-source-${suffix}`, issueRolls: 10, issueWeight: 10 }],
      },
    });
    const legacyReceive = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId: partiallyReceivedLegacyIssue.id,
        coneCount: 20,
        netWeight: 2,
        coneWeight: 2,
        grossWeight: 3,
        tareWeight: 1,
        boxId: coningBox.id,
        barcode: `RCO-${5_100_000 + Number(String(Date.now()).slice(-6))}-C001`,
        sourceRowRefs: [],
      },
    });
    await prisma.receiveFromConingMachinePieceTotal.create({
      data: { pieceId: partiallyReceivedLegacyIssue.id, totalCones: 20, totalNetWeight: 2, wastageNetWeight: 0 },
    });
    const repairedPartialReceive = await request(app)
      .post('/api/receive_from_coning_machine/manual')
      .set('Authorization', auth)
      .send({
        issueId: partiallyReceivedLegacyIssue.id,
        pieceId: partiallyReceivedLegacyIssue.id,
        coneCount: 10,
        boxId: coningBox.id,
        grossWeight: 5,
        coneTypeId: coningConeType.id,
      });
    assert.equal(repairedPartialReceive.status, 200, repairedPartialReceive.text);
    const [preservedLegacyReceive, repairedPartialIssue] = await Promise.all([
      prisma.receiveFromConingMachineRow.findUnique({ where: { id: legacyReceive.id } }),
      prisma.issueToConingMachine.findUnique({ where: { id: partiallyReceivedLegacyIssue.id } }),
    ]);
    assert.equal(preservedLegacyReceive.netWeight, 2);
    assert.equal(preservedLegacyReceive.tareWeight, 1);
    assert.equal(repairedPartialIssue.receivedRowRefs[0].coneTypeId, coningConeType.id);

    const missingWastageIssue = await request(app)
      .post('/api/receive_from_coning_machine/mark_wastage')
      .set('Authorization', auth)
      .send({ issueId: `missing-${suffix}`, note: 'Close missing issue' });
    assert.equal(missingWastageIssue.status, 404, missingWastageIssue.text);
    assert.match(missingWastageIssue.body.error, /not found/i);
  });

  test('metadata-only Coning edits preserve legacy physical values without tare masters', async () => {
    const suffix = `${Date.now()}-legacy-coning-metadata`;
    const auth = await adminAuth(suffix);
    const item = await prisma.item.create({ data: { name: `Perf Item ${suffix}` } });
    const issue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`,
        barcode: `ICO-${5_150_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 100,
        receivedRowRefs: [],
      },
    });
    const row = await prisma.receiveFromConingMachineRow.create({
      data: {
        issueId: issue.id,
        barcode: `RCO-${5_150_000 + Number(String(Date.now()).slice(-6))}-C001`,
        coneCount: 100,
        grossWeight: 10,
        tareWeight: 2,
        netWeight: 8,
        coneWeight: 8,
        boxId: null,
        sourceRowRefs: [],
      },
    });
    await prisma.receiveFromConingMachinePieceTotal.create({
      data: { pieceId: issue.id, totalCones: 100, totalNetWeight: 8, wastageNetWeight: 0 },
    });

    const edited = await request(app)
      .put(`/api/receive_from_coning_machine/rows/${row.id}`)
      .set('Authorization', auth)
      .send({
        coneCount: 100,
        grossWeight: 10,
        boxId: '',
        notes: 'Legacy metadata repaired',
      });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.body.row.notes, 'Legacy metadata repaired');
    assert.equal(edited.body.row.grossWeight, 10);
    assert.equal(edited.body.row.tareWeight, 2);
    assert.equal(edited.body.row.netWeight, 8);
    assert.equal(edited.body.row.coneCount, 100);
    assert.equal(edited.body.pieceTotal.totalNetWeight, 8);
    assert.equal(edited.body.pieceTotal.totalCones, 100);
  });

  test('legacy Holo tare and receive bucket survive edit and delete', async () => {
    const suffix = `${Date.now()}-legacy-holo-accounting`;
    const auth = await adminAuth(suffix);
    const [item, rollType, box] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.rollType.create({ data: { name: `Legacy Wastage Label ${suffix}`, weight: 0.1 } }),
      prisma.box.create({ data: { name: `Perf Holo Box ${suffix}`, weight: 0.5, processType: 'holo' } }),
    ]);
    const issue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27',
        itemId: item.id,
        lotNo: `PERF-${suffix}`,
        barcode: `IHO-${5_200_000 + Number(String(Date.now()).slice(-6))}`,
        metallicBobbins: 20,
        metallicBobbinsWeight: 20,
        receivedRowRefs: [],
      },
    });
    const pieceId = `${issue.lotNo}-1`;
    const legacyRow = await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId: issue.id,
        pieceId,
        rollCount: 10,
        rollWeight: 9.5,
        grossWeight: 12,
        tareWeight: 2.5,
        rollTypeId: rollType.id,
        boxId: box.id,
        barcode: `RHO-${5_200_000 + Number(String(Date.now()).slice(-6))}-C001`,
      },
    });
    // Simulate a row that existed before the nullable classification column.
    await prisma.receiveFromHoloMachineRow.update({
      where: { id: legacyRow.id },
      data: { isWastage: null },
    });
    await prisma.receiveFromHoloMachinePieceTotal.create({
      data: { pieceId, totalRolls: 10, totalNetWeight: 9.5, wastageNetWeight: 0 },
    });

    const edited = await request(app)
      .put(`/api/receive_from_holo_machine/rows/${legacyRow.id}`)
      .set('Authorization', auth)
      .send({
        rollCount: 10,
        grossWeight: 12,
        rollTypeId: rollType.id,
        boxId: box.id,
        notes: 'Metadata-only legacy edit',
      });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.body.row.tareWeight, 2.5);
    assert.equal(edited.body.row.rollWeight, 9.5);
    assert.equal(edited.body.row.isWastage, false);
    assert.equal(edited.body.pieceTotal.totalNetWeight, 9.5);
    assert.equal(edited.body.pieceTotal.wastageNetWeight, 0);

    await prisma.rollType.update({ where: { id: rollType.id }, data: { weight: 0.3 } });
    const countCorrected = await request(app)
      .put(`/api/receive_from_holo_machine/rows/${legacyRow.id}`)
      .set('Authorization', auth)
      .send({
        rollCount: 11,
        grossWeight: 12.3,
        rollTypeId: rollType.id,
        boxId: box.id,
        notes: 'Preserve signed tare residual after master change',
      });
    assert.equal(countCorrected.status, 200, countCorrected.text);
    assert.equal(countCorrected.body.row.tareWeight, 2.8);
    assert.equal(countCorrected.body.row.rollWeight, 9.5);
    assert.equal(countCorrected.body.pieceTotal.totalNetWeight, 9.5);
    assert.equal(countCorrected.body.pieceTotal.totalRolls, 11);

    await prisma.receiveFromHoloMachineRow.update({ where: { id: legacyRow.id }, data: { isWastage: null } });
    const deleted = await request(app)
      .delete(`/api/receive_from_holo_machine/rows/${legacyRow.id}`)
      .set('Authorization', auth)
      .send({});
    assert.equal(deleted.status, 200, deleted.text);
    assert.equal(deleted.body.pieceTotal.totalNetWeight, 0);
    assert.equal(deleted.body.pieceTotal.wastageNetWeight, 0);
    assert.equal(deleted.body.pieceTotal.totalRolls, 0);
  });

  test('migration-first rollout keeps previous-backend Holo writes in their legacy bucket', async () => {
    const suffix = `${Date.now()}-holo-old-writer-null`;
    const [item, rollType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.rollType.create({ data: { name: `Wastage ${suffix}`, weight: 0.1 } }),
    ]);
    const issue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27',
        itemId: item.id,
        lotNo: `PERF-${suffix}`,
        barcode: `IHO-${5_300_000 + Number(String(Date.now()).slice(-6))}`,
        metallicBobbins: 10,
        metallicBobbinsWeight: 10,
        receivedRowRefs: [],
      },
    });
    const oldWriterRow = await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId: issue.id,
        rollCount: 1,
        rollWeight: 1,
        grossWeight: 1.1,
        tareWeight: 0.1,
        rollTypeId: rollType.id,
        barcode: `RHO-${5_300_000 + Number(String(Date.now()).slice(-6))}-C001`,
      },
    });
    // The deployed previous backend omits isWastage and increments
    // totalNetWeight for every Holo receive. NULL tells the new readers to use
    // that same ordinary-receive bucket.
    assert.equal(oldWriterRow.isWastage, null);
  });

  test('concurrent Coning close accounts for take-backs exactly once and returns the closed balance', async () => {
    const suffix = `${Date.now()}-coning-close`;
    const auth = await adminAuth(suffix);
    const item = await prisma.item.create({ data: { name: `Perf Item ${suffix}` } });
    const issue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`, barcode: `ICO-${6_000_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `source-${suffix}`, issueRolls: 10, issueWeight: 10 }],
      },
    });
    await prisma.issueTakeBack.create({
      data: {
        stage: 'coning', issueId: issue.id, date: '2026-08-27', reason: 'Return', totalCount: 2, totalWeight: 2,
        lines: { create: [{ sourceId: `source-${suffix}`, count: 2, weight: 2, meta: {} }] },
      },
    });
    await prisma.receiveFromConingMachineRow.create({
      data: { issueId: issue.id, coneCount: 50, netWeight: 5, coneWeight: 5, grossWeight: 5, tareWeight: 0, sourceRowRefs: [] },
    });
    await prisma.receiveFromConingMachinePieceTotal.create({
      data: { pieceId: issue.id, totalCones: 50, totalNetWeight: 5, wastageNetWeight: 0 },
    });
    const responses = await Promise.all([
      request(app).post('/api/receive_from_coning_machine/mark_wastage').set('Authorization', auth).send({ issueId: issue.id, note: 'Close' }),
      request(app).post('/api/receive_from_coning_machine/mark_wastage').set('Authorization', auth).send({ issueId: issue.id, note: 'Close' }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const success = responses.find((response) => response.status === 200);
    assert.equal(success.body.marked, 3);
    assert.equal(success.body.issueBalance.pendingWeight, 0);
    const total = await prisma.receiveFromConingMachinePieceTotal.findUnique({ where: { pieceId: issue.id } });
    assert.equal(total.wastageNetWeight, 3);
  });

  test('re-coning writes an explicit source stage and makes the source row immutable', async () => {
    const suffix = `${Date.now()}-reconing-stage`;
    const auth = await adminAuth(suffix);
    const [item, coneType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
    ]);
    const parentIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`, barcode: `ICO-${7_000_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: `holo-${suffix}`, issueRolls: 10, issueWeight: 10, coneTypeId: coneType.id, stage: 'holo' }],
      },
    });
    const receiveSeries = 8_000_000 + Number(String(Date.now()).slice(-6));
    const source = await prisma.receiveFromConingMachineRow.create({
      data: { issueId: parentIssue.id, barcode: `RCO-${receiveSeries}-C001`, coneCount: 10, netWeight: 10, coneWeight: 10, grossWeight: 10, tareWeight: 0, sourceRowRefs: [] },
    });
    const child = await request(app)
      .post('/api/issue_to_coning_machine')
      .set('Authorization', auth)
      .send({ date: '2026-08-27', requiredPerConeNetWeight: 10, crates: [{ rowId: source.id, issueRolls: 5, coneTypeId: coneType.id }] });
    assert.equal(child.status, 200);
    assert.equal(child.body.issueToConingMachine.receivedRowRefs[0].stage, 'coning');
    const edit = await request(app)
      .put(`/api/receive_from_coning_machine/rows/${source.id}`)
      .set('Authorization', auth)
      .send({ coneCount: 9, grossWeight: 10 });
    assert.equal(edit.status, 400);
  });

  test('re-coning compares authoritative Holo lineage instead of stale parent masters', async () => {
    const suffix = `${Date.now()}-reconing-trace-first`;
    const auth = await adminAuth(suffix);
    const [item, cutA, cutB, yarnA, yarnB, twistA, twistB, coneType] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut A ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut B ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Perf Yarn A ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Perf Yarn B ${suffix}` } }),
      prisma.twist.create({ data: { name: `Perf Twist A ${suffix}` } }),
      prisma.twist.create({ data: { name: `Perf Twist B ${suffix}` } }),
      prisma.coneType.create({ data: { name: `Perf Cone ${suffix}`, weight: 0.01 } }),
    ]);
    const holoIssue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `PERF-${suffix}`,
        cutId: cutA.id, yarnId: yarnA.id, twistId: twistA.id,
        barcode: `HI-${suffix}`, metallicBobbins: 10, metallicBobbinsWeight: 10, receivedRowRefs: [],
      },
    });
    const holoSource = await prisma.receiveFromHoloMachineRow.create({
      data: {
        issueId: holoIssue.id, barcode: `RHO-${5_400_000 + Number(String(Date.now()).slice(-6))}-C001`,
        rollCount: 10, rollWeight: 10, grossWeight: 10, tareWeight: 0,
      },
    });
    const parentA = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: holoIssue.lotNo,
        cutId: cutA.id, yarnId: yarnA.id, twistId: twistA.id,
        barcode: `ICO-${7_100_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 5, requiredPerConeNetWeight: 10, expectedCones: 500,
        receivedRowRefs: [{ rowId: holoSource.id, stage: 'holo', issueRolls: 5, issueWeight: 5, coneTypeId: coneType.id }],
      },
    });
    const parentB = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: holoIssue.lotNo,
        cutId: cutB.id, yarnId: yarnB.id, twistId: twistB.id,
        barcode: `ICO-${7_200_000 + Number(String(Date.now()).slice(-6))}`,
        rollsIssued: 5, requiredPerConeNetWeight: 10, expectedCones: 500,
        receivedRowRefs: [{ rowId: holoSource.id, stage: 'holo', issueRolls: 5, issueWeight: 5, coneTypeId: coneType.id }],
      },
    });
    const [sourceA, sourceB] = await Promise.all([
      prisma.receiveFromConingMachineRow.create({
        data: { issueId: parentA.id, barcode: `RCO-${7_300_000 + Number(String(Date.now()).slice(-6))}-C001`, coneCount: 5, netWeight: 5, coneWeight: 5, grossWeight: 5, tareWeight: 0, sourceRowRefs: [] },
      }),
      prisma.receiveFromConingMachineRow.create({
        data: { issueId: parentB.id, barcode: `RCO-${7_400_000 + Number(String(Date.now()).slice(-6))}-C001`, coneCount: 5, netWeight: 5, coneWeight: 5, grossWeight: 5, tareWeight: 0, sourceRowRefs: [] },
      }),
    ]);

    const response = await request(app)
      .post('/api/issue_to_coning_machine')
      .set('Authorization', auth)
      .send({
        date: '2026-08-27', requiredPerConeNetWeight: 10,
        crates: [sourceA, sourceB].map((source) => ({
          rowId: source.id,
          barcode: source.barcode,
          issueRolls: 5,
          issueWeight: 5,
          coneTypeId: coneType.id,
        })),
      });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.issueToConingMachine.cutId, cutA.id);
    assert.equal(response.body.issueToConingMachine.yarnId, yarnA.id);
    assert.equal(response.body.issueToConingMachine.twistId, twistA.id);
  });

  test('Cutter challan edit respects its issue allocation and downstream lineage', async () => {
    const suffix = `${Date.now()}-cutter-challan-guard`;
    const auth = await adminAuth(suffix);
    const [item, cut, bobbin, box] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut ${suffix}` } }),
      prisma.bobbin.create({ data: { name: `Perf Bobbin ${suffix}`, weight: 0.1 } }),
      prisma.box.create({ data: { name: `Perf Box ${suffix}`, weight: 1, processType: 'cutter' } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    const pieceId = `${lotNo}-1`;
    await prisma.lot.create({ data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 10 } });
    await prisma.inboundItem.create({
      data: { id: pieceId, lotNo, itemId: item.id, weight: 10, issuedToCutterWeight: 5, status: 'available', seq: 1, barcode: `IN-${suffix}` },
    });
    const issue = await prisma.issueToCutterMachine.create({
      data: {
        id: `issue-${suffix}`, date: '2026-08-27', itemId: item.id, lotNo, cutId: cut.id, count: 1, totalWeight: 5,
        pieceIds: pieceId, reason: 'legacy header-only allocation', barcode: `ICU-${suffix}`,
      },
    });
    const upload = await prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: `challan-${suffix}`, rowCount: 1 } });
    const challan = await prisma.receiveFromCutterMachineChallan.create({
      data: { challanNo: `CH-${suffix}`, sequence: 1, fiscalYear: '2026-27', pieceId, lotNo, itemId: item.id, totalNetWeight: 4, totalBobbinQty: 10 },
    });
    const row = await prisma.receiveFromCutterMachineRow.create({
      data: {
        uploadId: upload.id, challanId: challan.id, issueId: null, pieceId, vchNo: `VCH-${suffix}`, barcode: `CUT-${suffix}`,
        bobbinId: bobbin.id, boxId: box.id, bobbinQuantity: 10, grossWt: 6, tareWt: 2, netWt: 4, totalKg: 4,
      },
    });
    await prisma.receiveFromCutterMachinePieceTotal.create({ data: { pieceId, totalNetWeight: 4, totalBob: 10 } });

    const overAllocated = await request(app)
      .put(`/api/receive_from_cutter_machine/challans/${challan.id}`)
      .set('Authorization', auth)
      .send({ updates: [{ rowId: row.id, grossWeight: 10, bobbinQuantity: 10, boxId: box.id }] });
    assert.equal(overAllocated.status, 409, overAllocated.text);
    assert.equal(overAllocated.body.outcome, 'availability_changed');
    assert.equal((await prisma.receiveFromCutterMachineRow.findUnique({ where: { id: row.id } })).netWt, 4);

    await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo, cutId: cut.id, barcode: `IHO-LINEAGE-${suffix}`,
        metallicBobbins: 1, metallicBobbinsWeight: 1,
        receivedRowRefs: [{ rowId: row.id, barcode: row.barcode, issuedBobbins: 1, issuedBobbinWeight: 1 }],
      },
    });
    const deleteUsed = await request(app)
      .delete(`/api/receive_from_cutter_machine/challans/${challan.id}`)
      .set('Authorization', auth)
      .send({});
    assert.equal(deleteUsed.status, 409, deleteUsed.text);
    assert.equal(deleteUsed.body.outcome, 'dependency_exists');
    assert.equal((await prisma.receiveFromCutterMachineRow.findUnique({ where: { id: row.id } })).isDeleted, false);
  });

  test('Cutter issue replacement locks removed sources and preserves a concurrent allocation', async () => {
    const suffix = `${Date.now()}-cutter-edit-union-lock`;
    const auth = await adminAuth(suffix);
    const [item, cut] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut ${suffix}` } }),
    ]);
    const lotNo = `PERF-${suffix}`;
    const oldPieceId = `${lotNo}-1`;
    const newPieceId = `${lotNo}-2`;
    await prisma.lot.create({ data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 2, totalWeight: 20 } });
    await prisma.inboundItem.createMany({ data: [
      { id: oldPieceId, lotNo, itemId: item.id, weight: 10, issuedToCutterWeight: 5, status: 'available', seq: 1, barcode: `IN-OLD-${suffix}` },
      { id: newPieceId, lotNo, itemId: item.id, weight: 10, issuedToCutterWeight: 0, status: 'available', seq: 2, barcode: `IN-NEW-${suffix}` },
    ] });
    const originalIssue = await prisma.issueToCutterMachine.create({
      data: {
        id: `issue-original-${suffix}`, date: '2026-08-27', itemId: item.id, lotNo, cutId: cut.id, count: 1, totalWeight: 5,
        pieceIds: oldPieceId, reason: 'internal', barcode: `ICU-ORIGINAL-${suffix}`, lines: { create: [{ pieceId: oldPieceId, issuedWeight: 5 }] },
      },
    });

    let releaseLock;
    let lockedResolve;
    const locked = new Promise((resolve) => { lockedResolve = resolve; });
    const release = new Promise((resolve) => { releaseLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "InboundItem" WHERE id = ${oldPieceId} FOR UPDATE`;
      lockedResolve();
      await release;
    });
    await locked;
    const concurrentCreate = request(app)
      .post('/api/issue_to_cutter_machine')
      .set('Authorization', auth)
      .send({ date: '2026-08-27', itemId: item.id, lotNo, cutId: cut.id, pieceLines: [{ pieceId: oldPieceId, issuedWeight: 3 }] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const replacementEdit = request(app)
      .put(`/api/issue_to_cutter_machine/${originalIssue.id}`)
      .set('Authorization', auth)
      .send({ pieceLines: [{ pieceId: newPieceId, issuedWeight: 5 }] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseLock();
    const [created, edited] = await Promise.all([concurrentCreate, replacementEdit]);
    await blocker;
    assert.equal(created.status, 200, created.text);
    assert.equal(edited.status, 200, edited.text);
    const [oldPiece, newPiece] = await Promise.all([
      prisma.inboundItem.findUnique({ where: { id: oldPieceId } }),
      prisma.inboundItem.findUnique({ where: { id: newPieceId } }),
    ]);
    assert.equal(oldPiece.issuedToCutterWeight, 3);
    assert.equal(newPiece.issuedToCutterWeight, 5);
  });

  test('Cutter purchase delete rechecks locked lineage after a concurrent issue', async () => {
    const suffix = `${Date.now()}-purchase-delete-race`;
    const auth = await adminAuth(suffix);
    const [item, cut] = await Promise.all([
      prisma.item.create({ data: { name: `Perf Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Perf Cut ${suffix}` } }),
    ]);
    const lotNo = `CP-${suffix}`;
    const pieceId = `${lotNo}-1`;
    await prisma.lot.create({ data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 10 } });
    await prisma.inboundItem.create({ data: { id: pieceId, lotNo, itemId: item.id, weight: 10, status: 'available', seq: 1, barcode: `IN-${suffix}` } });
    const upload = await prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: `purchase-${suffix}`, rowCount: 1 } });
    const challan = await prisma.receiveFromCutterMachineChallan.create({
      data: { challanNo: `CP-CH-${suffix}`, sequence: 1, fiscalYear: '2026-27', pieceId, lotNo, itemId: item.id, totalNetWeight: 10, totalBobbinQty: 10 },
    });
    const purchaseRow = await prisma.receiveFromCutterMachineRow.create({
      data: {
        uploadId: upload.id, challanId: challan.id, pieceId, vchNo: `CP-VCH-${suffix}`, barcode: `CP-CUT-${suffix}`,
        createdBy: 'cutter_purchase', bobbinQuantity: 10, grossWt: 10, tareWt: 0, netWt: 10, totalKg: 10,
      },
    });
    await prisma.receiveFromCutterMachinePieceTotal.create({ data: { pieceId, totalNetWeight: 10, totalBob: 10 } });

    let releaseLock;
    let lockedResolve;
    const locked = new Promise((resolve) => { lockedResolve = resolve; });
    const release = new Promise((resolve) => { releaseLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "InboundItem" WHERE id = ${pieceId} FOR UPDATE`;
      lockedResolve();
      await release;
    });
    await locked;
    const issueRequest = request(app)
      .post('/api/issue_to_cutter_machine')
      .set('Authorization', auth)
      .send({ date: '2026-08-27', itemId: item.id, lotNo, cutId: cut.id, pieceLines: [{ pieceId, issuedWeight: 3 }] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deleteRequest = request(app)
      .delete(`/api/inbound/cutter_purchase/${encodeURIComponent(lotNo)}`)
      .set('Authorization', auth)
      .send({});
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseLock();
    const [issued, deleted] = await Promise.all([issueRequest, deleteRequest]);
    await blocker;
    assert.equal(issued.status, 200, issued.text);
    assert.equal(deleted.status, 409, deleted.text);
    assert.equal(deleted.body.outcome, 'dependency_exists');
    assert.ok(await prisma.lot.findUnique({ where: { lotNo } }));
    assert.ok(await prisma.inboundItem.findUnique({ where: { id: pieceId } }));
    assert.ok(await prisma.receiveFromCutterMachineRow.findUnique({ where: { id: purchaseRow.id } }));
  });

  test('two reversal requests create only one take-back reversal', async () => {
    const suffix = `${Date.now()}-takeback-reverse`;
    const auth = await adminAuth(suffix);
    const item = await prisma.item.create({ data: { name: `Perf Item ${suffix}` } });
    const lotNo = `PERF-${suffix}`;
    const pieceId = `${lotNo}-1`;
    await prisma.inboundItem.create({
      data: { id: pieceId, lotNo, itemId: item.id, weight: 10, issuedToCutterWeight: 5, status: 'available', seq: 1, barcode: `IN-${suffix}` },
    });
    const issue = await prisma.issueToCutterMachine.create({
      data: {
        id: `issue-${suffix}`,
        date: '2026-08-27',
        itemId: item.id,
        lotNo,
        count: 1,
        totalWeight: 10,
        pieceIds: pieceId,
        reason: 'internal',
        barcode: `ICU-${suffix}`,
        lines: { create: [{ pieceId, issuedWeight: 10 }] },
      },
    });
    const olderTakeBack = await prisma.issueTakeBack.create({
      data: {
        stage: 'cutter', issueId: issue.id, date: '2026-08-26', reason: 'Older take-back',
        totalCount: 1, totalWeight: 3, createdAt: new Date(Date.now() - 1_000),
        lines: { create: [{ sourceId: pieceId, count: 1, weight: 3, meta: {} }] },
      },
    });
    const takeBack = await prisma.issueTakeBack.create({
      data: {
        stage: 'cutter',
        issueId: issue.id,
        date: '2026-08-27',
        reason: 'Concurrency test',
        totalCount: 1,
        totalWeight: 2,
        lines: { create: [{ sourceId: pieceId, count: 1, weight: 2, meta: {} }] },
      },
    });
    const staleReverse = await request(app)
      .post(`/api/issue_take_backs/${olderTakeBack.id}/reverse`)
      .set('Authorization', auth)
      .send({ reason: 'reverse' });
    assert.equal(staleReverse.status, 400, staleReverse.text);
    assert.match(staleReverse.body.error, /latest active take-back/i);
    const responses = await Promise.all([
      request(app).post(`/api/issue_take_backs/${takeBack.id}/reverse`).set('Authorization', auth).send({ reason: 'reverse' }),
      request(app).post(`/api/issue_take_backs/${takeBack.id}/reverse`).set('Authorization', auth).send({ reason: 'reverse' }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
    const original = await prisma.issueTakeBack.findUnique({ where: { id: takeBack.id } });
    const older = await prisma.issueTakeBack.findUnique({ where: { id: olderTakeBack.id } });
    assert.equal(original.isReversed, true);
    assert.equal(older.isReversed, false);
    assert.equal(await prisma.issueTakeBack.count({ where: { stage: 'cutter', issueId: issue.id, isReverse: true } }), 1);
  });
}
