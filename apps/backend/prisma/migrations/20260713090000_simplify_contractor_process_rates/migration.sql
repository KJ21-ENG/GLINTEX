-- Contractor payments now use a current process owner and a current rate card.
-- Settlement lines already snapshot contractor/rate/quality values, so paid
-- history remains immutable while these master tables are simplified.

-- A process can have only one owner after effective dates are removed. Keep
-- the most recent open-ended assignment; when none is open-ended, keep the
-- assignment with the latest start/update timestamp.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "process"
      ORDER BY
        CASE WHEN "effectiveTo" IS NULL THEN 0 ELSE 1 END,
        "effectiveFrom" DESC,
        "updatedAt" DESC,
        "id" DESC
    ) AS row_number
  FROM "ContractorAssignment"
)
DELETE FROM "ContractorAssignment" AS assignment
USING ranked
WHERE assignment."id" = ranked."id"
  AND ranked.row_number > 1;

DROP INDEX IF EXISTS "ContractorAssignment_process_effectiveFrom_idx";
ALTER TABLE "ContractorAssignment"
  DROP COLUMN "effectiveFrom",
  DROP COLUMN "effectiveTo";
CREATE UNIQUE INDEX "ContractorAssignment_process_key"
  ON "ContractorAssignment"("process");

-- Different effective-dated versions of the same quality tuple collapse into
-- one current rate. Prefer an open-ended version, then the latest start/update
-- timestamp. Different quality tuples and specificity overrides are retained.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "contractorId",
        "process",
        "itemId",
        "yarnId",
        "cutId",
        "side",
        "twistId",
        "coneTypeId"
      ORDER BY
        CASE WHEN "effectiveTo" IS NULL THEN 0 ELSE 1 END,
        "effectiveFrom" DESC,
        "updatedAt" DESC,
        "id" DESC
    ) AS row_number
  FROM "ContractorRate"
)
DELETE FROM "ContractorRate" AS rate
USING ranked
WHERE rate."id" = ranked."id"
  AND ranked.row_number > 1;

ALTER TABLE "ContractorRate"
  DROP COLUMN "effectiveFrom",
  DROP COLUMN "effectiveTo";
