-- Add Opening Stock note persistence for inbound and cutter rows
ALTER TABLE "InboundItem"
  ADD COLUMN "note" TEXT;

ALTER TABLE "ReceiveFromCutterMachineRow"
  ADD COLUMN "notes" TEXT;
