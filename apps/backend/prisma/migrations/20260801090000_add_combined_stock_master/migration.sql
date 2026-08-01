-- Combined Stock master: per-process stock views shown in the combined item-wise
-- view (enable/disable + order) plus the singleton display-mode config.

-- 1) CombinedStockProcessView -----------------------------------------------
CREATE TABLE "CombinedStockProcessView" (
  "id" TEXT NOT NULL,
  "processKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "CombinedStockProcessView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CombinedStockProcessView_processKey_key" ON "CombinedStockProcessView"("processKey");

-- 2) CombinedStockConfig (singleton) ----------------------------------------
CREATE TABLE "CombinedStockConfig" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "displayMode" TEXT NOT NULL DEFAULT 'summary',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "CombinedStockConfig_pkey" PRIMARY KEY ("id")
);

-- 3) Seed the 4 fixed stock views and the singleton config ------------------
-- Rows are never created or deleted through the API; only label/isEnabled/order
-- are editable, so seeding here is the only source of these rows.
INSERT INTO "CombinedStockProcessView" ("id", "processKey", "label", "isEnabled", "sortOrder")
VALUES
  ('csv_jumbo', 'jumbo', 'Jumbo Rolls', true, 10),
  ('csv_bobbins', 'bobbins', 'Bobbins', true, 20),
  ('csv_holo', 'holo', 'Rolls (Holo)', true, 30),
  ('csv_coning', 'coning', 'Cones (Coning)', true, 40)
ON CONFLICT DO NOTHING;

INSERT INTO "CombinedStockConfig" ("id", "displayMode")
VALUES (1, 'summary')
ON CONFLICT DO NOTHING;
