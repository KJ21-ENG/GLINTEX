-- Add required per-cone net weight and expected cones to coning issues
ALTER TABLE "IssueToConingMachine"
  ADD COLUMN "requiredPerConeNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "expectedCones" DOUBLE PRECISION NOT NULL DEFAULT 0;
