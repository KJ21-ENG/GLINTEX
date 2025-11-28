-- Add cone type and wrapper masters for coning flow
CREATE TABLE "ConeType" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT UNIQUE NOT NULL,
  "weight" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE "Wrapper" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT UNIQUE NOT NULL,
  "weight" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT now()
);
