-- Add barcode to Holo receive rows
ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN "barcode" TEXT UNIQUE;
