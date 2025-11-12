#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

// Extract key parts from itemName for matching
function extractKeyParts(itemName) {
  if (!itemName) return [];
  const parts = itemName
    .toUpperCase()
    .replace(/[\/\-]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 1 && !['S', 'SS', 'SRT', 'FL', 'MET', 'DIGITAL', 'SML', 'SBM', 'VM', 'B', 'CH'].includes(p));
  return parts;
}

// Check if two itemNames are similar (share key parts)
function areSimilar(itemName1, itemName2) {
  if (!itemName1 || !itemName2) return false;
  
  // Normalize both names
  const norm1 = itemName1.toUpperCase().trim();
  const norm2 = itemName2.toUpperCase().trim();
  
  // Check for exact substring match (for cases like "LG 20" in "B/S MET DIGITAL SRT LG 20-SML")
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return true;
  }
  
  const parts1 = extractKeyParts(itemName1);
  const parts2 = extractKeyParts(itemName2);
  
  if (parts1.length === 0 || parts2.length === 0) return false;
  
  // Check if they share at least 2 key parts, or one significant part
  const commonParts = parts1.filter(p => parts2.includes(p));
  
  // Significant parts that should match even if only one is found
  const significantParts = parts1.filter(p => 
    p.length >= 4 || /^\d+$/.test(p) || ['WATER', 'ANMOL', 'LG', 'PINK', 'ORANGE', 'GOLD', '1010', '20'].includes(p)
  );
  const hasSignificantMatch = significantParts.some(p => parts2.includes(p));
  
  return commonParts.length >= 2 || (commonParts.length >= 1 && hasSignificantMatch);
}

async function main() {
  try {
    console.log('Fuzzy matching bobbins by itemName...\n');

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

    // Get rows without bobbin
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

    // Get rows with bobbin
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

    console.log(`Rows without bobbin: ${rowsWithoutBobbin.length}`);
    console.log(`Reference rows with bobbin: ${rowsWithBobbin.length}\n`);

    // Create mapping: itemName -> most common bobbin
    const itemNameBobbinMap = new Map();
    const itemNameBobbinCounts = new Map();

    rowsWithBobbin.forEach(row => {
      if (!row.itemName || !row.bobbinId) return;
      const itemName = row.itemName.trim();
      const bobbinId = row.bobbinId;
      const key = `${itemName}|${bobbinId}`;
      
      const count = itemNameBobbinCounts.get(key) || 0;
      itemNameBobbinCounts.set(key, count + 1);
      
      const currentBest = itemNameBobbinMap.get(itemName);
      if (currentBest) {
        const currentBestKey = `${itemName}|${currentBest}`;
        const currentBestCount = itemNameBobbinCounts.get(currentBestKey) || 0;
        if (count + 1 > currentBestCount) {
          itemNameBobbinMap.set(itemName, bobbinId);
        }
      } else {
        itemNameBobbinMap.set(itemName, bobbinId);
      }
    });

    // Get bobbin names
    const bobbinIds = [...new Set(itemNameBobbinMap.values())];
    const bobbins = await prisma.bobbin.findMany({
      where: { id: { in: bobbinIds } },
      select: { id: true, name: true },
    });
    const bobbinNameMap = new Map(bobbins.map(b => [b.id, b.name]));

    // Match rows without bobbin to rows with bobbin using fuzzy matching
    const updates = [];
    const matches = [];

    for (const rowWithout of rowsWithoutBobbin) {
      if (!rowWithout.itemName) continue;
      
      const itemNameWithout = rowWithout.itemName.trim();
      
      // First try exact match
      let matchedBobbinId = itemNameBobbinMap.get(itemNameWithout);
      let matchType = 'exact';
      let matchedItemName = itemNameWithout;
      
      // If no exact match, try fuzzy matching
      if (!matchedBobbinId) {
        for (const [itemNameWith, bobbinId] of itemNameBobbinMap.entries()) {
          if (areSimilar(itemNameWithout, itemNameWith)) {
            matchedBobbinId = bobbinId;
            matchType = 'fuzzy';
            matchedItemName = itemNameWith;
            break;
          }
        }
      }
      
      if (matchedBobbinId) {
        updates.push({
          id: rowWithout.id,
          vchNo: rowWithout.vchNo,
          pieceId: rowWithout.pieceId,
          itemName: itemNameWithout,
          matchedItemName: matchedItemName,
          matchType: matchType,
          newBobbinId: matchedBobbinId,
          newBobbinName: bobbinNameMap.get(matchedBobbinId) || 'Unknown',
        });
        
        matches.push({
          itemName: itemNameWithout,
          matchedItemName: matchedItemName,
          matchType: matchType,
          bobbinName: bobbinNameMap.get(matchedBobbinId) || 'Unknown',
        });
      }
    }

    // Show unique matches
    const uniqueMatches = Array.from(
      new Map(matches.map(m => [`${m.itemName}|${m.matchedItemName}`, m])).values()
    );

    console.log(`Found ${updates.length} rows to update (${uniqueMatches.length} unique matches)\n`);
    console.log('Matching results:');
    console.table(uniqueMatches.map(m => ({
      itemNameWithout: m.itemName,
      itemNameWith: m.matchedItemName,
      matchType: m.matchType,
      bobbinName: m.bobbinName,
    })));

    if (updates.length === 0) {
      console.log('\nNo matches found. No rows to update.');
      return;
    }

    // Show sample updates
    console.log('\nSample of rows to be updated:');
    console.table(updates.slice(0, 10).map(u => ({
      vchNo: u.vchNo,
      pieceId: u.pieceId,
      itemName: u.itemName,
      matchedTo: u.matchedItemName,
      matchType: u.matchType,
      newBobbin: u.newBobbinName,
    })));

    // Update rows
    console.log(`\nUpdating ${updates.length} rows...`);

    let updated = 0;
    let errors = 0;

    for (const update of updates) {
      try {
        await prisma.receiveRow.update({
          where: { id: update.id },
          data: { 
            bobbinId: update.newBobbinId,
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

    // Verify
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

    console.log('\nFuzzy matching completed successfully!');

  } catch (err) {
    console.error('Matching failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

