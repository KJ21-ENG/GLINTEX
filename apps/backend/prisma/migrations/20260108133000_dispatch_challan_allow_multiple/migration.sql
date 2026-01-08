-- Drop unique constraint so a single challan can cover multiple dispatch rows
DROP INDEX IF EXISTS "Dispatch_challanNo_key";

-- Non-unique index for faster challan lookups
CREATE INDEX IF NOT EXISTS "Dispatch_challanNo_idx" ON "Dispatch"("challanNo");
