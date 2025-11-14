-- Add barcode column to inbound items
ALTER TABLE "InboundItem" ADD COLUMN IF NOT EXISTS "barcode" TEXT;

UPDATE "InboundItem"
SET "barcode" = 'INB-MET-' || "lotNo" || '-' || LPAD(CAST("seq" AS TEXT), 3, '0')
WHERE "barcode" IS NULL OR "barcode" = '';

ALTER TABLE "InboundItem"
  ALTER COLUMN "barcode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "InboundItem_barcode_key" ON "InboundItem"("barcode");

-- Add barcode column to issue_to_machine (one per issue/roll)
ALTER TABLE "IssueToMachine" ADD COLUMN IF NOT EXISTS "barcode" TEXT;

UPDATE "IssueToMachine"
SET "barcode" = 'ISM-MET-' || "lotNo" || '-' ||
  COALESCE(
    LPAD(NULLIF(regexp_replace(split_part("pieceIds", ',', 1), '^.*?-', ''), ''), 3, '0'),
    '000'
  )
WHERE "barcode" IS NULL OR "barcode" = '';

ALTER TABLE "IssueToMachine"
  ALTER COLUMN "barcode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "IssueToMachine_barcode_key" ON "IssueToMachine"("barcode");

-- Drop legacy crate table if it existed
DROP TABLE IF EXISTS "IssueCrate";
