-- Wastage Events: per-piece audit trail for mark/revert with optional notes.
-- Adds a normalized event table plus a pointer column on each *PieceTotal
-- so the UI can cheaply detect "is wastage marked and revertable".

CREATE TABLE IF NOT EXISTS "WastageEvent" (
    "id"              TEXT PRIMARY KEY,
    "stage"           TEXT NOT NULL,
    "pieceId"         TEXT NOT NULL,
    "eventType"       TEXT NOT NULL,
    "weight"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note"            TEXT,
    "reason"          TEXT,
    "reversedEventId" TEXT,
    "holoRowId"       TEXT,
    "challanId"       TEXT,
    "synthetic"       BOOLEAN NOT NULL DEFAULT FALSE,
    "actorUserId"     TEXT,
    "actorUsername"   TEXT,
    "actorRoleKey"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "WastageEvent_reversedEventId_key"
    ON "WastageEvent" ("reversedEventId");

CREATE INDEX IF NOT EXISTS "WastageEvent_stage_pieceId_createdAt_idx"
    ON "WastageEvent" ("stage", "pieceId", "createdAt");

CREATE INDEX IF NOT EXISTS "WastageEvent_actorUserId_createdAt_idx"
    ON "WastageEvent" ("actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "WastageEvent_holoRowId_idx"
    ON "WastageEvent" ("holoRowId");

CREATE INDEX IF NOT EXISTS "WastageEvent_challanId_idx"
    ON "WastageEvent" ("challanId");

-- Denormalized pointer to the most recent open mark event per piece total.
ALTER TABLE "ReceiveFromCutterMachinePieceTotal"
    ADD COLUMN IF NOT EXISTS "lastWastageEventId" TEXT;

ALTER TABLE "ReceiveFromConingMachinePieceTotal"
    ADD COLUMN IF NOT EXISTS "lastWastageEventId" TEXT;

ALTER TABLE "ReceiveFromHoloMachinePieceTotal"
    ADD COLUMN IF NOT EXISTS "lastWastageEventId" TEXT;
