ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerPrintedAt" TIMESTAMP(3);
ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerPrintedCopies" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerPrintedCrates" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerPrintedRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerPrintedByUserId" TEXT;
CREATE INDEX "IssueToConingMachine_isDeleted_date_idx" ON "IssueToConingMachine"("isDeleted", "date");
