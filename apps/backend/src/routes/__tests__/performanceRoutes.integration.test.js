import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const TEST_DB = process.env.TEST_PERFORMANCE_DATABASE_URL;

if (!TEST_DB) {
  test('production-scale v2 route rehearsal (skipped - set TEST_PERFORMANCE_DATABASE_URL)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  const { default: prisma } = await import('../../lib/prisma.js');
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (!/_perf_test$/.test(db)) {
    await prisma.$disconnect();
    throw new Error(`Refusing performance route tests against database "${db}" because its name does not end in _perf_test.`);
  }

  const request = (await import('supertest')).default;
  const { default: app } = await import('../../app.js');
  const { hashSessionToken } = await import('../../utils/auth.js');
  let auth;

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

  before(async () => {
    const role = await ensureAdminRole();
    const suffix = `${Date.now()}-routes`;
    const user = await prisma.user.create({
      data: { username: `perf-user-${suffix}`, passwordHash: 'x', isActive: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = `perf-token-${suffix}`;
    await prisma.userSession.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    auth = `Bearer ${token}`;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  async function get(path, query = {}) {
    const startedAt = performance.now();
    const response = await request(app).get(path).query(query).set('Authorization', auth);
    const probe = {
      response,
      durationMs: performance.now() - startedAt,
      bytes: Buffer.byteLength(response.text || JSON.stringify(response.body || {})),
    };
    if (process.env.PERF_ROUTE_EVIDENCE === '1') {
      console.info(JSON.stringify({
        path,
        query,
        status: response.status,
        durationMs: Number(probe.durationMs.toFixed(1)),
        bytes: probe.bytes,
      }));
    }
    return probe;
  }

  async function authForPermissions(suffix, permissions) {
    const role = await prisma.role.create({
      data: { key: `perf-role-${suffix}`, name: `Perf Role ${suffix}`, permissions },
    });
    const user = await prisma.user.create({
      data: { username: `perf-limited-${suffix}`, passwordHash: 'x', isActive: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const token = `perf-limited-token-${suffix}`;
    await prisma.userSession.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return `Bearer ${token}`;
  }

  test('targeted source and action-detail contracts stay small', async () => {
    const probes = [
      await get('/api/v2/issue/holo/source-row', { barcode: 'PERF-CR-00001' }),
      await get('/api/v2/issue/coning/source-row', { barcode: 'PERF-HR-06001' }),
      await get('/api/v2/issue/holo/perf-holo-issue-00001/action-detail'),
      await get('/api/v2/receive/holo/perf-holo-row-00001/action-detail'),
      await get('/api/v2/issue/coning/perf-coning-issue-0001/action-detail'),
      await get('/api/v2/receive/coning/perf-coning-row-00001/action-detail'),
    ];
    for (const probe of probes) {
      assert.equal(probe.response.status, 200, probe.response.text);
      assert.ok(probe.bytes < 100 * 1024, `action response was ${probe.bytes} bytes`);
      assert.ok(probe.durationMs < 5_000, `action response took ${probe.durationMs.toFixed(1)}ms`);
    }
  });

  test('fresh Cutter Issue can load bounded available lots and pieces without a scanner', async () => {
    const suffix = `${Date.now()}-cutter-candidates`;
    const [item, cut] = await Promise.all([
      prisma.item.create({ data: { name: `Candidate Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Candidate Cut ${suffix}` } }),
    ]);
    const lotNo = `CAND-${suffix}`;
    const secondLotNo = `CAND2-${suffix}`;
    await prisma.lot.createMany({ data: [
      { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 2, totalWeight: 14 },
      { lotNo: secondLotNo, date: '2026-08-26', itemId: item.id, totalPieces: 1, totalWeight: 3 },
    ] });
    const piece = await prisma.inboundItem.create({
      data: { id: `${lotNo}-1`, lotNo, itemId: item.id, weight: 10, status: 'available', seq: 1, barcode: `CAND-IN-${suffix}`, issuedToCutterWeight: 2, dispatchedWeight: 1 },
    });
    await prisma.inboundItem.createMany({ data: [
      { id: `${lotNo}-2`, lotNo, itemId: item.id, weight: 4, status: 'available', seq: 2, barcode: `CAND-IN2-${suffix}` },
      { id: `${secondLotNo}-1`, lotNo: secondLotNo, itemId: item.id, weight: 3, status: 'available', seq: 1, barcode: `CAND2-IN-${suffix}` },
    ] });

    const lotItems = [];
    let lotCursor = null;
    do {
      const lots = await get('/api/v2/issue/cutter/source-candidates', { itemId: item.id, limit: 1, cursor: lotCursor });
      assert.equal(lots.response.status, 200, lots.response.text);
      assert.ok(lots.bytes < 100 * 1024);
      lotItems.push(...lots.response.body.items);
      lotCursor = lots.response.body.hasMore ? lots.response.body.nextCursor : null;
    } while (lotCursor);
    assert.deepEqual(new Set(lotItems.map((row) => row.lotNo)), new Set([lotNo, secondLotNo]));
    assert.equal(lotItems.find((row) => row.lotNo === lotNo)?.availableWeight, 4);

    const pieceItems = [];
    let pieceCursor = null;
    do {
      const pieces = await get('/api/v2/issue/cutter/source-candidates', { itemId: item.id, lotNo, limit: 1, cursor: pieceCursor });
      assert.equal(pieces.response.status, 200, pieces.response.text);
      assert.ok(pieces.bytes < 100 * 1024);
      pieceItems.push(...pieces.response.body.items);
      pieceCursor = pieces.response.body.hasMore ? pieces.response.body.nextCursor : null;
    } while (pieceCursor);
    assert.equal(pieceItems.length, 1);
    assert.equal(pieceItems.some((row) => row.id === piece.id), false);

    const lookup = await get('/api/v2/issue/cutter/source-row', { barcode: piece.barcode });
    assert.equal(lookup.response.status, 409, lookup.response.text);
    assert.equal(lookup.response.body.outcome, 'exhausted');
    assert.deepEqual(lookup.response.body.availability, { availableCount: 0, availableWeight: 0 });

    const directIssue = await request(app)
      .post('/api/issue_to_cutter_machine')
      .set('Authorization', auth)
      .send({
        date: '2026-08-27',
        itemId: item.id,
        lotNo,
        cutId: cut.id,
        pieceLines: [{ pieceId: piece.id, issuedWeight: 1 }],
      });
    assert.equal(directIssue.status, 409, directIssue.text);
    assert.equal(directIssue.body.outcome, 'availability_changed');
  });

  test('ordinary v2 lists are stable, bounded, and complete-summary aware', async () => {
    for (const process of ['holo', 'coning']) {
      for (const route of ['tracking', 'history']) {
        const prefix = route === 'tracking' ? 'issue' : 'receive';
        const first = await get(`/api/v2/${prefix}/${process}/${route}`, { limit: 200 });
        assert.equal(first.response.status, 200, first.response.text);
        assert.ok(first.bytes < 500 * 1024, `${process} ${route} was ${first.bytes} bytes`);
        assert.ok(first.durationMs < 5_000, `${process} ${route} took ${first.durationMs.toFixed(1)}ms`);
        assert.equal(first.response.body.items.length, 200);
        assert.ok(first.response.body.summary);
        assert.ok(first.response.body.nextCursor);

        const second = await get(`/api/v2/${prefix}/${process}/${route}`, {
          limit: 200,
          cursor: first.response.body.nextCursor,
        });
        assert.equal(second.response.status, 200, second.response.text);
        const ids = [...first.response.body.items, ...second.response.body.items].map((row) => row.id);
        assert.equal(new Set(ids).size, ids.length, `${process} ${route} repeated a cursor row`);
      }
    }
  });

  test('default Issue Tracking summaries stay database-aggregate backed', async () => {
    for (const process of ['cutter', 'holo', 'coning']) {
      const result = await get(`/api/v2/issue/${process}/tracking`, { limit: 50 });
      assert.equal(result.response.status, 200, result.response.text);
      assert.ok(result.durationMs < 5_000, `${process} issue tracking took ${result.durationMs.toFixed(1)}ms`);
      assert.ok(result.bytes < 500 * 1024, `${process} issue tracking was ${result.bytes} bytes`);
      assert.ok(result.response.body.summary);
      assert.ok(result.response.body.summary.totalCount >= result.response.body.items.length);
    }
  });

  test('sparse computed filters stop at a raw-row scan budget and return continuation cursors', async () => {
    const cases = [
      ['/api/v2/issue/coning/tracking', 'takenBackWeight'],
      ['/api/v2/on-machine/coning', 'pendingWeight'],
    ];
    for (const [path, field] of cases) {
      const filters = JSON.stringify([{ field, op: 'between', min: 999999, max: 1000000 }]);
      const first = await get(path, { limit: 50, filters });
      assert.equal(first.response.status, 200, first.response.text);
      assert.ok(first.durationMs < 5_000, `${path} took ${first.durationMs.toFixed(1)}ms`);
      assert.deepEqual(first.response.body.items, []);
      assert.equal(first.response.body.summary, null);
      assert.equal(first.response.body.hasMore, true);
      assert.ok(first.response.body.nextCursor);

      const second = await get(path, { limit: 50, filters, cursor: first.response.body.nextCursor });
      assert.equal(second.response.status, 200, second.response.text);
      assert.deepEqual(second.response.body.items, []);
      assert.equal(second.response.body.summary, null);
      assert.notEqual(second.response.body.nextCursor, first.response.body.nextCursor);
    }
  });

  test('default On Machine summaries use bounded aggregate responses', async () => {
    for (const process of ['cutter', 'holo', 'coning']) {
      const result = await get(`/api/v2/on-machine/${process}`, { limit: 50 });
      assert.equal(result.response.status, 200, result.response.text);
      assert.ok(result.durationMs < 5_000, `${process} on-machine took ${result.durationMs.toFixed(1)}ms`);
      assert.ok(result.bytes < 500 * 1024, `${process} on-machine was ${result.bytes} bytes`);
      assert.ok(result.response.body.summary);
      assert.ok(result.response.body.summary.totalCount >= result.response.body.items.length);
    }
  });

  test('separate On Machine lists render without totals and summary endpoints preserve exact totals', async () => {
    for (const process of ['cutter', 'holo', 'coning']) {
      const inline = await get(`/api/v2/on-machine/${process}`, { limit: 50 });
      const list = await get(`/api/v2/on-machine/${process}`, { limit: 50, summaryMode: 'separate' });
      const summary = await get(`/api/v2/on-machine/${process}/summary`);
      assert.equal(list.response.status, 200, list.response.text);
      assert.equal(list.response.body.summary, null);
      assert.equal(list.response.body.summaryPending, true);
      assert.ok(list.response.body.items.length > 0);
      assert.ok(list.durationMs < 5_000, `${process} separate on-machine took ${list.durationMs.toFixed(1)}ms`);
      assert.equal(summary.response.status, 200, summary.response.text);
      assert.ok(summary.durationMs < 10_000, `${process} on-machine summary took ${summary.durationMs.toFixed(1)}ms`);
      assert.ok(summary.response.body.computedAt);
      assert.deepEqual(summary.response.body.summary, inline.response.body.summary);
    }
  });

  test('Cutter On Machine attributes legacy receive rows without issueId to the latest eligible issue', async () => {
    const suffix = `${Date.now()}-legacy-cutter-receive`;
    const baseline = await get('/api/v2/on-machine/cutter/summary');
    assert.equal(baseline.response.status, 200, baseline.response.text);

    const [item, cut, upload] = await Promise.all([
      prisma.item.create({ data: { name: `Legacy Cutter Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Legacy Cutter Cut ${suffix}` } }),
      prisma.receiveFromCutterMachineUpload.create({
        data: { originalFilename: `legacy-cutter-${suffix}.csv`, rowCount: 1 },
      }),
    ]);
    const lotNo = `LEGACY-CUTTER-${suffix}`;
    const pieceId = `${lotNo}-1`;
    const issueId = `LEGACY-CUTTER-ISSUE-${suffix}`;
    const issueCreatedAt = new Date(Date.now() - 1_000);
    await prisma.lot.create({
      data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 5 },
    });
    await prisma.inboundItem.create({
      data: {
        id: pieceId,
        lotNo,
        itemId: item.id,
        weight: 5,
        status: 'consumed',
        seq: 1,
        barcode: `LEGACY-CUTTER-IN-${suffix}`,
      },
    });
    await prisma.issueToCutterMachine.create({
      data: {
        id: issueId,
        date: '2026-08-27',
        itemId: item.id,
        lotNo,
        cutId: cut.id,
        count: 1,
        totalWeight: 5,
        pieceIds: pieceId,
        reason: 'Legacy receive attribution parity',
        barcode: `LEGACY-CUTTER-ISSUE-BC-${suffix}`,
        createdAt: issueCreatedAt,
        lines: { create: [{ pieceId, issuedWeight: 5, createdAt: issueCreatedAt }] },
      },
    });
    await prisma.receiveFromCutterMachineRow.create({
      data: {
        uploadId: upload.id,
        issueId: null,
        pieceId,
        vchNo: `LEGACY-CUTTER-VCH-${suffix}`,
        barcode: `LEGACY-CUTTER-ROW-${suffix}`,
        bobbinQuantity: 10,
        netWt: 5,
        createdAt: new Date(),
      },
    });

    const [list, summary] = await Promise.all([
      get('/api/v2/on-machine/cutter', { limit: 50, summaryMode: 'separate' }),
      get('/api/v2/on-machine/cutter/summary'),
    ]);
    assert.equal(list.response.status, 200, list.response.text);
    assert.equal(summary.response.status, 200, summary.response.text);
    assert.equal(list.response.body.items.some((row) => row.id === issueId), false);
    assert.deepEqual(summary.response.body.summary, baseline.response.body.summary);
  });

  test('separate stock lists omit totals and stock summary endpoints preserve inline totals', async () => {
    for (const process of ['cutter', 'holo', 'coning']) {
      const query = process === 'cutter' ? { limit: 100, view: 'bobbins' } : { limit: 100 };
      const inline = await get(`/api/v2/stock/${process}/lot-groups`, query);
      const list = await get(`/api/v2/stock/${process}/lot-groups`, { ...query, summaryMode: 'separate' });
      const summary = await get(`/api/v2/stock/${process}/summary`, process === 'cutter' ? { view: 'bobbins' } : {});
      assert.equal(list.response.status, 200, list.response.text);
      assert.equal(list.response.body.summary, null);
      assert.equal(list.response.body.summaryPending, true);
      assert.ok(list.durationMs < 5_000, `${process} separate stock list took ${list.durationMs.toFixed(1)}ms`);
      assert.equal(summary.response.status, 200, summary.response.text);
      assert.ok(summary.durationMs < 10_000, `${process} stock summary took ${summary.durationMs.toFixed(1)}ms`);
      assert.ok(summary.response.body.computedAt);
      assert.deepEqual(summary.response.body.summary, inline.response.body.summary);
    }
  });

  test('cold-load list and summary routes meet repeated and concurrent budgets', {
    skip: process.env.RUN_COLD_LOAD_ROUTE_GATE !== '1',
  }, async () => {
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    };
    const routes = [
      { name: 'on-machine-cutter-list', path: '/api/v2/on-machine/cutter', query: { limit: 50, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'on-machine-holo-list', path: '/api/v2/on-machine/holo', query: { limit: 50, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'on-machine-coning-list', path: '/api/v2/on-machine/coning', query: { limit: 50, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'on-machine-cutter-summary', path: '/api/v2/on-machine/cutter/summary', query: {}, maxMs: 10_000 },
      { name: 'on-machine-holo-summary', path: '/api/v2/on-machine/holo/summary', query: {}, maxMs: 10_000 },
      { name: 'on-machine-coning-summary', path: '/api/v2/on-machine/coning/summary', query: {}, maxMs: 10_000 },
      { name: 'stock-cutter-jumbo-list', path: '/api/v2/stock/cutter/lot-groups', query: { view: 'jumbo', limit: 100, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'stock-cutter-bobbins-list', path: '/api/v2/stock/cutter/lot-groups', query: { view: 'bobbins', limit: 100, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'stock-holo-list', path: '/api/v2/stock/holo/lot-groups', query: { limit: 100, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'stock-coning-list', path: '/api/v2/stock/coning/lot-groups', query: { limit: 100, summaryMode: 'separate' }, maxMs: 5_000, maxBytes: 500 * 1024 },
      { name: 'stock-cutter-jumbo-summary', path: '/api/v2/stock/cutter/summary', query: { view: 'jumbo' }, maxMs: 10_000 },
      { name: 'stock-cutter-bobbins-summary', path: '/api/v2/stock/cutter/summary', query: { view: 'bobbins' }, maxMs: 10_000 },
      { name: 'stock-holo-summary', path: '/api/v2/stock/holo/summary', query: {}, maxMs: 10_000 },
      { name: 'stock-coning-summary', path: '/api/v2/stock/coning/summary', query: {}, maxMs: 10_000 },
    ];

    for (const route of routes) {
      const samples = [];
      for (let sample = 0; sample < 20; sample += 1) {
        const result = await get(route.path, route.query);
        assert.equal(result.response.status, 200, `${route.name}: ${result.response.text}`);
        if (route.maxBytes) assert.ok(result.bytes < route.maxBytes, `${route.name} was ${result.bytes} bytes`);
        samples.push(result.durationMs);
      }
      const p95 = percentile(samples, 0.95);
      const p99 = percentile(samples, 0.99);
      console.info(JSON.stringify({ route: route.name, samples: 20, firstHitMs: Number(samples[0].toFixed(1)), p95Ms: Number(p95.toFixed(1)), p99Ms: Number(p99.toFixed(1)) }));
      assert.ok(p95 < (route.maxMs === 5_000 ? 2_000 : route.maxMs), `${route.name} p95 was ${p95.toFixed(1)}ms`);
      assert.ok(p99 < route.maxMs, `${route.name} p99 was ${p99.toFixed(1)}ms`);
    }

    const concurrentStartedAt = performance.now();
    const concurrentPages = await Promise.all([
      get('/api/v2/on-machine/coning', { limit: 50, summaryMode: 'separate' }),
      get('/api/v2/stock/cutter/lot-groups', { view: 'bobbins', limit: 100, summaryMode: 'separate' }),
      get('/api/v2/stock/holo/lot-groups', { limit: 100, summaryMode: 'separate' }),
      get('/api/v2/stock/coning/lot-groups', { limit: 100, summaryMode: 'separate' }),
    ]);
    const concurrentDurationMs = performance.now() - concurrentStartedAt;
    concurrentPages.forEach((result) => assert.equal(result.response.status, 200, result.response.text));
    assert.ok(concurrentDurationMs < 5_000, `four concurrent normal pages took ${concurrentDurationMs.toFixed(1)}ms`);
    console.info(JSON.stringify({ route: 'four-concurrent-normal-pages', samples: 4, durationMs: Number(concurrentDurationMs.toFixed(1)) }));
  });

  test('stock group and expanded-row routes execute for every process within response budgets', async () => {
    for (const process of ['cutter', 'holo', 'coning']) {
      const query = process === 'cutter' ? { limit: 100, view: 'bobbins' } : { limit: 100 };
      const groups = await get(`/api/v2/stock/${process}/lot-groups`, query);
      assert.equal(groups.response.status, 200, groups.response.text);
      assert.ok(groups.bytes < 500 * 1024, `${process} stock groups was ${groups.bytes} bytes`);
      assert.ok(groups.durationMs < 5_000, `${process} stock groups took ${groups.durationMs.toFixed(1)}ms`);
      assert.ok(groups.response.body.items.length > 0);
      assert.ok(groups.response.body.summary);

      const rows = await get(`/api/v2/stock/${process}/lot-rows`, {
        key: groups.response.body.items[0].lotKey,
        limit: 200,
      });
      assert.equal(rows.response.status, 200, rows.response.text);
      assert.ok(rows.bytes < 500 * 1024, `${process} stock rows was ${rows.bytes} bytes`);
      assert.ok(rows.durationMs < 5_000, `${process} stock rows took ${rows.durationMs.toFixed(1)}ms`);
      assert.ok(rows.response.body.items.length > 0, `${process} stock group did not expand to rows`);
    }

    for (const process of ['holo', 'coning']) {
      const firstPage = await get(`/api/v2/stock/${process}/lot-groups`, { limit: 1 });
      assert.equal(firstPage.response.status, 200, firstPage.response.text);
      assert.equal(firstPage.response.body.items.length, 1);
      assert.equal(firstPage.response.body.hasMore, true);
      const secondPage = await get(`/api/v2/stock/${process}/lot-groups`, {
        limit: 1,
        cursor: firstPage.response.body.nextCursor,
      });
      assert.equal(secondPage.response.status, 200, secondPage.response.text);
      assert.equal(secondPage.response.body.items.length, 1);
      assert.notEqual(firstPage.response.body.items[0].lotKey, secondPage.response.body.items[0].lotKey);
      assert.equal(secondPage.response.body.summary.totalWeight, firstPage.response.body.summary.totalWeight);

      const grouped = await get(`/api/v2/stock/${process}/lot-groups`, { limit: 100, groupBy: true });
      assert.equal(grouped.response.status, 200, grouped.response.text);
      assert.ok(grouped.durationMs < 5_000, `${process} grouped stock took ${grouped.durationMs.toFixed(1)}ms`);
      assert.ok(grouped.response.body.summary);
      assert.ok(grouped.response.body.items.length > 0);
      assert.equal(grouped.response.body.items[0].lotKey, null);
      assert.ok(Array.isArray(grouped.response.body.items[0].memberLotKeys));
      assert.ok(grouped.response.body.items[0].memberLotKeys.length > 0);
    }
  });

  test('Cutter stock paginates in SQL and keeps full filtered summaries without multi-Yarn multiplication', async () => {
    const suffix = `${Date.now()}-cutter-stock-sql`;
    const [item, cut, yarnA, yarnB, upload] = await Promise.all([
      prisma.item.create({ data: { name: `Cutter SQL Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Cutter SQL Cut ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Cutter SQL Yarn A ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Cutter SQL Yarn B ${suffix}` } }),
      prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: `cutter-sql-${suffix}.csv`, rowCount: 2 } }),
    ]);
    const lotNos = [`CSQL-A-${suffix}`, `CSQL-B-${suffix}`];
    await prisma.lot.createMany({ data: [
      { lotNo: lotNos[0], date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 10 },
      { lotNo: lotNos[1], date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 5 },
    ] });
    const pieceIds = lotNos.map((lotNo, index) => `${lotNo}-${index + 1}`);
    await prisma.inboundItem.createMany({ data: [
      { id: pieceIds[0], lotNo: lotNos[0], itemId: item.id, weight: 10, status: 'available', seq: 1, barcode: `CSQL-IN-A-${suffix}`, issuedToCutterWeight: 4, dispatchedWeight: 1 },
      { id: pieceIds[1], lotNo: lotNos[1], itemId: item.id, weight: 5, status: 'available', seq: 1, barcode: `CSQL-IN-B-${suffix}` },
    ] });
    await prisma.receiveFromCutterMachinePieceTotal.create({
      data: { pieceId: pieceIds[0], totalNetWeight: 3, totalBob: 20, wastageNetWeight: 1 },
    });
    await prisma.issueToCutterMachine.create({
      data: {
        id: `CSQL-ISSUE-${suffix}`, date: '2026-08-27', itemId: item.id, lotNo: lotNos[0], cutId: cut.id,
        count: 1, totalWeight: 4, pieceIds: pieceIds[0], reason: 'SQL parity', barcode: `CSQL-ICU-${suffix}`,
        lines: { create: [{ pieceId: pieceIds[0], issuedWeight: 4 }] },
      },
    });
    await prisma.receiveFromCutterMachineRow.createMany({ data: [
      { uploadId: upload.id, pieceId: pieceIds[0], issueId: `CSQL-ISSUE-${suffix}`, vchNo: `CSQL-VCH-A-${suffix}`, barcode: `CSQL-ROW-A-${suffix}`, bobbinQuantity: 10, netWt: 1.5, yarnName: yarnA.name, cutId: cut.id, cut: cut.name },
      { uploadId: upload.id, pieceId: pieceIds[0], issueId: `CSQL-ISSUE-${suffix}`, vchNo: `CSQL-VCH-B-${suffix}`, barcode: `CSQL-ROW-B-${suffix}`, bobbinQuantity: 10, netWt: 1.5, yarnName: yarnB.name, cutId: cut.id, cut: cut.name },
    ] });

    const first = await get('/api/v2/stock/cutter/lot-groups', { view: 'jumbo', item: item.id, limit: 1 });
    assert.equal(first.response.status, 200, first.response.text);
    assert.equal(first.response.body.items.length, 1);
    assert.equal(first.response.body.hasMore, true);
    assert.equal(first.response.body.summary.groupCount, 2);
    assert.equal(first.response.body.summary.totalWeight, 15);
    assert.equal(first.response.body.summary.availableCount, 1);
    assert.equal(first.response.body.summary.pendingWeight, 10);
    const second = await get('/api/v2/stock/cutter/lot-groups', {
      view: 'jumbo', item: item.id, limit: 1, cursor: first.response.body.nextCursor,
    });
    assert.equal(second.response.status, 200, second.response.text);
    assert.equal(second.response.body.items.length, 1);
    assert.equal(second.response.body.summary.totalWeight, 15);
    assert.deepEqual(
      new Set([...first.response.body.items, ...second.response.body.items].map((row) => row.lotNo)),
      new Set(lotNos),
    );

    const bobbins = await get('/api/v2/stock/cutter/lot-groups', { view: 'bobbins', item: item.id, limit: 1 });
    assert.equal(bobbins.response.status, 200, bobbins.response.text);
    assert.equal(bobbins.response.body.summary.groupCount, 1);
    assert.equal(bobbins.response.body.summary.totalBobbins, 20);
    assert.equal(bobbins.response.body.summary.totalWeight, 3);
    assert.equal(bobbins.response.body.items[0].yarnIds.length, 2);
    const firstBobbinRow = await get('/api/v2/stock/cutter/lot-rows', {
      key: bobbins.response.body.items[0].lotKey, limit: 1,
    });
    assert.equal(firstBobbinRow.response.status, 200, firstBobbinRow.response.text);
    assert.equal(firstBobbinRow.response.body.items.length, 1);
    assert.equal(firstBobbinRow.response.body.hasMore, true);
    const secondBobbinRow = await get('/api/v2/stock/cutter/lot-rows', {
      key: bobbins.response.body.items[0].lotKey,
      limit: 1,
      cursor: firstBobbinRow.response.body.nextCursor,
    });
    assert.equal(secondBobbinRow.response.status, 200, secondBobbinRow.response.text);
    assert.equal(secondBobbinRow.response.body.items.length, 1);
    assert.notEqual(firstBobbinRow.response.body.items[0].id, secondBobbinRow.response.body.items[0].id);
  });

  test('distinct Holo mixed-lot source sets keep distinct keys and exact expansion', async () => {
    const suffix = `${Date.now()}-mixed-key`;
    const [item, cut, yarn, twist, upload] = await Promise.all([
      prisma.item.create({ data: { name: `Mixed Key Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Mixed Key Cut ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Mixed Key Yarn ${suffix}` } }),
      prisma.twist.create({ data: { name: `Mixed Key Twist ${suffix}` } }),
      prisma.receiveFromCutterMachineUpload.create({ data: { originalFilename: `mixed-${suffix}.csv`, rowCount: 8 } }),
    ]);
    const lotNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => `MK-${suffix}-${name}`);
    const cutterRows = new Map();
    for (const [index, lotNo] of lotNames.entries()) {
      await prisma.lot.create({ data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 10 } });
      const pieceId = `${lotNo}-1`;
      await prisma.inboundItem.create({ data: { id: pieceId, lotNo, itemId: item.id, weight: 10, status: 'consumed', seq: 1, barcode: `MK-IN-${suffix}-${index}` } });
      const row = await prisma.receiveFromCutterMachineRow.create({
        data: { uploadId: upload.id, pieceId, vchNo: `MK-VCH-${suffix}-${index}`, barcode: `MK-CR-${suffix}-${index}`, bobbinQuantity: 10, netWt: 10, cutId: cut.id, cut: cut.name },
      });
      cutterRows.set(lotNo, row.id);
    }
    const sourceSets = [
      [lotNames[0], lotNames[1], lotNames[2], lotNames[3]],
      [lotNames[0], lotNames[4], lotNames[5], lotNames[6]],
    ];
    const receiveIds = [];
    for (const [index, sourceLots] of sourceSets.entries()) {
      const issue = await prisma.issueToHoloMachine.create({
        data: {
          date: '2026-08-27', itemId: item.id, lotNo: 'MIXED', cutId: cut.id, yarnId: yarn.id, twistId: twist.id,
          barcode: `MK-IHO-${suffix}-${index}`, metallicBobbins: 4, metallicBobbinsWeight: 4,
          receivedRowRefs: sourceLots.map((lotNo) => ({ rowId: cutterRows.get(lotNo), issuedBobbins: 1, issuedBobbinWeight: 1 })),
        },
      });
      const received = await Promise.all([0, 1].map((rowIndex) => prisma.receiveFromHoloMachineRow.create({
        data: { issueId: issue.id, pieceId: `${sourceLots[0]}-1`, barcode: `MK-RHO-${suffix}-${index}-${rowIndex}`, rollCount: 2, rollWeight: 2, grossWeight: 2, tareWeight: 0 },
      })));
      receiveIds.push(...received.map((row) => row.id));
    }

    const groups = await get('/api/v2/stock/holo/lot-groups', { search: item.name, limit: 20 });
    assert.equal(groups.response.status, 200, groups.response.text);
    assert.equal(groups.response.body.items.length, 2);
    assert.equal(new Set(groups.response.body.items.map((group) => group.lotKey)).size, 2);
    const expandedIds = [];
    for (const group of groups.response.body.items) {
      const firstRows = await get('/api/v2/stock/holo/lot-rows', { key: group.lotKey, limit: 1 });
      assert.equal(firstRows.response.status, 200, firstRows.response.text);
      assert.equal(firstRows.response.body.items.length, 1);
      assert.equal(firstRows.response.body.hasMore, true);
      const secondRows = await get('/api/v2/stock/holo/lot-rows', {
        key: group.lotKey, limit: 1, cursor: firstRows.response.body.nextCursor,
      });
      assert.equal(secondRows.response.status, 200, secondRows.response.text);
      assert.equal(secondRows.response.body.items.length, 1);
      assert.notEqual(firstRows.response.body.items[0].id, secondRows.response.body.items[0].id);
      expandedIds.push(firstRows.response.body.items[0].id, secondRows.response.body.items[0].id);
    }
    assert.deepEqual(new Set(expandedIds), new Set(receiveIds));
  });

  test('Holo expansion keeps same-lot process variants isolated by complete group identity', async () => {
    const suffix = `${Date.now()}-holo-variant`;
    const [item, cutA, cutB, yarnA, yarnB, twistA, twistB] = await Promise.all([
      prisma.item.create({ data: { name: `Holo Variant Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Holo Variant Cut A ${suffix}` } }),
      prisma.cut.create({ data: { name: `Holo Variant Cut B ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Holo Variant Yarn A ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Holo Variant Yarn B ${suffix}` } }),
      prisma.twist.create({ data: { name: `Holo Variant Twist A ${suffix}` } }),
      prisma.twist.create({ data: { name: `Holo Variant Twist B ${suffix}` } }),
    ]);
    const lotNo = `HV-${suffix}`;
    await prisma.lot.create({
      data: { lotNo, date: '2026-08-27', itemId: item.id, totalPieces: 1, totalWeight: 20 },
    });
    const variants = [
      { cut: cutA, yarn: yarnA, twist: twistA },
      { cut: cutB, yarn: yarnB, twist: twistB },
    ];
    const receiveIdByYarn = new Map();
    for (const [index, variant] of variants.entries()) {
      const issue = await prisma.issueToHoloMachine.create({
        data: {
          date: '2026-08-27', itemId: item.id, lotNo, cutId: variant.cut.id,
          yarnId: variant.yarn.id, twistId: variant.twist.id,
          barcode: `HV-IHO-${suffix}-${index}`, metallicBobbins: 10, metallicBobbinsWeight: 10,
          receivedRowRefs: [],
        },
      });
      const row = await prisma.receiveFromHoloMachineRow.create({
        data: {
          issueId: issue.id, pieceId: `${lotNo}-1`, barcode: `HV-RHO-${suffix}-${index}`,
          rollCount: 10, rollWeight: 10, grossWeight: 10, tareWeight: 0,
        },
      });
      receiveIdByYarn.set(variant.yarn.id, row.id);
    }

    const groups = await get('/api/v2/stock/holo/lot-groups', { search: item.name, limit: 20 });
    assert.equal(groups.response.status, 200, groups.response.text);
    assert.equal(groups.response.body.items.length, 2);
    for (const group of groups.response.body.items) {
      const rows = await get('/api/v2/stock/holo/lot-rows', { key: group.lotKey, limit: 20 });
      assert.equal(rows.response.status, 200, rows.response.text);
      assert.deepEqual(rows.response.body.items.map((row) => row.id), [receiveIdByYarn.get(group.yarnId)]);
      assert.equal(rows.response.body.hasMore, false);
    }
  });

  test('Coning tracking, On Machine, filters, and export use traced Holo lineage', async () => {
    const suffix = `${Date.now()}-trace-first`;
    const [item, cutA, cutB, yarnA, yarnB, twistA, twistB] = await Promise.all([
      prisma.item.create({ data: { name: `Trace Item ${suffix}` } }),
      prisma.cut.create({ data: { name: `Trace Cut A ${suffix}` } }),
      prisma.cut.create({ data: { name: `Trace Cut B ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Trace Yarn A ${suffix}` } }),
      prisma.yarn.create({ data: { name: `Trace Yarn B ${suffix}` } }),
      prisma.twist.create({ data: { name: `Trace Twist A ${suffix}` } }),
      prisma.twist.create({ data: { name: `Trace Twist B ${suffix}` } }),
    ]);
    const holoIssue = await prisma.issueToHoloMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `TRACE-${suffix}`, cutId: cutA.id, yarnId: yarnA.id, twistId: twistA.id,
        barcode: `TRACE-IHO-${suffix}`, metallicBobbins: 10, metallicBobbinsWeight: 10, receivedRowRefs: [],
      },
    });
    const source = await prisma.receiveFromHoloMachineRow.create({
      data: { issueId: holoIssue.id, pieceId: `TRACE-${suffix}-1`, barcode: `TRACE-RHO-${suffix}`, rollCount: 10, rollWeight: 10, grossWeight: 10, tareWeight: 0 },
    });
    const coningIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `TRACE-${suffix}`, cutId: cutB.id, yarnId: yarnB.id, twistId: twistB.id,
        barcode: `TRACE-ICO-${suffix}`, rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: source.id, stage: 'holo', issueRolls: 10, issueWeight: 10 }],
      },
    });
    const correctedConingIssue = await prisma.issueToConingMachine.create({
      data: {
        date: '2026-08-27', itemId: item.id, lotNo: `TRACE-${suffix}`, cutId: cutA.id, yarnId: yarnA.id, twistId: twistA.id,
        barcode: `TRACE-ICO-CORRECTED-${suffix}`, rollsIssued: 10, requiredPerConeNetWeight: 10, expectedCones: 1000,
        receivedRowRefs: [{ rowId: source.id, stage: 'holo', issueRolls: 10, issueWeight: 10 }],
      },
    });
    const filters = JSON.stringify([{ field: 'cut', op: 'in', values: [cutA.name] }]);
    for (const path of ['/api/v2/issue/coning/tracking', '/api/v2/on-machine/coning']) {
      const result = await get(path, { filters, search: coningIssue.barcode, limit: 20 });
      assert.equal(result.response.status, 200, result.response.text);
      assert.ok(result.durationMs < 5_000, `${path} trace filter took ${result.durationMs.toFixed(1)}ms`);
      const row = result.response.body.items.find((itemRow) => itemRow.id === coningIssue.id);
      assert.ok(row, `${path} omitted traced row`);
      assert.equal(row.cutName, cutA.name);
      assert.equal(row.yarnName, yarnA.name);
      assert.equal(row.twistName, twistA.name);
      assert.equal(result.response.body.summary, null);
    }
    const exported = await get('/api/v2/issue/coning/tracking/export.json', { filters, search: coningIssue.barcode });
    assert.equal(exported.response.status, 200, exported.response.text);
    assert.equal(exported.response.body.items.find((row) => row.id === coningIssue.id)?.cutName, cutA.name);
    const onMachineExported = await get('/api/v2/on-machine/coning/export.json', { filters, search: coningIssue.barcode });
    assert.equal(onMachineExported.response.status, 200, onMachineExported.response.text);
    assert.equal(onMachineExported.response.body.items.find((row) => row.id === coningIssue.id)?.cutName, cutA.name);
    const staleFilter = JSON.stringify([{ field: 'cut', op: 'in', values: [cutB.name] }]);
    const excluded = await get('/api/v2/issue/coning/tracking', { filters: staleFilter, search: coningIssue.barcode, limit: 20 });
    assert.equal(excluded.response.status, 200, excluded.response.text);
    assert.ok(!excluded.response.body.items.some((row) => row.id === coningIssue.id));
    assert.equal(excluded.response.body.summary, null);
    const excludedOnMachineExport = await get('/api/v2/on-machine/coning/export.json', { filters: staleFilter, search: coningIssue.barcode });
    assert.equal(excludedOnMachineExport.response.status, 200, excludedOnMachineExport.response.text);
    assert.ok(!excludedOnMachineExport.response.body.items.some((row) => row.id === coningIssue.id));

    const [staleStoredReceive, correctedStoredReceive] = await Promise.all([
      prisma.receiveFromConingMachineRow.create({
        data: { issueId: coningIssue.id, barcode: `TRACE-RCO-STALE-${suffix}`, coneCount: 100, netWeight: 10, coneWeight: 10, grossWeight: 10, tareWeight: 0, sourceRowRefs: [] },
      }),
      prisma.receiveFromConingMachineRow.create({
        data: { issueId: correctedConingIssue.id, barcode: `TRACE-RCO-CORRECTED-${suffix}`, coneCount: 100, netWeight: 10, coneWeight: 10, grossWeight: 10, tareWeight: 0, sourceRowRefs: [] },
      }),
    ]);
    const stock = await get('/api/v2/stock/coning/lot-groups', { search: item.name, limit: 20 });
    assert.equal(stock.response.status, 200, stock.response.text);
    const traceGroups = stock.response.body.items.filter((group) => group.lotNo === `TRACE-${suffix}`);
    assert.equal(traceGroups.length, 1, 'stored child Yarn split one traced stock identity');
    assert.equal(traceGroups[0].yarnId, yarnA.id);
    assert.deepEqual(traceGroups[0].yarnIds, [yarnA.id]);
    assert.equal(traceGroups[0].twistId, twistA.id);
    assert.deepEqual(traceGroups[0].twistIds, [twistA.id]);
    const groupedStock = await get('/api/v2/stock/coning/lot-groups', { search: item.name, limit: 20, groupBy: true });
    assert.equal(groupedStock.response.status, 200, groupedStock.response.text);
    const tracedGroupedRows = groupedStock.response.body.items.filter((group) => group.twistName === twistA.name);
    assert.equal(tracedGroupedRows.length, 1, 'trace-first Twist split one grouped stock identity');
    assert.deepEqual(tracedGroupedRows[0].memberLotKeys, [traceGroups[0].lotKey]);
    const expanded = await get('/api/v2/stock/coning/lot-rows', { key: traceGroups[0].lotKey, limit: 1 });
    assert.equal(expanded.response.status, 200, expanded.response.text);
    assert.equal(expanded.response.body.hasMore, true);
    const expandedNext = await get('/api/v2/stock/coning/lot-rows', {
      key: traceGroups[0].lotKey, limit: 1, cursor: expanded.response.body.nextCursor,
    });
    assert.equal(expandedNext.response.status, 200, expandedNext.response.text);
    assert.notEqual(expanded.response.body.items[0].id, expandedNext.response.body.items[0].id);
    assert.deepEqual(
      new Set([...expanded.response.body.items, ...expandedNext.response.body.items].map((row) => row.id)),
      new Set([staleStoredReceive.id, correctedStoredReceive.id]),
    );
    const barcodeKeys = await get('/api/v2/stock/coning/barcode-lot-keys', { q: staleStoredReceive.barcode });
    assert.equal(barcodeKeys.response.status, 200, barcodeKeys.response.text);
    assert.ok(barcodeKeys.response.body.keys.includes(traceGroups[0].lotKey));
  });

  test('one global facet response contains every process-specific option set', async () => {
    const expected = {
      holo: ['machine', 'operator', 'employee', 'helper', 'item', 'cut', 'yarn', 'twist', 'box', 'bobbin', 'addedBy', 'shift'],
      coning: ['machine', 'operator', 'employee', 'helper', 'item', 'cut', 'yarn', 'twist', 'box', 'coneType', 'addedBy', 'shift'],
    };
    for (const process of Object.keys(expected)) {
      const result = await get(`/api/v2/receive/${process}/history/facets`);
      assert.equal(result.response.status, 200, result.response.text);
      assert.ok(result.bytes < 100 * 1024);
      for (const key of expected[process]) {
        assert.ok(Array.isArray(result.response.body.facets[key]), `${process} facets omitted ${key}`);
      }
      assert.ok(result.response.body.facets.item.includes('Performance Item'));
      assert.ok(result.response.body.facets.cut.includes('Performance Cut'));
    }
  });

  test('stage facets do not expose unrelated usernames or process-only masters', async () => {
    const suffix = `${Date.now()}-facet-outsider`;
    const outsider = await prisma.user.create({
      data: { username: `facet-outsider-${suffix}`, passwordHash: 'x', isActive: true },
    });
    const cutterIssue = await get('/api/v2/issue/cutter/tracking/facets');
    assert.equal(cutterIssue.response.status, 200, cutterIssue.response.text);
    assert.ok(!cutterIssue.response.body.facets.addedBy.includes(outsider.username));
    assert.deepEqual(cutterIssue.response.body.facets.yarn, []);
    assert.deepEqual(cutterIssue.response.body.facets.twist, []);
    assert.deepEqual(cutterIssue.response.body.facets.coneType, []);

    const holoReceive = await get('/api/v2/receive/holo/history/facets');
    assert.equal(holoReceive.response.status, 200, holoReceive.response.text);
    assert.ok(!holoReceive.response.body.facets.addedBy.includes(outsider.username));
    assert.deepEqual(holoReceive.response.body.facets.bobbin, []);
    assert.deepEqual(holoReceive.response.body.facets.coneType, []);
  });

  test('invalid process and unauthenticated access are rejected', async () => {
    const invalid = await get('/api/v2/stock/not-a-process/lot-groups');
    assert.equal(invalid.response.status, 400);
    const unauthenticated = await request(app).get('/api/v2/stock/holo/lot-groups');
    assert.equal(unauthenticated.status, 401);
  });

  test('targeted contracts enforce a behavioral per-process permission matrix', async () => {
    const limitedAuth = await authForPermissions(`${Date.now()}-holo-read`, { 'issue.holo': 1 });
    const allowedLookup = await request(app)
      .get('/api/v2/issue/holo/source-row')
      .query({ barcode: 'PERF-CR-00001' })
      .set('Authorization', limitedAuth);
    assert.equal(allowedLookup.status, 200, allowedLookup.text);

    const allowedIssueDetail = await request(app)
      .get('/api/v2/issue/holo/perf-holo-issue-00001/action-detail')
      .set('Authorization', limitedAuth);
    assert.equal(allowedIssueDetail.status, 200, allowedIssueDetail.text);

    for (const path of [
      '/api/v2/issue/coning/source-row?barcode=PERF-HR-06001',
      '/api/v2/issue/coning/perf-coning-issue-0001/action-detail',
      '/api/v2/receive/holo/perf-holo-row-00001/action-detail',
      '/api/v2/stock/holo/lot-groups',
    ]) {
      const forbidden = await request(app).get(path).set('Authorization', limitedAuth);
      assert.equal(forbidden.status, 403, `${path}: ${forbidden.text}`);
    }
  });

  test('v2 issue and receive row sets and totals match authoritative legacy data', {
    skip: process.env.RUN_PERFORMANCE_PARITY !== '1',
  }, async () => {
    const collect = async (path) => {
      const items = [];
      let cursor = null;
      let summary = null;
      do {
        const page = await get(path, { limit: 200, cursor });
        assert.equal(page.response.status, 200, page.response.text);
        items.push(...page.response.body.items);
        summary ||= page.response.body.summary;
        cursor = page.response.body.hasMore ? page.response.body.nextCursor : null;
      } while (cursor);
      return { items, summary };
    };
    const closeTo = (actual, expected, label) => {
      assert.ok(Math.abs(Number(actual || 0) - Number(expected || 0)) < 0.000001, `${label}: ${actual} != ${expected}`);
    };

    for (const process of ['holo', 'coning']) {
      const issueModel = process === 'holo' ? prisma.issueToHoloMachine : prisma.issueToConingMachine;
      const receiveModel = process === 'holo' ? prisma.receiveFromHoloMachineRow : prisma.receiveFromConingMachineRow;
      const [issues, receives, sourceIssues, sourceReceives, takeBacks] = await Promise.all([
        collect(`/api/v2/issue/${process}/tracking`),
        collect(`/api/v2/receive/${process}/history`),
        issueModel.findMany({ where: { isDeleted: false } }),
        receiveModel.findMany({ where: { isDeleted: false } }),
        prisma.issueTakeBack.findMany({
          where: { stage: process, isReverse: false, isReversed: false },
        }),
      ]);

      assert.deepEqual(
        issues.items.map((row) => row.id).sort(),
        sourceIssues.map((row) => row.id).sort(),
        `${process} issue row-set mismatch`,
      );
      assert.deepEqual(
        receives.items.map((row) => row.id).sort(),
        sourceReceives.map((row) => row.id).sort(),
        `${process} receive row-set mismatch`,
      );
      assert.equal(issues.summary.totalCount, sourceIssues.length);
      assert.equal(receives.summary.totalCount, sourceReceives.length);

      const takenBackCount = takeBacks.reduce((sum, row) => sum + Number(row.totalCount || 0), 0);
      const takenBackWeight = takeBacks.reduce((sum, row) => sum + Number(row.totalWeight || 0), 0);
      closeTo(issues.summary.takenBackCount, takenBackCount, `${process} take-back count`);
      closeTo(issues.summary.takenBackWeight, takenBackWeight, `${process} take-back weight`);

      if (process === 'holo') {
        const issuedCount = sourceIssues.reduce((sum, row) => sum + Number(row.metallicBobbins || 0), 0);
        const issuedWeight = sourceIssues.reduce((sum, row) => sum + Number(row.metallicBobbinsWeight || 0), 0);
        closeTo(issues.summary.metallicBobbins, issuedCount, 'holo issue count');
        closeTo(issues.summary.metallicBobbinsWeight, issuedWeight, 'holo issue weight');
        closeTo(receives.summary.rolls, sourceReceives.reduce((sum, row) => sum + Number(row.rollCount || 0), 0), 'holo receive count');
        closeTo(receives.summary.weight, sourceReceives.reduce((sum, row) => sum + Number(row.rollWeight || 0), 0), 'holo receive weight');
      } else {
        const refs = sourceIssues.flatMap((row) => Array.isArray(row.receivedRowRefs) ? row.receivedRowRefs : []);
        closeTo(issues.summary.rollsIssued, refs.reduce((sum, row) => sum + Number(row.issueRolls || row.baseRolls || 0), 0), 'coning issue rolls');
        closeTo(issues.summary.originalIssuedWeight, refs.reduce((sum, row) => sum + Number(row.issueWeight || 0), 0), 'coning issue weight');
        closeTo(receives.summary.cones, sourceReceives.reduce((sum, row) => sum + Number(row.coneCount || 0), 0), 'coning receive count');
        closeTo(receives.summary.weight, sourceReceives.reduce((sum, row) => sum + Number(row.netWeight || 0), 0), 'coning receive weight');
      }
    }
  });

  test('issue POST latency meets the production-scale rehearsal budget', {
    skip: process.env.RUN_PERFORMANCE_LOAD !== '1',
  }, async () => {
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
    };
    const [holoSourceCandidates, coningSources, coneType] = await Promise.all([
      prisma.receiveFromCutterMachineRow.findMany({
        where: {
          id: { startsWith: 'perf-cutter-row-' },
          isDeleted: false,
        },
        orderBy: { id: 'desc' },
        take: 500,
        select: {
          id: true,
          bobbinQuantity: true,
          issuedBobbins: true,
          netWt: true,
          issuedBobbinWeight: true,
        },
      }),
      prisma.receiveFromHoloMachineRow.findMany({
        where: {
          id: { gte: 'perf-holo-row-07000', startsWith: 'perf-holo-row-' },
          isDeleted: false,
          issue: { isDeleted: false },
        },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, barcode: true },
      }),
      prisma.coneType.findFirst({ orderBy: { id: 'asc' } }),
    ]);
    // Rehearsal rows intentionally include partially issued production-like data.
    // Select by authoritative remaining count and weight so this opt-in load gate
    // remains repeatable instead of requiring pristine zero-consumption fixtures.
    const holoSources = holoSourceCandidates.filter((row) => (
      Number(row.bobbinQuantity || 0) - Number(row.issuedBobbins || 0) >= 1
      && Number(row.netWt || 0) - Number(row.issuedBobbinWeight || 0) > 0.001
    )).slice(0, 100);
    assert.equal(holoSources.length, 100);
    assert.equal(coningSources.length, 100);
    assert.ok(coneType?.id, 'performance rehearsal requires a cone type master');

    const scenarios = [
      {
        name: 'holo',
        path: '/api/issue_to_holo_machine',
        body: (index) => ({
          date: '2026-08-27',
          twistId: 'perf-twist',
          crates: [{ rowId: holoSources[index - 1].id, issuedBobbins: 1 }],
        }),
      },
      {
        name: 'coning',
        path: '/api/issue_to_coning_machine',
        body: (index) => ({
          date: '2026-08-27',
          requiredPerConeNetWeight: 10,
          crates: [{
            rowId: coningSources[index - 1].id,
            barcode: coningSources[index - 1].barcode,
            issueRolls: 1,
            issueWeight: 0.5,
            coneTypeId: coneType.id,
          }],
        }),
      },
    ];

    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
      for (const scenario of scenarios) {
        const durations = [];
        for (let index = 1; index <= 100; index += 1) {
          const startedAt = performance.now();
          const response = await request(app)
            .post(scenario.path)
            .set('Authorization', auth)
            .send(scenario.body(index));
          durations.push(performance.now() - startedAt);
          assert.equal(response.status, 200, `${scenario.name} sample ${index}: ${response.text}`);
        }
        const p95 = percentile(durations, 0.95);
        const p99 = percentile(durations, 0.99);
        console.info(JSON.stringify({ route: scenario.path, samples: durations.length, p95Ms: Number(p95.toFixed(1)), p99Ms: Number(p99.toFixed(1)) }));
        assert.ok(p95 < 2_000, `${scenario.name} issue POST p95 was ${p95.toFixed(1)}ms`);
        assert.ok(p99 < 5_000, `${scenario.name} issue POST p99 was ${p99.toFixed(1)}ms`);
      }
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
  });
}
