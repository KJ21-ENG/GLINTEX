#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Backfilling totalPieces in ReceivePieceTotal from ReceiveRow records...');

    // Fetch all receive rows with pcs values
    const allRows = await prisma.receiveRow.findMany({
      select: {
        pieceId: true,
        pcs: true,
      },
    });

    console.log(`Found ${allRows.length} receive rows`);

    // Group by pieceId and sum pcs values
    const piecePcsMap = new Map();
    for (const row of allRows) {
      const pcs = row.pcs;
      if (pcs !== null && pcs !== undefined && Number.isFinite(Number(pcs)) && Number(pcs) > 0) {
        const current = piecePcsMap.get(row.pieceId) || 0;
        piecePcsMap.set(row.pieceId, current + Number(pcs));
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

    for (const [pieceId, totalPcs] of piecePcsMap.entries()) {
      const existing = await prisma.receivePieceTotal.findUnique({
        where: { pieceId },
      });

      if (existing) {
        // Update existing record
        const existingPcs = existing.totalPieces || 0;
        if (existingPcs === totalPcs) {
          unchanged++;
        } else {
          await prisma.receivePieceTotal.update({
            where: { pieceId },
            data: { totalPieces: totalPcs },
          });
          updated++;
          const existingPcs = existing.totalPieces || 0;
          console.log(`Updated ${pieceId}: ${existingPcs} -> ${totalPcs}`);
        }
      } else {
        // Create new record (with 0 weight if no weight data exists)
        await prisma.receivePieceTotal.create({
          data: {
            pieceId,
            totalNetWeight: 0,
            totalPieces: totalPcs,
            wastageNetWeight: 0,
          },
        });
        created++;
        console.log(`Created ${pieceId}: totalPieces = ${totalPcs}`);
      }
    }

    console.log('\nSummary:');
    console.log(`  Updated: ${updated}`);
    console.log(`  Created: ${created}`);
    console.log(`  Unchanged: ${unchanged}`);
    console.log(`  Total processed: ${piecePcsMap.size}`);

    // Verify: Show sample of updated records
    console.log('\nSample of updated records:');
    const sample = await prisma.receivePieceTotal.findMany({
      where: {
        pieceId: { in: Array.from(piecePcsMap.keys()).slice(0, 10) },
      },
      select: {
        pieceId: true,
        totalPieces: true,
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

