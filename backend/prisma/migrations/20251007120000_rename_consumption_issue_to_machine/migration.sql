-- Rename Consumption table to IssueToMachine to align with new terminology
ALTER TABLE "Consumption" RENAME TO "IssueToMachine";

-- Rename primary key and foreign key constraints if they still use the old table name
DO $$
BEGIN
  ALTER TABLE "IssueToMachine" RENAME CONSTRAINT "Consumption_pkey" TO "IssueToMachine_pkey";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "IssueToMachine" RENAME CONSTRAINT "Consumption_machineId_fkey" TO "IssueToMachine_machineId_fkey";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "IssueToMachine" RENAME CONSTRAINT "Consumption_operatorId_fkey" TO "IssueToMachine_operatorId_fkey";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Update whatsapp template events to match the renamed concept
UPDATE "WhatsappTemplate"
SET event = 'issue_to_machine_created'
WHERE event = 'consumption_created';

UPDATE "WhatsappTemplate"
SET event = 'issue_to_machine_deleted'
WHERE event = 'consumption_deleted';
