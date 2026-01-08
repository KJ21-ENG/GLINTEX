-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "count" INTEGER;

-- AlterTable
ALTER TABLE "ReceiveFromConingMachineRow" ADD COLUMN     "dispatchedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReceiveFromCutterMachineRow" ADD COLUMN     "dispatchedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReceiveFromHoloMachineRow" ADD COLUMN     "dispatchedCount" INTEGER NOT NULL DEFAULT 0;
