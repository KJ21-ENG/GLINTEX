ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN "challanId" TEXT;
ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN "deletedByUserId" TEXT;

CREATE TABLE "ReceiveFromCutterMachineChallan" (
    "id" TEXT NOT NULL,
    "challanNo" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "itemId" TEXT,
    "date" TEXT,
    "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBobbinQty" INTEGER NOT NULL DEFAULT 0,
    "operatorId" TEXT,
    "helperId" TEXT,
    "cutId" TEXT,
    "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastageNote" TEXT,
    "changeLog" JSONB NOT NULL DEFAULT '[]',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    CONSTRAINT "ReceiveFromCutterMachineChallan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceiveFromCutterMachineChallan_challanNo_key" ON "ReceiveFromCutterMachineChallan"("challanNo");

ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "ReceiveFromCutterMachineChallan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
