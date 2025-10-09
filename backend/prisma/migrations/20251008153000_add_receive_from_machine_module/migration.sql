-- Receive from machine module: uploads, rows, and per-piece totals

-- Create uploads table to store metadata per imported CSV
CREATE TABLE IF NOT EXISTS "ReceiveUpload" (
    "id" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ReceiveUpload_pkey" PRIMARY KEY ("id")
);

-- Create individual CSV rows table
CREATE TABLE IF NOT EXISTS "ReceiveRow" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "vchNo" TEXT NOT NULL,
    "narration" TEXT,
    "date" TEXT,
    "vchBook" TEXT,
    "barcode" TEXT,
    "shift" TEXT,
    "godownName" TEXT,
    "racNo" TEXT,
    "prodIssType" TEXT,
    "yarnName" TEXT,
    "itemName" TEXT,
    "cut" TEXT,
    "machineNo" TEXT,
    "employee" TEXT,
    "pktTypeName" TEXT,
    "pcsTypeName" TEXT,
    "pcs" INTEGER,
    "grossWt" DOUBLE PRECISION,
    "tareWt" DOUBLE PRECISION,
    "netWt" DOUBLE PRECISION,
    "pktBoxWt" DOUBLE PRECISION,
    "pcsBoxWt" DOUBLE PRECISION,
    "yarnWt" DOUBLE PRECISION,
    "totalKg" DOUBLE PRECISION,
    "createdBy" TEXT,
    "modifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiveRow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReceiveRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ReceiveUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReceiveRow_vchNo_key" ON "ReceiveRow" ("vchNo");

-- Aggregate table storing per-piece received weight
CREATE TABLE IF NOT EXISTS "ReceivePieceTotal" (
    "pieceId" TEXT NOT NULL,
    "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceivePieceTotal_pkey" PRIMARY KEY ("pieceId")
);

-- Ensure updatedAt reflects last modification
CREATE OR REPLACE FUNCTION update_receive_piece_total_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ReceivePieceTotal_updatedAt" ON "ReceivePieceTotal";
CREATE TRIGGER "ReceivePieceTotal_updatedAt"
BEFORE UPDATE ON "ReceivePieceTotal"
FOR EACH ROW
EXECUTE FUNCTION update_receive_piece_total_updated_at();
