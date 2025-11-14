import fs from 'fs';
import { parse } from 'csv-parse/sync';

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => String(r[h] ?? '')).join(','));
  return lines.join('\n');
}

// Usage: node scripts/filterReceiveByExisting.mjs <inputCsv> <backupJson> <outCsv>
const [,, inputCsv, backupJson, outCsv] = process.argv;
if (!inputCsv || !backupJson || !outCsv) {
  console.error('Usage: node scripts/filterReceiveByExisting.mjs <inputCsv> <backupJson> <outCsv>');
  process.exit(1);
}

const csvText = fs.readFileSync(inputCsv, 'utf8');
const records = parse(csvText, { columns: true, skip_empty_lines: true });

const backup = JSON.parse(fs.readFileSync(backupJson, 'utf8'));
const existing = new Set((backup.receive_rows || []).map(r => r.vchNo));

const filtered = records.filter(r => !existing.has(r.VchNo));
fs.writeFileSync(outCsv, toCsv(filtered));
console.log(`Filtered ${records.length - filtered.length} duplicates, kept ${filtered.length}. Wrote ${outCsv}`);


