-- Add roll type master
CREATE TABLE "RollType" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT UNIQUE NOT NULL,
  "weight" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

-- Extend ReceiveFromHoloMachine rows with roll type and weight breakdown
ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN "rollTypeId" TEXT,
  ADD COLUMN "grossWeight" DOUBLE PRECISION,
  ADD COLUMN "tareWeight" DOUBLE PRECISION;

ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD CONSTRAINT "ReceiveFromHoloMachineRow_rollTypeId_fkey"
  FOREIGN KEY ("rollTypeId") REFERENCES "RollType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
