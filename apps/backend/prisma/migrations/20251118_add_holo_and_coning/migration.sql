CREATE TABLE "IssueToHoloMachine" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "lotNo" TEXT NOT NULL,
  "machineId" TEXT,
  "operatorId" TEXT,
  "barcode" TEXT UNIQUE NOT NULL,
  "note" TEXT,
  "metallicBobbins" INTEGER NOT NULL DEFAULT 0,
  "yarnKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivedRowRefs" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "rollsProducedEstimate" INTEGER,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE "ReceiveFromHoloMachineRow" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT,
  "issueId" TEXT NOT NULL,
  "rollCount" INTEGER NOT NULL,
  "rollWeight" DOUBLE PRECISION,
  "machineNo" TEXT,
  "operatorId" TEXT,
  "helperId" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  FOREIGN KEY ("issueId") REFERENCES "IssueToHoloMachine" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("operatorId") REFERENCES "Operator" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("helperId") REFERENCES "Operator" ("id") ON DELETE SET NULL
);

CREATE TABLE "ReceiveFromHoloMachinePieceTotal" (
  "pieceId" TEXT PRIMARY KEY,
  "totalRolls" INTEGER NOT NULL DEFAULT 0,
  "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE "IssueToConingMachine" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "lotNo" TEXT NOT NULL,
  "machineId" TEXT,
  "operatorId" TEXT,
  "barcode" TEXT UNIQUE NOT NULL,
  "note" TEXT,
  "rollsIssued" INTEGER NOT NULL DEFAULT 0,
  "receivedRowRefs" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE "ReceiveFromConingMachineRow" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT,
  "issueId" TEXT NOT NULL,
  "coneCount" INTEGER NOT NULL,
  "coneWeight" DOUBLE PRECISION,
  "machineNo" TEXT,
  "operatorId" TEXT,
  "helperId" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  FOREIGN KEY ("issueId") REFERENCES "IssueToConingMachine" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("operatorId") REFERENCES "Operator" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("helperId") REFERENCES "Operator" ("id") ON DELETE SET NULL
);

CREATE TABLE "ReceiveFromConingMachinePieceTotal" (
  "pieceId" TEXT PRIMARY KEY,
  "totalCones" INTEGER NOT NULL DEFAULT 0,
  "totalNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "wastageNetWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);
