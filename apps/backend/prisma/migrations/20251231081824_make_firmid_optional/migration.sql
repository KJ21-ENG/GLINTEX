-- DropForeignKey
ALTER TABLE "Lot" DROP CONSTRAINT "Lot_firmId_fkey";

-- AlterTable
ALTER TABLE "Lot" ALTER COLUMN "firmId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
