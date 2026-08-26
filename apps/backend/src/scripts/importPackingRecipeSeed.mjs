import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SOURCE_ROWS = [
  [3, 'PARCEL', '110 NYLON-ANMOL 10', 'MSK', 'NEW 3435', 'P GREEN', '125', 320, '4 BOX', 1, ''],
  [4, 'PARCEL', '110 NYLON-L WATER', 'G-4', 'M GOLD', 'P YELLOW', '125', 320, '4 BOX', 1, ''],
  [5, 'PARCEL', '110 NYLON-ANMOL 21', 'PLAIN', '3435', 'P GREEN', '125', 320, '4 BOX', 1, ''],
  [6, 'PARCEL', '110 NYLON-ANMOL 41', 'PLAIN', '152', 'P GREEN', '100', 400, '4 BOX', 1, ''],
  [7, 'PARCEL', '110 NYLON-ANMOL 21', 'GLINTEX', '3435', 'Y-BLACK', '125', 320, '4 BOX', 1, ''],
  [8, 'PARCEL', '110 NYLON-ANMOL 10', 'NAZIR', 'NEW 3435', 'Y-BLACK', 'S', 320, '4 BOX', 1, ''],
  [10, 'PARCEL', '40/2 COTTON-IVERY', 'GOLDEN DARE', '108', '1 HOLE PINK', '35', 900, '150 PAC', 1, ''],
  [11, 'PARCEL', '40/2 COTTON-IVERY', 'PLAIN', '108', '1 HOLE PINK', '30', 900, '150 PAC', 1, ''],
  [12, 'PARCEL', '40/2 COTOON-WATER 11', 'JJH', 'WATER', '1 HOLE BLUE', '50', 720, '120 PAC', 1, ''],
  [13, 'PARCEL', '40/2 COTOON-ANMOL 21', 'PLAIN', '20', '1 HOLE BLUE', '45', 720, '120PAC', 1, ''],
  [14, 'PARCEL', '40/2 COTOON-IVERY', 'PLAIN', '108', '1 HOLE PINK', '25', 900, '150 PAC', 1, ''],
  [15, 'PARCEL', '100 POLYSTER-WATER 11', 'ASHIYANA', 'WATER', 'BALAZI S/Z', '30', 1040, '4 BOX', 1, ''],
  [16, 'PARCEL', '40 NYLON-D GOLD', 'PLAIN', 'D GOLD', 'BLUE+WHITE', '100', 400, '4 BOX', 1, ''],
  [17, 'PARCEL', '70 POLYSTER-D GOLD', 'PLAIN', 'D GOLD', 'BLUE+WHITE', '100', 400, '4 BOX', 1, ''],
  [18, 'PARCEL', '70 POLYSTER-D GOLD', 'PLAIN', 'D GOLD', 'BLUE+WHITE', '95', 400, '4 BOX', 1, ''],
  [19, 'PARCEL', '75 POLYSTER-D GOLD', 'PLAIN', 'D GOLD', 'S/S', '100', 400, '4 BOX', 1, ''],
  [21, 'PARCEL', '180 BRT-R WATER', 'GLINTEX', 'WATER GOLD', 'P PUTHA', '1000', 60, '4 BORI', 1, '1*15 PER BORI'],
  [22, 'PARCEL', '70 NYLON-D GOLD', 'NEPOLEON', 'D GOLD', 'P WHITE', '250', 200, '4 BORI', 1, '1*50 PER BORI'],
  [23, 'PARCEL', '75 POLYSTER-D GOLD', 'NEPOLEON', 'D GOLD', 'P RED', '250', 200, '4 BORI', 1, '1*50 PER BORI'],
  [24, 'PARCEL', '180 CREAM-ST WATER', 'INDIAN FLORA', 'D GOLD', 'P PUTHA', '250', 250, '5 BORI', 1, '1*50 PER BORI'],
  [25, 'PARCEL', '180 BRT-SR WATER', 'PLAIN', 'WY-10-D', 'P GREEN', '220', 250, '5 BORI', 1, '1*50 PER BORI'],
  [26, 'PARCEL', '180 GOLD-ANMOL 15', 'PLAIN', 'L.ANTIC-201', 'P GREEN', '220', 250, '5 BORI', 1, '1*50 PER BORI'],
  [27, 'PARCEL', '40/2 COTTON-IVERY', 'GLINTEX', '108', 'P PUTHA', '500', 100, '4 BORI', 1, '1*25 PER BORI'],
  [28, 'PARCEL', '40/2 COTTON-IVERY', 'PLAIN', '32', 'P RED', '100', 400, '5 BORI', 1, '1*15 PER BORI'],
  [30, 'LOCAL', '30 NO COTTON-WATER D', 'GLINTEX', 'FL WATER D', 'P PUTHA', '1000', 15, '1 BORI', null, ''],
  [31, 'LOCAL', '70 NYLON-SR ANMOL', 'GLINTEX', 'ANMOL', 'P PUTHA', '500', 28, '1 BORI', null, ''],
  [32, 'LOCAL', '70 NYLON-D GOLD', 'GLINTEX', 'D GOLD', 'P PUTHA', '500', 25, '1 BORI', null, ''],
  [33, 'LOCAL', '40 NYLON-D GOLD', 'GLINTEX', 'D GOLD', 'P PUTHA', '500', 25, '1 BORI', null, ''],
  [34, 'LOCAL', '70 NYLON-SR ANMOL', 'GLINTEX', 'ANMOL YELLOW MONO DOUBLING', 'JALI PUTHA', '1000', 15, '1 BORI', null, ''],
  [35, 'LOCAL', '70 NYLON-W 10', 'GLINTEX', 'W-10', 'P PUTHA', '500', 28, '1 BORI', null, ''],
  [36, 'LOCAL', '20 NYLON-ANMOL 10(S)', 'GLINTEX BORI', 'LIGHT ANMOL', 'P PUTHA', '500', 20, '1 BORI', null, ''],
  [37, 'LOCAL', '30 NO COTTON-PINK COPPER', 'GLINTEX', 'PINK COPPER', 'P PUTHA', '1000', 15, '1 BORI', null, ''],
  [38, 'LOCAL', '30 NO COTTON-SR ANMOL', 'GLINTEX', 'ANMOL', 'P PUTHA', '1000', 15, '1 BORI', null, ''],
  [39, 'LOCAL', '30 NO COTTON-W 10', 'GLINTEX', 'W-10', 'P PUTHA', '1000', 15, '1 BORI', null, ''],
  [40, 'LOCAL', '30 NO COTTON-W 2', 'GLINTEX', 'W-2', 'P PUTHA', '1000', 15, '1 BORI', null, ''],
  [42, 'LOCAL', '20 NYLON-LG 20', 'GLINTEX', 'LM.BCH', 'P PUTHA', '500', 20, '1 BORI', null, ''],
  [43, 'LOCAL', '20 NYLON-CJ GOLD', 'GLINTEX', 'MY-44', 'P PUTHA', '500', 20, '1 BORI', null, ''],
  [44, 'LOCAL', '20 NYLON-ANMOL 10', 'GLINTEX BORI', 'LIGHT ANMOL', 'ROLLS', '350', 60, '1 BORI', null, ''],
  [45, 'LOCAL', '30 NYLON-I VERY', 'GLINTEX BORI', 'MY-16', 'ROLLS', '350', 60, '1 BORI', null, ''],
].map(([sourceRow, deliveryMode, item, brand, color, cone, gram, pcs, packageText, parcel, notes]) => ({
  sourceRow,
  deliveryMode,
  item,
  brand,
  color,
  cone,
  gram,
  pcs,
  packageText,
  parcel,
  notes,
}));

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function parsePackage(row) {
  const match = String(row.packageText || '').trim().match(/^(\d+)\s*(BOX|PAC|PACKET|BORI|PARCEL)$/i);
  const notesMatch = String(row.notes || '').match(/1\s*\*\s*(\d+)\s*PER\s*(BORI|BOX|PAC|PACKET|PARCEL)/i);
  if (!match) return { levels: [], unresolved: ['package'] };
  const containerCount = Number(match[1]);
  const rawKind = match[2].toUpperCase();
  const kind = rawKind === 'PAC' ? 'PACKET' : rawKind;
  const noteUnits = notesMatch ? Number(notesMatch[1]) : null;
  const arithmeticBaseUnits = Number(row.pcs) / containerCount;
  if (!Number.isInteger(arithmeticBaseUnits) || arithmeticBaseUnits <= 0 || arithmeticBaseUnits * containerCount !== Number(row.pcs)) {
    return { levels: [], unresolved: ['package_arithmetic'] };
  }
  if (noteUnits !== null && noteUnits !== arithmeticBaseUnits) {
    return { levels: [], unresolved: ['package_arithmetic', 'package_note_mismatch'] };
  }
  const baseUnits = arithmeticBaseUnits;
  const levels = [{ levelIndex: 1, kind, childUnitsPerContainer: baseUnits, barcodeEnabled: true }];
  if (row.deliveryMode === 'PARCEL' && Number(row.parcel || 0) === 1) {
    levels.push({ levelIndex: 2, kind: 'PARCEL', childUnitsPerContainer: containerCount, barcodeEnabled: true });
  }
  return { levels, unresolved: [] };
}

async function allMasters(tx) {
  const [items, wrappers, coneTypes] = await Promise.all([
    tx.item.findMany({ select: { id: true, name: true } }),
    tx.wrapper.findMany({ select: { id: true, name: true } }),
    tx.coneType.findMany({ select: { id: true, name: true } }),
  ]);
  return { items, wrappers, coneTypes };
}

function unambiguousMatch(records, raw) {
  const matches = records.filter((record) => normalize(record.name) === normalize(raw));
  return matches.length === 1 ? matches[0] : null;
}

async function packageTypeForKind(tx, kind) {
  const name = kind === 'PACKET' ? 'PACKET' : kind;
  return tx.packingPackageType.upsert({
    where: { normalizedName: normalize(name) },
    update: { isActive: true },
    create: { name, normalizedName: normalize(name), kind, defaultTareKg: 0, isActive: true },
  });
}

async function colorForName(tx, name) {
  const displayName = String(name || '').trim();
  const normalizedName = normalize(displayName);
  return tx.packingColor.upsert({
    where: { normalizedName },
    update: { isActive: true },
    create: { name: displayName, normalizedName, isActive: true },
  });
}

async function importRows() {
  return prisma.$transaction(async (tx) => {
    const masters = await allMasters(tx);
    const results = [];
    for (const row of SOURCE_ROWS) {
      const familyKey = `seed-row-${row.sourceRow}`;
      const existing = await tx.packingRecipe.findFirst({ where: { familyKey, version: 1 }, select: { id: true, sourceMetadata: true } });
      if (existing) {
        results.push({ sourceRow: row.sourceRow, status: 'SKIPPED', id: existing.id });
        continue;
      }
      const unresolved = [];
      const item = unambiguousMatch(masters.items, row.item);
      const wrapper = unambiguousMatch(masters.wrappers, row.brand);
      const coneType = unambiguousMatch(masters.coneTypes, row.cone);
      if (!item) unresolved.push('item');
      if (!wrapper) unresolved.push('wrapper');
      if (!coneType) unresolved.push('coneType');
      const gramNumber = Number(row.gram);
      const nominalGram = Number.isFinite(gramNumber) ? gramNumber : null;
      if (nominalGram === null) unresolved.push('gram');
      const color = await colorForName(tx, row.color);
      const packageParse = parsePackage(row);
      unresolved.push(...packageParse.unresolved.filter((value) => !unresolved.includes(value)));
      const levels = [];
      for (const level of packageParse.levels) {
        const packageType = await packageTypeForKind(tx, level.kind);
        levels.push({
          levelIndex: level.levelIndex,
          packageTypeId: packageType.id,
          childUnitsPerContainer: level.childUnitsPerContainer,
          barcodeEnabled: level.barcodeEnabled,
        });
      }
      const created = await tx.packingRecipe.create({
        data: {
          familyKey,
          version: 1,
          status: 'DRAFT',
          itemId: item?.id || null,
          wrapperId: wrapper?.id || null,
          colorId: color.id,
          coneTypeId: coneType?.id || null,
          nominalGram,
          deliveryMode: row.deliveryMode,
          allowPartialDispatch: false,
          requiresQualityHold: false,
          warningVariancePercent: 2,
          approvalVariancePercent: 5,
          stockUnitLevelIndex: 1,
          notes: row.notes || null,
          sourceMetadata: {
            importer: 'packing-workbook-v1',
            sourceRow: row.sourceRow,
            raw: row,
            normalizedPackage: row.packageText.replace(/120PAC/i, '120 PAC'),
            unresolved,
          },
          levels: levels.length ? { create: levels } : undefined,
        },
      });
      results.push({ sourceRow: row.sourceRow, status: 'CREATED', id: created.id, unresolved });
    }
    return results;
  });
}

try {
  const result = await importRows();
  console.log(JSON.stringify({ imported: result.length, result }, null, 2));
} finally {
  await prisma.$disconnect();
}
