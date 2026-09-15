-- CreateTable
CREATE TABLE "HoloOtherWastageCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "HoloOtherWastageCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HoloOtherWastageCategory_name_key" ON "HoloOtherWastageCategory"("name");

-- AlterTable
ALTER TABLE "HoloOtherWastageItem" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "HoloOtherWastageItem_categoryId_idx" ON "HoloOtherWastageItem"("categoryId");

-- AddForeignKey
ALTER TABLE "HoloOtherWastageItem" ADD CONSTRAINT "HoloOtherWastageItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HoloOtherWastageCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
