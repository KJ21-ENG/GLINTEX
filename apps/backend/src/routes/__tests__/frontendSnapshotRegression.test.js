import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDir, '../../../../..');
const frontendSource = join(repositoryRoot, 'apps/frontend/src');

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceFiles(path));
    if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

test('operational frontend never requests a legacy full process snapshot', async () => {
  const files = await listSourceFiles(frontendSource);
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/full\s*:\s*true|[?&]full=true/.test(source)) {
      offenders.push(relative(repositoryRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test('issue and receive mutations do not await process snapshot refreshes', async () => {
  const roots = [
    join(frontendSource, 'components/issue'),
    join(frontendSource, 'components/receive'),
  ];
  const explicitFiles = [
    join(frontendSource, 'pages/IssueHistory.jsx'),
    join(frontendSource, 'pages/IssueToMachine.jsx'),
    join(frontendSource, 'pages/ReceiveFromMachine.jsx'),
  ];
  const files = [...(await Promise.all(roots.map(listSourceFiles))).flat(), ...explicitFiles];
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/await\s+refreshProcessData\s*\(/.test(source)) {
      offenders.push(relative(repositoryRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test('stock and combined stock never load a legacy process module', async () => {
  const files = [
    join(frontendSource, 'pages/Stock.jsx'),
    join(frontendSource, 'components/stock/CombinedStockView.jsx'),
    join(frontendSource, 'components/stock/BobbinView.jsx'),
    join(frontendSource, 'components/stock/HoloView.jsx'),
    join(frontendSource, 'components/stock/ConingView.jsx'),
  ];
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/ensureModuleData\s*\(\s*['"]process['"]|fetchProcessData\s*\(/.test(source)) {
      offenders.push(relative(repositoryRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test('combined stock keeps pagination user-driven instead of draining every cursor', async () => {
  const source = await readFile(join(frontendSource, 'components/stock/CombinedStockView.jsx'), 'utf8');
  assert.doesNotMatch(source, /state\.lotsHasMore[\s\S]{0,160}state\.loadMoreLots\(\)/);
  assert.match(source, /hasMore=\{state\.hasMore\}/);
  assert.match(source, /onLoadMore=\{state\.onLoadMore\}/);
  assert.match(source, /hasMore=\{jumboV2\.lotsHasMore\}/);
  assert.match(source, /loadGroups: displayMode === 'full' \|\| expandedSections\.has\('jumbo'\)/);
  assert.match(source, /loadGroups: displayMode === 'full' \|\| expandedSections\.has\('coning'\)/);
});

test('rows render independently from exact separate summaries', async () => {
  const onMachine = await readFile(join(frontendSource, 'components/issue/OnMachineTable.jsx'), 'utf8');
  const stockHook = await readFile(join(frontendSource, 'hooks/useV2StockLots.js'), 'utf8');
  assert.match(onMachine, /summaryMode: 'separate'/);
  assert.match(onMachine, /getV2OnMachineSummary/);
  assert.match(onMachine, /Calculating totals…/);
  assert.match(stockHook, /getV2StockSummary/);
  assert.match(stockHook, /summaryMode: 'separate'/);
  assert.match(stockHook, /new AbortController\(\)/);
});

test('API origin and cursor request ownership are environment and generation safe', async () => {
  const apiBase = await readFile(join(frontendSource, 'api/base.js'), 'utf8');
  const cursorHook = await readFile(join(frontendSource, 'hooks/useV2CursorList.js'), 'utf8');
  assert.match(apiBase, /if \(!import\.meta\.env\?\.DEV\) return window\.location\.origin/);
  assert.match(apiBase, /window\.location\.hostname}:4000/);
  assert.match(cursorHook, /const requestToken = Symbol\('v2-page-request'\)/);
  assert.match(cursorHook, /activePageRequestRef\.current === requestToken/);
  assert.match(cursorHook, /const pageOwnsSummary = !fetchSummaryRef\.current/);
  assert.match(cursorHook, /pageOwnsSummary && res\?\.summary != null/);
  assert.doesNotMatch(cursorHook, /inFlightRef/);
});

test('Cutter challan mutations invalidate challans, receive history, and stock', async () => {
  const source = await readFile(join(frontendSource, 'components/receive/ReceiveHistoryTable.jsx'), 'utf8');
  assert.match(source, /invalidateCutterChallanViews/);
  assert.match(source, /INVENTORY_INVALIDATION_KEYS\.receiveHistory\('cutter'\)/);
  assert.match(source, /INVENTORY_INVALIDATION_KEYS\.stock\('cutter'\)/);
  assert.match(source, /invalidateCutterChallanViews\('updateCutterReceiveChallan'/);
  assert.match(source, /invalidateCutterChallanViews\('deleteCutterReceiveChallan'/);
});

test('Cutter grouped stock and post-mutation projections retain authoritative identity', async () => {
  const stock = await readFile(join(frontendSource, 'pages/Stock.jsx'), 'utf8');
  const issue = await readFile(join(frontendSource, 'components/issue/IssueToCutter.jsx'), 'utf8');
  const history = await readFile(join(frontendSource, 'pages/IssueHistory.jsx'), 'utf8');
  assert.match(stock, /lot\.groupKey \|\| lot\.lotNo \|\| lot\.lotKey/);
  assert.match(issue, /candidateRefreshNonce/);
  assert.match(issue, /setScannedPieces\(\(prev\) => prev\.filter\(\(piece\) => !pieceIds\.includes\(piece\.id\)\)\)/);
  assert.match(issue, /setCandidateRefreshNonce\(\(value\) => value \+ 1\)/);
  assert.match(history, /INVENTORY_INVALIDATION_KEYS\.issueHistory\('cutter'\)/);
  assert.match(history, /INVENTORY_INVALIDATION_KEYS\.issueOnMachine\('cutter'\)/);
});

test('stock pagination preserves grouped identities and resets stale load-more state', async () => {
  const source = await readFile(join(frontendSource, 'hooks/useV2StockLots.js'), 'utf8');
  assert.match(source, /item\?\.groupKey \|\| item\?\.lotKey/);
  assert.match(source, /const existingKeys = new Set/);
  assert.match(source, /setV2LotsLoadingMore\(false\);[\s\S]{0,180}setV2LotsLoading\(true\)/);
});

test('expanded stock rows stay user-driven instead of draining every cursor', async () => {
  const hook = await readFile(join(frontendSource, 'hooks/useV2StockLots.js'), 'utf8');
  const control = await readFile(join(frontendSource, 'components/stock/LotRowsLoadMore.jsx'), 'utf8');
  assert.doesNotMatch(hook, /getAllV2StockLotRows/);
  assert.match(hook, /getV2StockLotRows\(processId, \{ key: lotKey, limit: 100 \}, \{ signal: controller\.signal \}\)/);
  assert.match(hook, /loadMoreV2LotRows/);
  assert.match(control, /Load more rows/);
});

test('Cutter challan actions fail closed when targeted row hydration fails', async () => {
  const source = await readFile(join(frontendSource, 'components/receive/ReceiveHistoryTable.jsx'), 'utf8');
  assert.match(source, /api\.getCutterReceiveChallan\(challanId\)/);
  assert.match(source, /if \(!Array\.isArray\(res\?\.rows\)\) throw/);
  assert.doesNotMatch(source, /getChallanEntriesLocal|return local/);
});

test('Issue Tracking and On Machine continuation is explicitly user-driven', async () => {
  const issue = await readFile(join(frontendSource, 'pages/IssueHistory.jsx'), 'utf8');
  const onMachine = await readFile(join(frontendSource, 'components/issue/OnMachineTable.jsx'), 'utf8');
  assert.match(issue, /useV2CursorList/);
  assert.match(issue, /onClick=\{v2List\.loadMore\}/);
  assert.doesNotMatch(issue, /useV2PagedList|<TablePagination/);
  assert.match(onMachine, /onClick=\{v2List\.loadMore\}/);
  assert.doesNotMatch(onMachine, /useInfiniteScrollSentinel|loadMoreRef/);
});

test('take-back actions use free source selection with an authoritative shared cap and latest detail', async () => {
  const source = await readFile(join(frontendSource, 'components/issue/OnMachineTable.jsx'), 'utf8');
  assert.doesNotMatch(source, /pendingCountPool|pendingWeightPool/);
  assert.match(source, /process === 'holo' \|\| process === 'coning'[\s\S]{0,180}takeBackTarget\?\.pendingWeight/);
  assert.match(source, /const detail = await v2\.getV2IssueActionDetail\(process, entry\.id\);[\s\S]{0,120}activeTakeBacks/);
  assert.doesNotMatch(source, /let latest = latestReversibleTakeBackByIssue\.get/);
});

test('targeted issue balances win until a newer mutation balance arrives', async () => {
  const helper = await readFile(join(frontendSource, 'utils/issueBalance.js'), 'utf8');
  const files = ['CutterReceiveForm.jsx', 'HoloReceiveForm.jsx', 'ConingReceiveForm.jsx'];
  assert.match(helper, /cachedTime > issueTime \? cachedBalance : issueBalance/);
  for (const file of files) {
    const source = await readFile(join(frontendSource, 'components/receive', file), 'utf8');
    assert.match(source, /chooseLatestIssueBalance/);
    assert.doesNotMatch(source, /db\?\.issue_balances\?\.\[[^\]]+\] \|\| rawIssue\.issueBalance/);
  }
});

test('Coning issue and legacy first-receive flows preserve authoritative cone tare metadata', async () => {
  const issueForm = await readFile(join(frontendSource, 'components/issue/IssueToConing.jsx'), 'utf8');
  const receiveForm = await readFile(join(frontendSource, 'components/receive/ConingReceiveForm.jsx'), 'utf8');
  assert.match(issueForm, /if \(!form\.coneTypeId\) \{ alert\('Select cone type'\); return; \}/);
  assert.match(issueForm, /disabled=\{submitting \|\| crates\.length === 0 \|\| !form\.coneTypeId\}/);
  assert.match(receiveForm, /Cone Type required for this legacy issue/);
  assert.match(receiveForm, /coneTypeId: issueConeTypeId \|\| null/);
  assert.match(receiveForm, /issueToConingMachine\?\.receivedRowRefs/);
  assert.match(receiveForm, /Existing receive weights stay unchanged/);
});

test('no operational frontend screen loads the deprecated process module', async () => {
  const files = await listSourceFiles(frontendSource);
  const offenders = [];
  for (const file of files) {
    if (file.endsWith('/api/client.js') || file.endsWith('/context/InventoryContext.jsx')) continue;
    const source = await readFile(file, 'utf8');
    if (/refreshProcessData\s*\(|getProcessModule\s*\(|fetchProcessData\s*\(/.test(source)) {
      offenders.push(relative(repositoryRoot, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test('value facets stay lazy and single-flight per process', async () => {
  const cases = [
    [join(frontendSource, 'pages/IssueHistory.jsx'), 'getV2IssueTrackingFacets'],
    [join(frontendSource, 'components/issue/OnMachineTable.jsx'), 'getV2OnMachineFacets'],
    [join(frontendSource, 'components/receive/ReceiveHistoryTable.jsx'), 'getV2ReceiveHistoryFacets'],
  ];
  for (const [file, functionName] of cases) {
    const source = await readFile(file, 'utf8');
    assert.equal((source.match(new RegExp(functionName, 'g')) || []).length, 1, relative(repositoryRoot, file));
    assert.match(source, /if \(!openFilterId\) return;/, relative(repositoryRoot, file));
    assert.match(source, /v2FacetRequestRef\.current\?\.process === process/, relative(repositoryRoot, file));
  }
});

test('detailed Cutter stock exports hydrate the exporter-specific row field', async () => {
  const file = join(frontendSource, 'pages/Stock.jsx');
  const source = await readFile(file, 'utf8');
  assert.match(source, /viewType === 'jumbo'\) return \{ \.\.\.lot, pieces: rows \}/);
  assert.match(source, /viewType === 'bobbins'\) return \{ \.\.\.lot, crates: rows \}/);
  assert.match(source, /getAllV2StockLotRows\(processId, \{ key: lot\.lotKey \}\)/);
  assert.match(source, /memberLotKeys/);
  assert.match(source, /includeMembers: format === 'xlsx-detailed' && groupByItem \? 'true' : ''/);
  assert.doesNotMatch(source, /memberLots\.has\(lot\.lotNo\)/);
});

test('fresh Cutter Issue uses bounded candidates and stock reprints are permission gated', async () => {
  const cutterIssue = await readFile(join(frontendSource, 'components/issue/IssueToCutter.jsx'), 'utf8');
  assert.doesNotMatch(cutterIssue, /getAllV2CutterSourceCandidates/);
  assert.match(cutterIssue, /getV2CutterSourceCandidates\(\{ itemId, limit: 100/);
  assert.match(cutterIssue, /getV2CutterSourceCandidates\(\{ itemId, lotNo, limit: 100/);
  assert.match(cutterIssue, /Load more lots/);
  assert.match(cutterIssue, /Load more pieces/);
  for (const name of ['BobbinView.jsx', 'HoloView.jsx', 'ConingView.jsx']) {
    const source = await readFile(join(frontendSource, 'components/stock', name), 'utf8');
    assert.match(source, /canReprint = false/);
    assert.match(source, /\{canReprint && <button/);
    if (name === 'HoloView.jsx') {
      assert.match(source, /Array\.isArray\(decoded\.lotNos\)/);
      assert.match(source, /exactLotNos/);
    }
  }
});

test('Holo stock reprint preserves the targeted action-detail trace', async () => {
  const holoView = await readFile(join(frontendSource, 'components/stock/HoloView.jsx'), 'utf8');
  const labelData = await readFile(join(frontendSource, 'utils/receiveLabelData.js'), 'utf8');
  assert.match(holoView, /\.\.\.\(detail\?\.trace \|\| \{\}\)/);
  assert.match(labelData, /row\?\.cutName \|\|/);
  assert.match(labelData, /row\?\.yarnName \|\|/);
  assert.match(labelData, /row\?\.twistName \|\|/);

});
