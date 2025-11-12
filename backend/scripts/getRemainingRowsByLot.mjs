#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Finding remaining rows with default "Bobbin" and their lot numbers...\n');

    const defaultBobbin = await prisma.bobbin.findFirst({
      where: {
        name: {
          equals: 'Bobbin',
          mode: 'insensitive',
        },
      },
    });

    if (!defaultBobbin) {
      console.log('Default "Bobbin" not found.');
      return;
    }

    // Get remaining rows
    const remainingRows = await prisma.receiveRow.findMany({
      where: {
        bobbinId: defaultBobbin.id,
      },
      select: {
        id: true,
        vchNo: true,
        pieceId: true,
        itemName: true,
        pcsTypeName: true,
        createdAt: true,
      },
      orderBy: {
        pieceId: 'asc',
      },
    });

    console.log(`Found ${remainingRows.length} rows still linked to default "Bobbin"\n`);

    if (remainingRows.length === 0) {
      console.log('No rows to process.');
      return;
    }

    // Get pieceIds
    const pieceIds = [...new Set(remainingRows.map(r => r.pieceId))];

    // Get lot information for these pieces (InboundItem.id is the pieceId)
    const inboundItems = await prisma.inboundItem.findMany({
      where: {
        id: { in: pieceIds },
      },
      select: {
        id: true,
        lotNo: true,
        itemId: true,
      },
    });

    // Get item names
    const itemIds = [...new Set(inboundItems.map(i => i.itemId))];
    const items = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true },
    });
    const itemNameMap = new Map(items.map(i => [i.id, i.name]));

    // Create pieceId -> lotNo map
    const pieceLotMap = new Map();
    inboundItems.forEach(item => {
      pieceLotMap.set(item.id, {
        lotNo: item.lotNo,
        itemName: itemNameMap.get(item.itemId) || null,
      });
    });

    // Group rows by lot number
    const rowsByLot = new Map();

    remainingRows.forEach(row => {
      const lotInfo = pieceLotMap.get(row.pieceId);
      const lotNo = lotInfo?.lotNo || 'NO_LOT';
      const itemName = lotInfo?.itemName || row.itemName || 'UNKNOWN';

      if (!rowsByLot.has(lotNo)) {
        rowsByLot.set(lotNo, {
          lotNo,
          itemName,
          rows: [],
          uniqueItemNames: new Set(),
        });
      }

      const lotData = rowsByLot.get(lotNo);
      lotData.rows.push(row);
      if (row.itemName) {
        lotData.uniqueItemNames.add(row.itemName);
      }
    });

    // Convert to array and sort
    const lotSummary = Array.from(rowsByLot.values())
      .map(lot => ({
        lotNo: lot.lotNo,
        itemName: lot.itemName,
        rowCount: lot.rows.length,
        uniqueItemNames: Array.from(lot.uniqueItemNames).join(', ') || lot.itemName || 'N/A',
        sampleVchNos: lot.rows.slice(0, 3).map(r => r.vchNo).join(', '),
        pieceIds: [...new Set(lot.rows.map(r => r.pieceId))].join(', '),
      }))
      .sort((a, b) => {
        if (a.lotNo === 'NO_LOT') return 1;
        if (b.lotNo === 'NO_LOT') return -1;
        return a.lotNo.localeCompare(b.lotNo);
      });

    console.log('=== Rows Grouped by Lot Number ===\n');
    console.table(lotSummary.map(lot => ({
      'Lot No': lot.lotNo,
      'Item Name': lot.itemName,
      'Row Count': lot.rowCount,
      'Item Names in Rows': lot.uniqueItemNames,
      'Sample VchNos': lot.sampleVchNos,
      'Piece IDs': lot.pieceIds,
    })));

    // Also show detailed breakdown
    console.log('\n=== Detailed Row Information ===\n');
    const detailedRows = remainingRows.map(row => {
      const lotInfo = pieceLotMap.get(row.pieceId);
      return {
        vchNo: row.vchNo,
        pieceId: row.pieceId,
        lotNo: lotInfo?.lotNo || 'NO_LOT',
        itemName: row.itemName || lotInfo?.itemName || 'UNKNOWN',
        pcsTypeName: row.pcsTypeName || 'null',
        createdAt: row.createdAt.toISOString().split('T')[0],
      };
    });

    console.table(detailedRows);

    // Generate update script template
    console.log('\n=== Update Script Template ===\n');
    console.log('Copy this and fill in the bobbin names, then run updateRemainingRows.mjs:\n');
    
    const updateData = lotSummary.map(lot => ({
      lotNo: lot.lotNo,
      bobbinName: '???', // Placeholder for user to fill
    }));

    console.log(JSON.stringify(updateData, null, 2));

    // Save to file for easy editing
    const fs = await import('fs');
    const updateTemplate = {
      updates: updateData,
    };
    
    fs.writeFileSync(
      'scripts/remainingRowsUpdate.json',
      JSON.stringify(updateTemplate, null, 2)
    );

    console.log('\nTemplate saved to: scripts/remainingRowsUpdate.json');
    console.log('Edit this file with the correct bobbin names, then run: node scripts/updateRemainingRows.mjs');

  } catch (err) {
    console.error('Failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

