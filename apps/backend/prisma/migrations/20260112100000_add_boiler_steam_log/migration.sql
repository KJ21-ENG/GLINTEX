-- CreateTable
CREATE TABLE "BoilerSteamLog" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "holoReceiveRowId" TEXT,
    "steamedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "BoilerSteamLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoilerSteamLog_barcode_key" ON "BoilerSteamLog"("barcode");
