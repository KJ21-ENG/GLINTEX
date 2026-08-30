-- Existing rows and writes from the previous backend stay NULL deliberately.
-- That backend accumulated every Holo receive in totalNetWeight regardless of
-- its roll-type label, so NULL preserves the same bucket during migration-first
-- rollout and rollback. New-backend writes persist the authoritative bucket.
ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN IF NOT EXISTS "isWastage" BOOLEAN;
