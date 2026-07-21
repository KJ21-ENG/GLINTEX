import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guardrail: every column filter the frontend exposes must have a backend handler.
// The root cause of the 2026-07 dead-filter audit was that the UI rendered filter
// controls for columns the backend filter maps never handled, so `buildFilterWhere`
// silently dropped them and returned all rows. This test fails if that gap reopens.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const v2 = read('apps/backend/src/routes/v2.js');

// Grab the body of a `const NAME = { ... };` block (up to the first column-0 `};`).
function blockBody(src, name) {
  const startMarker = `const ${name} = {`;
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, `Could not find ${name} in v2.js`);
  const end = src.indexOf('\n};', start);
  assert.ok(end !== -1, `Could not find end of ${name} in v2.js`);
  return src.slice(start, end);
}

// Top-level filter-map keys are 2-space-indented `key: {`.
function mapKeys(name) {
  const body = blockBody(v2, name);
  return new Set([...body.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]));
}

// Computed-field configs are `{ process: new Set([...ids]) }`; collect every quoted id.
function computedIds(name) {
  const body = blockBody(v2, name);
  return new Set([...body.matchAll(/'(\w+)'/g)].map((m) => m[1]));
}

// Async side-path filters handled outside the *_FILTERS maps.
const SIDE_PATHS = new Set(['item', 'coneType', 'addedBy']);

const backendSupported = new Set([
  ...mapKeys('RECEIVE_FILTERS'),
  ...mapKeys('ISSUE_FILTERS'),
  ...computedIds('ISSUE_COMPUTED_FIELDS'),
  ...computedIds('ON_MACHINE_COMPUTED_FIELDS'),
  ...computedIds('RECEIVE_COMPUTED_FIELDS'),
  ...SIDE_PATHS,
]);

// Frontend filter columns: `{ id: 'x', label: 'Y', kind: '...' , getValue: ... }`.
const FRONTEND_FILES = [
  'apps/frontend/src/components/receive/ReceiveHistoryTable.jsx',
  'apps/frontend/src/pages/IssueHistory.jsx',
  'apps/frontend/src/components/issue/OnMachineTable.jsx',
];

function frontendFilterIds(rel) {
  const src = read(rel);
  return [...src.matchAll(/id:\s*'(\w+)',\s*label:\s*'[^']*',\s*kind:/g)].map((m) => m[1]);
}

for (const rel of FRONTEND_FILES) {
  test(`every filter column in ${path.basename(rel)} has a backend handler`, () => {
    const ids = frontendFilterIds(rel);
    assert.ok(ids.length > 0, `No filter columns detected in ${rel} — regex may be stale`);
    const unbacked = [...new Set(ids)].filter((id) => !backendSupported.has(id));
    assert.deepEqual(
      unbacked,
      [],
      `These UI filter ids have NO backend handler (dead filter): ${unbacked.join(', ')}. `
        + 'Add them to RECEIVE_FILTERS/ISSUE_FILTERS, a computed-field set, or a side-path resolver.',
    );
  });
}

// Sanity: the specific ids the 2026-07 audit flagged must now be backed.
test('audit-flagged dead filters are now backed', () => {
  const mustBeBacked = [
    'coneType', 'notes', 'weight', 'netWt', 'cones', 'rolls', 'bobbin', 'bobbinQty',
    'perCone', 'piece', 'addedBy', 'qty', 'metallicBobbins', 'metallicBobbinsWeight',
    'yarnKg', 'rollsProducedEstimate', 'rollsIssued', 'issuedWeight', 'receivedWeight',
    'pendingWeight', 'actualG',
  ];
  const missing = mustBeBacked.filter((id) => !backendSupported.has(id));
  assert.deepEqual(missing, [], `Audit-flagged filters lost their backend handler: ${missing.join(', ')}`);
});
