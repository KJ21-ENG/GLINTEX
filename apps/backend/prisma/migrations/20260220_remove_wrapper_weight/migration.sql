-- Wrapper weight is no longer tracked; drop the column
ALTER TABLE "Wrapper" DROP COLUMN IF EXISTS "weight";
