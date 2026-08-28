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

export function CombinedStockView({ db }) {
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

  // Hooks must run unconditionally; the `enabled` flag is what gates the network call.
  const jumboV2 = useV2StockLots('cutter', {
    enabled: jumboEnabled && hasItem,
    loadGroups: displayMode === 'full' || expandedSections.has('jumbo'),
    search: '',
    filters: { view: 'jumbo', item: selectedItemId, yarn: selectedYarnId, status: CUTTER_DEFAULT_STATUS },
  });
  const bobbinV2 = useV2StockLots('cutter', {
    enabled: bobbinsEnabled && hasItem,
    loadGroups: displayMode === 'full' || expandedSections.has('bobbins'),
    search: '',
    filters: { view: 'bobbins', item: selectedItemId, yarn: selectedYarnId, status: CUTTER_DEFAULT_STATUS },
  });
  const holoV2 = useV2StockLots('holo', {
    enabled: holoEnabled && hasItem,
    loadGroups: displayMode === 'full' || expandedSections.has('holo'),
    search: '',
    filters: { item: selectedItemId, yarn: selectedYarnId, status: V2_DEFAULT_STATUS },
  });
  const coningV2 = useV2StockLots('coning', {
    enabled: coningEnabled && hasItem,
    loadGroups: displayMode === 'full' || expandedSections.has('coning'),
    search: '',
    filters: { item: selectedItemId, yarn: selectedYarnId, status: V2_DEFAULT_STATUS },
  });

  const jumboLots = useMemo(() => {
    if (!jumboEnabled || !selectedItemId) return [];
    return (jumboV2.lots || []).sort(byLotNo);
  }, [jumboV2.lots, jumboEnabled, selectedItemId]);

  const bobbinLots = useMemo(() => {
    if (!bobbinsEnabled || !selectedItemId) return [];
    return (bobbinV2.lots || []).sort(byLotNo);
  }, [bobbinV2.lots, bobbinsEnabled, selectedItemId]);

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

  const jumboLoadedTotals = useMemo(() => jumboLots.reduce((acc, lot) => ({
    remainingWeight: acc.remainingWeight + Number(lot.remainingWeight || 0),
    availableCount: acc.availableCount + (lot.availableCount ?? countAvailablePieces(lot.pieces || [])),
  }), { remainingWeight: 0, availableCount: 0 }), [jumboLots]);
  const jumboTotals = jumboV2.summary ? { ...jumboLoadedTotals, ...jumboV2.summary } : null;

  const bobbinLoadedTotals = useMemo(() => bobbinLots.reduce((acc, lot) => ({
    availableWeight: acc.availableWeight + (lot.availableWeight || 0),
    availableBobbins: acc.availableBobbins + (lot.availableBobbins || 0),
  }), { availableWeight: 0, availableBobbins: 0 }), [bobbinLots]);
  const bobbinTotals = bobbinV2.summary ? { ...bobbinLoadedTotals, ...bobbinV2.summary } : null;

  const holoLoadedTotals = useMemo(() => holoLots.reduce((acc, lot) => ({
    totalWeight: acc.totalWeight + (lot.totalWeight || 0),
    totalRolls: acc.totalRolls + (lot.totalRolls || 0),
    steamedRolls: acc.steamedRolls + (lot.steamedRolls || 0),
  }), { totalWeight: 0, totalRolls: 0, steamedRolls: 0 }), [holoLots]);
  const holoTotals = holoV2.summary ? { ...holoLoadedTotals, ...holoV2.summary } : null;

  const coningLoadedTotals = useMemo(() => coningLots.reduce((acc, lot) => ({
    totalWeight: acc.totalWeight + (lot.totalWeight || 0),
    totalCones: acc.totalCones + (lot.totalCones || 0),
  }), { totalWeight: 0, totalCones: 0 }), [coningLots]);
  const coningTotals = coningV2.summary ? { ...coningLoadedTotals, ...coningV2.summary } : null;

  // --- Pinned filters for full-tables mode ---

  const cutterFilters = useMemo(() => buildPinnedFilters(selectedItemId, selectedYarnId, CUTTER_DEFAULT_STATUS), [selectedItemId, selectedYarnId]);
  const v2Filters = useMemo(() => buildPinnedFilters(selectedItemId, selectedYarnId, V2_DEFAULT_STATUS), [selectedItemId, selectedYarnId]);

  // --- Section descriptors ---

  const sectionState = {
    jumbo: { isLoading: Boolean(jumboV2.lotsLoading), summaryLoading: jumboV2.summaryLoading, error: jumboV2.lotsError || null, summaryError: jumboV2.summaryError, onRetry: jumboV2.retryLots, hasMore: jumboV2.lotsHasMore, isLoadingMore: jumboV2.lotsLoadingMore, onLoadMore: jumboV2.loadMoreLots },
    bobbins: { isLoading: Boolean(bobbinV2.lotsLoading), summaryLoading: bobbinV2.summaryLoading, error: bobbinV2.lotsError || null, summaryError: bobbinV2.summaryError, onRetry: bobbinV2.retryLots, hasMore: bobbinV2.lotsHasMore, isLoadingMore: bobbinV2.lotsLoadingMore, onLoadMore: bobbinV2.loadMoreLots },
    holo: { isLoading: Boolean(holoV2.lotsLoading), summaryLoading: holoV2.summaryLoading, error: holoV2.lotsError || null, summaryError: holoV2.summaryError, onRetry: holoV2.retryLots, hasMore: holoV2.lotsHasMore, isLoadingMore: holoV2.lotsLoadingMore, onLoadMore: holoV2.loadMoreLots },
    coning: { isLoading: Boolean(coningV2.lotsLoading), summaryLoading: coningV2.summaryLoading, error: coningV2.lotsError || null, summaryError: coningV2.summaryError, onRetry: coningV2.retryLots, hasMore: coningV2.lotsHasMore, isLoadingMore: coningV2.lotsLoadingMore, onLoadMore: coningV2.loadMoreLots },
  };

  const summaryConfig = {
    jumbo: {
      emptyMessage: 'No jumbo roll stock for this item.',
      rows: jumboLots,
      getRowKey: (l) => l.lotNo,
      totals: [
        { label: 'Remaining Wt', value: jumboTotals ? `${formatKg(jumboTotals.remainingWeight)} kg` : '—' },
        { label: 'Available Pieces', value: jumboTotals ? String(jumboTotals.availableCount) : '—' },
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
        { label: 'Available Wt', value: bobbinTotals ? `${formatKg(bobbinTotals.availableWeight)} kg` : '—' },
        { label: 'Available Bobbins', value: bobbinTotals ? String(bobbinTotals.availableBobbins) : '—' },
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
        { label: 'Net Weight', value: holoTotals ? `${formatKg(holoTotals.totalWeight)} kg` : '—' },
        { label: 'Rolls', value: holoTotals ? String(holoTotals.totalRolls) : '—' },
        { label: 'Steamed', value: holoTotals ? `${holoTotals.steamedRolls} / ${holoTotals.totalRolls}` : '—' },
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
        { label: 'Net Weight', value: coningTotals ? `${formatKg(coningTotals.totalWeight)} kg` : '—' },
        { label: 'Cones', value: coningTotals ? String(coningTotals.totalCones) : '—' },
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
          summary={jumboV2.summary}
          summaryLoading={jumboV2.summaryLoading}
          rowsByKey={jumboV2.rowsByKey}
          rowPagesByKey={jumboV2.rowPagesByKey}
          loadLotRows={jumboV2.loadLotRows}
          loadMoreLotRows={jumboV2.loadMoreLotRows}
          isLoading={jumboV2.lotsLoading}
          error={jumboV2.lotsError}
          onRetry={jumboV2.retryLots}
          hasMore={jumboV2.lotsHasMore}
          isLoadingMore={jumboV2.lotsLoadingMore}
          onLoadMore={jumboV2.loadMoreLots}
        />
      );
    }
    if (processKey === 'bobbins') {
      if (bobbinV2.lotsLoading || bobbinV2.lotsError) {
        return (
          <ListState
            isLoading={bobbinV2.lotsLoading}
            error={bobbinV2.lotsError}
            onRetry={bobbinV2.retryLots}
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
          v2={bobbinV2}
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
        summaryLoading={state.summaryLoading}
        summaryError={state.summaryError}
        error={state.error}
        onRetry={state.onRetry}
        hasMore={state.hasMore}
        isLoadingMore={state.isLoadingMore}
        onLoadMore={state.onLoadMore}
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
