#!/usr/bin/env node
import prisma from '../src/lib/prisma.js';

async function main() {
  try {
    console.log('Starting backfill for soft-deleted barcodes and challan numbers...');

    // 1. IssueToCutterMachine
    const cutterIssues = await prisma.issueToCutterMachine.findMany({
      where: {
        isDeleted: true,
        NOT: { barcode: { contains: '-deleted-' } }
      },
      select: { id: true, barcode: true }
    });

    console.log(`Found ${cutterIssues.length} soft-deleted IssueToCutterMachine records to update.`);
    let cutterIssuesUpdated = 0;
    for (const record of cutterIssues) {
      const newBarcode = `${record.barcode}-deleted-${record.id.slice(0, 8)}`;
      await prisma.issueToCutterMachine.update({
        where: { id: record.id },
        data: { barcode: newBarcode }
      });
      cutterIssuesUpdated++;
      console.log(`  Updated IssueToCutterMachine ID ${record.id}: ${record.barcode} -> ${newBarcode}`);
    }

    // 2. ReceiveFromCutterMachineChallan
    const cutterChallans = await prisma.receiveFromCutterMachineChallan.findMany({
      where: {
        isDeleted: true,
        NOT: { challanNo: { contains: '-deleted-' } }
      },
      select: { id: true, challanNo: true }
    });

    console.log(`Found ${cutterChallans.length} soft-deleted ReceiveFromCutterMachineChallan records to update.`);
    let cutterChallansUpdated = 0;
    for (const record of cutterChallans) {
      const newChallanNo = `${record.challanNo}-deleted-${record.id.slice(0, 8)}`;
      await prisma.receiveFromCutterMachineChallan.update({
        where: { id: record.id },
        data: { challanNo: newChallanNo }
      });
      cutterChallansUpdated++;
      console.log(`  Updated ReceiveFromCutterMachineChallan ID ${record.id}: ${record.challanNo} -> ${newChallanNo}`);
    }

    // 3. ReceiveFromHoloMachineRow
    const holoRows = await prisma.receiveFromHoloMachineRow.findMany({
      where: {
        isDeleted: true,
        NOT: [
          { barcode: null },
          { barcode: '' },
          { barcode: { contains: '-deleted-' } }
        ]
      },
      select: { id: true, barcode: true }
    });

    console.log(`Found ${holoRows.length} soft-deleted ReceiveFromHoloMachineRow records to update.`);
    let holoRowsUpdated = 0;
    for (const record of holoRows) {
      const newBarcode = `${record.barcode}-deleted-${record.id.slice(0, 8)}`;
      await prisma.receiveFromHoloMachineRow.update({
        where: { id: record.id },
        data: { barcode: newBarcode }
      });
      holoRowsUpdated++;
      console.log(`  Updated ReceiveFromHoloMachineRow ID ${record.id}: ${record.barcode} -> ${newBarcode}`);
    }

    // 4. ReceiveFromConingMachineRow
    const coningRows = await prisma.receiveFromConingMachineRow.findMany({
      where: {
        isDeleted: true,
        NOT: [
          { barcode: null },
          { barcode: '' },
          { barcode: { contains: '-deleted-' } }
        ]
      },
      select: { id: true, barcode: true }
    });

    console.log(`Found ${coningRows.length} soft-deleted ReceiveFromConingMachineRow records to update.`);
    let coningRowsUpdated = 0;
    for (const record of coningRows) {
      const newBarcode = `${record.barcode}-deleted-${record.id.slice(0, 8)}`;
      await prisma.receiveFromConingMachineRow.update({
        where: { id: record.id },
        data: { barcode: newBarcode }
      });
      coningRowsUpdated++;
      console.log(`  Updated ReceiveFromConingMachineRow ID ${record.id}: ${record.barcode} -> ${newBarcode}`);
    }

    console.log('Backfill summary:');
    console.log(`- IssueToCutterMachine updated: ${cutterIssuesUpdated}`);
    console.log(`- ReceiveFromCutterMachineChallan updated: ${cutterChallansUpdated}`);
    console.log(`- ReceiveFromHoloMachineRow updated: ${holoRowsUpdated}`);
    console.log(`- ReceiveFromConingMachineRow updated: ${coningRowsUpdated}`);
    console.log('Backfill completed successfully.');

  } catch (err) {
    console.error('Backfill failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
