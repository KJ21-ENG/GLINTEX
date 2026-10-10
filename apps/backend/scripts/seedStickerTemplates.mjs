// Seeds the factory label designs (version 2) for every stage.
// The designs are data exported from the frontend: apps/frontend/scripts/export-label-defaults.mjs
// Usage: node scripts/seedStickerTemplates.mjs [--only-missing] [--file <designs.json>]
// --file seeds another design set in the same format, e.g. scripts/stickerTemplates.production.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../src/lib/prisma.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fileArg = process.argv.indexOf('--file');
const source = fileArg >= 0 ? path.resolve(process.cwd(), process.argv[fileArg + 1] || '') : path.join(here, 'stickerTemplates.v2.json');
const { templates } = JSON.parse(fs.readFileSync(source, 'utf8'));
const onlyMissing = process.argv.includes('--only-missing');
console.log('Seeding', templates.length, 'designs from', path.relative(process.cwd(), source));

async function seed() {
  for (const t of templates) {
    const id = `template-${t.stageKey}-seed`;
    if (onlyMissing) {
      const existing = await prisma.stickerTemplate.findUnique({ where: { stageKey: t.stageKey } });
      if (existing) { console.log('Kept', t.stageKey); continue; }
    }
    await prisma.stickerTemplate.upsert({
      where: { stageKey: t.stageKey },
      update: { dimensions: t.dimensions, content: t.content },
      create: { id, stageKey: t.stageKey, dimensions: t.dimensions, content: t.content },
    });
    console.log('Upserted', t.stageKey);
  }
  const all = await prisma.stickerTemplate.findMany();
  console.log('Total sticker templates:', all.length);
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
