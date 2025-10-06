-- DropIndex (use IF EXISTS to avoid failing on shadow DB)
DROP INDEX IF EXISTS "Machine_name_key";

-- DropIndex (use IF EXISTS to avoid failing on shadow DB)
DROP INDEX IF EXISTS "Operator_name_key";

-- AddForeignKey (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'Consumption_machineId_fkey') THEN
        ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (only if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'Consumption_operatorId_fkey') THEN
        ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
