import prisma from '../src/prismaClient.js';

async function seed() {
  const defaults = [
    { event: 'inbound_created', enabled: true, template: 'New inbound: {{itemName}} Lot {{lotNo}} - {{totalPieces}} pcs, total {{totalWeight}} kg on {{date}}' },
    { event: 'consumption_created', enabled: true, template: 'Issued: {{itemName}} Lot {{lotNo}} - {{count}} pcs by {{operatorName}} on {{date}}' },
    { event: 'consumption_deleted', enabled: true, template: 'Issue deleted: {{itemName}} Lot {{lotNo}} - {{count}} pcs on {{date}}' },
    { event: 'inbound_piece_deleted', enabled: true, template: 'Inbound piece deleted: {{itemName}} Lot {{lotNo}} piece {{pieceId}}' },
  ];

  for (const t of defaults) {
    await prisma.whatsappTemplate.upsert({
      where: { event: t.event },
      update: { enabled: t.enabled, template: t.template },
      create: t,
    });
    console.log('Upserted', t.event);
  }

  const all = await prisma.whatsappTemplate.findMany();
  console.log('Total templates:', all.length);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });


