\set ON_ERROR_STOP on

-- Prisma 4 executes migration files in a transaction. PostgreSQL forbids
-- CONCURRENTLY there, so these idempotent online indexes are a separate,
-- explicit predeploy step run by the Compose migration service.
-- An interrupted concurrent build leaves an invalid index behind. Remove only
-- invalid target indexes before retrying so IF NOT EXISTS cannot silently keep
-- an unusable index.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I', index_class.relname)
FROM pg_index
JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
WHERE NOT pg_index.indisvalid
  AND index_class.relname IN (
    'IssueToCutterMachine_isDeleted_createdAt_id_idx',
    'IssueToHoloMachine_isDeleted_createdAt_id_idx',
    'IssueToConingMachine_isDeleted_createdAt_id_idx',
    'ReceiveFromCutterMachineRow_isDeleted_createdAt_id_idx',
    'ReceiveFromHoloMachineRow_isDeleted_createdAt_id_idx',
    'ReceiveFromConingMachineRow_isDeleted_createdAt_id_idx',
    'BoilerSteamLog_holoReceiveRowId_steamedAt_id_idx',
    'BoilerSteamLog_upper_barcode_steamedAt_id_idx',
    'IssueTakeBack_stage_issueId_isReverse_isReversed_idx'
  )
\gexec

CREATE INDEX CONCURRENTLY IF NOT EXISTS "IssueToCutterMachine_isDeleted_createdAt_id_idx"
ON "IssueToCutterMachine"("isDeleted", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "IssueToHoloMachine_isDeleted_createdAt_id_idx"
ON "IssueToHoloMachine"("isDeleted", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "IssueToConingMachine_isDeleted_createdAt_id_idx"
ON "IssueToConingMachine"("isDeleted", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReceiveFromCutterMachineRow_isDeleted_createdAt_id_idx"
ON "ReceiveFromCutterMachineRow"("isDeleted", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReceiveFromHoloMachineRow_isDeleted_createdAt_id_idx"
ON "ReceiveFromHoloMachineRow"("isDeleted", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReceiveFromConingMachineRow_isDeleted_createdAt_id_idx"
ON "ReceiveFromConingMachineRow"("isDeleted", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BoilerSteamLog_holoReceiveRowId_steamedAt_id_idx"
ON "BoilerSteamLog"("holoReceiveRowId", "steamedAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BoilerSteamLog_upper_barcode_steamedAt_id_idx"
ON "BoilerSteamLog"(upper("barcode"), "steamedAt" DESC, "id" DESC)
WHERE "barcode" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "IssueTakeBack_stage_issueId_isReverse_isReversed_idx"
ON "IssueTakeBack"("stage", "issueId", "isReverse", "isReversed");

SELECT count(*) = 9 AS all_indexes_valid
FROM pg_index
JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
WHERE pg_index.indisvalid
  AND index_class.relname IN (
    'IssueToCutterMachine_isDeleted_createdAt_id_idx',
    'IssueToHoloMachine_isDeleted_createdAt_id_idx',
    'IssueToConingMachine_isDeleted_createdAt_id_idx',
    'ReceiveFromCutterMachineRow_isDeleted_createdAt_id_idx',
    'ReceiveFromHoloMachineRow_isDeleted_createdAt_id_idx',
    'ReceiveFromConingMachineRow_isDeleted_createdAt_id_idx',
    'BoilerSteamLog_holoReceiveRowId_steamedAt_id_idx',
    'BoilerSteamLog_upper_barcode_steamedAt_id_idx',
    'IssueTakeBack_stage_issueId_isReverse_isReversed_idx'
  )
\gset

\if :all_indexes_valid
\echo 'All process pagination indexes are valid.'
\else
\echo 'One or more process pagination indexes are missing or invalid.'
\quit 3
\endif

-- Retire superseded indexes only after the replacements are proven valid.
DROP INDEX CONCURRENTLY IF EXISTS "IssueToHoloMachine_isDeleted_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "IssueToConingMachine_isDeleted_createdAt_idx";
