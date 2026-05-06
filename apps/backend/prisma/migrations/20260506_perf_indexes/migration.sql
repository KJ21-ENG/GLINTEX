-- Performance indexes for issue/receive read paths
-- See plans/wants-you-to-fix-stateless-nova.md (Phase A)

-- Composite indexes for filtered FK lookups in receive-row aggregations.
CREATE INDEX IF NOT EXISTS "IssueToHoloMachine_isDeleted_createdAt_idx"
    ON "IssueToHoloMachine" ("isDeleted", "createdAt");

CREATE INDEX IF NOT EXISTS "IssueToConingMachine_isDeleted_createdAt_idx"
    ON "IssueToConingMachine" ("isDeleted", "createdAt");

CREATE INDEX IF NOT EXISTS "ReceiveFromHoloMachineRow_issueId_isDeleted_idx"
    ON "ReceiveFromHoloMachineRow" ("issueId", "isDeleted");

CREATE INDEX IF NOT EXISTS "ReceiveFromConingMachineRow_issueId_isDeleted_idx"
    ON "ReceiveFromConingMachineRow" ("issueId", "isDeleted");

CREATE INDEX IF NOT EXISTS "ReceiveFromCutterMachineRow_issueId_isDeleted_idx"
    ON "ReceiveFromCutterMachineRow" ("issueId", "isDeleted");

CREATE INDEX IF NOT EXISTS "ReceiveFromCutterMachineRow_pieceId_isDeleted_idx"
    ON "ReceiveFromCutterMachineRow" ("pieceId", "isDeleted");

CREATE INDEX IF NOT EXISTS "ReceiveFromCutterMachineChallan_pieceId_isDeleted_idx"
    ON "ReceiveFromCutterMachineChallan" ("pieceId", "isDeleted");

-- GIN indexes on receivedRowRefs jsonb. The v2 stock CTEs do
--   LATERAL jsonb_array_elements(receivedRowRefs) AS elem
-- and reference elem->>'rowId'. Without an index, every call scans every issue.
CREATE INDEX IF NOT EXISTS "IssueToHoloMachine_receivedRowRefs_gin_idx"
    ON "IssueToHoloMachine" USING GIN ("receivedRowRefs" jsonb_path_ops);

CREATE INDEX IF NOT EXISTS "IssueToConingMachine_receivedRowRefs_gin_idx"
    ON "IssueToConingMachine" USING GIN ("receivedRowRefs" jsonb_path_ops);

-- ANALYZE so the planner picks up the new indexes immediately.
ANALYZE "IssueToHoloMachine";
ANALYZE "IssueToConingMachine";
ANALYZE "ReceiveFromHoloMachineRow";
ANALYZE "ReceiveFromConingMachineRow";
ANALYZE "ReceiveFromCutterMachineRow";
ANALYZE "ReceiveFromCutterMachineChallan";
