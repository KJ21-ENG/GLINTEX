-- Add issuedBobbins column to ReceiveFromCutterMachineRow with default value 0
ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN IF NOT EXISTS "issuedBobbins" INTEGER NOT NULL DEFAULT 0;

-- Rename totalPieces to totalBob in ReceiveFromCutterMachinePieceTotal
ALTER TABLE "ReceiveFromCutterMachinePieceTotal" RENAME COLUMN "totalPieces" TO "totalBob";

