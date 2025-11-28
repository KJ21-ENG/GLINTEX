-- Add barcode to coning receive rows
ALTER TABLE "ReceiveFromConingMachineRow"
  ADD COLUMN "barcode" TEXT;

CREATE UNIQUE INDEX "ReceiveFromConingMachineRow_barcode_key" ON "ReceiveFromConingMachineRow"("barcode");
