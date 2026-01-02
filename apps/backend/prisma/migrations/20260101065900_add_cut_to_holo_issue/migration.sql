-- AlterTable
ALTER TABLE "IssueToHoloMachine" ADD COLUMN     "cutId" TEXT;

-- AddForeignKey
ALTER TABLE "IssueToHoloMachine" ADD CONSTRAINT "IssueToHoloMachine_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "Cut"("id") ON DELETE SET NULL ON UPDATE CASCADE;
