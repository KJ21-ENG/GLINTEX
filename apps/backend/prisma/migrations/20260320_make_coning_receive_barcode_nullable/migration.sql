-- Allow existing rows without barcodes; keep uniqueness when present
ALTER TABLE "ReceiveFromConingMachineRow"
  ALTER COLUMN "barcode" DROP NOT NULL;
