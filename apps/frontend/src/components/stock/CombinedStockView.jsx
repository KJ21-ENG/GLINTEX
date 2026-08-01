import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Label, Select } from '../ui';
import { ListState } from '../data-table';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import { Layers } from 'lucide-react';
import { getProcessDefinition } from '../../constants/processes';
import { useV2StockLots } from '../../hooks/useV2StockLots';
import { BobbinView } from './BobbinView';
import { HoloView } from './HoloView';
import { ConingView } from './ConingView';
import { CombinedSummarySection } from './combined/CombinedSummarySection';
import { CombinedJumboTable } from './combined/CombinedJumboTable';
import {
  idEq,
  countAvailablePieces,
  isCutterPurchaseLotNo,
  buildReceiveTotalsMap,
  buildCutterWastageNoteByPieceId,
  buildCutterIssueByPieceId,
  buildJumboLotsMap,
  buildInboundPieceMap,
  buildBobbinLotMetaMap,
  buildBobbinCrates,
  buildBobbinLots,
} from './stockSelectors';

/**
 * Combined Stock — one item's stock across every enabled process view.
 *
 * Hard constraint: no new stock math. Jumbo/Bobbins reuse the same `stockSelectors`
 * functions the Stock page and BobbinView run; Holo/Coning reuse the same v2 lot
 * payloads via `useV2StockLots`. Each section is then narrowed to the picked item,
 * the optionally picked yarn (empty = all yarns), and that view's DEFAULT status
 * filter, so the headline totals equal the existing view's grand-total row filtered
 * the same way. Yarn matching mirrors each view: name-set membership for
 * jumbo/bobbins/coning, direct yarnId equality for holo.
 */

const CUTTER_PROCESS = getProcessDefinition('cutter');

// Cutter views default to "Available to issue"; the v2 views default to "Active Only".
const CUTTER_DEFAULT_STATUS = 'available_to_issue';
const V2_DEFAULT_STATUS = 'active';

const buildPinnedFilters = (itemId, yarnId, status) => ({
  item: itemId,
  cut: '',
  yarn: yarnId,
  firm: '',
  supplier: '',
  status,
  steamed: 'all',
  from: '',
  to: '',
});

const byLotNo = (a, b) => (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true });

const noopApplyFilter = () => { };

export function CombinedStockView({ db, ensureModuleData }) {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedYarnId, setSelectedYarnId] = useState('');
  const [expandedSections, setExpandedSections] = useState(() => new Set());

  const enabledViews = useMemo(() => (
    (db?.combined_stock_views || [])
      .filter((v) => v?.isEnabled)
      .slice()
      .sort((a, b) => (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0))
  ), [db?.combined_stock_views]);

  const displayMode = db?.combined_stock_config?.[0]?.displayMode || 'summary';

  const enabledKeys = useMemo(() => new Set(enabledViews.map((v) => v.processKey)), [enabledViews]);
  const jumboEnabled = enabledKeys.has('jumbo');
  const bobbinsEnabled = enabledKeys.has('bobbins');
  const holoEnabled = enabledKeys.has('holo');
  const coningEnabled = enabledKeys.has('coning');
  const hasItem = !!selectedItemId;

  useEffect(() => { setExpandedSections(new Set()); }, [selectedItemId, selectedYarnId]);

  // Jumbo/bobbins/coning filter by the yarn's NAME against each lot's yarn-name set
  // (Stock.jsx / BobbinView / ConingView do the same); an unresolvable id filters nothing.
  const selectedYarnName = useMemo(() => (
    selectedYarnId ? ((db?.yarns || []).find((y) => idEq(y.id, selectedYarnId))?.name || '') : ''
  ), [db?.yarns, selectedYarnId]);

  const toggleSection = useCallback((key) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // --- Data loading (only for enabled sections, and only once an item is picked) ---

  // Jumbo + Bobbins both read the legacy cutter module payload, so one call covers both.
  const needsCutter = (jumboEnabled || bobbinsEnabled) && hasItem;
  const [cutterLoaded, setCutterLoaded] = useState(false);
  const [cutterError, setCutterError] = useState(null);
  const [cutterNonce, setCutterNonce] = useState(0);

  useEffect(() => {
    if (!needsCutter) return;
    let cancelled = false;
    setCutterError(null);
    Promise.resolve(ensureModuleData('process', { process: 'cutter', full: true }))
      .then(() => { if (!cancelled) setCutterLoaded(true); })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load cutter stock module', err);
        setCutterError(err);
      });
    return () => { cancelled = true; };
  }, [needsCutter, ensureModuleData, cutterNonce]);

  const retryCutter = useCallback(() => {
    setCutterError(null);
    setCutterNonce((n) => n + 1);
  }, []);

  // Derived (not stored) so the first render after picking an item already reads as
  // loading instead of flashing an empty section before the effect fires.
  const cutterLoading = needsCutter && !cutterLoaded && !cutterError;

  // Hooks must run unconditionally; the `enabled` flag is what gates the network call.
  const holoV2 = useV2StockLots('holo', { enabled: holoEnabled && hasItem, search: '' });
  const coningV2 = useV2StockLots('coning', { enabled: coningEnabled && hasItem, search: '' });

  // --- Jumbo (same selectors as the Stock page) ---

  const receiveTotalsMap = useMemo(() => (
    jumboEnabled
      ? buildReceiveTotalsMap(db, CUTTER_PROCESS.receiveTotalsKey, CUTTER_PROCESS.receiveWeightField, CUTTER_PROCESS.receiveUnitField)
      : new Map()
  ), [db, jumboEnabled]);

  const cutterWastageNoteByPieceId = useMemo(() => (
    jumboEnabled ? buildCutterWastageNoteByPieceId(db, true) : new Map()
  ), [db?.receive_from_cutter_machine_challans, jumboEnabled]);

  const cutterIssueByPieceId = useMemo(() => (
    jumboEnabled ? buildCutterIssueByPieceId(db, true) : new Map()
  ), [db, jumboEnabled]);

  const jumboLotsMap = useMemo(() => (
    jumboEnabled ? buildJumboLotsMap(db, receiveTotalsMap, cutterIssueByPieceId, cutterWastageNoteByPieceId) : {}
  ), [db, receiveTotalsMap, cutterIssueByPieceId, jumboEnabled]);

  const jumboLots = useMemo(() => {
    if (!jumboEnabled || !selectedItemId) return [];
    // Mirrors the Jumbo Rolls view: CP-* purchase lots are excluded, then the item
    // filter and the default "Available to issue" status filter are applied.
    return Object.values(jumboLotsMap)
      .filter((l) => !isCutterPurchaseLotNo(l?.lotNo))
      .filter((l) => idEq(l.itemId, selectedItemId))
      .filter((l) => !selectedYarnName || l.yarnNames?.has(selectedYarnName))
      .filter((l) => (l.availableCount || 0) > 0)
      .sort(byLotNo);
  }, [jumboLotsMap, jumboEnabled, selectedItemId, selectedYarnName]);

  // --- Bobbins (same selectors as BobbinView) ---

  const inboundPieceMap = useMemo(() => (
    bobbinsEnabled ? buildInboundPieceMap(db) : new Map()
  ), [db?.inbound_items, bobbinsEnabled]);

  const bobbinLotMetaMap = useMemo(() => (
    bobbinsEnabled ? buildBobbinLotMetaMap(db) : new Map()
  ), [db?.lots, db?.items, db?.firms, db?.suppliers, bobbinsEnabled]);

  const bobbinCrates = useMemo(() => (
    bobbinsEnabled ? buildBobbinCrates(db, inboundPieceMap, bobbinLotMetaMap) : []
  ), [db?.receive_from_cutter_machine_rows, inboundPieceMap, bobbinLotMetaMap, db?.cuts, bobbinsEnabled]);

  const allBobbinLots = useMemo(() => buildBobbinLots(bobbinCrates), [bobbinCrates]);

  const bobbinLots = useMemo(() => {
    if (!bobbinsEnabled || !selectedItemId) return [];
    // Mirrors the Bobbins view default status filter (available bobbins only).
    return allBobbinLots
      .filter((l) => idEq(l.itemId, selectedItemId))
      .filter((l) => !selectedYarnName || l.yarnNames?.has(selectedYarnName))
      .filter((l) => (l.availableBobbins || 0) > 0)
      .sort(byLotNo);
  }, [allBobbinLots, bobbinsEnabled, selectedItemId, selectedYarnName]);

  // --- Holo / Coning (same v2 lot payloads as HoloView / ConingView) ---

  const holoLots = useMemo(() => {
    if (!holoEnabled || !selectedItemId) return [];
    return (holoV2.lots || [])
      .filter((l) => String(l.itemId) === String(selectedItemId))
      .filter((l) => !selectedYarnId || String(l.yarnId) === String(selectedYarnId))
      .filter((l) => l.statusType === V2_DEFAULT_STATUS)
      .sort(byLotNo);
  }, [holoV2.lots, holoEnabled, selectedItemId, selectedYarnId]);

  const coningLots = useMemo(() => {
    if (!coningEnabled || !selectedItemId) return [];
    return (coningV2.lots || [])
      .filter((l) => String(l.itemId) === String(selectedItemId))
      .filter((l) => {
        // The Yarn column shows the upstream-holo trace names — match what is
        // displayed, exactly as ConingView builds its yarnNames set.
        if (!selectedYarnName) return true;
        const yarnNamesArr = Array.isArray(l.yarnNames) ? l.yarnNames : [];
        const names = yarnNamesArr.length
          ? yarnNamesArr
          : String(l.yarnName || '').split(',').map((v) => v.trim()).filter(Boolean);
        return names.includes(selectedYarnName);
      })
      .filter((l) => l.statusType === V2_DEFAULT_STATUS)
      .sort(byLotNo);
  }, [coningV2.lots, coningEnabled, selectedItemId, selectedYarnName]);

  // --- Headline totals (the exact fields each view's grand-total row sums) ---

  const jumboTotals = useMemo(() => jumboLots.reduce((acc, lot) => ({
    remainingWeight: acc.remainingWeight + Number(lot.remainingWeight || 0),
    availableCount: acc.availableCount + (lot.availableCount ?? countAvailablePieces(lot.pieces || [])),
  }), { remainingWeight: 0, availableCount: 0 }), [jumboLots]);

  const bobbinTotals = useMemo(() => bobbinLots.reduce((acc, lot) => ({
    availableWeight: acc.availableWeight + (lot.availableWeight || 0),
    availableBobbins: acc.availableBobbins + (lot.availableBobbins || 0),
  }), { availableWeight: 0, availableBobbins: 0 }), [bobbinLots]);

  const holoTotals = useMemo(() => holoLots.reduce((acc, lot) => ({
    totalWeight: acc.totalWeight + (lot.totalWeight || 0),
    totalRolls: acc.totalRolls + (lot.totalRolls || 0),
    steamedRolls: acc.steamedRolls + (lot.steamedRolls || 0),
  }), { totalWeight: 0, totalRolls: 0, steamedRolls: 0 }), [holoLots]);

  const coningTotals = useMemo(() => coningLots.reduce((acc, lot) => ({
    totalWeight: acc.totalWeight + (lot.totalWeight || 0),
    totalCones: acc.totalCones + (lot.totalCones || 0),
  }), { totalWeight: 0, totalCones: 0 }), [coningLots]);

  // --- Pinned filters for full-tables mode ---

  const cutterFilters = useMemo(() => buildPinnedFilters(selectedItemId, selectedYarnId, CUTTER_DEFAULT_STATUS), [selectedItemId, selectedYarnId]);
  const v2Filters = useMemo(() => buildPinnedFilters(selectedItemId, selectedYarnId, V2_DEFAULT_STATUS), [selectedItemId, selectedYarnId]);

  // --- Section descriptors ---

  const sectionState = {
    jumbo: { isLoading: cutterLoading, error: cutterError, onRetry: retryCutter },
    bobbins: { isLoading: cutterLoading, error: cutterError, onRetry: retryCutter },
    holo: { isLoading: Boolean(holoV2.lotsLoading), error: holoV2.lotsError || null, onRetry: holoV2.retryLots },
    coning: { isLoading: Boolean(coningV2.lotsLoading), error: coningV2.lotsError || null, onRetry: coningV2.retryLots },
  };

  const summaryConfig = {
    jumbo: {
      emptyMessage: 'No jumbo roll stock for this item.',
      rows: jumboLots,
      getRowKey: (l) => l.lotNo,
      totals: [
        { label: 'Remaining Wt', value: `${formatKg(jumboTotals.remainingWeight)} kg` },
        { label: 'Available Pieces', value: String(jumboTotals.availableCount) },
      ],
      columns: [
        { key: 'lotNo', header: 'Lot No', cell: (l) => l.lotNo || '—' },
        { key: 'date', header: 'Date', cell: (l) => formatDateDDMMYYYY(l.date) || '—' },
        { key: 'cut', header: 'Cut', cell: (l) => l.cutName || '—' },
        { key: 'firm', header: 'Firm', cell: (l) => l.firmName || '—' },
        { key: 'supplier', header: 'Supplier', cell: (l) => l.supplierName || '—' },
        {
          key: 'pieces',
          header: 'Pieces',
          className: 'text-right tabular-nums',
          cell: (l) => `${l.availableCount ?? countAvailablePieces(l.pieces || [])} / ${l.totalPieces ?? (l.pieces || []).length}`,
        },
        {
          key: 'weight',
          header: 'Weight',
          className: 'text-right tabular-nums whitespace-nowrap',
          cell: (l) => `${formatKg(l.remainingWeight)} / ${formatKg(l.totalWeight)}`,
        },
      ],
      renderMobileRow: (l) => (
        <div className="space-y-1">
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold truncate">{l.lotNo || '—'}</span>
            <span className="font-mono font-semibold whitespace-nowrap">{formatKg(l.remainingWeight)} / {formatKg(l.totalWeight)}</span>
          </div>
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{formatDateDDMMYYYY(l.date) || '—'} • {l.cutName || '—'}</span>
            <span className="whitespace-nowrap">{l.availableCount ?? countAvailablePieces(l.pieces || [])} / {l.totalPieces ?? (l.pieces || []).length} pieces</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">Supplier: {l.supplierName || '—'}</div>
        </div>
      ),
    },
    bobbins: {
      emptyMessage: 'No bobbin stock for this item.',
      rows: bobbinLots,
      getRowKey: (l) => l.lotKey || l.lotNo,
      totals: [
        { label: 'Available Wt', value: `${formatKg(bobbinTotals.availableWeight)} kg` },
        { label: 'Available Bobbins', value: String(bobbinTotals.availableBobbins) },
      ],
      columns: [
        { key: 'lotNo', header: 'Lot No', cell: (l) => l.lotNo || '—' },
        { key: 'date', header: 'Date', cell: (l) => formatDateDDMMYYYY(l.date) || '—' },
        { key: 'cut', header: 'Cut', cell: (l) => l.cutName || '—' },
        { key: 'firm', header: 'Firm', cell: (l) => l.firmName || '—' },
        { key: 'supplier', header: 'Supplier', cell: (l) => l.supplierName || '—' },
        {
          key: 'bobbins',
          header: 'Bobbins',
          className: 'text-right tabular-nums',
          cell: (l) => `${l.availableBobbins} / ${l.totalBobbins}`,
        },
        {
          key: 'weight',
          header: 'Weight',
          className: 'text-right tabular-nums whitespace-nowrap',
          cell: (l) => `${formatKg(l.availableWeight)} / ${formatKg(l.totalWeight)}`,
        },
      ],
      renderMobileRow: (l) => (
        <div className="space-y-1">
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold truncate">{l.lotNo || '—'}</span>
            <span className="font-mono font-semibold whitespace-nowrap">{formatKg(l.availableWeight)} / {formatKg(l.totalWeight)}</span>
          </div>
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{formatDateDDMMYYYY(l.date) || '—'} • {l.cutName || '—'}</span>
            <span className="whitespace-nowrap">{l.availableBobbins} / {l.totalBobbins} bobbins</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">Supplier: {l.supplierName || '—'}</div>
        </div>
      ),
    },
    holo: {
      emptyMessage: 'No holo stock for this item.',
      rows: holoLots,
      getRowKey: (l) => l.lotKey || l.lotNo,
      totals: [
        { label: 'Net Weight', value: `${formatKg(holoTotals.totalWeight)} kg` },
        { label: 'Rolls', value: String(holoTotals.totalRolls) },
        { label: 'Steamed', value: `${holoTotals.steamedRolls} / ${holoTotals.totalRolls}` },
      ],
      columns: [
        { key: 'lotNo', header: 'Lot No', cell: (l) => l.lotNo || '—' },
        { key: 'date', header: 'Date', cell: (l) => formatDateDDMMYYYY(l.date) || '—' },
        { key: 'cut', header: 'Cut', cell: (l) => l.cutName || '—' },
        { key: 'yarn', header: 'Yarn / Twist', cell: (l) => `${l.yarnName || '—'} / ${l.twistName || '—'}` },
        { key: 'supplier', header: 'Supplier', cell: (l) => l.supplierName || '—' },
        { key: 'rolls', header: 'Rolls', className: 'text-right tabular-nums', cell: (l) => String(l.totalRolls || 0) },
        { key: 'weight', header: 'Net Weight', className: 'text-right tabular-nums whitespace-nowrap', cell: (l) => formatKg(l.totalWeight) },
        { key: 'steamed', header: 'Steamed', className: 'text-right tabular-nums', cell: (l) => `${l.steamedRolls || 0} / ${l.totalRolls || 0}` },
      ],
      renderMobileRow: (l) => (
        <div className="space-y-1">
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold truncate">{l.lotNo || '—'}</span>
            <span className="font-mono font-semibold whitespace-nowrap">{formatKg(l.totalWeight)}</span>
          </div>
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{formatDateDDMMYYYY(l.date) || '—'} • {l.cutName || '—'}</span>
            <span className="whitespace-nowrap">{l.totalRolls || 0} rolls • {l.steamedRolls || 0} steamed</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">Supplier: {l.supplierName || '—'}</div>
        </div>
      ),
    },
    coning: {
      emptyMessage: 'No coning stock for this item.',
      rows: coningLots,
      getRowKey: (l) => l.lotKey || l.lotNo,
      totals: [
        { label: 'Net Weight', value: `${formatKg(coningTotals.totalWeight)} kg` },
        { label: 'Cones', value: String(coningTotals.totalCones) },
      ],
      columns: [
        { key: 'lotNo', header: 'Lot No', cell: (l) => l.lotNo || '—' },
        { key: 'date', header: 'Date', cell: (l) => formatDateDDMMYYYY(l.date) || '—' },
        { key: 'cut', header: 'Cut', cell: (l) => l.cutName || '—' },
        { key: 'yarn', header: 'Yarn', cell: (l) => l.yarnName || '—' },
        { key: 'supplier', header: 'Supplier', cell: (l) => l.supplierName || '—' },
        { key: 'cones', header: 'Cones', className: 'text-right tabular-nums', cell: (l) => String(l.totalCones || 0) },
        { key: 'weight', header: 'Net Weight', className: 'text-right tabular-nums whitespace-nowrap', cell: (l) => formatKg(l.totalWeight) },
      ],
      renderMobileRow: (l) => (
        <div className="space-y-1">
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold truncate">{l.lotNo || '—'}</span>
            <span className="font-mono font-semibold whitespace-nowrap">{formatKg(l.totalWeight)}</span>
          </div>
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{formatDateDDMMYYYY(l.date) || '—'} • {l.cutName || '—'}</span>
            <span className="whitespace-nowrap">{l.totalCones || 0} cones</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">Supplier: {l.supplierName || '—'}</div>
        </div>
      ),
    },
  };

  const renderFullSectionBody = (processKey) => {
    if (processKey === 'jumbo') {
      return (
        <CombinedJumboTable
          lots={jumboLots}
          isLoading={cutterLoading}
          error={cutterError}
          onRetry={retryCutter}
        />
      );
    }
    if (processKey === 'bobbins') {
      if (cutterLoading || cutterError) {
        return (
          <ListState
            isLoading={cutterLoading}
            error={cutterError}
            onRetry={retryCutter}
            emptyMessage="No bobbin stock for this item."
            className="border rounded-lg bg-card"
          />
        );
      }
      return (
        <BobbinView
          db={db}
          filters={cutterFilters}
          search=""
          groupBy={false}
          onApplyFilter={noopApplyFilter}
        />
      );
    }
    if (processKey === 'holo') {
      return (
        <HoloView
          db={db}
          filters={v2Filters}
          search=""
          groupBy={false}
          onApplyFilter={noopApplyFilter}
          ensureProcessData={() => ensureModuleData('process', { process: 'holo', full: true })}
          v2={holoV2}
        />
      );
    }
    if (processKey === 'coning') {
      return (
        <ConingView
          db={db}
          filters={v2Filters}
          search=""
          groupBy={false}
          onApplyFilter={noopApplyFilter}
          ensureProcessData={() => ensureModuleData('process', { process: 'coning', full: true })}
          v2={coningV2}
        />
      );
    }
    return null;
  };

  const renderSection = (viewRow) => {
    const processKey = viewRow.processKey;
    if (!summaryConfig[processKey]) return null;

    if (displayMode === 'full') {
      return (
        <div key={processKey} className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{viewRow.label}</h2>
          {renderFullSectionBody(processKey)}
        </div>
      );
    }

    const config = summaryConfig[processKey];
    const state = sectionState[processKey];
    return (
      <CombinedSummarySection
        key={processKey}
        label={viewRow.label}
        totals={config.totals}
        columns={config.columns}
        rows={config.rows}
        getRowKey={config.getRowKey}
        renderMobileRow={config.renderMobileRow}
        emptyMessage={config.emptyMessage}
        isLoading={state.isLoading}
        error={state.error}
        onRetry={state.onRetry}
        expanded={expandedSections.has(processKey)}
        onToggle={() => toggleSection(processKey)}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Item picker — combined view owns its own filter bar */}
      <Card className="bg-muted/40 border-none shadow-none">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
          <div className="min-w-0">
            <Label className="text-xs mb-1 block">Item</Label>
            <Select
              className="bg-background w-full"
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              options={db?.items || []}
              labelKey="name"
              valueKey="id"
              clearable
              placeholder="Select an item"
              cacheKey="combined-stock-item"
            />
          </div>
          <div className="min-w-0">
            <Label className="text-xs mb-1 block">Yarn</Label>
            <Select
              className="bg-background w-full"
              value={selectedYarnId}
              onChange={(e) => setSelectedYarnId(e.target.value)}
              options={db?.yarns || []}
              labelKey="name"
              valueKey="id"
              clearable
              placeholder="All yarns"
              cacheKey="combined-stock-yarn"
            />
          </div>
        </CardContent>
      </Card>

      {enabledViews.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No stock views are enabled. Configure them in Masters → Combined Stock.
          </CardContent>
        </Card>
      ) : !selectedItemId ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Layers className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Select an item to see its stock at each process.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {enabledViews.map(renderSection)}
        </div>
      )}
    </div>
  );
}
