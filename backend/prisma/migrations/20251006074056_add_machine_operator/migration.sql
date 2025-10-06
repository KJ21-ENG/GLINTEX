-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Machine_name_key" ON "Machine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_name_key" ON "Operator"("name");

-- AlterTable
ALTER TABLE "Consumption" ADD COLUMN     "machineId" TEXT;

-- AlterTable
ALTER TABLE "Consumption" ADD COLUMN     "operatorId" TEXT;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed WhatsappTemplate rows
INSERT INTO "WhatsappTemplate" (event, enabled, template) VALUES
('inbound_created', true, 'New inbound: {{itemName}} Lot {{lotNo}} - {{totalPieces}} pcs, total {{totalWeight}} kg on {{date}}'),
('consumption_created', true, 'Issued: {{itemName}} Lot {{lotNo}} - {{count}} pcs by {{operatorName}} on {{date}}'),
('consumption_deleted', true, 'Issue deleted: {{itemName}} Lot {{lotNo}} - {{count}} pcs on {{date}}'),
('inbound_piece_deleted', true, 'Inbound piece deleted: {{itemName}} Lot {{lotNo}} piece {{pieceId}}'),
('lot_deleted', true, 'Lot deleted: {{itemName}} Lot {{lotNo}} ({{totalPieces}} pcs) on {{date}}');
