-- Add permissions JSON to Role and introduce UserRole join table (multi-role support).

ALTER TABLE "Role"
ADD COLUMN IF NOT EXISTS "permissions" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "UserRole" (
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId")
);

CREATE INDEX IF NOT EXISTS "UserRole_roleId_idx" ON "UserRole"("roleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'UserRole'
      AND constraint_name = 'UserRole_userId_fkey'
  ) THEN
    ALTER TABLE "UserRole"
      ADD CONSTRAINT "UserRole_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'UserRole'
      AND constraint_name = 'UserRole_roleId_fkey'
  ) THEN
    ALTER TABLE "UserRole"
      ADD CONSTRAINT "UserRole_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "Role"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing user->role mappings.
INSERT INTO "UserRole" ("userId", "roleId")
SELECT id, "roleId" FROM "User"
ON CONFLICT DO NOTHING;

-- Default all existing roles to full access (read-write).
UPDATE "Role"
SET "permissions" = '{
  "inbound": 2,
  "issue.cutter": 2,
  "issue.holo": 2,
  "issue.coning": 2,
  "receive.cutter": 2,
  "receive.holo": 2,
  "receive.coning": 2,
  "boiler": 2,
  "dispatch": 2,
  "stock": 2,
  "reports": 2,
  "masters": 2,
  "settings": 2,
  "opening_stock": 2,
  "box_transfer": 2
}'::jsonb;

-- Drop legacy roleId column on User.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'User'
      AND constraint_name = 'User_roleId_fkey'
  ) THEN
    ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";
  END IF;
END $$;

ALTER TABLE "User" DROP COLUMN IF EXISTS "roleId";
