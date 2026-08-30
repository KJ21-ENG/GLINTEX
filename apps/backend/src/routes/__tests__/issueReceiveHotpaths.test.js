import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  fetchConingRollTypeNameByIssueIdForReceiveRows,
  receiveTargetedFacetFieldsForProcess,
  resolveHoloCutNameByIssueIdForReceiveRows,
} from '../v2.js';

const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const v2Source = readFileSync(new URL('../v2.js', import.meta.url), 'utf8');
const receiveLabelDataSource = readFileSync(
  new URL('../../../../frontend/src/utils/receiveLabelData.js', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Holo source lookup prefers modern barcode and only then checks legacy notes', () => {
  const route = section(
    indexSource,
    "router.get('/api/issue_to_holo_machine/source-row/lookup'",
    "router.get('/api/issue_to_coning_machine/source-row/lookup'",
  );
  const exactLookup = route.indexOf("barcode: { equals: barcode, mode: 'insensitive' }");
  const legacyLookup = route.indexOf("notes: { equals: barcode, mode: 'insensitive' }");
  assert.ok(exactLookup >= 0);
  assert.ok(legacyLookup > exactLookup);
  assert.match(route, /barcodeRows\.length === 1/);
  assert.match(route, /noteRows\.length === 1/);
  assert.match(route, /noteRows\.length > 0/);
  assert.match(route, /duplicate_legacy_match/);
  assert.match(route, /buildHoloSourceLookupPayload/);
  assert.match(route, /requirePermission\('issue\.holo', PERM_READ\)/);
  assert.match(
    indexSource,
    /router\.get\('\/api\/issue_to_coning_machine\/source-row\/lookup', requirePermission\('issue\.coning', PERM_READ\)/,
  );
});

test('Issue barcode lookups expose bounded hydration and authoritative balances', () => {
  const holo = section(indexSource, 'async function buildHoloIssueLookupPayload', 'async function buildConingIssueLookupPayload');
  const coning = section(indexSource, 'async function buildConingIssueLookupPayload', 'async function fetchHoloReceiveData');
  for (const payload of [holo, coning]) {
    assert.match(payload, /const sourceIds = allSourceIds;/);
    assert.match(payload, /ISSUE_LOOKUP_RECEIVE_LIMIT/);
    assert.match(payload, /issueBalance:/);
    assert.match(payload, /hasReceives:/);
    assert.match(payload, /receivesTruncated/);
  }
  assert.match(holo, /pieceTotals/);
  assert.match(coning, /pieceTotal/);
  assert.match(coning, /coneTypeWeight/);
  assert.match(coning, /rollTypeName/);
});

test('Holo and Coning receive writes return their authoritative updated totals', () => {
  const holo = section(
    indexSource,
    "router.post('/api/receive_from_holo_machine/manual'",
    "router.put('/api/receive_from_holo_machine/rows/:id'",
  );
  const coning = section(
    indexSource,
    "router.post('/api/receive_from_coning_machine/manual'",
    "router.post('/api/receive_from_coning_machine/mark_wastage'",
  );

  assert.match(holo, /const pieceTotal = await prisma\.receiveFromHoloMachinePieceTotal\.upsert/);
  assert.match(holo, /let issueBalance = null/);
  assert.match(holo, /computeIssueBalancesBatch\(prisma, 'holo', \[issue\]\)/);
  assert.match(holo, /Failed to enrich Holo receive response balance/);
  assert.match(holo, /issueBalance,/);
  assert.match(holo, /pieceTotal,/);

  assert.match(coning, /const pieceTotal = await prisma\.receiveFromConingMachinePieceTotal\.upsert/);
  assert.match(coning, /let issueBalance = null/);
  assert.match(coning, /computeIssueBalancesBatch\(prisma, 'coning', \[issue\]\)/);
  assert.match(coning, /Failed to enrich Coning receive response balance/);
  assert.match(coning, /issueBalance,/);
  assert.match(coning, /pieceTotal,/);
});

test('Coning source accounting joins expanded refs to a hashed target set', () => {
  const helper = section(indexSource, 'async function buildHoloIssuedToConingMap', 'function getHoloRowNetWeight');
  assert.match(helper, /WITH target_rows AS/);
  assert.match(helper, /JOIN target_rows ON target_rows\.row_id = elem->>'rowId'/);
  assert.doesNotMatch(helper, /elem->>'rowId' = ANY/);
  assert.match(helper, /takeBack\?\.isReverse \? 1 : -1/);
});

test('Coning source lookup keeps count and weight independent and accepts both receive stages', () => {
  const payload = section(
    indexSource,
    'async function buildConingSourceLookupPayload',
    'async function buildHoloIssueLookupPayload',
  );
  assert.match(payload, /sourceStage === 'coning'/);
  assert.match(payload, /totalRolls - dispatchedCount - Number\(issuedToConing\.issuedRolls \|\| 0\)/);
  assert.doesNotMatch(payload, /calcAvailableCountFromWeight/);
  assert.match(payload, /availableWeight = Math\.max\(0, totalWeight - dispatchedWeight/);

  const route = section(
    indexSource,
    "router.get('/api/issue_to_coning_machine/source-row/lookup'",
    "router.post('/api/issue_to_coning_machine'",
  );
  assert.match(route, /receiveFromHoloMachineRow\.findMany/);
  assert.match(route, /receiveFromConingMachineRow\.findMany/);
  assert.match(route, /sourceStage: 'holo'/);
  assert.match(route, /sourceStage: 'coning'/);
  assert.match(route, /buildConingSourceLookupPayload\(match\.row, match\.sourceStage\)/);
  assert.match(route, /duplicate_barcode_match/);
  assert.match(route, /duplicate_legacy_match/);
  assert.match(route, /outcome: 'deleted'/);
  assert.match(route, /outcome: 'not_found'/);
});

test('Receive history supports exact issueId and one-facet requests', () => {
  const history = section(
    v2Source,
    "router.get('/receive/:process/history'",
    'async function fetchReceiveShiftFacet',
  );
  assert.match(history, /const issueId = normalizeText\(req\.query\.issueId\)/);
  assert.match(history, /\.\.\.\(issueId \? \{ issueId \} : \{\}\)/);
  assert.match(history, /includeLabelLineage: false/);
  assert.match(history, /enrichReceiveRowsWithLabelLineage\(process, pageCandidates\.slice\(0, limit\)\)/);

  const facets = section(
    v2Source,
    "router.get('/receive/:process/history/facets'",
    "router.get('/receive/:process/history/export.json'",
  );
  const targetedBranch = facets.indexOf('if (field)');
  const legacyAllQueries = facets.indexOf('Promise.all');
  assert.ok(targetedBranch >= 0);
  assert.ok(legacyAllQueries > targetedBranch);
  assert.match(facets, /facets: \{ \[field\]: values \}/);
});

test('Targeted receive facets enumerate every supported values field', () => {
  const shared = [
    'machine',
    'operator',
    'employee',
    'helper',
    'item',
    'cut',
    'yarn',
    'twist',
    'box',
    'bobbin',
    'coneType',
    'addedBy',
    'shift',
  ];
  assert.deepEqual(receiveTargetedFacetFieldsForProcess('holo'), shared);
  assert.deepEqual(receiveTargetedFacetFieldsForProcess('coning'), shared);
  assert.deepEqual(receiveTargetedFacetFieldsForProcess('cutter'), [...shared, 'piece']);
});

test('Holo receive labels fall back to every traced Cutter cut when the direct cut is blank', () => {
  const cutNames = resolveHoloCutNameByIssueIdForReceiveRows([
    {
      issueId: 'holo-mixed',
      issue: {
        id: 'holo-mixed',
        cut: null,
        receivedRowRefs: [{ rowId: 'cutter-2' }, { rowId: 'cutter-1' }, { rowId: 'cutter-2' }],
      },
    },
    {
      issueId: 'holo-direct',
      issue: {
        id: 'holo-direct',
        cut: { name: 'Direct Cut' },
        receivedRowRefs: [{ rowId: 'cutter-1' }],
      },
    },
  ], [
    { id: 'cutter-1', cut: 'Raw Cut' },
    { id: 'cutter-2', cut: 'stale', cutMaster: { name: 'Master Cut' } },
  ]);

  assert.equal(cutNames.get('holo-mixed'), 'Master Cut, Raw Cut');
  assert.equal(cutNames.get('holo-direct'), 'Direct Cut');
});

test('Coning receive labels batch-trace roll type through recursive re-coning lineage', async () => {
  const holoRows = [
    { id: 'holo-fine', rollType: { name: 'Fine Roll' } },
    { id: 'holo-heavy', rollType: { name: 'Heavy Roll' } },
  ];
  const coningRows = [
    { id: 'reconing-source', issueId: 'parent-issue' },
    { id: 'cycle-source', issueId: 'target-issue' },
  ];
  const coningIssues = [
    {
      id: 'target-issue',
      receivedRowRefs: [{ rowId: 'holo-fine' }, { rowId: 'reconing-source' }],
    },
    {
      id: 'parent-issue',
      receivedRowRefs: [{ rowId: 'holo-heavy' }, { rowId: 'cycle-source' }],
    },
  ];
  const selectIds = (rows, query) => {
    const ids = new Set(query?.where?.id?.in || []);
    return rows.filter((row) => ids.has(row.id));
  };
  const db = {
    receiveFromHoloMachineRow: {
      findMany: async (query) => selectIds(holoRows, query),
    },
    receiveFromConingMachineRow: {
      findMany: async (query) => selectIds(coningRows, query),
    },
    issueToConingMachine: {
      findMany: async (query) => selectIds(coningIssues, query),
    },
  };

  const names = await fetchConingRollTypeNameByIssueIdForReceiveRows([
    { issueId: 'target-issue', issue: coningIssues[0] },
  ], db);

  assert.equal(names.get('target-issue'), 'Fine Roll, Heavy Roll');
});

test('Receive reprints prefer bounded server lineage fields over client history maps', () => {
  assert.match(receiveLabelDataSource, /const flattenedCut = row\?\.cutName/);
  assert.match(receiveLabelDataSource, /let rollType = row\?\.rollTypeName/);
});
