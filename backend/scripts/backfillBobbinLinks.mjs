#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Backfilling bobbin links in ReceiveRow records...\n');

    // Fetch all receive rows that have pcsTypeName but no bobbinId
    const rowsToUpdate = await prisma.receiveRow.findMany({
      where: {
        OR: [
          { bobbinId: null },
          { pcsTypeName: { not: null } },
        ],
      },
      select: {
        id: true,
        pcsTypeName: true,
        bobbinId: true,
      },
    });

    console.log(`Found ${rowsToUpdate.length} receive rows to process`);

    if (rowsToUpdate.length === 0) {
      console.log('No rows need updating. Nothing to backfill.');
      return;
    }

    // Get unique pcsTypeName values
    const uniquePcsTypeNames = [...new Set(rowsToUpdate.map(r => r.pcsTypeName).filter(Boolean))];
    console.log(`Found ${uniquePcsTypeNames.length} unique pcsTypeName values:`, uniquePcsTypeNames);

    // Create a map of pcsTypeName -> bobbinId
    const bobbinIdMap = new Map();

    // Process each unique pcsTypeName
    for (const pcsTypeName of uniquePcsTypeNames) {
      const normalizedName = String(pcsTypeName).trim() || 'Bobbin';
      
      // Find or create bobbin
      let bobbin = await prisma.bobbin.findFirst({
        where: {
          name: {
            equals: normalizedName,
            mode: 'insensitive',
          },
        },
      });

      if (!bobbin) {
        bobbin = await prisma.bobbin.create({
          data: { name: normalizedName },
        });
        console.log(`Created bobbin: "${normalizedName}" (ID: ${bobbin.id})`);
      }

      bobbinIdMap.set(pcsTypeName, bobbin.id);
    }

    // Ensure "Bobbin" exists for empty/null values
    let defaultBobbin = await prisma.bobbin.findFirst({
      where: {
        name: {
          equals: 'Bobbin',
          mode: 'insensitive',
        },
      },
    });

    if (!defaultBobbin) {
      defaultBobbin = await prisma.bobbin.create({
        data: { name: 'Bobbin' },
      });
      console.log(`Created default bobbin: "Bobbin" (ID: ${defaultBobbin.id})`);
    }

    bobbinIdMap.set(null, defaultBobbin.id);
    bobbinIdMap.set('', defaultBobbin.id);

    // Update rows in batches
    let updated = 0;
    let skipped = 0;

    for (const row of rowsToUpdate) {
      const targetBobbinId = bobbinIdMap.get(row.pcsTypeName) || bobbinIdMap.get(null);
      
      // Skip if already linked correctly
      if (row.bobbinId === targetBobbinId) {
        skipped++;
        continue;
      }

      await prisma.receiveRow.update({
        where: { id: row.id },
        data: { bobbinId: targetBobbinId },
      });

      updated++;
    }

    console.log('\nSummary:');
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped (already correct): ${skipped}`);
    console.log(`  Total processed: ${rowsToUpdate.length}`);

    // Verify: Show sample of updated records
    console.log('\nSample of updated records:');
    const sample = await prisma.receiveRow.findMany({
      where: {
        bobbinId: { not: null },
      },
      include: {
        bobbin: {
          select: {
            name: true,
          },
        },
      },
      take: 10,
    });
    
    console.table(sample.map(r => ({
      id: r.id,
      pieceId: r.pieceId,
      pcsTypeName: r.pcsTypeName || '—',
      bobbinName: r.bobbin?.name || '—',
    })));

    console.log('\nBackfill completed successfully!');

  } catch (err) {
    console.error('Backfill failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

