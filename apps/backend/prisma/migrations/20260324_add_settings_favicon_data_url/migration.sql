-- Add faviconDataUrl to Settings for storing favicon as data URL.
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "faviconDataUrl" TEXT;
