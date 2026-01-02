import prisma from '../src/lib/prisma.js';

async function seed() {
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
