-- Create Cut master table
CREATE TABLE "Cut" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Cut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cut_name_key" ON "Cut"("name");

-- Create Twist master table
CREATE TABLE "Twist" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Twist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Twist_name_key" ON "Twist"("name");

-- Add optional relations to existing tables
ALTER TABLE "ReceiveFromCutterMachineRow"
  ADD COLUMN "cutId" TEXT;

ALTER TABLE "IssueToHoloMachine"
  ADD COLUMN "twistId" TEXT;

ALTER TABLE "ReceiveFromCutterMachineRow"
  ADD CONSTRAINT "ReceiveFromCutterMachineRow_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IssueToHoloMachine"
  ADD CONSTRAINT "IssueToHoloMachine_twistId_fkey" FOREIGN KEY ("twistId") REFERENCES "Twist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
