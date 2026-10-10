// Writes the factory label designs to the backend as data, so the seed script and the
// Docker image never import frontend source. Run after editing utils/label/defaults.js:
//   node apps/frontend/scripts/export-label-defaults.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STAGE_TEMPLATES } from '../src/utils/label/defaults.js';
import { normalizeTemplate } from '../src/utils/label/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../backend/scripts/stickerTemplates.v2.json');
const templates = Object.entries(DEFAULT_STAGE_TEMPLATES).map(([stageKey, template]) => {
  const normalized = normalizeTemplate(template);
  return { stageKey: `v2:${stageKey}`, stage: stageKey, dimensions: { version: 2, ...normalized.media }, content: normalized };
});
fs.writeFileSync(target, `${JSON.stringify({ generatedBy: 'apps/frontend/scripts/export-label-defaults.mjs', templates }, null, 1)}\n`);
console.log(`Wrote ${templates.length} stage templates to ${path.relative(process.cwd(), target)}`);
