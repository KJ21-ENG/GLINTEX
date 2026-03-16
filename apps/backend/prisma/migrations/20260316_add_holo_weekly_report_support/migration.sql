ALTER TABLE "Machine"
  ADD COLUMN IF NOT EXISTS "spindle" INTEGER;

CREATE TABLE "HoloDailyMetric" (
  "id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "baseMachine" TEXT NOT NULL,
  "hours" DOUBLE PRECISION,
  "wastage" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "HoloDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HoloDailyMetric_date_baseMachine_key"
  ON "HoloDailyMetric"("date", "baseMachine");

CREATE TABLE "HoloProductionPerHour" (
  "id" TEXT NOT NULL,
  "yarnId" TEXT NOT NULL,
  "cutId" TEXT,
  "cutMatcher" TEXT NOT NULL,
  "productionPerHourKg" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "HoloProductionPerHour_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HoloProductionPerHour_yarnId_cutMatcher_key"
  ON "HoloProductionPerHour"("yarnId", "cutMatcher");

CREATE INDEX "HoloProductionPerHour_cutId_idx"
  ON "HoloProductionPerHour"("cutId");

ALTER TABLE "HoloProductionPerHour"
  ADD CONSTRAINT "HoloProductionPerHour_yarnId_fkey"
  FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HoloProductionPerHour"
  ADD CONSTRAINT "HoloProductionPerHour_cutId_fkey"
  FOREIGN KEY ("cutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;
