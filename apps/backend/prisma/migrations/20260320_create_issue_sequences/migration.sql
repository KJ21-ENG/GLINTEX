-- Create issue sequence tables before timestamp backfills.

CREATE TABLE IF NOT EXISTS "HoloIssueSequence" (
  "id" TEXT NOT NULL DEFAULT 'holo_issue_seq',
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "HoloIssueSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConingIssueSequence" (
  "id" TEXT NOT NULL DEFAULT 'coning_issue_seq',
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ConingIssueSequence_pkey" PRIMARY KEY ("id")
);
