-- Add whatsapp group IDs to Settings and template flags to WhatsappTemplate

-- Alter Settings: add whatsappGroupIds as TEXT[] (nullable)
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "whatsappGroupIds" TEXT[];

-- Alter WhatsappTemplate: add sendToPrimary and groupIds
ALTER TABLE "WhatsappTemplate" ADD COLUMN IF NOT EXISTS "sendToPrimary" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WhatsappTemplate" ADD COLUMN IF NOT EXISTS "groupIds" TEXT[];


