-- AlterTable
ALTER TABLE "BoilerSteamLog" ADD COLUMN IF NOT EXISTS "boilerMachineId" TEXT;
ALTER TABLE "BoilerSteamLog" ADD COLUMN IF NOT EXISTS "boilerNumber" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BoilerSteamLog_boilerMachineId_idx" ON "BoilerSteamLog"("boilerMachineId");

-- AddForeignKey
ALTER TABLE "BoilerSteamLog" ADD CONSTRAINT "BoilerSteamLog_boilerMachineId_fkey" FOREIGN KEY ("boilerMachineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
