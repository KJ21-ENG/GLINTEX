-- Existing rows stay NULL deliberately. Before row-level classification was
-- introduced, every Holo receive was accumulated in totalNetWeight regardless
-- of its roll-type label. New writes persist the authoritative bucket.
ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN IF NOT EXISTS "isWastage" BOOLEAN;
