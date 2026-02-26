-- Add per-template telegram routing
ALTER TABLE "WhatsappTemplate"
  ADD COLUMN "telegramChatIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
