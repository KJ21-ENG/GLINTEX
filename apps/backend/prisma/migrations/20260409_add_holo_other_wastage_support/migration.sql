CREATE TABLE "HoloOtherWastageItem" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "HoloOtherWastageItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HoloOtherWastageItem_name_key"
  ON "HoloOtherWastageItem"("name");

CREATE TABLE "HoloOtherWastageMetric" (
  "id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "otherWastageItemId" TEXT NOT NULL,
  "wastage" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "HoloOtherWastageMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HoloOtherWastageMetric_date_otherWastageItemId_key"
  ON "HoloOtherWastageMetric"("date", "otherWastageItemId");

CREATE INDEX "HoloOtherWastageMetric_otherWastageItemId_idx"
  ON "HoloOtherWastageMetric"("otherWastageItemId");

ALTER TABLE "HoloOtherWastageMetric"
  ADD CONSTRAINT "HoloOtherWastageMetric_otherWastageItemId_fkey"
  FOREIGN KEY ("otherWastageItemId") REFERENCES "HoloOtherWastageItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
