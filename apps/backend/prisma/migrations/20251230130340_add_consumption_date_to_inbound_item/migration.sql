-- AlterTable
ALTER TABLE "InboundItem" ADD COLUMN     "consumptionDate" TEXT,
ADD COLUMN     "isOpeningStock" BOOLEAN NOT NULL DEFAULT false;
