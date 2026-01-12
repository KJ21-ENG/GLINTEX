-- Add soft delete fields to issue tables
ALTER TABLE "IssueToCutterMachine"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "IssueToHoloMachine"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "IssueToConingMachine"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;
