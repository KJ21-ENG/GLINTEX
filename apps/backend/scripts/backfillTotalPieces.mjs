#!/usr/bin/env node
import prisma from '../src/lib/prisma.js';

async function main() {
  try {
    console.log('Backfilling totalBob in ReceivePieceTotal from ReceiveRow records...');

    // Fetch all receive rows with pcs values
    const allRows = await prisma.receiveFromCutterMachineRow.findMany({
      select: {
        pieceId: true,
        bobbinQuantity: true,
      },
    });

    console.log(`Found ${allRows.length} receive rows`);

    // Group by pieceId and sum pcs values
    const piecePcsMap = new Map();
    for (const row of allRows) {
      const qty = row.bobbinQuantity;
      if (qty !== null && qty !== undefined && Number.isFinite(Number(qty)) && Number(qty) > 0) {
        const current = piecePcsMap.get(row.pieceId) || 0;
        piecePcsMap.set(row.pieceId, current + Number(qty));
      }
    }

    console.log(`Found ${piecePcsMap.size} pieces with pcs data`);

    if (piecePcsMap.size === 0) {
      console.log('No pcs data found in receive rows. Nothing to backfill.');
      return;
    }

    // Update or create ReceivePieceTotal records
    let updated = 0;
    let created = 0;
    let unchanged = 0;

    for (const [pieceId, totalBob] of piecePcsMap.entries()) {
      const existing = await prisma.receiveFromCutterMachinePieceTotal.findUnique({
        where: { pieceId },
      });

      if (existing) {
        // Update existing record
        const existingBob = existing.totalBob || 0;
        if (existingBob === totalBob) {
          unchanged++;
        } else {
          await prisma.receiveFromCutterMachinePieceTotal.update({
            where: { pieceId },
            data: { totalBob: totalBob },
          });
          updated++;
          console.log(`Updated ${pieceId}: ${existingBob} -> ${totalBob}`);
        }
      } else {
        // Create new record (with 0 weight if no weight data exists)
        await prisma.receiveFromCutterMachinePieceTotal.create({
          data: {
            pieceId,
            totalNetWeight: 0,
            totalBob: totalBob,
            wastageNetWeight: 0,
          },
        });
        created++;
        console.log(`Created ${pieceId}: totalBob = ${totalBob}`);
      }
    }

    console.log('\nSummary:');
    console.log(`  Updated: ${updated}`);
    console.log(`  Created: ${created}`);
    console.log(`  Unchanged: ${unchanged}`);
    console.log(`  Total processed: ${piecePcsMap.size}`);

    // Verify: Show sample of updated records
    console.log('\nSample of updated records:');
    const sample = await prisma.receiveFromCutterMachinePieceTotal.findMany({
      where: {
        pieceId: { in: Array.from(piecePcsMap.keys()).slice(0, 10) },
      },
      select: {
        pieceId: true,
        totalBob: true,
        totalNetWeight: true,
      },
    });
    console.table(sample);

    console.log('\nBackfill completed successfully!');

  } catch (err) {
    console.error('Backfill failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
