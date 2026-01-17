import prisma from '../src/lib/prisma.js';

async function seed() {
  // Migration: Rename old generic keys to new process-specific ones if they exist
  const keyMigrations = [
    { old: 'issue_to_machine_created', new: 'issue_to_cutter_machine_created' },
    { old: 'receive_from_machine_created', new: 'receive_from_cutter_machine_created' },
    { old: 'piece_wastage_marked', new: 'piece_wastage_marked_cutter' },
    { old: 'issue_to_machine_deleted', new: 'issue_to_cutter_machine_deleted' },
  ];

  for (const m of keyMigrations) {
    const existingOld = await prisma.whatsappTemplate.findUnique({ where: { event: m.old } });
    if (existingOld) {
      console.log(`Migrating old template key: ${m.old} -> ${m.new}`);
      // If the new one doesn't exist, rename it. If it does, we just leave it (seed will update it anyway)
      const existingNew = await prisma.whatsappTemplate.findUnique({ where: { event: m.new } });
      if (!existingNew) {
        await prisma.whatsappTemplate.update({
          where: { event: m.old },
          data: { event: m.new }
        });
      } else {
        // If both exist, just delete the old one to cleanup
        await prisma.whatsappTemplate.delete({ where: { event: m.old } });
      }
    }
  }

  const defaults = [
    {
      event: 'inbound_created',
      enabled: true,
      template: '*New Inbound Registered*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🧩 *Pieces:* @totalPieces\n' +
        '⚖️ *Weight:* @totalWeight kg\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'issue_to_cutter_machine_created',
      enabled: true,
      template: '*Cutter Issue Notification*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🧩 *Pieces:* @count\n' +
        '🏗️ *Machine:* @machineName\n' +
        '👤 *Operator:* @operatorName\n' +
        '✂️ *Cut:* @cutName\n' +
        '⚖️ *Weight:* @totalWeight kg\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'receive_from_cutter_machine_created',
      enabled: true,
      template: '*Cutter Receive Confirmation*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '⚖️ *Net Weight:* *@netWeight kg*\n' +
        '🧶 *Bobbins:* @bobbinQuantity\n' +
        '👤 *Operator:* @operatorName\n' +
        '🎫 *Challan:* @challanNo\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'issue_to_holo_machine_created',
      enabled: true,
      template: '*Holo Issue Notification*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🧶 *Bobbins:* @metallicBobbins\n' +
        '⚖️ *Bobbin Wt:* @metallicBobbinsWeight kg\n' +
        '🧵 *Yarn:* @yarnKg kg\n' +
        '🏗️ *Machine:* @machineName\n' +
        '👤 *Operator:* @operatorName\n' +
        '🌀 *Twist:* @twistName\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'receive_from_holo_machine_created',
      enabled: true,
      template: '*Holo Receive Confirmation*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '⚖️ *Net Weight:* *@netWeight kg*\n' +
        '📜 *Rolls:* @rollCount\n' +
        '🏗️ *Machine:* @machineName\n' +
        '👤 *Operator:* @operatorName\n' +
        '🏷️ *Barcode:* @barcode\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'issue_to_coning_machine_created',
      enabled: true,
      template: '*Coning Issue Notification*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '📜 *Rolls:* @rollsIssued\n' +
        '🎯 *Target Cone:* @requiredPerConeNetWeight g\n' +
        '🏗️ *Machine:* @machineName\n' +
        '👤 *Operator:* @operatorName\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'receive_from_coning_machine_created',
      enabled: true,
      template: '*Coning Receive Confirmation*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '⚖️ *Net Weight:* *@netWeight kg*\n' +
        '🍦 *Cones:* @coneCount\n' +
        '🏗️ *Machine:* @machineName\n' +
        '👤 *Operator:* @operatorName\n' +
        '🏷️ *Barcode:* @barcode\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'piece_wastage_marked_cutter',
      enabled: true,
      template: '*Cutter Wastage Marked*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🆔 *Piece:* @pieceId\n' +
        '🗑️ *Wastage:* *@wastage kg*\n' +
        '📉 *Percent:* @wastagePercent%'
    },
    {
      event: 'piece_wastage_marked_holo',
      enabled: true,
      template: '*Holo Wastage Marked*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🆔 *Piece:* @pieceId\n' +
        '🗑️ *Wastage:* *@wastage kg*\n' +
        '📉 *Percent:* @wastagePercent%'
    },
    {
      event: 'piece_wastage_marked_coning',
      enabled: true,
      template: '*Coning Wastage Marked*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🆔 *Piece:* @pieceId\n' +
        '🗑️ *Wastage:* *@wastage kg*\n' +
        '📉 *Percent:* @wastagePercent%'
    },
    {
      event: 'issue_to_cutter_machine_deleted',
      enabled: true,
      template: '*Cutter Issue Deleted*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🧩 *Pieces:* @count\n' +
        '⚖️ *Weight:* @totalWeight kg\n' +
        '🏗️ *Machine:* @machineName'
    },
    {
      event: 'issue_to_holo_machine_deleted',
      enabled: true,
      template: '*Holo Issue Deleted*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🧶 *Bobbins:* @metallicBobbins\n' +
        '⚖️ *Weight:* @metallicBobbinsWeight kg\n' +
        '🏗️ *Machine:* @machineName'
    },
    {
      event: 'issue_to_coning_machine_deleted',
      enabled: true,
      template: '*Coning Issue Deleted*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '📜 *Rolls:* @rollsIssued\n' +
        '🏗️ *Machine:* @machineName'
    },
    {
      event: 'lot_deleted',
      enabled: true,
      template: '*Lot Deleted*\n\n' +
        '📦 *Item:* @itemName\n' +
        '🔢 *Lot:* @lotNo\n' +
        '🧩 *Total Pieces:* @totalPieces\n' +
        '📅 *Date:* @date'
    },
    {
      event: 'item_out_of_stock',
      enabled: true,
      template: '🚨 *Stock Alert*\n\n' +
        '📦 *Item:* @itemName\n' +
        '⚠️ *Status:* OUT OF STOCK\n' +
        '⚖️ *Available:* @available kg'
    },
    {
      event: 'backup_failed',
      enabled: true,
      template: '❌ *Backup Failed*\n\n' +
        '🖥️ *Host:* @host\n' +
        '🕒 *Time:* @time\n' +
        '📝 *Error:* @error\n' +
        '📂 *File:* @filename'
    },
    // Summary templates for PDF reports
    {
      event: 'summary_cutter_issue',
      enabled: true,
      template: '📊 *Cutter Issue Summary*\n\n' +
        '📅 *Date:* @date\n' +
        '📝 *Total Issues:* @totalCount\n' +
        '🧩 *Total Pieces:* @totalPieces\n' +
        '⚖️ *Total Weight:* @totalWeight kg'
    },
    {
      event: 'summary_cutter_receive',
      enabled: true,
      template: '📊 *Cutter Receive Summary*\n\n' +
        '📅 *Date:* @date\n' +
        '📝 *Total Receives:* @totalCount\n' +
        '🧶 *Total Bobbins:* @totalPieces\n' +
        '⚖️ *Total Weight:* @totalWeight kg'
    },
    {
      event: 'summary_holo_issue',
      enabled: true,
      template: '📊 *Holo Issue Summary*\n\n' +
        '📅 *Date:* @date\n' +
        '📝 *Total Issues:* @totalCount\n' +
        '🧶 *Total Bobbins:* @totalPieces\n' +
        '⚖️ *Total Weight:* @totalWeight kg'
    },
    {
      event: 'summary_holo_receive',
      enabled: true,
      template: '📊 *Holo Receive Summary*\n\n' +
        '📅 *Date:* @date\n' +
        '📝 *Total Receives:* @totalCount\n' +
        '📜 *Total Rolls:* @totalPieces\n' +
        '⚖️ *Total Weight:* @totalWeight kg'
    },
    {
      event: 'summary_coning_issue',
      enabled: true,
      template: '📊 *Coning Issue Summary*\n\n' +
        '📅 *Date:* @date\n' +
        '📝 *Total Issues:* @totalCount\n' +
        '📜 *Total Rolls:* @totalPieces'
    },
    {
      event: 'summary_coning_receive',
      enabled: true,
      template: '📊 *Coning Receive Summary*\n\n' +
        '📅 *Date:* @date\n' +
        '📝 *Total Receives:* @totalCount\n' +
        '🍦 *Total Cones:* @totalPieces\n' +
        '⚖️ *Total Weight:* @totalWeight kg'
    },
  ];

  for (const t of defaults) {
    await prisma.whatsappTemplate.upsert({
      where: { event: t.event },
      update: { enabled: t.enabled, template: t.template, sendToPrimary: true, groupIds: [] },
      create: { ...t, sendToPrimary: true, groupIds: [] },
    });
    console.log('Upserted', t.event);
  }

  const all = await prisma.whatsappTemplate.findMany();
  console.log('Total templates:', all.length);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
