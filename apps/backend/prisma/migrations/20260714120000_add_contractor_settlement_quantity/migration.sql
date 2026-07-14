-- Store the process-specific physical count used by contractor settlement PDFs.
-- Existing rows are backfilled from their claimed production receive row.

ALTER TABLE "ContractorSettlementLine"
  ADD COLUMN "quantity" INTEGER;

UPDATE "ContractorSettlementLine" AS line
SET "quantity" = source."bobbin_quantity"
FROM "ReceiveFromCutterMachineRow" AS source
WHERE line."process" = 'cutter'
  AND line."sourceRowId" = source."id";

UPDATE "ContractorSettlementLine" AS line
SET "quantity" = source."rollCount"
FROM "ReceiveFromHoloMachineRow" AS source
WHERE line."process" = 'holo'
  AND line."sourceRowId" = source."id";

UPDATE "ContractorSettlementLine" AS line
SET "quantity" = source."coneCount"
FROM "ReceiveFromConingMachineRow" AS source
WHERE line."process" = 'coning'
  AND line."sourceRowId" = source."id";
