CREATE TABLE "ConingStickerPrint" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "copies" INTEGER NOT NULL,
  "printedFor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "ConingStickerPrint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConingStickerPrint_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueToConingMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ConingStickerPrint_issueId_createdAt_idx" ON "ConingStickerPrint"("issueId", "createdAt");
