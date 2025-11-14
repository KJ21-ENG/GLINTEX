import fs from 'fs';
import { parse } from 'csv-parse/sync';

function trim(s) { return String(s || '').trim(); }
function toKgNumber(s) {
  const v = trim(s).replace(/\s*K\.G\.|\s*KG\.?/ig, '').replace(/,/g,'');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Build S/O -> new lotNo map from import.json lots by correlating items/firms sequence
function normalizeItemNameWithoutSupplier(name) {
  const raw = trim(name);
  if (!raw) return '';
  const idx = raw.lastIndexOf('-');
  return idx === -1 ? raw : trim(raw.slice(0, idx));
}

function buildSoToLotNoMap(sheet1CsvPath, importJsonPath) {
  const raw1 = fs.readFileSync(sheet1CsvPath, 'utf8');
  const rows1 = parse(raw1, { columns: true, skip_empty_lines: true, relax_column_count: true });
  // Keep original order in CSV for rows that have any R? weight
  const sheet1Orders = [];
  for (const r of rows1) {
    const so = trim(r['S/O']);
    const name = normalizeItemNameWithoutSupplier(r['Name of Item']);
    const firm = trim(r['FIRM']);
    const anyWeight = ['R1','R2','R3','R4'].some(k => toKgNumber(r[k]) || Number(r[k]));
    if (so && name && firm && anyWeight) {
      sheet1Orders.push({ so, name, firm });
    }
  }

  const imp = JSON.parse(fs.readFileSync(importJsonPath, 'utf8'));
  const itemIdToName = new Map(imp.items.map(i => [i.id, i.name]));
  const firmIdToName = new Map(imp.firms.map(f => [f.id, f.name]));
  const lots = imp.lots;

  // lots are in assigned sequential order already; map positionally by matching item+firm name
  const pairs = lots.map(l => ({ lotNo: l.lotNo, itemName: normalizeItemNameWithoutSupplier(itemIdToName.get(l.itemId) || ''), firmName: firmIdToName.get(l.firmId) || '' }));

  const soToLot = new Map();
  let j = 0;
  for (const s of sheet1Orders) {
    // advance j to next matching item+firm
    while (j < pairs.length) {
      const p = pairs[j];
      j++;
      if (trim(p.itemName) === trim(s.name) && trim(p.firmName) === trim(s.firm)) {
        soToLot.set(s.so, p.lotNo);
        break;
      }
    }
  }
  return soToLot;
}

function makeVchNo(lotNo, rollLabel, chalan) {
  const c = trim(chalan).replace(/\s+/g, '');
  return `${lotNo}-${rollLabel}-${c || 'X'}`;
}

function transformSheet2(sheet2CsvPath, soToLotNo) {
  const raw = fs.readFileSync(sheet2CsvPath, 'utf8');
  const rows = parse(raw, {
    columns: (header) => header.map((h, i) => `${h}`.trim() + `__${i}`), // uniquify duplicate headers
    skip_empty_lines: true,
    relax_column_count: true
  });

  const outRows = [];
  let current = { date: '', so: '', item: '' };

  for (const r of rows) {
    const date = trim(r['DATE__0']);
    const so = trim(r['S/O__1'] || r['S/O__0']);
    const item = trim(r['NAME OF ITEM__2'] || r['NAME OF ITEM__0']);
    const roll = trim(r['ROLL NO.__3'] || r['ROLL NO.__0']); // e.g., R1 / R2 / R3 / R4

    if (date || so || item) {
      current = { date, so, item };
    }
    if (!roll) continue;

    const lotNo = soToLotNo.get(current.so) || '';
    if (!lotNo) continue;

    const rollIdx = (/^R(\d)$/i.test(roll) ? Number(roll.slice(1)) : null);
    if (!rollIdx || rollIdx < 1 || rollIdx > 4) continue;
    const pieceId = `${lotNo}-${rollIdx}`;

    // read CHALAN NO., WEIGHT repeated pairs across columns
    const pairs = [];
    const headers = Object.keys(r);
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const base = h.split('__')[0].toUpperCase();
      if (base === 'CHALAN NO.') {
        const weightHeader = headers[i + 1];
        const ch = trim(r[h]);
        const wt = toKgNumber(r[weightHeader]);
        if (ch || (wt && wt > 0)) {
          pairs.push({ chalan: ch, weight: wt });
        }
      }
    }

    for (const p of pairs) {
      if (!p.weight || p.weight <= 0) continue;
      const vchNo = makeVchNo(lotNo, roll.toUpperCase(), p.chalan);
      outRows.push({
        'Narration': pieceId,
        'VchNo': vchNo,
        'Date': current.date,
        'Item': current.item,
        'Net Wt': p.weight,
      });
    }
  }

  return outRows;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = ['Narration','VchNo','Date','Item','Net Wt'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const vals = headers.map(h => String(r[h] ?? ''));
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}

function main() {
  const sheet1Csv = process.argv[2];
  const sheet2Csv = process.argv[3];
  const importJson = process.argv[4];
  const outCsv = process.argv[5];
  const overridesPath = process.argv[6]; // optional JSON: { "SO/xxx": "lotNo" }
  if (!sheet1Csv || !sheet2Csv || !importJson || !outCsv) {
    console.error('Usage: node scripts/receiveFromMachineFromSheet2.mjs <Book(Sheet1).csv> <Book(Sheet2).csv> <import.json> <out.csv> [overrides.json]');
    process.exit(1);
  }
  const soMap = buildSoToLotNoMap(sheet1Csv, importJson);
  if (overridesPath && fs.existsSync(overridesPath)) {
    const ov = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    for (const [k, v] of Object.entries(ov)) {
      soMap.set(k, v);
    }
  }
  const rows = transformSheet2(sheet2Csv, soMap);
  fs.writeFileSync(outCsv, toCsv(rows));
  console.log(`Wrote ${outCsv} rows=${rows.length}`);
}

main();


