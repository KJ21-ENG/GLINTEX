import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { PACKING_LAUNCH_STATE_ID, readLaunchState } from './writeGate.js';
import { getRuntimeSafety } from '../../utils/runtimeSafety.js';

export const REQUIRED_PACKING_TABLES = Object.freeze([
  'OperationalSequence',
  'PackingLaunchState',
  'PackingColor',
  'PackingPackageType',
  'PackingRecipe',
  'PackingRecipeLevel',
  'PackingBatch',
  'PackingBatchSource',
  'PackedUnit',
  'PackedUnitEvent',
  'DispatchChallan',
  'DispatchLine',
  'DispatchEvent',
  'DispatchDocument',
  'InventoryAdjustmentBatch',
  'InventoryAdjustmentLine',
]);

export const REQUIRED_PACKING_MIGRATION = '20260820090000_add_packing_dispatch_v2';

async function checkDatabase(client) {
  try {
    await client.$queryRaw(Prisma.sql`SELECT 1`);
    return { ok: true };
  } catch (error) {
    console.error('[Readiness] Database connectivity check failed:', error?.message || error);
    return { ok: false, error: 'database_unavailable' };
  }
}

async function checkRequiredSchema(client) {
  try {
    const rows = await client.$queryRaw(Prisma.sql`
      SELECT "table_name"
      FROM information_schema.tables
      WHERE "table_schema" = 'public'
        AND "table_name" IN (${Prisma.join(REQUIRED_PACKING_TABLES)})
    `);
    const present = new Set(rows.map((row) => String(row.table_name)));
    const missing = REQUIRED_PACKING_TABLES.filter((tableName) => !present.has(tableName));

    const customerColumns = await client.$queryRaw(Prisma.sql`
      SELECT "column_name"
      FROM information_schema.columns
      WHERE "table_schema" = 'public'
        AND "table_name" = 'Customer'
        AND "column_name" = 'isActive'
    `);
    if (!customerColumns.length) missing.push('Customer.isActive');

    return {
      ok: missing.length === 0,
      requiredTables: REQUIRED_PACKING_TABLES,
      missing,
    };
  } catch (error) {
    console.error('[Readiness] Required schema check failed:', error?.message || error);
    return {
      ok: false,
      requiredTables: REQUIRED_PACKING_TABLES,
      missing: REQUIRED_PACKING_TABLES,
      error: 'required_schema_unavailable',
    };
  }
}

async function checkMigration(client) {
  try {
    const rows = await client.$queryRaw(Prisma.sql`
      SELECT "migration_name", "finished_at", "rolled_back_at"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${REQUIRED_PACKING_MIGRATION}
      ORDER BY "finished_at" DESC NULLS LAST
      LIMIT 1
    `);
    const migration = rows[0] || null;
    const applied = Boolean(migration?.finished_at) && !migration?.rolled_back_at;
    return {
      ok: applied,
      expected: REQUIRED_PACKING_MIGRATION,
      applied,
      migration,
    };
  } catch (error) {
    console.error('[Readiness] Migration status check failed:', error?.message || error);
    return {
      ok: false,
      expected: REQUIRED_PACKING_MIGRATION,
      applied: false,
      migration: null,
      error: 'migration_status_unavailable',
    };
  }
}

export async function checkBackendReadiness({ client = prisma, deploySha = process.env.GLINTEX_DEPLOY_SHA || null } = {}) {
  const runtimeSafety = getRuntimeSafety();
  const database = await checkDatabase(client);
  const requiredSchema = database.ok
    ? await checkRequiredSchema(client)
    : { ok: false, requiredTables: REQUIRED_PACKING_TABLES, missing: REQUIRED_PACKING_TABLES, skipped: true };
  const migration = database.ok
    ? await checkMigration(client)
    : { ok: false, expected: REQUIRED_PACKING_MIGRATION, applied: false, migration: null, skipped: true };

  let launchState = null;
  if (database.ok && requiredSchema.ok) {
    try {
      launchState = await readLaunchState(client);
    } catch (_) {
      launchState = null;
    }
  }

  const checks = {
    database,
    requiredSchema,
    migration,
    launchState: {
      ok: launchState !== null,
      id: PACKING_LAUNCH_STATE_ID,
      status: launchState?.status || 'PREPARATION',
      affectedWritesPaused: Boolean(launchState?.affectedWritesPaused),
    },
  };
  const ok = checks.database.ok && checks.requiredSchema.ok && checks.migration.ok;

  return {
    ok,
    status: ok ? 'ready' : 'not_ready',
    deploySha,
    runtimeMode: runtimeSafety.runtimeMode,
    externalIntegrationsDisabled: !runtimeSafety.externalIntegrationsAllowed,
    checks,
    checkedAt: new Date().toISOString(),
  };
}
