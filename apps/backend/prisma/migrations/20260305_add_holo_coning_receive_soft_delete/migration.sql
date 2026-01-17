-- Add soft delete + pieceId tracking for receive rows
ALTER TABLE "ReceiveFromHoloMachineRow"
  ADD COLUMN "pieceId" TEXT,
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP,
  ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "ReceiveFromConingMachineRow"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP,
  ADD COLUMN "deletedByUserId" TEXT;

-- Backfill pieceId for holo receive rows when unambiguous
WITH issue_piece_map AS (
  SELECT
    i.id AS issue_id,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT c."pieceId"), NULL) AS piece_ids
  FROM "IssueToHoloMachine" i
  LEFT JOIN LATERAL jsonb_array_elements(i."receivedRowRefs") AS ref ON true
  LEFT JOIN "ReceiveFromCutterMachineRow" c ON c.id = ref->>'rowId'
  GROUP BY i.id
),
issue_single_piece AS (
  SELECT issue_id, piece_ids[1] AS piece_id
  FROM issue_piece_map
  WHERE COALESCE(array_length(piece_ids, 1), 0) = 1
)
UPDATE "ReceiveFromHoloMachineRow" h
SET "pieceId" = isp.piece_id
FROM issue_single_piece isp
WHERE h."issueId" = isp.issue_id
  AND h."pieceId" IS NULL;

-- Fallback: if issue has no mapped pieces but lot has a single inbound piece
WITH issue_piece_map AS (
  SELECT
    i.id AS issue_id,
    i."lotNo" AS lot_no,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT c."pieceId"), NULL) AS piece_ids
  FROM "IssueToHoloMachine" i
  LEFT JOIN LATERAL jsonb_array_elements(i."receivedRowRefs") AS ref ON true
  LEFT JOIN "ReceiveFromCutterMachineRow" c ON c.id = ref->>'rowId'
  GROUP BY i.id
),
issues_without_piece AS (
  SELECT issue_id, lot_no
  FROM issue_piece_map
  WHERE COALESCE(array_length(piece_ids, 1), 0) = 0
),
lot_single_piece AS (
  SELECT "lotNo" AS lot_no, MIN(id) AS piece_id
  FROM "InboundItem"
  GROUP BY "lotNo"
  HAVING COUNT(*) = 1
)
UPDATE "ReceiveFromHoloMachineRow" h
SET "pieceId" = lsp.piece_id
FROM issues_without_piece i
JOIN lot_single_piece lsp ON lsp.lot_no = i.lot_no
WHERE h."issueId" = i.issue_id
  AND h."pieceId" IS NULL;
