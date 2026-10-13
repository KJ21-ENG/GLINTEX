ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerCarryPrintedFor" TEXT;
ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerCarryPrintedAt" TIMESTAMP(3);
ALTER TABLE "IssueToConingMachine" ADD COLUMN "stickerCarryPrintedCopies" INTEGER NOT NULL DEFAULT 0;
