-- Add explicit channel toggles and Telegram settings to Settings
ALTER TABLE "Settings"
  ADD COLUMN "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "telegramBotToken" TEXT,
  ADD COLUMN "telegramChatIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
