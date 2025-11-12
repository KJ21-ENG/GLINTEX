-- Add totalPieces column to ReceivePieceTotal
ALTER TABLE "ReceivePieceTotal"
ADD COLUMN IF NOT EXISTS "totalPieces" INTEGER NOT NULL DEFAULT 0;


