-- Add backupTime to Settings for configurable auto backup schedule
ALTER TABLE "Settings" ADD COLUMN "backupTime" TEXT NOT NULL DEFAULT '03:00';
