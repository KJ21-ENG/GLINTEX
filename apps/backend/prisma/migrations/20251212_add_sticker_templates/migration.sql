-- CreateTable
CREATE TABLE "StickerTemplate" (
    "id" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StickerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StickerTemplate_stageKey_key" ON "StickerTemplate"("stageKey");

