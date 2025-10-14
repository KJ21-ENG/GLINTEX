import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

function trim(s){ return String(s||'').trim(); }

// Usage: node scripts/appendImportJson.mjs <input.json>
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/appendImportJson.mjs <input.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

async function getOrCreateByName(model, name) {
  const n = trim(name);
  if (!n) return null;
  const lower = n.toLowerCase();
  // naive find by exact name
  const existing = await model.findFirst({ where: { name: n } });
  if (existing) return existing.id;
  const created = await model.create({ data: { name: n } });
  return created.id;
}

async function main() {
  const itemIdMap = new Map();
  const firmIdMap = new Map();
  const supplierIdMap = new Map();

  // Build name -> id cache from DB
  const [itemsDb, firmsDb, suppliersDb] = await Promise.all([
    prisma.item.findMany(),
    prisma.firm.findMany(),
    prisma.supplier.findMany(),
  ]);
  itemsDb.forEach(i => itemIdMap.set(i.name, i.id));
  firmsDb.forEach(f => firmIdMap.set(f.name, f.id));
  suppliersDb.forEach(s => supplierIdMap.set(s.name, s.id));

  // Ensure masters from input
  for (const it of (data.items || [])) {
    if (!itemIdMap.has(it.name)) {
      const created = await prisma.item.create({ data: { name: it.name } });
      itemIdMap.set(it.name, created.id);
    }
  }
  for (const f of (data.firms || [])) {
    if (!firmIdMap.has(f.name)) {
      const created = await prisma.firm.create({ data: { name: f.name } });
      firmIdMap.set(f.name, created.id);
    }
  }
  for (const s of (data.suppliers || [])) {
    if (!supplierIdMap.has(s.name)) {
      const created = await prisma.supplier.create({ data: { name: s.name } });
      supplierIdMap.set(s.name, created.id);
    }
  }

  // Helper to map provided ids in lots to actual DB ids by name
  const providedIdToName = new Map();
  (data.items || []).forEach(it => providedIdToName.set(it.id, it.name));
  const providedFirmIdToName = new Map();
  (data.firms || []).forEach(f => providedFirmIdToName.set(f.id, f.name));
  const providedSupplierIdToName = new Map();
  (data.suppliers || []).forEach(s => providedSupplierIdToName.set(s.id, s.name));

  // Lots
  for (const l of (data.lots || [])) {
    const exists = await prisma.lot.findUnique({ where: { lotNo: l.lotNo } });
    if (exists) continue;
    const itemName = providedIdToName.get(l.itemId) || '';
    const firmName = providedFirmIdToName.get(l.firmId) || '';
    const supplierName = providedSupplierIdToName.get(l.supplierId) || null;
    const itemId = itemIdMap.get(itemName) || await getOrCreateByName(prisma.item, itemName);
    const firmId = firmIdMap.get(firmName) || await getOrCreateByName(prisma.firm, firmName);
    const supplierId = supplierName ? (supplierIdMap.get(supplierName) || await getOrCreateByName(prisma.supplier, supplierName)) : null;
    await prisma.lot.create({ data: { lotNo: l.lotNo, date: trim(l.date||''), itemId, firmId, supplierId, totalPieces: Number(l.totalPieces||0), totalWeight: Number(l.totalWeight||0) } });
  }

  // Inbound items
  for (const ii of (data.inbound_items || [])) {
    const exists = await prisma.inboundItem.findUnique({ where: { id: ii.id } });
    if (exists) continue;
    // Map itemId by provided id -> name -> db id
    const itemName = providedIdToName.get(ii.itemId) || null;
    const itemId = itemName ? (itemIdMap.get(itemName) || await getOrCreateByName(prisma.item, itemName)) : null;
    await prisma.inboundItem.create({ data: { id: ii.id, lotNo: ii.lotNo, itemId: itemId || undefined, weight: Number(ii.weight||0), status: trim(ii.status||'available'), seq: Number(ii.seq||0) } });
  }

  // Issue to machine
  for (const c of (data.issue_to_machine || [])) {
    const exists = await prisma.issueToMachine.findUnique({ where: { id: c.id } });
    if (exists) continue;
    const itemName = providedIdToName.get(c.itemId) || '';
    const itemId = itemIdMap.get(itemName) || await getOrCreateByName(prisma.item, itemName);
    const pieceIds = Array.isArray(c.pieceIds) ? c.pieceIds.join(',') : (c.pieceIds || '');
    await prisma.issueToMachine.create({ data: { id: c.id, date: trim(c.date||''), itemId, lotNo: c.lotNo, count: Number(c.count||0), totalWeight: Number(c.totalWeight||0), pieceIds, reason: trim(c.reason||'internal'), note: c.note || null } });
  }

  console.log('Append import completed');
}

main().finally(()=>prisma.$disconnect());


