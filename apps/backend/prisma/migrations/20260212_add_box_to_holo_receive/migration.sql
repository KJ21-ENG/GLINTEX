-- Add box reference to Holo receive rows
ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN "boxId" TEXT;

ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD CONSTRAINT "ReceiveFromHoloMachineRow_boxId_fkey"
  FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE SET NULL ON UPDATE CASCADE;
