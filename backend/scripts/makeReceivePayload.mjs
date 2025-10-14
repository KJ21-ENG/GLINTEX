import fs from 'fs';

// Usage: node scripts/makeReceivePayload.mjs <csvPath> <outJsonPath> [filename]
const csvPath = process.argv[2];
const outPath = process.argv[3];
const filename = process.argv[4] || 'receive_import.csv';

if (!csvPath || !outPath) {
  console.error('Usage: node scripts/makeReceivePayload.mjs <csvPath> <outJsonPath> [filename]');
  process.exit(1);
}

const content = fs.readFileSync(csvPath, 'utf8');
const payload = {
  filename,
  content,
};

fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(`Wrote payload to ${outPath}`);


