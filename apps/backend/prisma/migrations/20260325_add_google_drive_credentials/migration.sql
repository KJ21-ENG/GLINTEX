-- Create GoogleDriveCredential table for storing Drive OAuth tokens and metadata.
CREATE TABLE IF NOT EXISTS "GoogleDriveCredential" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "refreshToken" TEXT NOT NULL,
  "accessToken" TEXT,
  "tokenExpiry" TIMESTAMP(3),
  "email" TEXT,
  "folderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleDriveCredential_pkey" PRIMARY KEY ("id")
);
