-- Add weight and box fields to coning receive rows
ALTER TABLE "ReceiveFromConingMachineRow"
  ADD COLUMN "netWeight" DOUBLE PRECISION,
  ADD COLUMN "tareWeight" DOUBLE PRECISION,
  ADD COLUMN "grossWeight" DOUBLE PRECISION,
  ADD COLUMN "boxId" TEXT;

ALTER TABLE "ReceiveFromConingMachineRow"
  ADD CONSTRAINT "ReceiveFromConingMachineRow_boxId_fkey"
    FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE SET NULL ON UPDATE CASCADE;
