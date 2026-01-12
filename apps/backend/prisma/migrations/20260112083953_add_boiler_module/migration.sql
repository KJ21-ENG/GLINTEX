-- DropIndex
DROP INDEX "Dispatch_challanNo_idx";

-- AlterTable
ALTER TABLE "ReceiveFromConingMachineRow" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReceiveFromHoloMachineRow" ADD COLUMN     "boilerBatchId" TEXT,
ADD COLUMN     "steamedAt" TIMESTAMP(3),
ADD COLUMN     "steamedByUserId" TEXT,
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BoilerBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "BoilerBatch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReceiveFromHoloMachineRow" ADD CONSTRAINT "ReceiveFromHoloMachineRow_boilerBatchId_fkey" FOREIGN KEY ("boilerBatchId") REFERENCES "BoilerBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
