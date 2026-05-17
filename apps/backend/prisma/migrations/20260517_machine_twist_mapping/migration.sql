-- Machine -> Twist mapping (one twist per machine) and a Settings flag
-- to toggle automatic Twist pre-fill on the Issue to Machine forms.

CREATE TABLE IF NOT EXISTS "MachineTwistMapping" (
    "id"              TEXT PRIMARY KEY,
    "machineId"       TEXT NOT NULL,
    "twistId"         TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "MachineTwistMapping_machineId_key"
    ON "MachineTwistMapping"("machineId");

CREATE INDEX IF NOT EXISTS "MachineTwistMapping_twistId_idx"
    ON "MachineTwistMapping"("twistId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MachineTwistMapping_machineId_fkey'
    ) THEN
        ALTER TABLE "MachineTwistMapping"
            ADD CONSTRAINT "MachineTwistMapping_machineId_fkey"
            FOREIGN KEY ("machineId") REFERENCES "Machine"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MachineTwistMapping_twistId_fkey'
    ) THEN
        ALTER TABLE "MachineTwistMapping"
            ADD CONSTRAINT "MachineTwistMapping_twistId_fkey"
            FOREIGN KEY ("twistId") REFERENCES "Twist"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END$$;

ALTER TABLE "Settings"
    ADD COLUMN IF NOT EXISTS "autoSelectTwistForMachine" BOOLEAN NOT NULL DEFAULT FALSE;
