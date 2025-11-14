-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "supplierId" TEXT,
    "totalPieces" INTEGER NOT NULL,
    "totalWeight" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundItem" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bobbin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,

    CONSTRAINT "Bobbin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueToMachine" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "totalWeight" DOUBLE PRECISION NOT NULL,
    "pieceIds" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "machineId" TEXT,
    "operatorId" TEXT,

    CONSTRAINT "IssueToMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveUpload" (
    "id" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReceiveUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveRow" (
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
    "bobbinId" TEXT,
    "boxId" TEXT,
    "operatorId" TEXT,
    "helperId" TEXT,
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

    CONSTRAINT "ReceiveRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivePieceTotal" (
    "pieceId" TEXT NOT NULL,
    "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPieces" INTEGER NOT NULL DEFAULT 0,
    "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivePieceTotal_pkey" PRIMARY KEY ("pieceId")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "brandPrimary" TEXT NOT NULL,
    "brandGold" TEXT NOT NULL,
    "logoDataUrl" TEXT,
    "whatsappNumber" TEXT,
    "whatsappGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL DEFAULT 'lot_sequence',
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "template" TEXT NOT NULL,
    "sendToPrimary" BOOLEAN NOT NULL DEFAULT true,
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Box" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Box_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lot_lotNo_key" ON "Lot"("lotNo");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiveRow_vchNo_key" ON "ReceiveRow"("vchNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_event_key" ON "WhatsappTemplate"("event");

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToMachine" ADD CONSTRAINT "IssueToMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToMachine" ADD CONSTRAINT "IssueToMachine_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveRow" ADD CONSTRAINT "ReceiveRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ReceiveUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveRow" ADD CONSTRAINT "ReceiveRow_bobbinId_fkey" FOREIGN KEY ("bobbinId") REFERENCES "Bobbin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveRow" ADD CONSTRAINT "ReceiveRow_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveRow" ADD CONSTRAINT "ReceiveRow_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveRow" ADD CONSTRAINT "ReceiveRow_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

