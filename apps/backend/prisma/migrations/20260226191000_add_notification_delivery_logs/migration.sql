-- Persist notification delivery attempts/results for WhatsApp and Telegram
CREATE TABLE "NotificationDeliveryLog" (
  "id" TEXT NOT NULL,
  "event" TEXT,
  "templateEvent" TEXT,
  "templateId" INTEGER,
  "source" TEXT,
  "channel" TEXT NOT NULL,
  "recipient" TEXT,
  "recipientType" TEXT,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "error" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationDeliveryLog_createdAt_idx" ON "NotificationDeliveryLog"("createdAt");
CREATE INDEX "NotificationDeliveryLog_event_createdAt_idx" ON "NotificationDeliveryLog"("event", "createdAt");
CREATE INDEX "NotificationDeliveryLog_channel_createdAt_idx" ON "NotificationDeliveryLog"("channel", "createdAt");
