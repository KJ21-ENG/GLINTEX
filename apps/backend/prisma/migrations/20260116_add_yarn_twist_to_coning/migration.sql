-- AlterTable: Add yarn, twist, and cut fields to IssueToConingMachine
ALTER TABLE "IssueToConingMachine" ADD COLUMN IF NOT EXISTS "yarnId" TEXT;
ALTER TABLE "IssueToConingMachine" ADD COLUMN IF NOT EXISTS "twistId" TEXT;
ALTER TABLE "IssueToConingMachine" ADD COLUMN IF NOT EXISTS "cutId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToConingMachine_yarnId_fkey') THEN
    ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToConingMachine_twistId_fkey') THEN
    ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_twistId_fkey" FOREIGN KEY ("twistId") REFERENCES "Twist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssueToConingMachine_cutId_fkey') THEN
    ALTER TABLE "IssueToConingMachine" ADD CONSTRAINT "IssueToConingMachine_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
