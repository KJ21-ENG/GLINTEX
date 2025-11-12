#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Matching bobbins by itemName for entries without PcsTypeName...\n');

    // Get all rows without PcsTypeName (null bobbinId or linked to default "Bobbin")
    const defaultBobbin = await prisma.bobbin.findFirst({
      where: {
        name: {
          equals: 'Bobbin',
          mode: 'insensitive',
        },
      },
    });

    if (!defaultBobbin) {
      console.log('Default "Bobbin" not found. Exiting.');
      return;
    }

    const rowsWithoutBobbin = await prisma.receiveRow.findMany({
      where: {
        OR: [
          { pcsTypeName: null },
          { bobbinId: defaultBobbin.id },
        ],
      },
      select: {
        id: true,
        vchNo: true,
        pieceId: true,
        itemName: true,
        pcsTypeName: true,
        bobbinId: true,
      },
    });

    console.log(`Found ${rowsWithoutBobbin.length} rows without proper bobbin assignment\n`);

    if (rowsWithoutBobbin.length === 0) {
      console.log('No rows to process.');
      return;
    }

    // Get all rows WITH PcsTypeName to use as reference
    const rowsWithBobbin = await prisma.receiveRow.findMany({
      where: {
        AND: [
          { pcsTypeName: { not: null } },
          { bobbinId: { not: defaultBobbin.id } },
        ],
      },
      select: {
        id: true,
        itemName: true,
        pcsTypeName: true,
        bobbinId: true,
        bobbin: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    console.log(`Found ${rowsWithBobbin.length} reference rows with bobbin assignments\n`);

    // Create a map: itemName -> bobbinId (most common bobbin for that itemName)
    const itemNameBobbinMap = new Map();
    const itemNameBobbinCounts = new Map();

    rowsWithBobbin.forEach(row => {
      if (!row.itemName || !row.bobbinId) return;
      
      const itemName = row.itemName.trim();
      const bobbinId = row.bobbinId;
      const key = `${itemName}|${bobbinId}`;
      
      // Count occurrences
      const currentCount = itemNameBobbinCounts.get(key) || 0;
      itemNameBobbinCounts.set(key, currentCount + 1);
      
      // Track most common bobbin for each itemName
      const currentBest = itemNameBobbinMap.get(itemName);
      if (currentBest) {
        const currentBestKey = `${itemName}|${currentBest}`;
        const currentBestCount = itemNameBobbinCounts.get(currentBestKey) || 0;
        if (currentCount + 1 > currentBestCount) {
          itemNameBobbinMap.set(itemName, bobbinId);
        }
      } else {
        itemNameBobbinMap.set(itemName, bobbinId);
      }
    });

    console.log(`Created mapping for ${itemNameBobbinMap.size} unique itemNames\n`);

    // Show the mapping
    const bobbinIds = [...new Set(itemNameBobbinMap.values())];
    const bobbins = await prisma.bobbin.findMany({
      where: { id: { in: bobbinIds } },
      select: { id: true, name: true },
    });
    const bobbinNameMap = new Map(bobbins.map(b => [b.id, b.name]));

    console.log('ItemName -> Bobbin mapping:');
    const mappingTable = Array.from(itemNameBobbinMap.entries())
      .map(([itemName, bobbinId]) => ({
        itemName,
        bobbinName: bobbinNameMap.get(bobbinId) || 'Unknown',
        bobbinId,
      }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
    console.table(mappingTable);

    // Process rows without bobbin
    let matched = 0;
    let unmatched = 0;
    const updates = [];

    for (const row of rowsWithoutBobbin) {
      if (!row.itemName) {
        unmatched++;
        continue;
      }

      const itemName = row.itemName.trim();
      const matchedBobbinId = itemNameBobbinMap.get(itemName);

      if (matchedBobbinId) {
        updates.push({
          id: row.id,
          vchNo: row.vchNo,
          pieceId: row.pieceId,
          itemName: itemName,
          currentBobbinId: row.bobbinId,
          newBobbinId: matchedBobbinId,
          newBobbinName: bobbinNameMap.get(matchedBobbinId) || 'Unknown',
        });
        matched++;
      } else {
        unmatched++;
      }
    }

    console.log(`\nMatching Results:`);
    console.log(`  Matched: ${matched}`);
    console.log(`  Unmatched: ${unmatched}`);

    if (updates.length === 0) {
      console.log('\nNo rows to update.');
      return;
    }

    // Show sample of updates
    console.log('\nSample of rows to be updated:');
    console.table(updates.slice(0, 10).map(u => ({
      vchNo: u.vchNo,
      pieceId: u.pieceId,
      itemName: u.itemName,
      currentBobbin: u.currentBobbinId === defaultBobbin.id ? 'Bobbin (default)' : 'None',
      newBobbin: u.newBobbinName,
    })));

    // Ask for confirmation (in a script, we'll proceed)
    console.log(`\nUpdating ${updates.length} rows...`);

    let updated = 0;
    let errors = 0;

    for (const update of updates) {
      try {
        await prisma.receiveRow.update({
          where: { id: update.id },
          data: { 
            bobbinId: update.newBobbinId,
            // Also update pcsTypeName to match
            pcsTypeName: update.newBobbinName,
          },
        });
        updated++;
      } catch (err) {
        console.error(`Failed to update row ${update.id}:`, err.message);
        errors++;
      }
    }

    console.log(`\nUpdate Summary:`);
    console.log(`  Successfully updated: ${updated}`);
    console.log(`  Errors: ${errors}`);

    // Verify: Show sample of updated records
    console.log('\nSample of updated records:');
    const sampleUpdated = await prisma.receiveRow.findMany({
      where: {
        id: { in: updates.slice(0, 5).map(u => u.id) },
      },
      include: {
        bobbin: {
          select: {
            name: true,
          },
        },
      },
    });

    console.table(sampleUpdated.map(r => ({
      vchNo: r.vchNo,
      pieceId: r.pieceId,
      itemName: r.itemName,
      pcsTypeName: r.pcsTypeName,
      bobbinName: r.bobbin?.name || '—',
    })));

    console.log('\nMatching completed successfully!');

  } catch (err) {
    console.error('Matching failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

