-- Contractor KG Payments with side-based coning rates

-- 1) Item side classification -----------------------------------------------
CREATE TYPE "SideType" AS ENUM ('SINGLE', 'BOTH', 'UNKNOWN');

ALTER TABLE "Item"
  ADD COLUMN "side" "SideType" NOT NULL DEFAULT 'UNKNOWN';

-- Backfill Side from existing name prefixes; unmatched Items stay UNKNOWN and
-- require manual correction before they can be paid.
UPDATE "Item" SET "side" = 'SINGLE'
  WHERE "side" = 'UNKNOWN' AND UPPER(BTRIM("name")) LIKE 'S/S%';
UPDATE "Item" SET "side" = 'BOTH'
  WHERE "side" = 'UNKNOWN' AND UPPER(BTRIM("name")) LIKE 'B/S%';

-- 2) Contractor -------------------------------------------------------------
CREATE TABLE "Contractor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "paymentDetails" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Contractor_isActive_idx" ON "Contractor"("isActive");

-- 3) ContractorAssignment ---------------------------------------------------
CREATE TABLE "ContractorAssignment" (
  "id" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "process" TEXT NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "ContractorAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractorAssignment_contractorId_idx" ON "ContractorAssignment"("contractorId");
CREATE INDEX "ContractorAssignment_process_effectiveFrom_idx" ON "ContractorAssignment"("process", "effectiveFrom");

ALTER TABLE "ContractorAssignment"
  ADD CONSTRAINT "ContractorAssignment_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) ContractorRate ---------------------------------------------------------
CREATE TABLE "ContractorRate" (
  "id" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "process" TEXT NOT NULL,
  "itemId" TEXT,
  "yarnId" TEXT,
  "cutId" TEXT,
  "side" "SideType",
  "twistId" TEXT,
  "coneTypeId" TEXT,
  "ratePerKg" DECIMAL(12,4) NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "ContractorRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractorRate_contractorId_process_idx" ON "ContractorRate"("contractorId", "process");

ALTER TABLE "ContractorRate"
  ADD CONSTRAINT "ContractorRate_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) ContractorSettlement ---------------------------------------------------
CREATE TABLE "ContractorSettlement" (
  "id" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "process" TEXT NOT NULL,
  "periodFrom" TEXT NOT NULL,
  "periodTo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "productionKg" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "productionAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "adjustmentsTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "finalPayable" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "paymentDate" TEXT,
  "paymentMode" TEXT,
  "paymentReference" TEXT,
  "paymentNotes" TEXT,
  "paidAt" TIMESTAMP(3),
  "paidByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "ContractorSettlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractorSettlement_contractorId_process_idx" ON "ContractorSettlement"("contractorId", "process");
CREATE INDEX "ContractorSettlement_status_idx" ON "ContractorSettlement"("status");
CREATE INDEX "ContractorSettlement_process_periodFrom_periodTo_idx" ON "ContractorSettlement"("process", "periodFrom", "periodTo");

ALTER TABLE "ContractorSettlement"
  ADD CONSTRAINT "ContractorSettlement_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) ContractorSettlementLine ----------------------------------------------
CREATE TABLE "ContractorSettlementLine" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "process" TEXT NOT NULL,
  "sourceRowId" TEXT NOT NULL,
  "date" TEXT,
  "netKg" DECIMAL(16,3) NOT NULL,
  "ratePerKg" DECIMAL(12,4) NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "rateId" TEXT,
  "itemId" TEXT,
  "itemName" TEXT,
  "yarnId" TEXT,
  "yarnName" TEXT,
  "cutId" TEXT,
  "cutName" TEXT,
  "twistId" TEXT,
  "twistName" TEXT,
  "coneTypeId" TEXT,
  "coneTypeName" TEXT,
  "side" "SideType",
  "barcode" TEXT,
  "lotNo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorSettlementLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractorSettlementLine_process_sourceRowId_key" ON "ContractorSettlementLine"("process", "sourceRowId");
CREATE INDEX "ContractorSettlementLine_settlementId_idx" ON "ContractorSettlementLine"("settlementId");

ALTER TABLE "ContractorSettlementLine"
  ADD CONSTRAINT "ContractorSettlementLine_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "ContractorSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7) ContractorSettlementAdjustment ----------------------------------------
CREATE TABLE "ContractorSettlementAdjustment" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "ContractorSettlementAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractorSettlementAdjustment_settlementId_idx" ON "ContractorSettlementAdjustment"("settlementId");

ALTER TABLE "ContractorSettlementAdjustment"
  ADD CONSTRAINT "ContractorSettlementAdjustment_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "ContractorSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8) ContractorSettlementRevision ------------------------------------------
CREATE TABLE "ContractorSettlementRevision" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "afterSnapshot" JSONB NOT NULL,
  "previousTotal" DECIMAL(16,2) NOT NULL,
  "newTotal" DECIMAL(16,2) NOT NULL,
  "delta" DECIMAL(16,2) NOT NULL,
  "changedByUserId" TEXT,
  "changedByUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorSettlementRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractorSettlementRevision_settlementId_revisionNumber_key" ON "ContractorSettlementRevision"("settlementId", "revisionNumber");
CREATE INDEX "ContractorSettlementRevision_settlementId_idx" ON "ContractorSettlementRevision"("settlementId");

ALTER TABLE "ContractorSettlementRevision"
  ADD CONSTRAINT "ContractorSettlementRevision_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "ContractorSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
