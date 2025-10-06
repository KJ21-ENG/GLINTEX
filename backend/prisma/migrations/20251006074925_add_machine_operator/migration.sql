-- DropIndex
DROP INDEX "Machine_name_key";

-- DropIndex
DROP INDEX "Operator_name_key";

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
