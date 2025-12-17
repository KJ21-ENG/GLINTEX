-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Yarn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Yarn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cut" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Cut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Twist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Twist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

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
    "barcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "InboundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "processType" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "processType" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bobbin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Bobbin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueToHoloMachine" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "yarnId" TEXT,
    "twistId" TEXT,
    "machineId" TEXT,
    "operatorId" TEXT,
    "barcode" TEXT NOT NULL,
    "note" TEXT,
    "shift" TEXT,
    "metallicBobbins" INTEGER NOT NULL DEFAULT 0,
    "metallicBobbinsWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yarnKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivedRowRefs" JSONB NOT NULL DEFAULT '[]',
    "rollsProducedEstimate" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "IssueToHoloMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromHoloMachineRow" (
    "id" TEXT NOT NULL,
    "date" TEXT,
    "issueId" TEXT NOT NULL,
    "rollCount" INTEGER NOT NULL,
    "rollWeight" DOUBLE PRECISION,
    "rollTypeId" TEXT,
    "grossWeight" DOUBLE PRECISION,
    "tareWeight" DOUBLE PRECISION,
    "barcode" TEXT,
    "boxId" TEXT,
    "machineNo" TEXT,
    "operatorId" TEXT,
    "helperId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ReceiveFromHoloMachineRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromHoloMachinePieceTotal" (
    "pieceId" TEXT NOT NULL,
    "totalRolls" INTEGER NOT NULL DEFAULT 0,
    "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ReceiveFromHoloMachinePieceTotal_pkey" PRIMARY KEY ("pieceId")
);

-- CreateTable
CREATE TABLE "RollType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "RollType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConeType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ConeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wrapper" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Wrapper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerTemplate" (
    "id" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "StickerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueToConingMachine" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "machineId" TEXT,
    "operatorId" TEXT,
    "barcode" TEXT NOT NULL,
    "note" TEXT,
    "shift" TEXT,
    "rollsIssued" INTEGER NOT NULL DEFAULT 0,
    "requiredPerConeNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedCones" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivedRowRefs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "IssueToConingMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromConingMachineRow" (
    "id" TEXT NOT NULL,
    "barcode" TEXT,
    "date" TEXT,
    "issueId" TEXT NOT NULL,
    "coneCount" INTEGER NOT NULL,
    "coneWeight" DOUBLE PRECISION,
    "netWeight" DOUBLE PRECISION,
    "tareWeight" DOUBLE PRECISION,
    "grossWeight" DOUBLE PRECISION,
    "boxId" TEXT,
    "machineNo" TEXT,
    "operatorId" TEXT,
    "helperId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ReceiveFromConingMachineRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromConingMachinePieceTotal" (
    "pieceId" TEXT NOT NULL,
    "totalCones" INTEGER NOT NULL DEFAULT 0,
    "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ReceiveFromConingMachinePieceTotal_pkey" PRIMARY KEY ("pieceId")
);

-- CreateTable
CREATE TABLE "IssueToCutterMachine" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "cutId" TEXT,
    "count" INTEGER NOT NULL,
    "totalWeight" DOUBLE PRECISION NOT NULL,
    "pieceIds" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "machineId" TEXT,
    "operatorId" TEXT,
    "barcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "IssueToCutterMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromCutterMachineUpload" (
    "id" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReceiveFromCutterMachineUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromCutterMachineRow" (
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
    "helperName" TEXT,
    "bobbin_quantity" INTEGER,
    "issuedBobbins" INTEGER NOT NULL DEFAULT 0,
    "issuedBobbinWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "cutId" TEXT,

    CONSTRAINT "ReceiveFromCutterMachineRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiveFromCutterMachinePieceTotal" (
    "pieceId" TEXT NOT NULL,
    "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBob" INTEGER NOT NULL DEFAULT 0,
    "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ReceiveFromCutterMachinePieceTotal_pkey" PRIMARY KEY ("pieceId")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "brandPrimary" TEXT NOT NULL,
    "brandGold" TEXT NOT NULL,
    "logoDataUrl" TEXT,
    "whatsappNumber" TEXT,
    "whatsappGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL DEFAULT 'lot_sequence',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoloIssueSequence" (
    "id" TEXT NOT NULL DEFAULT 'holo_issue_seq',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "HoloIssueSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConingIssueSequence" (
    "id" TEXT NOT NULL DEFAULT 'coning_issue_seq',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "ConingIssueSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "template" TEXT NOT NULL,
    "sendToPrimary" BOOLEAN NOT NULL DEFAULT true,
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Box" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "processType" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorUsername" TEXT,
    "actorRoleKey" TEXT,
    "payload" JSONB,
    "payloadText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Yarn_name_key" ON "Yarn"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Cut_name_key" ON "Cut"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Twist_name_key" ON "Twist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_lotNo_key" ON "Lot"("lotNo");

-- CreateIndex
CREATE UNIQUE INDEX "InboundItem_barcode_key" ON "InboundItem"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "IssueToHoloMachine_barcode_key" ON "IssueToHoloMachine"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiveFromHoloMachineRow_barcode_key" ON "ReceiveFromHoloMachineRow"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "RollType_name_key" ON "RollType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ConeType_name_key" ON "ConeType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Wrapper_name_key" ON "Wrapper"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StickerTemplate_stageKey_key" ON "StickerTemplate"("stageKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssueToConingMachine_barcode_key" ON "IssueToConingMachine"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiveFromConingMachineRow_barcode_key" ON "ReceiveFromConingMachineRow"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "IssueToCutterMachine_barcode_key" ON "IssueToCutterMachine"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiveFromCutterMachineRow_vchNo_key" ON "ReceiveFromCutterMachineRow"("vchNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_event_key" ON "WhatsappTemplate"("event");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_twistId_fkey" FOREIGN KEY ("twistId") REFERENCES "Twist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToHoloMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_rollTypeId_fkey" FOREIGN KEY ("rollTypeId") REFERENCES "RollType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToConingMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToCutterMachine" ADD CONSTRAINT "IssueToCutterMachine_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToCutterMachine" ADD CONSTRAINT "IssueToCutterMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueToCutterMachine" ADD CONSTRAINT "IssueToCutterMachine_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ReceiveFromCutterMachineUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_bobbinId_fkey" FOREIGN KEY ("bobbinId") REFERENCES "Bobbin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiveFromCutterMachineRow" ADD CONSTRAINT "ReceiveFromCutterMachineRow_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

