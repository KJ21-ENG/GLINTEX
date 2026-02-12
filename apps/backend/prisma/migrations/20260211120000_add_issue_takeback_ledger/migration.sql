-- Add cutter issued-weight ledger on inbound pieces
ALTER TABLE "InboundItem"
  ADD COLUMN "issuedToCutterWeight" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Link cutter receives to the source cutter issue (nullable for legacy rows)
ALTER TABLE "ReceiveFromCutterMachineRow"
  ADD COLUMN "issueId" TEXT;

-- Normalize cutter issue allocations at piece level
CREATE TABLE "IssueToCutterMachineLine" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "pieceId" TEXT NOT NULL,
  "issuedWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "IssueToCutterMachineLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssueToCutterMachineLine_issueId_pieceId_key" ON "IssueToCutterMachineLine"("issueId", "pieceId");
CREATE INDEX "IssueToCutterMachineLine_issueId_idx" ON "IssueToCutterMachineLine"("issueId");
CREATE INDEX "IssueToCutterMachineLine_pieceId_idx" ON "IssueToCutterMachineLine"("pieceId");

ALTER TABLE "IssueToCutterMachineLine"
  ADD CONSTRAINT "IssueToCutterMachineLine_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "IssueToCutterMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReceiveFromCutterMachineRow"
  ADD CONSTRAINT "ReceiveFromCutterMachineRow_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "IssueToCutterMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ReceiveFromCutterMachineRow_issueId_idx" ON "ReceiveFromCutterMachineRow"("issueId");

-- Append-only issue take-back ledger
CREATE TABLE "IssueTakeBack" (
  "id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "totalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isReverse" BOOLEAN NOT NULL DEFAULT false,
  "isReversed" BOOLEAN NOT NULL DEFAULT false,
  "reversedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "IssueTakeBack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssueTakeBack_reversedById_key" ON "IssueTakeBack"("reversedById");
CREATE INDEX "IssueTakeBack_stage_idx" ON "IssueTakeBack"("stage");
CREATE INDEX "IssueTakeBack_issueId_idx" ON "IssueTakeBack"("issueId");
CREATE INDEX "IssueTakeBack_stage_issueId_idx" ON "IssueTakeBack"("stage", "issueId");

ALTER TABLE "IssueTakeBack"
  ADD CONSTRAINT "IssueTakeBack_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "IssueTakeBack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IssueTakeBackLine" (
  "id" TEXT NOT NULL,
  "takeBackId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceBarcode" TEXT,
  "count" INTEGER NOT NULL DEFAULT 0,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "IssueTakeBackLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IssueTakeBackLine_takeBackId_idx" ON "IssueTakeBackLine"("takeBackId");
CREATE INDEX "IssueTakeBackLine_sourceId_idx" ON "IssueTakeBackLine"("sourceId");

ALTER TABLE "IssueTakeBackLine"
  ADD CONSTRAINT "IssueTakeBackLine_takeBackId_fkey"
  FOREIGN KEY ("takeBackId") REFERENCES "IssueTakeBack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill piece-level lines from legacy comma-separated issue pieceIds
WITH expanded AS (
  SELECT
    i."id" AS issue_id,
    trim(piece_id) AS piece_id,
    i."totalWeight" AS issue_total_weight
  FROM "IssueToCutterMachine" i,
       unnest(string_to_array(COALESCE(i."pieceIds", ''), ',')) AS piece_id
  WHERE COALESCE(trim(piece_id), '') <> ''
),
weights AS (
  SELECT
    e.issue_id,
    e.piece_id,
    e.issue_total_weight,
    COALESCE(ii."weight", 0) AS piece_weight
  FROM expanded e
  LEFT JOIN "InboundItem" ii ON ii."id" = e.piece_id
),
agg AS (
  SELECT
    issue_id,
    SUM(piece_weight) AS sum_piece_weight,
    COUNT(*) AS piece_count
  FROM weights
  GROUP BY issue_id
)
INSERT INTO "IssueToCutterMachineLine" (
  "id", "issueId", "pieceId", "issuedWeight", "createdAt", "updatedAt", "createdByUserId", "updatedByUserId"
)
SELECT
  'itcl-' || substr(md5(w.issue_id || ':' || w.piece_id), 1, 28) AS id,
  w.issue_id,
  w.piece_id,
  CASE
    WHEN COALESCE(a.sum_piece_weight, 0) > 0 THEN round((w.issue_total_weight * (w.piece_weight / a.sum_piece_weight))::numeric, 3)::double precision
    WHEN COALESCE(a.piece_count, 0) > 0 THEN round((w.issue_total_weight / a.piece_count)::numeric, 3)::double precision
    ELSE 0
  END AS issued_weight,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  NULL
FROM weights w
JOIN agg a ON a.issue_id = w.issue_id
ON CONFLICT ("issueId", "pieceId") DO NOTHING;

-- Backfill inbound issued-to-cutter weight from active issue lines
WITH active_issue_weight AS (
  SELECT
    l."pieceId" AS piece_id,
    SUM(l."issuedWeight") AS issued_weight
  FROM "IssueToCutterMachineLine" l
  JOIN "IssueToCutterMachine" i ON i."id" = l."issueId"
  WHERE i."isDeleted" = false
  GROUP BY l."pieceId"
)
UPDATE "InboundItem" ii
SET "issuedToCutterWeight" = GREATEST(0, LEAST(COALESCE(ii."weight", 0), COALESCE(aiw.issued_weight, 0)))
FROM active_issue_weight aiw
WHERE aiw.piece_id = ii."id";

-- Backfill cutter receive rows with best-effort issue linkage (closest prior issue on same piece)
UPDATE "ReceiveFromCutterMachineRow" r
SET "issueId" = (
  SELECT l."issueId"
  FROM "IssueToCutterMachineLine" l
  JOIN "IssueToCutterMachine" i ON i."id" = l."issueId"
  WHERE l."pieceId" = r."pieceId"
    AND i."isDeleted" = false
    AND i."createdAt" <= r."createdAt"
  ORDER BY i."createdAt" DESC
  LIMIT 1
)
WHERE r."issueId" IS NULL;

-- Remaining unresolved rows: fallback to latest active issue on same piece
UPDATE "ReceiveFromCutterMachineRow" r
SET "issueId" = (
  SELECT l."issueId"
  FROM "IssueToCutterMachineLine" l
  JOIN "IssueToCutterMachine" i ON i."id" = l."issueId"
  WHERE l."pieceId" = r."pieceId"
    AND i."isDeleted" = false
  ORDER BY i."createdAt" DESC
  LIMIT 1
)
WHERE r."issueId" IS NULL;
