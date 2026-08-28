\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() !~ '_perf_test$' THEN
    RAISE EXCEPTION 'Refusing to seed non-performance-test database: %', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM "Item" WHERE id = 'perf-item') THEN
    RAISE EXCEPTION 'Performance rehearsal fixture already exists in %', current_database();
  END IF;
END $$;

INSERT INTO "Item" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-item', 'Performance Item', now(), now());
INSERT INTO "Cut" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-cut', 'Performance Cut', now(), now());
INSERT INTO "Yarn" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-yarn', 'Performance Yarn', now(), now());
INSERT INTO "Twist" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-twist', 'Performance Twist', now(), now());
INSERT INTO "ConeType" (id, name, weight, "createdAt", "updatedAt") VALUES
  ('perf-cone-type', 'Performance Cone Type', 0.01, now(), now());
INSERT INTO "Firm" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-firm', 'Performance Firm', now(), now());
INSERT INTO "Supplier" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-supplier', 'Performance Supplier', now(), now());

INSERT INTO "Lot" (
  id, "lotNo", date, "itemId", "firmId", "supplierId", "totalPieces", "totalWeight", "createdAt", "updatedAt"
)
SELECT
  'perf-lot-id-' || n,
  CASE WHEN n <= 50 THEN 'OP-PERF-' || lpad(n::text, 4, '0') ELSE 'PERF-LOT-' || lpad(n::text, 4, '0') END,
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-item', 'perf-firm', 'perf-supplier', 1, 100,
  '2026-08-01 00:00:00+00'::timestamptz + ((n % 20) * interval '1 second'),
  '2026-08-01 00:00:00+00'::timestamptz + ((n % 20) * interval '1 second')
FROM generate_series(1, 2000) AS n;

INSERT INTO "InboundItem" (
  id, "lotNo", "itemId", weight, status, seq, barcode, "isOpeningStock",
  "dispatchedWeight", "issuedToCutterWeight", "createdAt", "updatedAt"
)
SELECT
  'PERF-PIECE-' || lpad(n::text, 5, '0'),
  CASE WHEN n <= 50 THEN 'OP-PERF-' || lpad(n::text, 4, '0') ELSE 'PERF-LOT-' || lpad(n::text, 4, '0') END,
  'perf-item', 100,
  CASE WHEN n % 97 = 0 THEN 'consumed' ELSE 'available' END,
  1,
  'PERF-IN-' || lpad(n::text, 5, '0'),
  n <= 50,
  CASE WHEN n % 89 = 0 THEN 5 ELSE 0 END,
  CASE WHEN n % 13 = 0 THEN 20 ELSE 0 END,
  '2026-08-01 00:00:00+00'::timestamptz + ((n % 20) * interval '1 second'),
  '2026-08-01 00:00:00+00'::timestamptz + ((n % 20) * interval '1 second')
FROM generate_series(1, 2000) AS n;

-- Pending Cutter issues exercise the Cutter On Machine list and summary without
-- colliding with the legacy receive rows below, which intentionally reference
-- only the original PERF-PIECE sources.
INSERT INTO "Lot" (
  id, "lotNo", date, "itemId", "firmId", "supplierId", "totalPieces", "totalWeight", "createdAt", "updatedAt"
)
SELECT
  'perf-cutter-pending-lot-id-' || lpad(n::text, 4, '0'),
  'PERF-CUT-PENDING-' || lpad(n::text, 4, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-item', 'perf-firm', 'perf-supplier', 1, 10,
  '2026-08-01 01:00:00+00'::timestamptz + ((n % 20) * interval '1 second'),
  '2026-08-01 01:00:00+00'::timestamptz + ((n % 20) * interval '1 second')
FROM generate_series(1, 200) AS n;

INSERT INTO "InboundItem" (
  id, "lotNo", "itemId", weight, status, seq, barcode,
  "dispatchedWeight", "issuedToCutterWeight", "createdAt", "updatedAt"
)
SELECT
  'PERF-CUT-PENDING-PIECE-' || lpad(n::text, 4, '0'),
  'PERF-CUT-PENDING-' || lpad(n::text, 4, '0'),
  'perf-item', 10, 'available', 1,
  'PERF-CUT-PENDING-IN-' || lpad(n::text, 4, '0'),
  0, 5,
  '2026-08-01 01:00:00+00'::timestamptz + ((n % 20) * interval '1 second'),
  '2026-08-01 01:00:00+00'::timestamptz + ((n % 20) * interval '1 second')
FROM generate_series(1, 200) AS n;

INSERT INTO "IssueToCutterMachine" (
  id, date, "itemId", "lotNo", "cutId", count, "totalWeight", "pieceIds",
  reason, barcode, "isDeleted", "createdAt", "updatedAt"
)
SELECT
  'perf-cutter-issue-' || lpad(n::text, 4, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-item',
  'PERF-CUT-PENDING-' || lpad(n::text, 4, '0'),
  'perf-cut', 1, 5,
  'PERF-CUT-PENDING-PIECE-' || lpad(n::text, 4, '0'),
  'Performance rehearsal',
  'PERF-CUT-I-' || lpad(n::text, 4, '0'),
  false,
  '2026-08-01 02:00:00+00'::timestamptz + ((n % 20) * interval '1 second'),
  '2026-08-01 02:00:00+00'::timestamptz + ((n % 20) * interval '1 second')
FROM generate_series(1, 200) AS n;

INSERT INTO "IssueToCutterMachineLine" (
  id, "issueId", "pieceId", "issuedWeight", "createdAt", "updatedAt"
)
SELECT
  'perf-cutter-issue-line-' || lpad(n::text, 4, '0'),
  'perf-cutter-issue-' || lpad(n::text, 4, '0'),
  'PERF-CUT-PENDING-PIECE-' || lpad(n::text, 4, '0'),
  5,
  '2026-08-01 02:00:00+00'::timestamptz + ((n % 20) * interval '1 second'),
  '2026-08-01 02:00:00+00'::timestamptz + ((n % 20) * interval '1 second')
FROM generate_series(1, 200) AS n;

INSERT INTO "ReceiveFromCutterMachineUpload" (id, "originalFilename", "uploadedAt", "createdAt", "updatedAt", "rowCount")
VALUES ('perf-upload', 'performance-rehearsal.csv', now(), now(), now(), 15000);

INSERT INTO "ReceiveFromCutterMachineRow" (
  id, "uploadId", "pieceId", "vchNo", date, barcode, "yarnName", "itemName", cut,
  "cutId", "bobbin_quantity", "issuedBobbins", "issuedBobbinWeight", "netWt", "totalKg",
  notes, "isDeleted", "dispatchedWeight", "dispatchedCount", "createdAt", "updatedAt"
)
SELECT
  'perf-cutter-row-' || lpad(n::text, 5, '0'),
  'perf-upload',
  'PERF-PIECE-' || lpad((((n - 1) % 2000) + 1)::text, 5, '0'),
  'PERF-VCH-' || lpad(n::text, 5, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'PERF-CR-' || lpad(n::text, 5, '0'),
  'Performance Yarn', 'Performance Item', 'Performance Cut', 'perf-cut',
  100, 0, 0, 50, 50,
  CASE WHEN n % 250 = 0 THEN 'LEGACY-PERF-' || n ELSE NULL END,
  n % 101 = 0,
  CASE WHEN n % 73 = 0 THEN 2 ELSE 0 END,
  CASE WHEN n % 73 = 0 THEN 4 ELSE 0 END,
  '2026-08-02 00:00:00+00'::timestamptz + ((n % 25) * interval '1 second'),
  '2026-08-02 00:00:00+00'::timestamptz + ((n % 25) * interval '1 second')
FROM generate_series(1, 15000) AS n;

INSERT INTO "IssueToHoloMachine" (
  id, date, "itemId", "lotNo", "yarnId", "twistId", "cutId", barcode,
  "metallicBobbins", "metallicBobbinsWeight", "receivedRowRefs", "isDeleted", "createdAt", "updatedAt"
)
SELECT
  'perf-holo-issue-' || lpad(n::text, 5, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-item',
  CASE WHEN ((n - 1) % 2000) + 1 <= 50
    THEN 'OP-PERF-' || lpad((((n - 1) % 2000) + 1)::text, 4, '0')
    ELSE 'PERF-LOT-' || lpad((((n - 1) % 2000) + 1)::text, 4, '0') END,
  'perf-yarn', 'perf-twist', 'perf-cut', 'PERF-HI-' || lpad(n::text, 5, '0'),
  50, 25,
  CASE WHEN n % 500 = 0 THEN jsonb_build_array(
    jsonb_build_object('rowId', 'perf-cutter-row-' || lpad(n::text, 5, '0'), 'issuedBobbins', 25, 'issuedBobbinWeight', 12.5),
    jsonb_build_object('rowId', 'perf-cutter-row-' || lpad(((n % 15000) + 1)::text, 5, '0'), 'issuedBobbins', 25, 'issuedBobbinWeight', 12.5)
  ) ELSE jsonb_build_array(
    jsonb_build_object('rowId', 'perf-cutter-row-' || lpad(n::text, 5, '0'), 'issuedBobbins', 50, 'issuedBobbinWeight', 25)
  ) END,
  n % 103 = 0,
  '2026-08-03 00:00:00+00'::timestamptz + ((n % 30) * interval '1 second'),
  '2026-08-03 00:00:00+00'::timestamptz + ((n % 30) * interval '1 second')
FROM generate_series(1, 15000) AS n;

-- Keep authoritative source counters consistent with the generated Holo issue refs.
-- This makes availability tests exercise genuinely consumed and partially consumed rows.
WITH consumed AS (
  SELECT elem->>'rowId' AS row_id,
         SUM((elem->>'issuedBobbins')::int) AS issued_count,
         SUM((elem->>'issuedBobbinWeight')::numeric) AS issued_weight
  FROM "IssueToHoloMachine" issue,
       jsonb_array_elements(issue."receivedRowRefs") elem
  WHERE issue.id LIKE 'perf-holo-issue-%' AND issue."isDeleted" = false
  GROUP BY elem->>'rowId'
)
UPDATE "ReceiveFromCutterMachineRow" row
SET "issuedBobbins" = consumed.issued_count,
    "issuedBobbinWeight" = consumed.issued_weight,
    "updatedAt" = now()
FROM consumed
WHERE row.id = consumed.row_id;

INSERT INTO "ReceiveFromHoloMachineRow" (
  id, date, "issueId", "pieceId", "rollCount", "rollWeight", "grossWeight", "tareWeight",
  barcode, notes, "isDeleted", "dispatchedWeight", "dispatchedCount", "createdAt", "updatedAt"
)
SELECT
  'perf-holo-row-' || lpad(n::text, 5, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-holo-issue-' || lpad(n::text, 5, '0'),
  'PERF-PIECE-' || lpad((((n - 1) % 2000) + 1)::text, 5, '0'),
  50, 25, 26, 1,
  'PERF-HR-' || lpad(n::text, 5, '0'),
  CASE WHEN n % 250 = 0 THEN 'LEGACY-HOLO-' || n ELSE NULL END,
  n % 107 = 0,
  CASE WHEN n % 79 = 0 THEN 2 ELSE 0 END,
  CASE WHEN n % 79 = 0 THEN 4 ELSE 0 END,
  '2026-08-04 00:00:00+00'::timestamptz + ((n % 35) * interval '1 second'),
  '2026-08-04 00:00:00+00'::timestamptz + ((n % 35) * interval '1 second')
FROM generate_series(1, 15000) AS n;

INSERT INTO "IssueToConingMachine" (
  id, date, "itemId", "lotNo", "yarnId", "twistId", "cutId", barcode,
  "rollsIssued", "requiredPerConeNetWeight", "expectedCones", "receivedRowRefs",
  "isDeleted", "createdAt", "updatedAt"
)
SELECT
  'perf-coning-issue-' || lpad(n::text, 4, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-item',
  CASE WHEN ((n - 1) % 2000) + 1 <= 50
    THEN 'OP-PERF-' || lpad((((n - 1) % 2000) + 1)::text, 4, '0')
    ELSE 'PERF-LOT-' || lpad((((n - 1) % 2000) + 1)::text, 4, '0') END,
  'perf-yarn', 'perf-twist', 'perf-cut', 'PERF-CI-' || lpad(n::text, 4, '0'),
  25, 10, 2500,
  jsonb_build_array(jsonb_build_object(
    'rowId', 'perf-holo-row-' || lpad(n::text, 5, '0'),
    'barcode', 'PERF-HR-' || lpad(n::text, 5, '0'),
    'issueRolls', 25, 'issueWeight', 12.5, 'coneTypeId', 'perf-cone-type'
  )),
  n % 109 = 0,
  '2026-08-05 00:00:00+00'::timestamptz + ((n % 40) * interval '1 second'),
  '2026-08-05 00:00:00+00'::timestamptz + ((n % 40) * interval '1 second')
FROM generate_series(1, 6000) AS n;

INSERT INTO "ReceiveFromConingMachineRow" (
  id, barcode, date, "issueId", "coneCount", "coneWeight", "netWeight", "grossWeight", "tareWeight",
  "sourceRowRefs", notes, "isDeleted", "dispatchedWeight", "dispatchedCount", "createdAt", "updatedAt"
)
SELECT
  'perf-coning-row-' || lpad(n::text, 5, '0'),
  'PERF-CONR-' || lpad(n::text, 5, '0'),
  '2026-08-' || lpad((((n - 1) % 27) + 1)::text, 2, '0'),
  'perf-coning-issue-' || lpad((((n - 1) % 6000) + 1)::text, 4, '0'),
  100, 6.25, 6.25, 7.25, 1,
  jsonb_build_array(jsonb_build_object(
    'rowId', 'perf-holo-row-' || lpad((((n - 1) % 15000) + 1)::text, 5, '0'),
    'weight', 6.25
  )),
  CASE WHEN n % 250 = 0 THEN 'LEGACY-CONING-' || n ELSE NULL END,
  n % 113 = 0,
  CASE WHEN n % 83 = 0 THEN 1 ELSE 0 END,
  CASE WHEN n % 83 = 0 THEN 10 ELSE 0 END,
  '2026-08-06 00:00:00+00'::timestamptz + ((n % 45) * interval '1 second'),
  '2026-08-06 00:00:00+00'::timestamptz + ((n % 45) * interval '1 second')
FROM generate_series(1, 12000) AS n;

-- Boiler lookup load, including equal steamed timestamps and barcode-based fallback.
INSERT INTO "BoilerSteamLog" (
  id, barcode, "holoReceiveRowId", "boilerNumber", "steamedAt", "createdAt", "updatedAt"
)
SELECT
  'perf-boiler-' || lpad(n::text, 4, '0'),
  'PERF-HR-' || lpad(n::text, 5, '0'),
  'perf-holo-row-' || lpad(n::text, 5, '0'),
  ((n - 1) % 4) + 1,
  '2026-08-07 00:00:00+00'::timestamptz + ((n % 10) * interval '1 second'),
  '2026-08-07 00:00:00+00'::timestamptz + ((n % 10) * interval '1 second'),
  '2026-08-07 00:00:00+00'::timestamptz + ((n % 10) * interval '1 second')
FROM generate_series(1, 1000) AS n;

-- Long display fields must not inflate the first stock page before group selection.
UPDATE "ReceiveFromHoloMachineRow"
SET notes = repeat('holo-performance-note-', 100)
WHERE id IN (SELECT 'perf-holo-row-' || lpad(n::text, 5, '0') FROM generate_series(14001, 14020) AS n);

UPDATE "ReceiveFromConingMachineRow"
SET notes = repeat('coning-performance-note-', 100)
WHERE id IN (SELECT 'perf-coning-row-' || lpad(n::text, 5, '0') FROM generate_series(11001, 11020) AS n);

-- Trace-first re-coning chain with branching to depth three. Stored child masters
-- are intentionally stale; the upstream Holo lineage remains authoritative.
INSERT INTO "Cut" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-stale-cut', 'Performance Stale Child Cut', now(), now());
INSERT INTO "Yarn" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-stale-yarn', 'Performance Stale Child Yarn', now(), now());
INSERT INTO "Twist" (id, name, "createdAt", "updatedAt") VALUES
  ('perf-stale-twist', 'Performance Stale Child Twist', now(), now());

INSERT INTO "IssueToConingMachine" (
  id, date, "itemId", "lotNo", "yarnId", "twistId", "cutId", barcode,
  "rollsIssued", "requiredPerConeNetWeight", "expectedCones", "receivedRowRefs",
  "createdAt", "updatedAt"
) VALUES
  ('perf-recon-issue-1', '2026-08-08', 'perf-item', 'PERF-LOT-0001', 'perf-stale-yarn', 'perf-stale-twist', 'perf-stale-cut', 'PERF-RECON-I-1',
    20, 10, 200, jsonb_build_array(
      jsonb_build_object('rowId', 'perf-coning-row-00001', 'stage', 'coning', 'issueRolls', 10, 'issueWeight', 1, 'coneTypeId', 'perf-cone-type'),
      jsonb_build_object('rowId', 'perf-coning-row-00002', 'stage', 'coning', 'issueRolls', 10, 'issueWeight', 1, 'coneTypeId', 'perf-cone-type')
    ), '2026-08-08 00:00:00+00', '2026-08-08 00:00:00+00'),
  ('perf-recon-issue-2', '2026-08-09', 'perf-item', 'PERF-LOT-0001', 'perf-stale-yarn', 'perf-stale-twist', 'perf-stale-cut', 'PERF-RECON-I-2',
    20, 10, 200, jsonb_build_array(
      jsonb_build_object('rowId', 'perf-recon-row-1', 'stage', 'coning', 'issueRolls', 10, 'issueWeight', 1, 'coneTypeId', 'perf-cone-type'),
      jsonb_build_object('rowId', 'perf-coning-row-00003', 'stage', 'coning', 'issueRolls', 10, 'issueWeight', 1, 'coneTypeId', 'perf-cone-type')
    ), '2026-08-09 00:00:00+00', '2026-08-09 00:00:00+00'),
  ('perf-recon-issue-3', '2026-08-10', 'perf-item', 'PERF-LOT-0001', 'perf-stale-yarn', 'perf-stale-twist', 'perf-stale-cut', 'PERF-RECON-I-3',
    10, 10, 100, jsonb_build_array(
      jsonb_build_object('rowId', 'perf-recon-row-2', 'stage', 'coning', 'issueRolls', 10, 'issueWeight', 1, 'coneTypeId', 'perf-cone-type')
    ), '2026-08-10 00:00:00+00', '2026-08-10 00:00:00+00');

INSERT INTO "ReceiveFromConingMachineRow" (
  id, barcode, date, "issueId", "coneCount", "coneWeight", "netWeight", "grossWeight", "tareWeight",
  "sourceRowRefs", notes, "createdAt", "updatedAt"
) VALUES
  ('perf-recon-row-1', 'PERF-RECON-R-1', '2026-08-08', 'perf-recon-issue-1', 10, 1.5, 1.5, 2, 0.5,
    jsonb_build_array(jsonb_build_object('rowId', 'perf-coning-row-00001', 'stage', 'coning', 'weight', 1.5)),
    'depth one', '2026-08-08 01:00:00+00', '2026-08-08 01:00:00+00'),
  ('perf-recon-row-2', 'PERF-RECON-R-2', '2026-08-09', 'perf-recon-issue-2', 10, 1.5, 1.5, 2, 0.5,
    jsonb_build_array(jsonb_build_object('rowId', 'perf-recon-row-1', 'stage', 'coning', 'weight', 1.5)),
    'depth two', '2026-08-09 01:00:00+00', '2026-08-09 01:00:00+00'),
  ('perf-recon-row-3', 'PERF-RECON-R-3', '2026-08-10', 'perf-recon-issue-3', 10, 0.75, 0.75, 1.25, 0.5,
    jsonb_build_array(jsonb_build_object('rowId', 'perf-recon-row-2', 'stage', 'coning', 'weight', 0.75)),
    repeat('depth three long note ', 80), '2026-08-10 01:00:00+00', '2026-08-10 01:00:00+00');

INSERT INTO "IssueTakeBack" (
  id, stage, "issueId", date, reason, "totalCount", "totalWeight", "isReverse", "createdAt", "updatedAt"
)
SELECT
  'perf-takeback-' || n,
  CASE WHEN n <= 50 THEN 'holo' ELSE 'coning' END,
  CASE WHEN n <= 50 THEN 'perf-holo-issue-' || lpad(n::text, 5, '0') ELSE 'perf-coning-issue-' || lpad((n - 50)::text, 4, '0') END,
  '2026-08-20', 'Performance rehearsal take-back', 1, 0.5, false, now(), now()
FROM generate_series(1, 100) AS n;

-- Include completed reversals so active take-back and signed-allocation queries
-- are rehearsed against both original and reversal records.
INSERT INTO "IssueTakeBack" (
  id, stage, "issueId", date, reason, "totalCount", "totalWeight", "isReverse", "isReversed", "createdAt", "updatedAt"
)
SELECT
  'perf-takeback-reverse-' || n,
  'holo',
  'perf-holo-issue-' || lpad(n::text, 5, '0'),
  '2026-08-21', 'Performance rehearsal reversal', 1, 0.5, true, false, now(), now()
FROM generate_series(1, 20) AS n;

INSERT INTO "IssueTakeBackLine" (
  id, "takeBackId", "sourceId", count, weight, meta, "createdAt", "updatedAt"
)
SELECT
  'perf-takeback-reverse-line-' || n,
  'perf-takeback-reverse-' || n,
  'perf-cutter-row-' || lpad(n::text, 5, '0'),
  1, 0.5, '{}'::jsonb, now(), now()
FROM generate_series(1, 20) AS n;

UPDATE "IssueTakeBack"
SET "isReversed" = true,
    "reversedById" = 'perf-takeback-reverse-' || substring(id from 'perf-takeback-(.*)'),
    "updatedAt" = now()
WHERE id ~ '^perf-takeback-([1-9]|1[0-9]|20)$';

INSERT INTO "IssueTakeBackLine" (
  id, "takeBackId", "sourceId", count, weight, meta, "createdAt", "updatedAt"
)
SELECT
  'perf-takeback-line-' || n,
  'perf-takeback-' || n,
  CASE WHEN n <= 50 THEN 'perf-cutter-row-' || lpad(n::text, 5, '0') ELSE 'perf-holo-row-' || lpad((n - 50)::text, 5, '0') END,
  1, 0.5, '{}'::jsonb, now(), now()
FROM generate_series(1, 100) AS n;

ANALYZE;

SELECT 'Lot' AS table_name, count(*) AS row_count FROM "Lot" WHERE id LIKE 'perf-%'
UNION ALL SELECT 'IssueToCutterMachine', count(*) FROM "IssueToCutterMachine" WHERE id LIKE 'perf-%'
UNION ALL SELECT 'IssueToHoloMachine', count(*) FROM "IssueToHoloMachine" WHERE id LIKE 'perf-%'
UNION ALL SELECT 'ReceiveFromHoloMachineRow', count(*) FROM "ReceiveFromHoloMachineRow" WHERE id LIKE 'perf-%'
UNION ALL SELECT 'IssueToConingMachine', count(*) FROM "IssueToConingMachine" WHERE id LIKE 'perf-%'
UNION ALL SELECT 'ReceiveFromConingMachineRow', count(*) FROM "ReceiveFromConingMachineRow" WHERE id LIKE 'perf-%'
ORDER BY table_name;
