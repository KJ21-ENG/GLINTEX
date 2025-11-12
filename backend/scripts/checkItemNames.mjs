#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Checking itemNames for rows without PcsTypeName...\n');

    const defaultBobbin = await prisma.bobbin.findFirst({
      where: {
        name: {
          equals: 'Bobbin',
          mode: 'insensitive',
        },
      },
    });

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
            name: true,
          },
        },
      },
    });

    console.log(`Rows without bobbin: ${rowsWithoutBobbin.length}`);
    console.log(`Rows with bobbin: ${rowsWithBobbin.length}\n`);

    // Get unique itemNames from rows without bobbin
    const itemNamesWithoutBobbin = [...new Set(
      rowsWithoutBobbin
        .map(r => r.itemName)
        .filter(Boolean)
        .map(n => n.trim())
    )].sort();

    // Get unique itemNames from rows with bobbin
    const itemNamesWithBobbin = [...new Set(
      rowsWithBobbin
        .map(r => r.itemName)
        .filter(Boolean)
        .map(n => n.trim())
    )].sort();

    console.log(`Unique itemNames WITHOUT bobbin: ${itemNamesWithoutBobbin.length}`);
    console.log('ItemNames:', itemNamesWithoutBobbin.join(', ') || 'None');
    console.log('\nUnique itemNames WITH bobbin: ${itemNamesWithBobbin.length}');
    console.log('ItemNames:', itemNamesWithBobbin.join(', ') || 'None');

    // Find matches (case-insensitive)
    const matches = [];
    const noMatches = [];

    for (const itemNameWithout of itemNamesWithoutBobbin) {
      const match = itemNamesWithBobbin.find(
        itemNameWith => itemNameWith.toLowerCase() === itemNameWithout.toLowerCase()
      );
      
      if (match) {
        // Get the bobbin for this matched itemName
        const matchedRow = rowsWithBobbin.find(
          r => r.itemName && r.itemName.trim().toLowerCase() === itemNameWithout.toLowerCase()
        );
        
        matches.push({
          itemName: itemNameWithout,
          matchedItemName: match,
          bobbinName: matchedRow?.bobbin?.name || 'Unknown',
          bobbinId: matchedRow?.bobbinId || null,
        });
      } else {
        noMatches.push(itemNameWithout);
      }
    }

    console.log('\n=== Matches Found ===');
    if (matches.length > 0) {
      console.table(matches);
    } else {
      console.log('No matches found.');
    }

    console.log('\n=== No Matches ===');
    if (noMatches.length > 0) {
      console.log(`ItemNames without matches: ${noMatches.length}`);
      console.log(noMatches.join(', ') || 'None');
    } else {
      console.log('All itemNames have matches.');
    }

    // Show sample rows
    console.log('\n=== Sample Rows WITHOUT bobbin ===');
    const sampleWithout = rowsWithoutBobbin.slice(0, 10);
    console.table(sampleWithout.map(r => ({
      vchNo: r.vchNo,
      pieceId: r.pieceId,
      itemName: r.itemName || '—',
      pcsTypeName: r.pcsTypeName || 'null',
    })));

    console.log('\n=== Sample Rows WITH bobbin ===');
    const sampleWith = rowsWithBobbin.slice(0, 10);
    console.table(sampleWith.map(r => ({
      vchNo: r.vchNo || '—',
      itemName: r.itemName || '—',
      pcsTypeName: r.pcsTypeName || '—',
      bobbinName: r.bobbin?.name || '—',
    })));

  } catch (err) {
    console.error('Check failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

