import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

function toNumber(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim().replace(/,/g, '');
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function normalizeName(str) {
  return String(str || '').trim();
}

function extractItemAndSupplier(name) {
  const raw = normalizeName(name);
  if (!raw) return { itemName: '', supplierName: 'SML' };
  const idx = raw.lastIndexOf('-');
  if (idx === -1) return { itemName: raw, supplierName: 'SML' };
  const itemName = normalizeName(raw.slice(0, idx));
  const supplierName = normalizeName(raw.slice(idx + 1)) || 'SML';
  return { itemName, supplierName };
}

function makeIdFromName(prefix, name) {
  return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 64);
}

function buildImportFromCsv(records) {
  const itemsMap = new Map();
  const firmsMap = new Map();
  const suppliersMap = new Map();
  const lots = [];
  const inbound_items = [];
  const issue_to_machine = [];

  let lotCounter = 0;

  for (const rec of records) {
    const date = normalizeName(rec[''] || rec['Date'] || rec['S Date'] || rec['S_DATE']);
    const so = normalizeName(rec['S/O']);
    const nameOfItem = normalizeName(rec['Name of Item']);
    const firmName = normalizeName(rec['FIRM']);

    // Skip empty rows
    if (!nameOfItem && !firmName && !rec['R1'] && !rec['R2'] && !rec['R3'] && !rec['R4']) continue;

    const { itemName, supplierName } = extractItemAndSupplier(nameOfItem);

    // Ensure master IDs
    if (itemName && !itemsMap.has(itemName)) {
      itemsMap.set(itemName, makeIdFromName('item', itemName));
    }
    const itemId = itemsMap.get(itemName);

    if (firmName && !firmsMap.has(firmName)) {
      firmsMap.set(firmName, makeIdFromName('firm', firmName));
    }
    const firmId = firmsMap.get(firmName);

    const supplierKey = supplierName || 'SML';
    if (!suppliersMap.has(supplierKey)) {
      suppliersMap.set(supplierKey, makeIdFromName('supplier', supplierKey));
    }
    const supplierId = suppliersMap.get(supplierKey);

    // Collect pieces from R1..R4
    const rollFields = [
      { w: toNumber(rec['R1']), status: String(rec['R1 STATUS'] || '').trim().toUpperCase(), date: rec['R1 DATE'] },
      { w: toNumber(rec['R2']), status: String(rec['R2 STATUS'] || '').trim().toUpperCase(), date: rec['R2 DATE'] },
      { w: toNumber(rec['R3']), status: String(rec['R3 STATUS'] || '').trim().toUpperCase(), date: rec['R3 DATE'] },
      { w: toNumber(rec['R4']), status: String(rec['R4 STATUS'] || '').trim().toUpperCase(), date: rec['R4 DATE'] },
    ];

    const pieces = [];
    for (const rf of rollFields) {
      if (rf.w && Number.isFinite(rf.w)) {
        const isPending = rf.status === 'PENDING';
        const isDone = rf.status === 'DONE';
        const status = isPending ? 'available' : (isDone ? 'consumed' : 'available');
        pieces.push({ weight: rf.w, status, done: isDone, doneDate: normalizeName(rf.date) });
      }
    }

    if (!itemId || !firmId || pieces.length === 0) {
      // Skip invalid rows
      continue;
    }

    // Assign new lot number sequentially
    lotCounter += 1;
    const lotNo = String(lotCounter).padStart(3, '0');

    const totalPieces = pieces.length;
    const totalWeight = pieces.reduce((s, p) => s + (Number(p.weight) || 0), 0);

    lots.push({ lotNo, date: date || '', itemId, firmId, supplierId, totalPieces, totalWeight });

    pieces.forEach((p, idx) => {
      inbound_items.push({ id: `${lotNo}-${idx + 1}`, lotNo, itemId, weight: p.weight, status: p.status, seq: idx + 1 });
    });

    // Optional: IssueToMachine summary per lot if any DONE
    const donePieces = pieces.map((p, idx) => ({ ...p, id: `${lotNo}-${idx + 1}` })).filter(p => p.done);
    if (donePieces.length > 0) {
      const id = `iss-${lotNo}`;
      const count = donePieces.length;
      const totalDoneWeight = donePieces.reduce((s, p) => s + (Number(p.weight) || 0), 0);
      const latestDate = donePieces.map(p => p.doneDate).filter(Boolean).sort().slice(-1)[0] || (date || '');
      issue_to_machine.push({ id, date: latestDate, itemId, lotNo, count, totalWeight: totalDoneWeight, pieceIds: donePieces.map(p => p.id), reason: 'import_legacy', note: 'Imported from old software' });
    }
  }

  const items = Array.from(itemsMap.entries()).map(([name, id]) => ({ id, name }));
  const firms = Array.from(firmsMap.entries()).map(([name, id]) => ({ id, name }));
  const suppliers = Array.from(suppliersMap.entries()).map(([name, id]) => ({ id, name }));

  return { items, firms, suppliers, lots, inbound_items, issue_to_machine, lotCount: lotCounter };
}

function readCsv(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  return records;
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || path.join(process.cwd(), 'import.json');
  if (!inputPath) {
    console.error('Usage: node scripts/legacyToImportJson.mjs <input.csv> [output.json]');
    process.exit(1);
  }
  const recs = readCsv(inputPath);
  const payload = buildImportFromCsv(recs);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outputPath}. Lots: ${payload.lots.length}, Items: ${payload.items.length}, Firms: ${payload.firms.length}, Suppliers: ${payload.suppliers.length}`);
}

main();



