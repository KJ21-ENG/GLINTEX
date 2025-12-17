-- CreateTable
CREATE TABLE "IssueCrate" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "receiveBarcode" TEXT,
    "crateIndex" INTEGER NOT NULL DEFAULT 1,
    "pieceId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "IssueCrate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueCrate_barcode_key" ON "IssueCrate"("barcode");

-- AddForeignKey
ALTER TABLE "IssueCrate" ADD CONSTRAINT "IssueCrate_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "InboundItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IssueCrate" ADD CONSTRAINT "IssueCrate_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
