import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  // Find receive rows with missing or placeholder challan (vchNo empty or contains '-X')
  const rowsEmpty = await prisma.receiveFromCutterMachineRow.findMany({ where: { vchNo: '' } });
  const rowsPlaceholder = await prisma.receiveFromCutterMachineRow.findMany({ where: { vchNo: { contains: '-X' } } });
  const rows = [...rowsEmpty, ...rowsPlaceholder];
  if (!rows.length) {
    console.log('No receive rows without challan found');
    return;
  }

  const results = [];
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const id = row.id;
      const pieceId = row.pieceId;
      const net = Number(row.netWt || 0);
      // delete receive row
      await tx.receiveFromCutterMachineRow.delete({ where: { id } });
      // adjust receivePieceTotal
      const rpt = await tx.receiveFromCutterMachinePieceTotal.findUnique({ where: { pieceId } });
      if (rpt) {
        const curr = Number(rpt.totalNetWeight || 0);
        const next = Math.max(0, curr - net);
        await tx.receiveFromCutterMachinePieceTotal.update({ where: { pieceId }, data: { totalNetWeight: next } });
        results.push({ id, pieceId, net, prevTotal: curr, newTotal: next });
      } else {
        results.push({ id, pieceId, net, prevTotal: null, newTotal: null });
      }
    }
  });

  console.log(JSON.stringify({ deletedCount: rows.length, details: results }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());


