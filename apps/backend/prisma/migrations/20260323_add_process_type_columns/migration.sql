-- Add processType columns used to scope masters by process (cutter/holo/coning/all).
-- These are additive and safe to apply on existing databases.

ALTER TABLE "Machine" ADD COLUMN IF NOT EXISTS "processType" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "Operator" ADD COLUMN IF NOT EXISTS "processType" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "Box" ADD COLUMN IF NOT EXISTS "processType" TEXT NOT NULL DEFAULT 'all';
