-- Existing rows stay NULL deliberately. Before row-level classification was
-- introduced, every Holo receive was accumulated in totalNetWeight regardless
-- of its roll-type label. New writes persist the authoritative bucket.
BEGIN;

ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN IF NOT EXISTS "isWastage" BOOLEAN;

-- The previous backend stays live while production migrations run. Classify
-- rows written by that version, which does not know about isWastage, before
-- readers switch to the new field. The trigger also keeps rollback writes
-- compatible. Historical rows remain NULL because this does not backfill or
-- reclassify unchanged rows.
CREATE OR REPLACE FUNCTION classify_holo_receive_wastage_bucket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  roll_type_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR NEW."rollTypeId" IS DISTINCT FROM OLD."rollTypeId" THEN
    SELECT name INTO roll_type_name
    FROM "RollType"
    WHERE id = NEW."rollTypeId";

    NEW."isWastage" := COALESCE(LOWER(roll_type_name) LIKE '%wastage%', FALSE);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classify_holo_receive_wastage_bucket
  ON "ReceiveFromHoloMachineRow";
CREATE TRIGGER classify_holo_receive_wastage_bucket
BEFORE INSERT OR UPDATE OF "rollTypeId" ON "ReceiveFromHoloMachineRow"
FOR EACH ROW
EXECUTE FUNCTION classify_holo_receive_wastage_bucket();

COMMIT;
