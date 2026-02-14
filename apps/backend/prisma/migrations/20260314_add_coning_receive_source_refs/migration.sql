-- Add persisted per-source consumption for coning receives
ALTER TABLE "ReceiveFromConingMachineRow"
  ADD COLUMN IF NOT EXISTS "sourceRowRefs" JSONB NOT NULL DEFAULT '[]'::jsonb;
