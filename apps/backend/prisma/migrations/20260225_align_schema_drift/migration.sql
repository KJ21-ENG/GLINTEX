-- Align legacy constraint/index names and default timestamps with current schema.
-- Designed to be idempotent for older prod databases.

-- Drop legacy index that is not defined in schema.
DROP INDEX IF EXISTS "IssueToCutterMachine_cutId_idx";

-- Rename primary key constraints (legacy -> current).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'IssueToMachine_pkey' AND t.relname = 'IssueToCutterMachine'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'IssueToCutterMachine_pkey' AND t.relname = 'IssueToCutterMachine'
  ) THEN
    EXECUTE 'ALTER TABLE "IssueToCutterMachine" RENAME CONSTRAINT "IssueToMachine_pkey" TO "IssueToCutterMachine_pkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceivePieceTotal_pkey' AND t.relname = 'ReceiveFromCutterMachinePieceTotal'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachinePieceTotal_pkey' AND t.relname = 'ReceiveFromCutterMachinePieceTotal'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachinePieceTotal" RENAME CONSTRAINT "ReceivePieceTotal_pkey" TO "ReceiveFromCutterMachinePieceTotal_pkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveRow_pkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachineRow_pkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachineRow" RENAME CONSTRAINT "ReceiveRow_pkey" TO "ReceiveFromCutterMachineRow_pkey"';
  END IF;
END $$;

-- Rename foreign key constraints on IssueToCutterMachine (legacy -> current).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'IssueToMachine_machineId_fkey' AND t.relname = 'IssueToCutterMachine'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'IssueToCutterMachine_machineId_fkey' AND t.relname = 'IssueToCutterMachine'
  ) THEN
    EXECUTE 'ALTER TABLE "IssueToCutterMachine" RENAME CONSTRAINT "IssueToMachine_machineId_fkey" TO "IssueToCutterMachine_machineId_fkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'IssueToMachine_operatorId_fkey' AND t.relname = 'IssueToCutterMachine'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'IssueToCutterMachine_operatorId_fkey' AND t.relname = 'IssueToCutterMachine'
  ) THEN
    EXECUTE 'ALTER TABLE "IssueToCutterMachine" RENAME CONSTRAINT "IssueToMachine_operatorId_fkey" TO "IssueToCutterMachine_operatorId_fkey"';
  END IF;
END $$;

-- Rename foreign key constraints on ReceiveFromCutterMachineRow (legacy -> current).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveRow_bobbinId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachineRow_bobbinId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachineRow" RENAME CONSTRAINT "ReceiveRow_bobbinId_fkey" TO "ReceiveFromCutterMachineRow_bobbinId_fkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveRow_boxId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachineRow_boxId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachineRow" RENAME CONSTRAINT "ReceiveRow_boxId_fkey" TO "ReceiveFromCutterMachineRow_boxId_fkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveRow_helperId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachineRow_helperId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachineRow" RENAME CONSTRAINT "ReceiveRow_helperId_fkey" TO "ReceiveFromCutterMachineRow_helperId_fkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveRow_operatorId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachineRow_operatorId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachineRow" RENAME CONSTRAINT "ReceiveRow_operatorId_fkey" TO "ReceiveFromCutterMachineRow_operatorId_fkey"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveRow_uploadId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'ReceiveFromCutterMachineRow_uploadId_fkey' AND t.relname = 'ReceiveFromCutterMachineRow'
  ) THEN
    EXECUTE 'ALTER TABLE "ReceiveFromCutterMachineRow" RENAME CONSTRAINT "ReceiveRow_uploadId_fkey" TO "ReceiveFromCutterMachineRow_uploadId_fkey"';
  END IF;
END $$;

-- Rename legacy indexes (if needed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IssueToMachine_barcode_key')
    AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IssueToCutterMachine_barcode_key') THEN
    EXECUTE 'ALTER INDEX "IssueToMachine_barcode_key" RENAME TO "IssueToCutterMachine_barcode_key"';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ReceiveRow_vchNo_key')
    AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ReceiveFromCutterMachineRow_vchNo_key') THEN
    EXECUTE 'ALTER INDEX "ReceiveRow_vchNo_key" RENAME TO "ReceiveFromCutterMachineRow_vchNo_key"';
  END IF;
END $$;

-- Align updatedAt defaults with schema.
ALTER TABLE "Machine" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Operator" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ReceiveFromCutterMachineUpload" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ReceiveFromCutterMachineChallan" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ReceiveFromConingMachinePieceTotal" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ReceiveFromHoloMachinePieceTotal" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Recreate receive-row foreign keys for consistent onDelete/onUpdate behavior.
ALTER TABLE "ReceiveFromHoloMachineRow" DROP CONSTRAINT IF EXISTS "ReceiveFromHoloMachineRow_helperId_fkey";
ALTER TABLE "ReceiveFromHoloMachineRow" DROP CONSTRAINT IF EXISTS "ReceiveFromHoloMachineRow_issueId_fkey";
ALTER TABLE "ReceiveFromHoloMachineRow" DROP CONSTRAINT IF EXISTS "ReceiveFromHoloMachineRow_operatorId_fkey";

ALTER TABLE "ReceiveFromConingMachineRow" DROP CONSTRAINT IF EXISTS "ReceiveFromConingMachineRow_helperId_fkey";
ALTER TABLE "ReceiveFromConingMachineRow" DROP CONSTRAINT IF EXISTS "ReceiveFromConingMachineRow_issueId_fkey";
ALTER TABLE "ReceiveFromConingMachineRow" DROP CONSTRAINT IF EXISTS "ReceiveFromConingMachineRow_operatorId_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToHoloMachine_machineId_fkey') THEN
    EXECUTE 'ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToHoloMachine_operatorId_fkey') THEN
    EXECUTE 'ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiveFromHoloMachineRow_issueId_fkey') THEN
    EXECUTE 'ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToHoloMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiveFromHoloMachineRow_operatorId_fkey') THEN
    EXECUTE 'ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiveFromHoloMachineRow_helperId_fkey') THEN
    EXECUTE 'ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToConingMachine_machineId_fkey') THEN
    EXECUTE 'ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToConingMachine_operatorId_fkey') THEN
    EXECUTE 'ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiveFromConingMachineRow_issueId_fkey') THEN
    EXECUTE 'ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToConingMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiveFromConingMachineRow_operatorId_fkey') THEN
    EXECUTE 'ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiveFromConingMachineRow_helperId_fkey') THEN
    EXECUTE 'ALTER TABLE "ReceiveFromConingMachineRow" ADD CONSTRAINT "ReceiveFromConingMachineRow_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
