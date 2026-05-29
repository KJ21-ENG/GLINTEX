-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "telegramCronChatId" TEXT,
ADD COLUMN     "telegramCronEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramCronMessage" TEXT,
ADD COLUMN     "telegramCronReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramCronReminderMessage" TEXT,
ADD COLUMN     "telegramCronReminderTime" TEXT NOT NULL DEFAULT '14:00',
ADD COLUMN     "telegramCronSchedule" TEXT NOT NULL DEFAULT '30 10 * * 4,6';

-- CreateTable
CREATE TABLE "TelegramCronLog" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "initialSentAt" TIMESTAMP(3),
    "initialMessageId" INTEGER,
    "reminderSentAt" TIMESTAMP(3),
    "responseDetected" BOOLEAN NOT NULL DEFAULT false,
    "responseText" TEXT,
    "responseUser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramCronLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramCronLog_date_key" ON "TelegramCronLog"("date");
