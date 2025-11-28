#!/usr/bin/env node
import prisma from '../src/lib/prisma.js';

async function main() {
  try {
    console.log('Checking pcs data in database...\n');

    // Check specific pieces shown in the UI
    const checkPieces = ['013-4', '018-4', '020-4', '017-2', '019-1', '022-1', '022-2', '020-3', '016-2'];

    console.log('Checking ReceiveRow records for these pieces:');
    for (const pieceId of checkPieces) {
      const rows = await prisma.receiveFromCutterMachineRow.findMany({
        where: { pieceId },
        select: { pieceId: true, bobbinQuantity: true, vchNo: true },
      });
      
      if (rows.length > 0) {
        const totalQty = rows.reduce((sum, r) => sum + (r.bobbinQuantity || 0), 0);
        const rowsWithQty = rows.filter(r => r.bobbinQuantity && r.bobbinQuantity > 0);
        console.log(`  ${pieceId}: ${rows.length} rows, ${rowsWithQty.length} with bobbin quantity data, total bobbin qty = ${totalQty}`);
        if (rowsWithQty.length > 0) {
          rowsWithQty.slice(0, 3).forEach(r => console.log(`    - VchNo ${r.vchNo}: ${r.bobbinQuantity} bobbin qty`));
        }
      } else {
        console.log(`  ${pieceId}: No ReceiveRow records found`);
      }
    }

    console.log('\nChecking ReceivePieceTotal records:');
    for (const pieceId of checkPieces) {
      const total = await prisma.receiveFromCutterMachinePieceTotal.findUnique({
        where: { pieceId },
      });
      
      if (total) {
        console.log(`  ${pieceId}: totalBob = ${total.totalBob || 0}, totalNetWeight = ${total.totalNetWeight || 0}`);
      } else {
        console.log(`  ${pieceId}: No ReceivePieceTotal record found`);
      }
    }

    console.log('\nSample of all ReceivePieceTotal with totalBob > 0:');
    const totalsWithPcs = await prisma.receiveFromCutterMachinePieceTotal.findMany({
      where: {
        totalBob: { gt: 0 },
      },
      select: {
        pieceId: true,
        totalBob: true,
        totalNetWeight: true,
      },
      take: 20,
    });
    console.table(totalsWithPcs);

    // Count how many pieces have pcs data
    const allTotals = await prisma.receiveFromCutterMachinePieceTotal.findMany({
      select: { pieceId: true, totalBob: true },
    });
    const withPcs = allTotals.filter(t => (t.totalBob || 0) > 0);
    console.log(`\nTotal ReceivePieceTotal records: ${allTotals.length}`);
    console.log(`Records with totalBob > 0: ${withPcs.length}`);

  } catch (err) {
    console.error('Check failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
