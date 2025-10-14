import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('Usage: node scripts/removeReceiveRows.mjs <receiveRowId> [more ids...]');
    process.exit(1);
  }

  const results = [];
  await prisma.$transaction(async (tx) => {
    for (const id of ids) {
      const row = await tx.receiveRow.findUnique({ where: { id } });
      if (!row) {
        results.push({ id, status: 'missing' });
        continue;
      }
      const pieceId = row.pieceId;
      const net = Number(row.netWt || row.netWt || 0);

      // delete the receive row
      await tx.receiveRow.delete({ where: { id } });

      // adjust receivePieceTotal
      const rpt = await tx.receivePieceTotal.findUnique({ where: { pieceId } });
      if (rpt) {
        const curr = Number(rpt.totalNetWeight || 0);
        const next = Math.max(0, curr - net);
        await tx.receivePieceTotal.update({ where: { pieceId }, data: { totalNetWeight: next } });
        results.push({ id, status: 'deleted', pieceId, net, prevTotal: curr, newTotal: next });
      } else {
        results.push({ id, status: 'deleted_no_total', pieceId, net });
      }
    }
  });

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());


