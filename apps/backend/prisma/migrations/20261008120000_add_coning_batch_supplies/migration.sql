ALTER TABLE "IssueToConingMachine"
  ADD COLUMN "coningBatchEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coningBatchOpen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coningBatchKey" TEXT,
  ADD COLUMN "coningBatchClosedAt" TIMESTAMP(3);

CREATE TABLE "ConingIssueSupply" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "rollsIssued" INTEGER NOT NULL,
  "issuedWeight" DOUBLE PRECISION NOT NULL,
  "receivedRowRefs" JSONB NOT NULL DEFAULT '[]',
  "specification" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "ConingIssueSupply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConingIssueSupply_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToConingMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConingIssueSupply_barcode_key" ON "ConingIssueSupply"("barcode");
CREATE INDEX "ConingIssueSupply_issueId_createdAt_id_idx" ON "ConingIssueSupply"("issueId", "createdAt", "id");
CREATE INDEX "IssueToConingMachine_coningBatchKey_coningBatchOpen_isDeleted_idx" ON "IssueToConingMachine"("coningBatchKey", "coningBatchOpen", "isDeleted");
