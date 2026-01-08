-- CreateTable
CREATE TABLE "BoxTransfer" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "fromBarcode" TEXT NOT NULL,
    "fromItemId" TEXT NOT NULL,
    "toBarcode" TEXT NOT NULL,
    "toItemId" TEXT NOT NULL,
    "pieceCount" INTEGER NOT NULL,
    "weightTransferred" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "BoxTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoxTransfer_reversedById_key" ON "BoxTransfer"("reversedById");

-- AddForeignKey
ALTER TABLE "BoxTransfer" ADD CONSTRAINT "BoxTransfer_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "BoxTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
