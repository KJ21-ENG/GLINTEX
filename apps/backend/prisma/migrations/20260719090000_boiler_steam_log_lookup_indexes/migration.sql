-- Lookup indexes for the BoilerSteamLog OR-join in the v2 holo stock queries.
-- The /api/v2/stock/holo/lots and lot-rows queries join BoilerSteamLog ON
--   holoReceiveRowId = r.id OR upper(barcode) = upper(r.barcode)
-- Without these two indexes Postgres nested-loops the whole table per receive
-- row (quadratic; minutes at 2026-07 data volume, killed by the role's 30s
-- statement_timeout). With them the planner uses a parameterized BitmapOr
-- (sub-second).

CREATE INDEX IF NOT EXISTS "BoilerSteamLog_holoReceiveRowId_idx"
    ON "BoilerSteamLog" ("holoReceiveRowId");

-- Functional index on upper(barcode) for the case-insensitive barcode branch.
-- This is migration-only by design: Prisma 4 cannot express a functional index
-- in schema.prisma, so it intentionally lives only here (accepted schema drift).
CREATE INDEX IF NOT EXISTS "BoilerSteamLog_barcode_upper_idx"
    ON "BoilerSteamLog" (upper("barcode"));

-- ANALYZE so the planner picks up the new indexes immediately.
ANALYZE "BoilerSteamLog";
