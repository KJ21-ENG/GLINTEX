#!/usr/bin/env node
import prisma from '../src/lib/prisma.js';
import fs from 'fs';

async function main() {
  try {
    console.log('Updating remaining rows based on lot number and bobbin mapping...\n');

    // Read the update file
    const updateFile = 'scripts/remainingRowsUpdate.json';
    if (!fs.existsSync(updateFile)) {
      console.error(`Update file not found: ${updateFile}`);
      console.error('Please run getRemainingRowsByLot.mjs first to generate the template.');
      process.exit(1);
    }

    const updateData = JSON.parse(fs.readFileSync(updateFile, 'utf8'));
    const updates = updateData.updates || [];

    if (updates.length === 0) {
      console.log('No updates specified in the file.');
      return;
    }

    // Validate updates
    const invalidUpdates = updates.filter(u => !u.lotNo || !u.bobbinName || u.bobbinName === '???');
    if (invalidUpdates.length > 0) {
      console.error('Invalid updates found (missing lotNo or bobbinName):');
      console.table(invalidUpdates);
      process.exit(1);
    }

    // Get default bobbin
    const defaultBobbin = await prisma.bobbin.findFirst({
      where: {
        name: {
          equals: 'Bobbin',
          mode: 'insensitive',
        },
      },
    });

    // Get all bobbins
    const allBobbins = await prisma.bobbin.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    const bobbinNameMap = new Map();
    allBobbins.forEach(b => {
      bobbinNameMap.set(b.name.toUpperCase(), b.id);
    });

    // Process each update
    let totalUpdated = 0;
    let errors = 0;

    for (const update of updates) {
      const lotNo = update.lotNo;
      const bobbinName = update.bobbinName.trim();

      // Find bobbin (case-insensitive)
      const bobbinId = bobbinNameMap.get(bobbinName.toUpperCase());
      if (!bobbinId) {
        console.error(`Bobbin not found: "${bobbinName}" for lot ${lotNo}`);
        errors++;
        continue;
      }

      // Get pieceIds for this lot (InboundItem.id is the pieceId)
      const inboundItems = await prisma.inboundItem.findMany({
        where: {
          lotNo: lotNo,
        },
        select: {
          id: true,
        },
      });

      if (inboundItems.length === 0) {
        console.warn(`No pieces found for lot ${lotNo}`);
        continue;
      }

      const pieceIds = inboundItems.map(i => i.id);

      // Update receive rows for these pieces that are still linked to default bobbin
      const result = await prisma.receiveFromCutterMachineRow.updateMany({
        where: {
          AND: [
            { pieceId: { in: pieceIds } },
            { bobbinId: defaultBobbin.id },
          ],
        },
        data: {
          bobbinId: bobbinId,
          pcsTypeName: bobbinName,
        },
      });

      console.log(`Lot ${lotNo}: Updated ${result.count} rows → "${bobbinName}"`);
      totalUpdated += result.count;
    }

    console.log(`\nUpdate Summary:`);
    console.log(`  Total rows updated: ${totalUpdated}`);
    console.log(`  Errors: ${errors}`);

    // Verify
    const remainingCount = await prisma.receiveFromCutterMachineRow.count({
      where: {
        bobbinId: defaultBobbin.id,
      },
    });

    console.log(`  Remaining rows with default "Bobbin": ${remainingCount}`);

    if (remainingCount === 0) {
      console.log('\n✅ All rows have been assigned proper bobbins!');
    }

  } catch (err) {
    console.error('Update failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

