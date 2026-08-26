-- Additive data foundation for Post-Coning Packing and Dispatch V2.
-- Historical Dispatch and production tables remain intact and are not rewritten.

CREATE TYPE "PackingPackageKind" AS ENUM ('PACKET', 'BOX', 'BORI', 'PARCEL');
CREATE TYPE "PackingLaunchStatus" AS ENUM (
  'PREPARATION',
  'WRITES_GATED',
  'CUTOVER_APPLIED',
  'ACTIVE',
  'FAILED',
  'REVERSED'
);
CREATE TYPE "PackingRecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "PackingDeliveryMode" AS ENUM ('UNSPECIFIED', 'LOCAL', 'PARCEL');
CREATE TYPE "PackingBatchKind" AS ENUM ('INITIAL', 'REPACKING', 'OPENING');
CREATE TYPE "PackingBatchStatus" AS ENUM (
  'DRAFT',
  'CONFIRMED',
  'IN_PROGRESS',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'SHORT_CLOSED',
  'VOIDED'
);
CREATE TYPE "PackingBatchSourceType" AS ENUM ('CONING_RECEIVE', 'PACKED_UNIT');
CREATE TYPE "PackedUnitStatus" AS ENUM (
  'IN_PROGRESS',
  'LABEL_PENDING',
  'QUALITY_HOLD',
  'AVAILABLE',
  'RESERVED',
  'DISPATCHED',
  'RETURNED_PENDING_INSPECTION',
  'DAMAGED',
  'REPACKED',
  'SPLIT_CONSUMED',
  'OPENED',
  'VOIDED'
);
CREATE TYPE "PackedUnitEventType" AS ENUM (
  'BATCH_CONFIRMED',
  'BATCH_STARTED',
  'BATCH_TARGET_AMENDED',
  'BATCH_COMPLETED',
  'BATCH_SHORT_CLOSED',
  'BATCH_VOIDED',
  'SOURCE_RESERVED',
  'SOURCE_CONSUMED',
  'SOURCE_RELEASED',
  'UNIT_SEALED',
  'UNIT_LABEL_PENDING',
  'UNIT_LABEL_REPRINTED',
  'UNIT_BARCODE_REPLACED',
  'UNIT_QUALITY_RELEASED',
  'UNIT_RESERVED',
  'UNIT_RESERVATION_RELEASED',
  'UNIT_RESERVATION_REASSIGNED',
  'UNIT_SPLIT',
  'UNIT_RETURNED',
  'UNIT_RETURN_INSPECTED',
  'UNIT_DAMAGED',
  'UNIT_WRITTEN_OFF',
  'UNIT_REPACKED',
  'ADMINISTRATIVE_AMENDMENT',
  'EVENT_REVERSED'
);
CREATE TYPE "DispatchChallanStatus" AS ENUM (
  'ACTIVE',
  'VOIDED',
  'PARTIALLY_RETURNED',
  'RETURNED'
);
CREATE TYPE "DispatchSourceType" AS ENUM ('INBOUND', 'CUTTER', 'HOLO', 'PACKED');
CREATE TYPE "DispatchEventType" AS ENUM (
  'CHALLAN_CREATED',
  'CHALLAN_VOIDED',
  'LINE_CORRECTED',
  'LINE_RETURNED',
  'RETURN_REVERSED',
  'DISPATCH_EVENT_REVERSED'
);
CREATE TYPE "DispatchDocumentKind" AS ENUM ('ORIGINAL', 'LEGACY_RECONSTRUCTION');
CREATE TYPE "InventoryAdjustmentKind" AS ENUM (
  'LEGACY_CUTOVER',
  'MANUAL_CORRECTION',
  'DAMAGE_WRITE_OFF',
  'OPENING_BALANCE'
);
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('DRAFT', 'APPLIED', 'REVERSED', 'FAILED');

ALTER TABLE "Customer"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ReceiveFromConingMachineRow"
  ADD COLUMN "isOpeningStock" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OperationalSequence" (
  "key" TEXT NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalSequence_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "OperationalSequence_nextValue_positive_check" CHECK ("nextValue" >= 1)
);

CREATE TABLE "PackingColor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackingColor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackingColor_name_nonempty_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "PackingColor_normalizedName_lowercase_check" CHECK ("normalizedName" = lower("normalizedName"))
);

CREATE TABLE "PackingPackageType" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "kind" "PackingPackageKind" NOT NULL,
  "defaultTareKg" DECIMAL(12,3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackingPackageType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackingPackageType_name_nonempty_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "PackingPackageType_normalizedName_lowercase_check" CHECK ("normalizedName" = lower("normalizedName")),
  CONSTRAINT "PackingPackageType_defaultTareKg_nonnegative_check" CHECK ("defaultTareKg" >= 0)
);

CREATE TABLE "PackingRecipe" (
  "id" TEXT NOT NULL,
  "familyKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PackingRecipeStatus" NOT NULL DEFAULT 'DRAFT',
  "supersedesRecipeId" TEXT,
  "itemId" TEXT,
  "wrapperId" TEXT,
  "colorId" TEXT,
  "coneTypeId" TEXT,
  "customerId" TEXT,
  "nominalGram" DECIMAL(12,3),
  "deliveryMode" "PackingDeliveryMode" NOT NULL DEFAULT 'UNSPECIFIED',
  "allowPartialDispatch" BOOLEAN NOT NULL DEFAULT false,
  "requiresQualityHold" BOOLEAN NOT NULL DEFAULT false,
  "warningVariancePercent" DECIMAL(12,3) NOT NULL DEFAULT 2.000,
  "approvalVariancePercent" DECIMAL(12,3) NOT NULL DEFAULT 5.000,
  "stockUnitLevelIndex" INTEGER NOT NULL,
  "notes" TEXT,
  "sourceMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackingRecipe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackingRecipe_version_positive_check" CHECK ("version" >= 1),
  CONSTRAINT "PackingRecipe_stockUnitLevelIndex_positive_check" CHECK ("stockUnitLevelIndex" >= 1),
  CONSTRAINT "PackingRecipe_nominalGram_nonnegative_check" CHECK ("nominalGram" IS NULL OR "nominalGram" >= 0),
  CONSTRAINT "PackingRecipe_variance_check" CHECK ("warningVariancePercent" >= 0 AND "approvalVariancePercent" >= "warningVariancePercent"),
  CONSTRAINT "PackingRecipe_active_fields_check" CHECK (
    "status" <> 'ACTIVE'
    OR (
      "itemId" IS NOT NULL
      AND "wrapperId" IS NOT NULL
      AND "colorId" IS NOT NULL
      AND "coneTypeId" IS NOT NULL
      AND "nominalGram" IS NOT NULL
      AND "stockUnitLevelIndex" >= 1
    )
  )
);

CREATE TABLE "PackingRecipeLevel" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "levelIndex" INTEGER NOT NULL,
  "packageTypeId" TEXT NOT NULL,
  "childUnitsPerContainer" INTEGER NOT NULL,
  "barcodeEnabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "PackingRecipeLevel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackingRecipeLevel_levelIndex_positive_check" CHECK ("levelIndex" >= 1),
  CONSTRAINT "PackingRecipeLevel_childUnits_positive_check" CHECK ("childUnitsPerContainer" > 0)
);

CREATE TABLE "PackingBatch" (
  "id" TEXT NOT NULL,
  "batchNo" TEXT NOT NULL,
  "kind" "PackingBatchKind" NOT NULL,
  "status" "PackingBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "recipeId" TEXT NOT NULL,
  "recipeSnapshot" JSONB NOT NULL,
  "customerId" TEXT,
  "deliveryMode" "PackingDeliveryMode" NOT NULL DEFAULT 'UNSPECIFIED',
  "plannedBaseCount" INTEGER NOT NULL,
  "plannedNetWeightKg" DECIMAL(16,3) NOT NULL,
  "targetAmendmentReason" TEXT,
  "shortCloseReason" TEXT,
  "voidReason" TEXT,
  "notes" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "shortClosedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackingBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackingBatch_plannedBaseCount_nonnegative_check" CHECK ("plannedBaseCount" >= 0),
  CONSTRAINT "PackingBatch_plannedNetWeightKg_nonnegative_check" CHECK ("plannedNetWeightKg" >= 0),
  CONSTRAINT "PackingBatch_version_positive_check" CHECK ("version" >= 1)
);

CREATE TABLE "PackingBatchSource" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceType" "PackingBatchSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceBarcode" TEXT,
  "sourceItemSnapshot" JSONB NOT NULL DEFAULT '{}',
  "sourceLotSnapshot" JSONB NOT NULL DEFAULT '{}',
  "sourceRecipeSnapshot" JSONB NOT NULL DEFAULT '{}',
  "sourceCustomerSnapshot" JSONB NOT NULL DEFAULT '{}',
  "reservedBaseCount" INTEGER NOT NULL,
  "reservedNetWeightKg" DECIMAL(16,3) NOT NULL,
  "consumedBaseCount" INTEGER NOT NULL DEFAULT 0,
  "consumedNetWeightKg" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "releasedBaseCount" INTEGER NOT NULL DEFAULT 0,
  "releasedNetWeightKg" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackingBatchSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackingBatchSource_reservedBaseCount_nonnegative_check" CHECK ("reservedBaseCount" >= 0),
  CONSTRAINT "PackingBatchSource_reservedNetWeightKg_nonnegative_check" CHECK ("reservedNetWeightKg" >= 0),
  CONSTRAINT "PackingBatchSource_consumedBaseCount_nonnegative_check" CHECK ("consumedBaseCount" >= 0),
  CONSTRAINT "PackingBatchSource_consumedNetWeightKg_nonnegative_check" CHECK ("consumedNetWeightKg" >= 0),
  CONSTRAINT "PackingBatchSource_releasedBaseCount_nonnegative_check" CHECK ("releasedBaseCount" >= 0),
  CONSTRAINT "PackingBatchSource_releasedNetWeightKg_nonnegative_check" CHECK ("releasedNetWeightKg" >= 0),
  CONSTRAINT "PackingBatchSource_baseCount_conservation_check" CHECK ("consumedBaseCount" + "releasedBaseCount" <= "reservedBaseCount"),
  CONSTRAINT "PackingBatchSource_weight_conservation_check" CHECK ("consumedNetWeightKg" + "releasedNetWeightKg" <= "reservedNetWeightKg")
);

CREATE TABLE "PackedUnit" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "packageTypeId" TEXT NOT NULL,
  "parentUnitId" TEXT,
  "levelIndex" INTEGER NOT NULL,
  "unitSequence" INTEGER NOT NULL,
  "barcode" TEXT,
  "isStockUnit" BOOLEAN NOT NULL,
  "status" "PackedUnitStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "itemId" TEXT NOT NULL,
  "wrapperId" TEXT NOT NULL,
  "colorId" TEXT NOT NULL,
  "coneTypeId" TEXT NOT NULL,
  "customerId" TEXT,
  "nominalGram" DECIMAL(12,3) NOT NULL,
  "baseCount" INTEGER NOT NULL,
  "grossWeightKg" DECIMAL(16,3) NOT NULL,
  "tareWeightKg" DECIMAL(16,3) NOT NULL,
  "netWeightKg" DECIMAL(16,3) NOT NULL,
  "labelPrintCount" INTEGER NOT NULL DEFAULT 0,
  "sealedAt" TIMESTAMP(3),
  "qualityReleasedAt" TIMESTAMP(3),
  "splitFromUnitId" TEXT,
  "replacedByUnitId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackedUnit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackedUnit_levelIndex_positive_check" CHECK ("levelIndex" >= 1),
  CONSTRAINT "PackedUnit_unitSequence_positive_check" CHECK ("unitSequence" >= 1),
  CONSTRAINT "PackedUnit_nominalGram_nonnegative_check" CHECK ("nominalGram" >= 0),
  CONSTRAINT "PackedUnit_baseCount_nonnegative_check" CHECK ("baseCount" >= 0),
  CONSTRAINT "PackedUnit_grossWeightKg_nonnegative_check" CHECK ("grossWeightKg" >= 0),
  CONSTRAINT "PackedUnit_tareWeightKg_nonnegative_check" CHECK ("tareWeightKg" >= 0),
  CONSTRAINT "PackedUnit_netWeightKg_nonnegative_check" CHECK ("netWeightKg" >= 0),
  CONSTRAINT "PackedUnit_labelPrintCount_nonnegative_check" CHECK ("labelPrintCount" >= 0),
  CONSTRAINT "PackedUnit_version_positive_check" CHECK ("version" >= 1)
);

CREATE TABLE "PackedUnitEvent" (
  "id" TEXT NOT NULL,
  "batchId" TEXT,
  "unitId" TEXT,
  "type" "PackedUnitEventType" NOT NULL,
  "reason" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "reversalOfEventId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackedUnitEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackedUnitEvent_reason_check" CHECK (
    "type" NOT IN (
      'BATCH_TARGET_AMENDED',
      'BATCH_SHORT_CLOSED',
      'BATCH_VOIDED',
      'SOURCE_RELEASED',
      'UNIT_LABEL_REPRINTED',
      'UNIT_BARCODE_REPLACED',
      'UNIT_RESERVATION_RELEASED',
      'UNIT_RESERVATION_REASSIGNED',
      'UNIT_SPLIT',
      'UNIT_RETURNED',
      'UNIT_RETURN_INSPECTED',
      'UNIT_DAMAGED',
      'UNIT_WRITTEN_OFF',
      'UNIT_REPACKED',
      'ADMINISTRATIVE_AMENDMENT',
      'EVENT_REVERSED'
    )
    OR NULLIF(btrim("reason"), '') IS NOT NULL
  )
);

CREATE TABLE "DispatchChallan" (
  "id" TEXT NOT NULL,
  "challanNo" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "DispatchChallanStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "companySnapshot" JSONB NOT NULL,
  "customerSnapshot" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "isLegacyReconstruction" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "DispatchChallan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchChallan_version_positive_check" CHECK ("version" >= 1)
);

CREATE TABLE "DispatchLine" (
  "id" TEXT NOT NULL,
  "challanId" TEXT NOT NULL,
  "sourceType" "DispatchSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceBarcode" TEXT,
  "sourceDisplaySnapshot" JSONB NOT NULL DEFAULT '{}',
  "baseCount" INTEGER,
  "netWeightKg" DECIMAL(16,3) NOT NULL,
  "parentPackedUnitId" TEXT,
  "legacyDispatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "DispatchLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchLine_baseCount_nonnegative_check" CHECK ("baseCount" IS NULL OR "baseCount" >= 0),
  CONSTRAINT "DispatchLine_baseCount_legacy_check" CHECK ("baseCount" IS NOT NULL OR "legacyDispatchId" IS NOT NULL),
  CONSTRAINT "DispatchLine_netWeightKg_nonnegative_check" CHECK ("netWeightKg" >= 0)
);

CREATE TABLE "DispatchEvent" (
  "id" TEXT NOT NULL,
  "challanId" TEXT,
  "lineId" TEXT,
  "type" "DispatchEventType" NOT NULL,
  "reason" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "reversalOfEventId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchEvent_reason_check" CHECK (
    "type" NOT IN ('CHALLAN_VOIDED', 'LINE_CORRECTED', 'LINE_RETURNED', 'RETURN_REVERSED', 'DISPATCH_EVENT_REVERSED')
    OR NULLIF(btrim("reason"), '') IS NOT NULL
  )
);

CREATE TABLE "DispatchDocument" (
  "id" TEXT NOT NULL,
  "challanId" TEXT NOT NULL,
  "kind" "DispatchDocumentKind" NOT NULL,
  "renderingSnapshot" JSONB NOT NULL,
  "pdfBytes" BYTEA,
  "sha256Hash" TEXT,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryAdjustmentBatch" (
  "id" TEXT NOT NULL,
  "batchNo" TEXT NOT NULL,
  "kind" "InventoryAdjustmentKind" NOT NULL,
  "status" "InventoryAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "appliedByUserId" TEXT,
  "reversedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "InventoryAdjustmentBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryAdjustmentLine" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "countDelta" INTEGER NOT NULL,
  "weightDeltaKg" DECIMAL(16,3) NOT NULL,
  "sourceBarcode" TEXT,
  "sourceItemSnapshot" JSONB NOT NULL DEFAULT '{}',
  "sourceLotSnapshot" JSONB NOT NULL DEFAULT '{}',
  "sourceConeSnapshot" JSONB NOT NULL DEFAULT '{}',
  "replacementSourceId" TEXT,
  "replacementUnitId" TEXT,
  "reversalOfLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "InventoryAdjustmentLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackingLaunchState" (
  "id" TEXT NOT NULL DEFAULT 'packing_dispatch_v2',
  "status" "PackingLaunchStatus" NOT NULL DEFAULT 'PREPARATION',
  "affectedWritesPaused" BOOLEAN NOT NULL DEFAULT false,
  "cutoffAt" TIMESTAMP(3),
  "adjustmentBatchId" TEXT,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" TEXT,
  CONSTRAINT "PackingLaunchState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_isActive_idx" ON "Customer"("isActive");
CREATE UNIQUE INDEX "PackingColor_normalizedName_key" ON "PackingColor"("normalizedName");
CREATE INDEX "PackingColor_isActive_name_idx" ON "PackingColor"("isActive", "name");
CREATE UNIQUE INDEX "PackingPackageType_normalizedName_key" ON "PackingPackageType"("normalizedName");
CREATE INDEX "PackingPackageType_kind_isActive_idx" ON "PackingPackageType"("kind", "isActive");
CREATE INDEX "PackingPackageType_isActive_name_idx" ON "PackingPackageType"("isActive", "name");
CREATE UNIQUE INDEX "PackingRecipe_familyKey_version_key" ON "PackingRecipe"("familyKey", "version");
CREATE UNIQUE INDEX "PackingRecipe_one_active_per_family_key" ON "PackingRecipe"("familyKey") WHERE "status" = 'ACTIVE'::"PackingRecipeStatus";
CREATE INDEX "PackingRecipe_familyKey_status_idx" ON "PackingRecipe"("familyKey", "status");
CREATE INDEX "PackingRecipe_status_updatedAt_idx" ON "PackingRecipe"("status", "updatedAt");
CREATE INDEX "PackingRecipe_itemId_wrapperId_colorId_coneTypeId_idx" ON "PackingRecipe"("itemId", "wrapperId", "colorId", "coneTypeId");
CREATE INDEX "PackingRecipe_customerId_status_idx" ON "PackingRecipe"("customerId", "status");
CREATE INDEX "PackingRecipe_supersedesRecipeId_idx" ON "PackingRecipe"("supersedesRecipeId");
CREATE UNIQUE INDEX "PackingRecipeLevel_recipeId_levelIndex_key" ON "PackingRecipeLevel"("recipeId", "levelIndex");
CREATE INDEX "PackingRecipeLevel_packageTypeId_idx" ON "PackingRecipeLevel"("packageTypeId");
CREATE UNIQUE INDEX "PackingBatch_batchNo_key" ON "PackingBatch"("batchNo");
CREATE INDEX "PackingBatch_status_createdAt_idx" ON "PackingBatch"("status", "createdAt");
CREATE INDEX "PackingBatch_recipeId_status_idx" ON "PackingBatch"("recipeId", "status");
CREATE INDEX "PackingBatch_customerId_status_idx" ON "PackingBatch"("customerId", "status");
CREATE INDEX "PackingBatch_kind_status_idx" ON "PackingBatch"("kind", "status");
CREATE INDEX "PackingBatchSource_batchId_idx" ON "PackingBatchSource"("batchId");
CREATE INDEX "PackingBatchSource_sourceType_sourceId_idx" ON "PackingBatchSource"("sourceType", "sourceId");
CREATE INDEX "PackingBatchSource_sourceBarcode_idx" ON "PackingBatchSource"("sourceBarcode");
CREATE UNIQUE INDEX "PackedUnit_barcode_key" ON "PackedUnit"("barcode");
CREATE UNIQUE INDEX "PackedUnit_batchId_levelIndex_unitSequence_key" ON "PackedUnit"("batchId", "levelIndex", "unitSequence");
CREATE INDEX "PackedUnit_batchId_levelIndex_idx" ON "PackedUnit"("batchId", "levelIndex");
CREATE INDEX "PackedUnit_parentUnitId_idx" ON "PackedUnit"("parentUnitId");
CREATE INDEX "PackedUnit_status_isStockUnit_idx" ON "PackedUnit"("status", "isStockUnit");
CREATE INDEX "PackedUnit_customerId_status_idx" ON "PackedUnit"("customerId", "status");
CREATE INDEX "PackedUnit_itemId_status_idx" ON "PackedUnit"("itemId", "status");
CREATE INDEX "PackedUnit_recipeId_status_idx" ON "PackedUnit"("recipeId", "status");
CREATE INDEX "PackedUnit_splitFromUnitId_idx" ON "PackedUnit"("splitFromUnitId");
CREATE INDEX "PackedUnit_replacedByUnitId_idx" ON "PackedUnit"("replacedByUnitId");
CREATE INDEX "PackedUnit_createdAt_idx" ON "PackedUnit"("createdAt");
CREATE UNIQUE INDEX "PackedUnitEvent_reversalOfEventId_key" ON "PackedUnitEvent"("reversalOfEventId");
CREATE UNIQUE INDEX "PackedUnitEvent_idempotencyKey_key" ON "PackedUnitEvent"("idempotencyKey");
CREATE INDEX "PackedUnitEvent_batchId_createdAt_idx" ON "PackedUnitEvent"("batchId", "createdAt");
CREATE INDEX "PackedUnitEvent_unitId_createdAt_idx" ON "PackedUnitEvent"("unitId", "createdAt");
CREATE INDEX "PackedUnitEvent_type_createdAt_idx" ON "PackedUnitEvent"("type", "createdAt");
CREATE UNIQUE INDEX "DispatchChallan_challanNo_key" ON "DispatchChallan"("challanNo");
CREATE UNIQUE INDEX "DispatchChallan_idempotencyKey_key" ON "DispatchChallan"("idempotencyKey");
CREATE INDEX "DispatchChallan_businessDate_idx" ON "DispatchChallan"("businessDate");
CREATE INDEX "DispatchChallan_customerId_status_businessDate_idx" ON "DispatchChallan"("customerId", "status", "businessDate");
CREATE INDEX "DispatchChallan_status_createdAt_idx" ON "DispatchChallan"("status", "createdAt");
CREATE INDEX "DispatchLine_challanId_idx" ON "DispatchLine"("challanId");
CREATE INDEX "DispatchLine_sourceType_sourceId_idx" ON "DispatchLine"("sourceType", "sourceId");
CREATE INDEX "DispatchLine_sourceBarcode_idx" ON "DispatchLine"("sourceBarcode");
CREATE INDEX "DispatchLine_parentPackedUnitId_idx" ON "DispatchLine"("parentPackedUnitId");
CREATE UNIQUE INDEX "DispatchLine_legacyDispatchId_key" ON "DispatchLine"("legacyDispatchId");
CREATE INDEX "DispatchLine_createdAt_idx" ON "DispatchLine"("createdAt");
CREATE UNIQUE INDEX "DispatchEvent_reversalOfEventId_key" ON "DispatchEvent"("reversalOfEventId");
CREATE UNIQUE INDEX "DispatchEvent_idempotencyKey_key" ON "DispatchEvent"("idempotencyKey");
CREATE INDEX "DispatchEvent_challanId_createdAt_idx" ON "DispatchEvent"("challanId", "createdAt");
CREATE INDEX "DispatchEvent_lineId_createdAt_idx" ON "DispatchEvent"("lineId", "createdAt");
CREATE INDEX "DispatchEvent_type_createdAt_idx" ON "DispatchEvent"("type", "createdAt");
CREATE UNIQUE INDEX "DispatchDocument_challanId_key" ON "DispatchDocument"("challanId");
CREATE UNIQUE INDEX "InventoryAdjustmentBatch_batchNo_key" ON "InventoryAdjustmentBatch"("batchNo");
CREATE UNIQUE INDEX "InventoryAdjustmentBatch_idempotencyKey_key" ON "InventoryAdjustmentBatch"("idempotencyKey");
CREATE INDEX "InventoryAdjustmentBatch_status_effectiveAt_idx" ON "InventoryAdjustmentBatch"("status", "effectiveAt");
CREATE INDEX "InventoryAdjustmentBatch_kind_status_idx" ON "InventoryAdjustmentBatch"("kind", "status");
CREATE INDEX "InventoryAdjustmentBatch_createdAt_idx" ON "InventoryAdjustmentBatch"("createdAt");
CREATE INDEX "InventoryAdjustmentLine_batchId_idx" ON "InventoryAdjustmentLine"("batchId");
CREATE INDEX "InventoryAdjustmentLine_sourceType_sourceId_idx" ON "InventoryAdjustmentLine"("sourceType", "sourceId");
CREATE INDEX "InventoryAdjustmentLine_sourceBarcode_idx" ON "InventoryAdjustmentLine"("sourceBarcode");
CREATE INDEX "InventoryAdjustmentLine_replacementSourceId_idx" ON "InventoryAdjustmentLine"("replacementSourceId");
CREATE INDEX "InventoryAdjustmentLine_replacementUnitId_idx" ON "InventoryAdjustmentLine"("replacementUnitId");
CREATE UNIQUE INDEX "InventoryAdjustmentLine_reversalOfLineId_key" ON "InventoryAdjustmentLine"("reversalOfLineId");
CREATE UNIQUE INDEX "PackingLaunchState_adjustmentBatchId_key" ON "PackingLaunchState"("adjustmentBatchId");

ALTER TABLE "PackingRecipe"
  ADD CONSTRAINT "PackingRecipe_supersedesRecipeId_fkey"
  FOREIGN KEY ("supersedesRecipeId") REFERENCES "PackingRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PackingRecipe"
  ADD CONSTRAINT "PackingRecipe_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingRecipe"
  ADD CONSTRAINT "PackingRecipe_wrapperId_fkey"
  FOREIGN KEY ("wrapperId") REFERENCES "Wrapper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingRecipe"
  ADD CONSTRAINT "PackingRecipe_colorId_fkey"
  FOREIGN KEY ("colorId") REFERENCES "PackingColor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingRecipe"
  ADD CONSTRAINT "PackingRecipe_coneTypeId_fkey"
  FOREIGN KEY ("coneTypeId") REFERENCES "ConeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingRecipe"
  ADD CONSTRAINT "PackingRecipe_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackingRecipeLevel"
  ADD CONSTRAINT "PackingRecipeLevel_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "PackingRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingRecipeLevel"
  ADD CONSTRAINT "PackingRecipeLevel_packageTypeId_fkey"
  FOREIGN KEY ("packageTypeId") REFERENCES "PackingPackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackingBatch"
  ADD CONSTRAINT "PackingBatch_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "PackingRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackingBatch"
  ADD CONSTRAINT "PackingBatch_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackingBatchSource"
  ADD CONSTRAINT "PackingBatchSource_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PackingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PackingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "PackingRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_packageTypeId_fkey"
  FOREIGN KEY ("packageTypeId") REFERENCES "PackingPackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_parentUnitId_fkey"
  FOREIGN KEY ("parentUnitId") REFERENCES "PackedUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_wrapperId_fkey"
  FOREIGN KEY ("wrapperId") REFERENCES "Wrapper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_colorId_fkey"
  FOREIGN KEY ("colorId") REFERENCES "PackingColor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_coneTypeId_fkey"
  FOREIGN KEY ("coneTypeId") REFERENCES "ConeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_splitFromUnitId_fkey"
  FOREIGN KEY ("splitFromUnitId") REFERENCES "PackedUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnit"
  ADD CONSTRAINT "PackedUnit_replacedByUnitId_fkey"
  FOREIGN KEY ("replacedByUnitId") REFERENCES "PackedUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackedUnitEvent"
  ADD CONSTRAINT "PackedUnitEvent_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PackingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnitEvent"
  ADD CONSTRAINT "PackedUnitEvent_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "PackedUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedUnitEvent"
  ADD CONSTRAINT "PackedUnitEvent_reversalOfEventId_fkey"
  FOREIGN KEY ("reversalOfEventId") REFERENCES "PackedUnitEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchChallan"
  ADD CONSTRAINT "DispatchChallan_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchLine"
  ADD CONSTRAINT "DispatchLine_challanId_fkey"
  FOREIGN KEY ("challanId") REFERENCES "DispatchChallan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchLine"
  ADD CONSTRAINT "DispatchLine_parentPackedUnitId_fkey"
  FOREIGN KEY ("parentPackedUnitId") REFERENCES "PackedUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchLine"
  ADD CONSTRAINT "DispatchLine_legacyDispatchId_fkey"
  FOREIGN KEY ("legacyDispatchId") REFERENCES "Dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchEvent"
  ADD CONSTRAINT "DispatchEvent_challanId_fkey"
  FOREIGN KEY ("challanId") REFERENCES "DispatchChallan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchEvent"
  ADD CONSTRAINT "DispatchEvent_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "DispatchLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchEvent"
  ADD CONSTRAINT "DispatchEvent_reversalOfEventId_fkey"
  FOREIGN KEY ("reversalOfEventId") REFERENCES "DispatchEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DispatchDocument"
  ADD CONSTRAINT "DispatchDocument_challanId_fkey"
  FOREIGN KEY ("challanId") REFERENCES "DispatchChallan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryAdjustmentLine"
  ADD CONSTRAINT "InventoryAdjustmentLine_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "InventoryAdjustmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentLine"
  ADD CONSTRAINT "InventoryAdjustmentLine_reversalOfLineId_fkey"
  FOREIGN KEY ("reversalOfLineId") REFERENCES "InventoryAdjustmentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PackingLaunchState"
  ADD CONSTRAINT "PackingLaunchState_adjustmentBatchId_fkey"
  FOREIGN KEY ("adjustmentBatchId") REFERENCES "InventoryAdjustmentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
