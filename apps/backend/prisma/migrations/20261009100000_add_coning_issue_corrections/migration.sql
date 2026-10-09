ALTER TABLE "IssueToConingMachine" ADD COLUMN "coningBatchRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ConingIssueCorrection" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "supplyId" TEXT,
  "revision" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "reason" TEXT,
  "requiresStickerReprint" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "ConingIssueCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConingIssueCorrection_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToConingMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConingIssueCorrection_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "ConingIssueSupply"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConingIssueCorrection_issueId_revision_key" ON "ConingIssueCorrection"("issueId", "revision");
CREATE INDEX "ConingIssueCorrection_supplyId_revision_idx" ON "ConingIssueCorrection"("supplyId", "revision");
