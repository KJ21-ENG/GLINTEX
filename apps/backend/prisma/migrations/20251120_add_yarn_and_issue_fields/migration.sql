CREATE TABLE "Yarn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Yarn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Yarn_name_key" ON "Yarn"("name");

ALTER TABLE "IssueToHoloMachine"
    ADD COLUMN "yarnId" TEXT,
    ADD COLUMN "metallicBobbinsWeight" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "IssueToHoloMachine"
    ADD CONSTRAINT "IssueToHoloMachine_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceiveFromCutterMachineRow"
    ADD COLUMN "issuedBobbinWeight" DOUBLE PRECISION NOT NULL DEFAULT 0;
