function boundedLimit(raw, fallback = 25, maximum = 100) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(maximum, Math.floor(value));
}

function cleanString(value, max = 160) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function optionalControlledValue(value, field, allowed, max = 80) {
  const normalized = cleanString(value, max)?.toUpperCase();
  if (!normalized) return null;
  if (!allowed.includes(normalized)) {
    throw Object.assign(new Error(`${field} is not supported.`), {
      status: 400,
      code: 'validation_error',
      details: { field, allowed },
    });
  }
  return normalized;
}

function decimalNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function serializeSettlement(settlement) {
  if (!settlement) return null;
  return {
    ...settlement,
    productionKg: decimalNumber(settlement.productionKg),
    productionAmount: decimalNumber(settlement.productionAmount),
    adjustmentsTotal: decimalNumber(settlement.adjustmentsTotal),
    finalPayable: decimalNumber(settlement.finalPayable),
    lines: Array.isArray(settlement.lines)
      ? settlement.lines.map(line => ({
        ...line,
        netKg: decimalNumber(line.netKg),
        ratePerKg: decimalNumber(line.ratePerKg),
        amount: decimalNumber(line.amount),
      }))
      : undefined,
    adjustments: Array.isArray(settlement.adjustments)
      ? settlement.adjustments.map(adjustment => ({ ...adjustment, amount: decimalNumber(adjustment.amount) }))
      : undefined,
  };
}

export async function readAgentReference(db) {
  const [
    items,
    yarns,
    cuts,
    twists,
    machines,
    operators,
    bobbins,
    boxes,
    rollTypes,
    coneTypes,
    wrappers,
    firms,
    suppliers,
    contractors,
    customers,
  ] = await Promise.all([
    db.item.findMany({ select: { id: true, name: true, side: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.yarn.findMany({ select: { id: true, name: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.cut.findMany({ select: { id: true, name: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.twist.findMany({ select: { id: true, name: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.machine.findMany({ select: { id: true, name: true, processType: true, spindle: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.operator.findMany({ select: { id: true, name: true, role: true, processType: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.bobbin.findMany({ select: { id: true, name: true, weight: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.box.findMany({ select: { id: true, name: true, weight: true, processType: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.rollType.findMany({ select: { id: true, name: true, weight: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.coneType.findMany({ select: { id: true, name: true, weight: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.wrapper.findMany({ select: { id: true, name: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.firm.findMany({ select: { id: true, name: true, address: true, mobile: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.supplier.findMany({ select: { id: true, name: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.contractor.findMany({ select: { id: true, name: true, phone: true, isActive: true, updatedAt: true }, orderBy: { name: 'asc' } }),
    db.customer.findMany({ select: { id: true, name: true, phone: true, address: true, updatedAt: true }, orderBy: { name: 'asc' } }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    masters: {
      items,
      yarns,
      cuts,
      twists,
      machines,
      operators,
      bobbins,
      boxes,
      rollTypes,
      coneTypes,
      wrappers,
      firms,
      suppliers,
      contractors,
      customers,
    },
  };
}

export async function readContractorSettlements(db, query = {}) {
  const limit = boundedLimit(query.limit, 25, 100);
  const page = boundedLimit(query.page, 1, 10_000);
  const process = cleanString(query.process, 20)?.toLowerCase();
  const status = cleanString(query.status, 20)?.toLowerCase();
  const id = cleanString(query.id, 100);
  if (process && !['cutter', 'holo', 'coning'].includes(process)) {
    throw Object.assign(new Error('process must be cutter, holo, or coning.'), { status: 400, code: 'validation_error' });
  }
  if (status && !['draft', 'paid'].includes(status)) {
    throw Object.assign(new Error('status must be draft or paid.'), { status: 400, code: 'validation_error' });
  }

  const include = {
    contractor: { select: { id: true, name: true, phone: true, isActive: true } },
    lines: id ? true : false,
    adjustments: id ? true : false,
  };
  if (id) {
    return serializeSettlement(await db.contractorSettlement.findUnique({ where: { id }, include }));
  }
  const search = cleanString(query.search, 120);
  const where = {
    ...(process ? { process } : {}),
    ...(status ? { status } : {}),
    ...(query.dateFrom || query.dateTo ? {
      periodFrom: query.dateTo ? { lte: String(query.dateTo) } : undefined,
      periodTo: query.dateFrom ? { gte: String(query.dateFrom) } : undefined,
    } : {}),
    ...(search ? { contractor: { name: { contains: search, mode: 'insensitive' } } } : {}),
  };
  const [items, total] = await Promise.all([
    db.contractorSettlement.findMany({
      where,
      include,
      orderBy: [{ periodTo: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.contractorSettlement.count({ where }),
  ]);
  return { items: items.map(serializeSettlement), total, page, limit };
}

export async function readOwnerTasks(db, query = {}) {
  const limit = boundedLimit(query.limit, 25, 100);
  const status = optionalControlledValue(query.status, 'status', ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']);
  const area = optionalControlledValue(query.area, 'area', ['FINANCE', 'INVENTORY', 'TECHNOLOGY', 'APPLICATION', 'OPERATIONS', 'GENERAL']);
  const id = cleanString(query.id, 100);
  if (id) return db.ownerTask.findUnique({ where: { id } });
  const search = cleanString(query.search, 120);
  const where = {
    ...(status ? { status } : {}),
    ...(area ? { area } : {}),
    ...(search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const [items, total] = await Promise.all([
    db.ownerTask.findMany({ where, orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }], take: limit }),
    db.ownerTask.count({ where }),
  ]);
  return { items, total, limit };
}

export async function readLearningCandidates(db, query = {}) {
  const limit = boundedLimit(query.limit, 25, 100);
  const status = optionalControlledValue(query.status, 'status', ['PROPOSED', 'APPROVED', 'REJECTED', 'APPLIED']);
  const category = optionalControlledValue(query.category, 'category', ['OWNER_PREFERENCE', 'DOMAIN_RULE', 'WORKFLOW_GAP', 'PROCESS_IMPROVEMENT']);
  const id = cleanString(query.id, 100);
  if (id) return db.agentLearningCandidate.findUnique({ where: { id } });
  const where = { ...(status ? { status } : {}), ...(category ? { category } : {}) };
  const [items, total] = await Promise.all([
    db.agentLearningCandidate.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    db.agentLearningCandidate.count({ where }),
  ]);
  return { items, total, limit };
}

export async function readOperationHistory(db, agent, query = {}) {
  const limit = boundedLimit(query.limit, 25, 100);
  const id = cleanString(query.id, 100);
  if (id) return db.agentOperation.findFirst({ where: { id, agentId: agent.id, requesterId: agent.requesterId } });
  const status = optionalControlledValue(query.status, 'status', [
    'PREPARED',
    'EXECUTING',
    'SUCCEEDED',
    'VERIFIED',
    'FAILED',
    'EXPIRED',
    'VERIFICATION_FAILED',
  ]);
  const action = cleanString(query.action, 80);
  if (action && !['owner_task.create', 'owner_task.update', 'owner_task.complete', 'owner_task.cancel', 'learning_candidate.propose'].includes(action)) {
    throw Object.assign(new Error('action is not supported.'), { status: 400, code: 'validation_error' });
  }
  const where = {
    agentId: agent.id,
    requesterId: agent.requesterId,
    ...(status ? { status } : {}),
    ...(action ? { action } : {}),
  };
  const [items, total] = await Promise.all([
    db.agentOperation.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    db.agentOperation.count({ where }),
  ]);
  return { items, total, limit };
}

function validDate(value, field) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw Object.assign(new Error(`${field} must use YYYY-MM-DD.`), { status: 400, code: 'validation_error' });
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw Object.assign(new Error(`${field} is not a real calendar date.`), { status: 400, code: 'validation_error' });
  }
  return normalized;
}

function summarizeProductionRows(process, rows) {
  const byDate = new Map();
  for (const row of rows) {
    const date = row.date || 'unknown';
    const current = byDate.get(date) || { date, records: 0, quantity: 0, netKg: 0 };
    current.records += 1;
    if (process === 'cutter') {
      current.quantity += Number(row.bobbinQuantity || 0);
      current.netKg += Number(row.netWt ?? row.totalKg ?? 0);
    }
    if (process === 'holo') {
      current.quantity += Number(row.rollCount || 0);
      current.netKg += Number(row.rollWeight ?? (Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
    }
    if (process === 'coning') {
      current.quantity += Number(row.coneCount || 0);
      current.netKg += Number(row.netWeight ?? row.coneWeight ?? (Number(row.grossWeight || 0) - Number(row.tareWeight || 0)));
    }
    byDate.set(date, current);
  }
  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(row => ({ ...row, netKg: Math.round(row.netKg * 1_000) / 1_000 }));
}

export async function readProductionSummary(db, query = {}) {
  const dateTo = validDate(query.dateTo || new Date().toISOString().slice(0, 10), 'dateTo');
  const dateFrom = validDate(query.dateFrom || dateTo, 'dateFrom');
  const fromMs = new Date(`${dateFrom}T00:00:00Z`).getTime();
  const toMs = new Date(`${dateTo}T00:00:00Z`).getTime();
  if (fromMs > toMs || (toMs - fromMs) / 86_400_000 > 93) {
    throw Object.assign(new Error('Production ranges must be ordered and no longer than 93 days.'), { status: 400, code: 'validation_error' });
  }
  const process = String(query.process || 'all').trim().toLowerCase();
  if (!['all', 'cutter', 'holo', 'coning'].includes(process)) {
    throw Object.assign(new Error('process must be all, cutter, holo, or coning.'), { status: 400, code: 'validation_error' });
  }
  const dateWhere = { gte: dateFrom, lte: dateTo };
  const selected = process === 'all' ? ['cutter', 'holo', 'coning'] : [process];
  const queries = selected.map(async (stage) => {
    if (stage === 'cutter') {
      return [stage, await db.receiveFromCutterMachineRow.findMany({
        where: { isDeleted: false, date: dateWhere },
        select: { date: true, bobbinQuantity: true, netWt: true, totalKg: true },
        take: 20_000,
      })];
    }
    if (stage === 'holo') {
      return [stage, await db.receiveFromHoloMachineRow.findMany({
        where: { isDeleted: false, date: dateWhere },
        select: { date: true, rollCount: true, rollWeight: true, grossWeight: true, tareWeight: true },
        take: 20_000,
      })];
    }
    return [stage, await db.receiveFromConingMachineRow.findMany({
      where: { isDeleted: false, date: dateWhere },
      select: { date: true, coneCount: true, netWeight: true, coneWeight: true, grossWeight: true, tareWeight: true },
      take: 20_000,
    })];
  });
  const results = await Promise.all(queries);
  const processes = Object.fromEntries(results.map(([stage, rows]) => [stage, summarizeProductionRows(stage, rows)]));
  const rowLimitReached = results
    .filter(([, rows]) => rows.length === 20_000)
    .map(([stage]) => stage);
  return {
    dateFrom,
    dateTo,
    process,
    processes,
    rowLimitReached,
    dataRule: 'Uses non-deleted receive rows and stored net-weight precedence; use the application reports UI for specialized KPI calculations.',
  };
}

async function readBackendHealth(baseUrl, timeoutMs = 3_000) {
  try {
    const response = await fetch(`${String(baseUrl || '').replace(/\/+$/, '')}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}

export async function readSystemStatus(db, env = process.env) {
  const startedAt = new Date(Date.now() - process.uptime() * 1_000).toISOString();
  const [databaseProbe, migrations, backend] = await Promise.all([
    db.$queryRaw`SELECT 1 AS ok`,
    db.$queryRaw`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
    readBackendHealth(env.GLINTEX_APP_BASE_URL || 'http://backend:4000'),
  ]);
  return {
    ok: Boolean(databaseProbe?.length && backend.ok),
    checkedAt: new Date().toISOString(),
    deploymentSha: String(env.GLINTEX_DEPLOY_SHA || 'unknown').slice(0, 64),
    agentApi: {
      nodeVersion: process.version,
      startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    database: {
      ok: Boolean(databaseProbe?.length),
      latestMigration: migrations?.[0] || null,
    },
    applicationBackend: backend,
  };
}
