-- CreateTable
CREATE TABLE IF NOT EXISTS "Bobbin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Bobbin_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ReceiveRow" ADD COLUMN IF NOT EXISTS "bobbinId" TEXT;

-- AddForeignKey
ALTER TABLE "ReceiveRow" ADD CONSTRAINT "ReceiveRow_bobbinId_fkey" FOREIGN KEY ("bobbinId") REFERENCES "Bobbin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

