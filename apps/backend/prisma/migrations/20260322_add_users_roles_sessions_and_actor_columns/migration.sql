-- Add app authentication (users/roles/sessions) and user attribution columns.
-- This migration is additive-only: it creates new tables and adds nullable columns.

-- ===== Actor columns on existing tables =====

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Yarn" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Yarn" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Cut" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Cut" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Twist" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Twist" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Firm" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Firm" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Lot" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Lot" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "InboundItem" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "InboundItem" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Machine" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Machine" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Operator" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Operator" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Bobbin" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Bobbin" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "IssueToHoloMachine" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "IssueToHoloMachine" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromHoloMachineRow" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromHoloMachineRow" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromHoloMachinePieceTotal" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromHoloMachinePieceTotal" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "RollType" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "RollType" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ConeType" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ConeType" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Wrapper" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Wrapper" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "StickerTemplate" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "StickerTemplate" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "IssueToConingMachine" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "IssueToConingMachine" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromConingMachineRow" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromConingMachineRow" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromConingMachinePieceTotal" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromConingMachinePieceTotal" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "IssueToCutterMachine" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "IssueToCutterMachine" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromCutterMachineUpload" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromCutterMachineUpload" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ReceiveFromCutterMachinePieceTotal" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ReceiveFromCutterMachinePieceTotal" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Sequence" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Sequence" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "HoloIssueSequence" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "HoloIssueSequence" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "ConingIssueSequence" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "ConingIssueSequence" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "WhatsappTemplate" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "WhatsappTemplate" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "Box" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Box" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorUsername" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorRoleKey" TEXT;

-- ===== Roles / Users / Sessions =====

CREATE TABLE IF NOT EXISTS "Role" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Role_key_key" ON "Role"("key");

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT,
  "passwordHash" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'User'
      AND constraint_name = 'User_roleId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "Role"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "ip" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'UserSession'
      AND constraint_name = 'UserSession_userId_fkey'
  ) THEN
    ALTER TABLE "UserSession"
      ADD CONSTRAINT "UserSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed system roles.
INSERT INTO "Role" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES
  ('role_admin', 'admin', 'Admin', 'System administrator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_user', 'user', 'User', 'Standard user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

