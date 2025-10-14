import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import path from 'path';

function trim(s){ return String(s||'').trim(); }
function toNum(s){ const v=trim(s).replace(/,/g,''); if(!v) return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function extractItemAndSupplier(name){ const raw=trim(name); const idx=raw.lastIndexOf('-'); return idx===-1?{itemName:raw,supplierName:'SML'}:{itemName:trim(raw.slice(0,idx)),supplierName:trim(raw.slice(idx+1))||'SML'}; }
function makeId(prefix, name){ return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}`.slice(0,64); }

// Usage: node scripts/importInboundAndIssueFromSheet4.mjs <Book(Sheet4).csv> <out-import.json> <out-overrides.json>
const [,, sheet4Csv, outImportJson, outOverridesJson] = process.argv;
if (!sheet4Csv || !outImportJson || !outOverridesJson) {
  console.error('Usage: node scripts/importInboundAndIssueFromSheet4.mjs <Book(Sheet4).csv> <out-import.json> <out-overrides.json>');
  process.exit(1);
}

const raw = fs.readFileSync(sheet4Csv, 'utf8');
const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });

const items = new Map();
const firms = new Map();
const suppliers = new Map();
const lots = [];
const inbound_items = [];
const issue_to_machine = [];
const overrides = {}; // SO -> lotNo

// We will assign new lot numbers after existing ones: we cannot know DB last; caller can remap later.
// For this standalone JSON, we allocate sequentially starting from 1001 (avoids collision with 001..).
let lotCounter = 1000;

for (const r of rows) {
  const so = trim(r['S/O']);
  const name = trim(r['Name of Item']);
  const firmName = trim(r['FIRM']);
  if (!so || !name || !firmName) continue;

  const { itemName, supplierName } = extractItemAndSupplier(name);
  if (itemName && !items.has(itemName)) items.set(itemName, makeId('item', itemName));
  if (firmName && !firms.has(firmName)) firms.set(firmName, makeId('firm', firmName));
  if (supplierName && !suppliers.has(supplierName)) suppliers.set(supplierName, makeId('supplier', supplierName));

  const itemId = items.get(itemName);
  const firmId = firms.get(firmName);
  const supplierId = suppliers.get(supplierName);

  // Gather pieces from R1..R4
  const rolls = [
    { w: toNum(r['R1']), status: trim(r['R1 STATUS']).toUpperCase(), date: trim(r['R1 DATE']) },
    { w: toNum(r['R2']), status: trim(r['R2 STATUS']).toUpperCase(), date: trim(r['R2 DATE']) },
    { w: toNum(r['R3']), status: trim(r['R3 STATUS']).toUpperCase(), date: trim(r['R3 DATE']) },
    { w: toNum(r['R4']), status: trim(r['R4 STATUS']).toUpperCase(), date: trim(r['R4 DATE']) },
  ].filter(p => p.w && Number.isFinite(p.w));

  if (rolls.length === 0) continue;

  lotCounter += 1;
  const lotNo = String(lotCounter);
  overrides[so] = lotNo;

  const totalPieces = rolls.length;
  const totalWeight = rolls.reduce((s,p)=>s+(p.w||0),0);
  lots.push({ lotNo, date: trim(r['']||r['DATE']||''), itemId, firmId, supplierId, totalPieces, totalWeight });

  rolls.forEach((p, idx) => {
    const isPending = p.status === 'PENDING';
    const isDone = p.status === 'DONE';
    const status = isPending ? 'available' : (isDone ? 'consumed' : 'available');
    inbound_items.push({ id: `${lotNo}-${idx+1}`, lotNo, itemId, weight: p.w, status, seq: idx+1 });
  });

  const done = rolls.map((p, idx)=>({ ...p, id: `${lotNo}-${idx+1}` })).filter(p=>p.status==='DONE');
  if (done.length > 0) {
    const id = `iss-${lotNo}`;
    const count = done.length;
    const totalDoneWeight = done.reduce((s,p)=>s+(p.w||0),0);
    const latestDate = done.map(p=>p.date).filter(Boolean).sort().slice(-1)[0] || '';
    issue_to_machine.push({ id, date: latestDate, itemId, lotNo, count, totalWeight: totalDoneWeight, pieceIds: done.map(p=>p.id), reason: 'import_legacy', note: 'Imported from sheet4' });
  }
}

const out = {
  items: Array.from(items, ([name,id])=>({ id, name })),
  firms: Array.from(firms, ([name,id])=>({ id, name })),
  suppliers: Array.from(suppliers, ([name,id])=>({ id, name })),
  lots,
  inbound_items,
  issue_to_machine,
};

fs.writeFileSync(outImportJson, JSON.stringify(out, null, 2));
fs.writeFileSync(outOverridesJson, JSON.stringify(overrides, null, 2));
console.log(`Wrote ${outImportJson} (lots=${lots.length}) and overrides ${outOverridesJson}`);


