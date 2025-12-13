-- Add cut selection to cutter issue rows
ALTER TABLE "IssueToCutterMachine" ADD COLUMN "cutId" TEXT;

-- Foreign key to Cut master (optional, set null on delete)
ALTER TABLE "IssueToCutterMachine"
  ADD CONSTRAINT "IssueToCutterMachine_cutId_fkey"
  FOREIGN KEY ("cutId") REFERENCES "Cut"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "IssueToCutterMachine_cutId_idx" ON "IssueToCutterMachine"("cutId");

