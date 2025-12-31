-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "challanFieldsConfig" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "challanFromAddress" TEXT,
ADD COLUMN     "challanFromMobile" TEXT,
ADD COLUMN     "challanFromName" TEXT;
