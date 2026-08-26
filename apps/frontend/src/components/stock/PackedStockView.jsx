import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  ChevronRight,
  History,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Tag,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import AccessDenied from '../common/AccessDenied';
import { useAuth } from '../../context/AuthContext';
import { usePermission } from '../../hooks/usePermission';
import * as legacyApi from '../../api/client';
import * as packedStockApi from '../../api/packedStock';
import usePackedStock from '../../hooks/usePackedStock';
import { formatDateDDMMYYYY, formatKg } from '../../utils';

const ACTIVE_STATUSES = ['AVAILABLE', 'RESERVED', 'QUALITY_HOLD', 'RETURNED_PENDING_INSPECTION'];
const HISTORY_PAGE_SIZE = 25;

function unitId(unit) {
  return unit?.id || unit?.unitId || unit?.sourceId || unit?.barcode;
}

function barcode(unit) {
  return unit?.barcode || unit?.sourceBarcode || '—';
}

function count(unit) {
  return unit?.baseCount ?? unit?.availableBaseCount ?? unit?.availableCount ?? unit?.count;
}

function weight(unit) {
  return unit?.netWeightKg ?? unit?.availableNetWeightKg ?? unit?.availableWeight ?? unit?.weight;
}

function statusVariant(status) {
  if (status === 'AVAILABLE') return 'success';
  if (status === 'RESERVED') return 'warning';
  if (status === 'DAMAGED' || status === 'VOIDED') return 'destructive';
  if (status === 'QUALITY_HOLD' || status === 'RETURNED_PENDING_INSPECTION') return 'secondary';
  return 'outline';
}

function displayName(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function hierarchyId(unit, index) {
  return unit?.id || unit?.unitId || unit?.barcode || `hierarchy-node-${index}`;
}

function hierarchyParentId(unit) {
  return unit?.parentUnitId || unit?.parentUnit?.id || unit?.parent?.id || null;
}

function buildHierarchyRoots(unit) {
  if (!unit) return [];
  const hierarchy = unit.hierarchy;
  const ancestors = Array.isArray(hierarchy?.ancestors) ? hierarchy.ancestors : [];
  const root = hierarchy?.root || unit;
  const descendants = Array.isArray(hierarchy?.descendants) ? hierarchy.descendants : [];
  const records = [...ancestors, root, ...descendants].filter(Boolean);
  if (!records.length) return [unit];

  const byId = new Map();
  const ordered = [];
  records.forEach((record, index) => {
    const id = hierarchyId(record, index);
    if (byId.has(id)) return;
    byId.set(id, record);
    ordered.push({ id, record, index });
  });

  const childrenByParent = new Map();
  ordered.forEach(({ id, record, index }) => {
    const parentId = hierarchyParentId(record);
    if (parentId && byId.has(parentId) && parentId !== id) {
      const children = childrenByParent.get(parentId) || [];
      children.push({ id, record, index });
      childrenByParent.set(parentId, children);
    }
  });

  // Older nested DTOs may omit scalar parentUnitId values. Preserve the
  // authoritative ancestor order in that case, then attach the selected root.
  if (ancestors.length > 1) {
    for (let index = 1; index < ancestors.length; index += 1) {
      const parentId = hierarchyId(ancestors[index - 1], index - 1);
      const childId = hierarchyId(ancestors[index], index);
      if (!hierarchyParentId(ancestors[index]) && byId.has(parentId)) {
        const children = childrenByParent.get(parentId) || [];
        if (!children.some((child) => child.id === childId)) children.push({ id: childId, record: ancestors[index], index });
        childrenByParent.set(parentId, children);
      }
    }
  }
  if (ancestors.length) {
    const parentId = hierarchyId(ancestors[ancestors.length - 1], ancestors.length - 1);
    const rootId = hierarchyId(root, ancestors.length);
    if (!hierarchyParentId(root) && byId.has(parentId)) {
      const children = childrenByParent.get(parentId) || [];
      if (!children.some((child) => child.id === rootId)) children.push({ id: rootId, record: root, index: ancestors.length });
      childrenByParent.set(parentId, children);
    }
  }

  const enrich = ({ id, record, index }) => {
    const nestedChildren = (childrenByParent.get(id) || []).map(enrich);
    return nestedChildren.length ? { ...record, children: nestedChildren } : record;
  };
  const childIds = new Set([...childrenByParent.values()].flat().map((child) => child.id));
  const roots = ordered.filter(({ id }) => !childIds.has(id)).map(enrich);
  return roots.length ? roots : [root];
}

function HierarchyNode({ unit, depth = 0 }) {
  if (!unit) return null;
  const children = unit.children || unit.hierarchy?.children || [];
  return (
    <div className="space-y-2" style={{ marginLeft: depth ? `${Math.min(depth, 8) * 12}px` : undefined }}>
      <div className="rounded-md border bg-muted/20 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Package className="h-3.5 w-3.5" />
          <span className="font-mono font-semibold">{barcode(unit)}</span>
          <Badge variant="outline">{displayName(unit.packageKind || unit.packageTypeName || unit.packageType?.kind)}</Badge>
          <Badge variant={statusVariant(unit.status)}>{displayName(unit.status)}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground">Level {displayName(unit.levelIndex)} · {count(unit) ?? '—'} base count · {weight(unit) == null ? '—' : formatKg(weight(unit))} kg</p>
      </div>
      {children.map((child, index) => <HierarchyNode key={child.id || child.barcode || index} unit={child} depth={depth + 1} />)}
    </div>
  );
}

function HierarchyTree({ unit }) {
  return <div className="space-y-2">{buildHierarchyRoots(unit).map((root, index) => <HierarchyNode key={root.id || root.barcode || index} unit={root} />)}</div>;
}

function UnitHistory({ events = [] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No unit events were returned.</p>;
  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <div key={event.id || event.idempotencyKey || index} className="rounded-md border p-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{event.type || event.eventType || 'Event'}</span>
            <span className="text-muted-foreground">{formatDateDDMMYYYY(event.createdAt || event.occurredAt || event.timestamp)}</span>
          </div>
          {event.reason && <p className="mt-1 text-muted-foreground">{event.reason}</p>}
        </div>
      ))}
    </div>
  );
}

export function PackedStockView() {
  const { user } = useAuth();
  const packingPermission = usePermission('packing');
  const stockPermission = usePermission('stock');
  const canRead = Boolean(user?.isAdmin || packingPermission.canRead || stockPermission.canRead);
  const canWrite = Boolean(user?.isAdmin || packingPermission.canWrite);
  const [filters, setFilters] = useState({ status: ACTIVE_STATUSES, customerId: '', search: '', batchKind: '' });
  const [customers, setCustomers] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState(null);
  const [actionForm, setActionForm] = useState({ customerId: '', reason: '' });
  const [actionError, setActionError] = useState(null);
  const [labelNotice, setLabelNotice] = useState(null);
  const [labelPrinting, setLabelPrinting] = useState(false);
  const [replacementConfirmation, setReplacementConfirmation] = useState(null);
  const [detailTab, setDetailTab] = useState('hierarchy');
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [historyUnitId, setHistoryUnitId] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const stock = usePackedStock({ filters, enabled: canRead });
  const { getHistory, getUnit, mutateUnit } = stock;

  useEffect(() => {
    if (!canRead) return undefined;
    let active = true;
    legacyApi.listCustomers().then((response) => {
      if (active) setCustomers((response?.customers || response?.items || []).filter((customer) => customer?.isActive !== false));
    }).catch(() => {});
    return () => { active = false; };
  }, [canRead]);

  const customerOptions = useMemo(() => customers, [customers]);

  const updateFilter = useCallback((patch) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ status: ACTIVE_STATUSES, customerId: '', search: '', batchKind: '' });
  }, []);

  const openDetail = useCallback(async (unit) => {
    setSelectedUnit(unit);
    setDetailTab('hierarchy');
    setHistoryEvents([]);
    setHistoryCursor(null);
    setHistoryUnitId(null);
    setHistoryError(null);
    const id = unitId(unit);
    if (!id) return;
    setDetailLoading(true);
    try {
      const detail = await getUnit(id);
      if (detail) setSelectedUnit(detail);
    } catch (error) {
      setActionError(error);
    } finally {
      setDetailLoading(false);
    }
  }, [getUnit]);

  const loadUnitHistory = useCallback(async ({ append = false } = {}) => {
    const id = unitId(selectedUnit);
    if (!id || (append && !historyCursor)) return;
    if (append) setHistoryLoadingMore(true);
    else setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await getHistory(id, {
        limit: HISTORY_PAGE_SIZE,
        cursor: append ? historyCursor : undefined,
      });
      if (unitId(selectedUnit) !== id) return;
      setHistoryEvents((previous) => append ? [...previous, ...response.events] : response.events);
      setHistoryCursor(response.nextCursor || null);
      setHistoryUnitId(id);
    } catch (error) {
      setHistoryError(error);
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
    }
  }, [getHistory, historyCursor, selectedUnit]);

  const openAction = useCallback((unit, nextAction) => {
    setSelectedUnit(unit);
    setActionError(null);
    setLabelNotice(null);
    setAction(nextAction);
    setActionForm({
      customerId: unit?.customerId || '',
      reason: '',
    });
  }, []);

  const submitAction = useCallback(async () => {
    const id = unitId(selectedUnit);
    if (!id || !action) return;
    const reason = actionForm.reason.trim();
    if ((action === 'release' || action === 'reassign' || action === 'replace-barcode' || action === 'reprint') && !reason) {
      setActionError(new Error('A reason is required for this action'));
      return;
    }
    if ((action === 'reserve' || action === 'reassign') && !actionForm.customerId) {
      setActionError(new Error('Select a Customer before saving the reservation'));
      return;
    }
    setActionError(null);
    try {
      let response;
      if (action === 'reserve') {
        response = await mutateUnit(packedStockApi.reservePackedStockUnit, id, { customerId: actionForm.customerId, reason });
      } else if (action === 'release') {
        response = await mutateUnit(packedStockApi.releasePackedStockReservation, id, { reason });
      } else if (action === 'reassign') {
        response = await mutateUnit(packedStockApi.reassignPackedStockReservation, id, { customerId: actionForm.customerId, reason });
      } else if (action === 'reprint') {
        response = await mutateUnit(packedStockApi.reprintPackedStockLabel, id, { reason });
      } else if (action === 'replace-barcode') {
        response = await mutateUnit(packedStockApi.replacePackedStockBarcode, id, { reason });
      }
      if (response?.unit) setSelectedUnit(response.unit);
      if (action === 'reprint' || action === 'replace-barcode') {
        if (response?.labelPending || response?.unit?.status === 'LABEL_PENDING' || !response?.label) {
          const pendingError = new Error('LABEL_PENDING: the authoritative label is unavailable. Resolve label generation before printing.');
          setLabelNotice({ kind: 'warning', message: pendingError.message });
          setActionError(pendingError);
          return;
        }
        if (action === 'replace-barcode') {
          setReplacementConfirmation({
            oldBarcode: barcode(selectedUnit),
            newBarcode: response.label.barcode,
            label: response.label,
            unit: response.unit,
            reason,
          });
          setAction(null);
          return;
        }
        setLabelPrinting(true);
        const printResult = await packedStockApi.printPackedStockLabel(response.label);
        setLabelPrinting(false);
        if (!printResult?.success) {
          const printError = new Error(`Label printing failed: ${printResult?.error || 'the local printer did not accept the job'}`);
          setLabelNotice({ kind: 'error', message: printError.message });
          setActionError(printError);
          return;
        }
        setLabelNotice({ kind: 'success', message: `Printed label ${response.label.barcode} with item ${response.label.itemName} and base count ${response.label.baseCount}.` });
      }
      setAction(null);
    } catch (error) {
      setLabelPrinting(false);
      setActionError(error);
    }
  }, [action, actionForm, mutateUnit, selectedUnit]);

  const confirmReplacementPrint = useCallback(async () => {
    if (!replacementConfirmation?.label) return;
    setActionError(null);
    setLabelPrinting(true);
    try {
      const printResult = await packedStockApi.printPackedStockLabel(replacementConfirmation.label);
      setLabelPrinting(false);
      if (!printResult?.success) {
        const printError = new Error(`Label printing failed: ${printResult?.error || 'the local printer did not accept the job'}`);
        setLabelNotice({ kind: 'error', message: printError.message });
        setActionError(printError);
        return;
      }
      setSelectedUnit(replacementConfirmation.unit);
      setLabelNotice({ kind: 'success', message: `Server-generated replacement ${replacementConfirmation.newBarcode} printed with item ${replacementConfirmation.label.itemName} and base count ${replacementConfirmation.label.baseCount}.` });
      setReplacementConfirmation(null);
    } catch (error) {
      setLabelPrinting(false);
      setActionError(error);
      setLabelNotice({ kind: 'error', message: `Label printing failed: ${error.message}` });
    }
  }, [replacementConfirmation]);

  const cancelReplacementPrint = useCallback(() => {
    if (!replacementConfirmation) return;
    setReplacementConfirmation(null);
    setLabelNotice({ kind: 'warning', message: `Server-generated replacement ${replacementConfirmation.newBarcode} was created. Printing remains pending until you confirm the returned identity.` });
  }, [replacementConfirmation]);

  if (!canRead) {
    return <AccessDenied title="Packed Stock unavailable" message="Packed Stock requires Stock or Packing read access." />;
  }

  const statusFilter = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
  const selectedEvents = historyEvents;
  const selectedChildren = selectedUnit?.hierarchy?.descendants || selectedUnit?.children || selectedUnit?.hierarchy?.children || [];
  const actionTitle = {
    reserve: 'Reserve Packed Stock unit',
    release: 'Release customer reservation',
    reassign: 'Reassign customer reservation',
    reprint: 'Reprint unit label',
    'replace-barcode': 'Replace unit barcode',
  }[action] || 'Packed Stock action';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Packed Stock</h1>
          <p className="mt-1 text-sm text-muted-foreground">The only list and action surface for sealed PackedUnit inventory.</p>
        </div>
        <Button type="button" variant="outline" onClick={stock.refresh} disabled={stock.loading}><RefreshCw className={`mr-2 h-4 w-4 ${stock.loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4 sm:p-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.search || ''} onChange={(event) => updateFilter({ search: event.target.value })} placeholder="Search exact barcode or item" className="pl-9" aria-label="Search Packed Stock" />
          </div>
          <select value={statusFilter} onChange={(event) => updateFilter({ status: event.target.value ? event.target.value.split(',') : '' })} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Packed Stock status filter">
            <option value={ACTIVE_STATUSES.join(',')}>Active stock</option>
            <option value="">All statuses</option>
            <option value="AVAILABLE">Available</option>
            <option value="RESERVED">Reserved</option>
            <option value="QUALITY_HOLD">Quality hold</option>
            <option value="LABEL_PENDING">Label pending</option>
            <option value="RETURNED_PENDING_INSPECTION">Returned pending inspection</option>
            <option value="DAMAGED">Damaged</option>
            <option value="REPACKED">Repacked</option>
            <option value="VOIDED">Voided</option>
          </select>
          <select value={filters.customerId || ''} onChange={(event) => updateFilter({ customerId: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Packed Stock customer filter">
            <option value="">All customers</option>
            {customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.displayName || customer.id}</option>)}
          </select>
          <select value={filters.batchKind || ''} onChange={(event) => updateFilter({ batchKind: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm" aria-label="Packed Stock batch kind filter">
            <option value="">All batch kinds</option>
            <option value="INITIAL">Initial</option>
            <option value="REPACKING">Repacking</option>
            <option value="OPENING">Opening balance</option>
          </select>
          <Button type="button" variant="ghost" onClick={resetFilters} className="justify-self-start">Reset filters</Button>
        </CardContent>
      </Card>

      {(stock.error || actionError) && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{(stock.error || actionError)?.message || 'Packed Stock request failed'}</div>}
      {labelNotice && <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${labelNotice.kind === 'success' ? 'border-green-500/40 bg-green-500/10 text-green-800' : 'border-amber-500/40 bg-amber-500/10 text-amber-800'}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{labelNotice.message}</span></div>}

      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-lg">Units</CardTitle>
          <span className="text-xs text-muted-foreground">{stock.units.length}{stock.hasMore ? '+' : ''} loaded</span>
        </CardHeader>
        <CardContent className="p-0">
          {stock.loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Packed Stock…</div>
          ) : stock.units.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No Packed Stock units match these filters.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Unit / barcode</TableHead><TableHead>Item / package</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Net kg</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {stock.units.map((unit) => {
                  const id = unitId(unit);
                  const status = unit.status || 'AVAILABLE';
                  return (
                    <TableRow key={id}>
                      <TableCell className="min-w-52"><button type="button" onClick={() => openDetail(unit)} className="text-left"><span className="flex items-center gap-2 font-mono text-sm font-semibold"><Barcode className="h-4 w-4 text-muted-foreground" /> {barcode(unit)}</span><span className="mt-1 block text-xs text-muted-foreground">Level {displayName(unit.levelIndex)} · {displayName(unit.batchNo || unit.batch?.batchNo || unit.batchId)}</span></button></TableCell>
                      <TableCell><div className="text-sm">{displayName(unit.itemName || unit.item?.name)}</div><div className="text-xs text-muted-foreground">{displayName(unit.packageKind || unit.packageTypeName || unit.packageType?.kind)}</div></TableCell>
                      <TableCell>{unit.customer?.name || unit.customerName || '—'}</TableCell>
                      <TableCell className="text-right">{count(unit) ?? '—'}</TableCell>
                      <TableCell className="text-right">{weight(unit) == null ? '—' : formatKg(weight(unit))}</TableCell>
                      <TableCell><Badge variant={statusVariant(status)}>{status}</Badge></TableCell>
                      <TableCell><div className="flex justify-end gap-1"><Button type="button" size="icon" variant="ghost" onClick={() => openDetail(unit)} title="Inspect unit" aria-label={`Inspect ${barcode(unit)}`}><ChevronRight className="h-4 w-4" /></Button>{canWrite && status === 'AVAILABLE' && <Button type="button" size="icon" variant="ghost" onClick={() => openAction(unit, 'reserve')} title="Reserve unit" aria-label={`Reserve ${barcode(unit)}`}><UserRound className="h-4 w-4" /></Button>}{canWrite && status === 'RESERVED' && <Button type="button" size="icon" variant="ghost" onClick={() => openAction(unit, 'release')} title="Release reservation" aria-label={`Release ${barcode(unit)}`}><UsersRound className="h-4 w-4" /></Button>}</div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {stock.hasMore && <div className="border-t p-4"><Button type="button" variant="outline" onClick={stock.loadMore} disabled={stock.loadingMore} className="w-full">{stock.loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{stock.loadingMore ? 'Loading more units…' : 'Load more units'}</Button></div>}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedUnit)} onOpenChange={(open) => { if (!open) setSelectedUnit(null); }}>
        <DialogContent title="Packed Stock unit" onOpenChange={(open) => { if (!open) setSelectedUnit(null); }} className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {detailLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading unit…</div> : selectedUnit && <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="font-mono text-sm font-semibold">{barcode(selectedUnit)}</p><p className="mt-1 text-xs text-muted-foreground">{displayName(selectedUnit.itemName || selectedUnit.item?.name)} · {displayName(selectedUnit.packageKind || selectedUnit.packageTypeName || selectedUnit.packageType?.kind)}</p></div>
              <Badge variant={statusVariant(selectedUnit.status)}>{displayName(selectedUnit.status)}</Badge>
            </div>
            {selectedUnit.status === 'LABEL_PENDING' && <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />LABEL_PENDING: this unit remains unavailable until the authoritative label is generated and printed successfully.</div>}
            <div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="block text-xs text-muted-foreground">Base count</span>{count(selectedUnit) ?? '—'}</div><div><span className="block text-xs text-muted-foreground">Net weight</span>{weight(selectedUnit) == null ? '—' : `${formatKg(weight(selectedUnit))} kg`}</div><div><span className="block text-xs text-muted-foreground">Customer</span>{selectedUnit.customer?.name || selectedUnit.customerName || '—'}</div></div>
            <div className="flex flex-wrap gap-2 border-b"><Button type="button" variant={detailTab === 'hierarchy' ? 'secondary' : 'ghost'} size="sm" onClick={() => setDetailTab('hierarchy')}><Package className="mr-1 h-4 w-4" /> Hierarchy ({selectedChildren.length})</Button><Button type="button" variant={detailTab === 'history' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setDetailTab('history'); if (historyUnitId !== unitId(selectedUnit)) void loadUnitHistory({ append: false }); }}><History className="mr-1 h-4 w-4" /> History ({selectedEvents.length})</Button></div>
            {detailTab === 'hierarchy' ? <HierarchyTree unit={selectedUnit} /> : <div className="space-y-3">
              {historyError && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{historyError.message || 'Unable to load unit history'}</p>}
              {historyLoading && selectedEvents.length === 0 ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</div> : <UnitHistory events={selectedEvents} />}
              {historyCursor && <Button type="button" variant="outline" onClick={() => loadUnitHistory({ append: true })} disabled={historyLoadingMore} className="w-full">{historyLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{historyLoadingMore ? 'Loading more history…' : 'Load more history'}</Button>}
            </div>}
            {canWrite && <div className="flex flex-wrap gap-2 border-t pt-3">{selectedUnit.status === 'AVAILABLE' && <Button type="button" size="sm" onClick={() => openAction(selectedUnit, 'reserve')}><UserRound className="mr-1 h-4 w-4" /> Reserve</Button>}{selectedUnit.status === 'RESERVED' && <><Button type="button" size="sm" variant="outline" onClick={() => openAction(selectedUnit, 'release')}>Release reservation</Button><Button type="button" size="sm" variant="outline" onClick={() => openAction(selectedUnit, 'reassign')}>Reassign</Button></>} {!['VOIDED', 'DAMAGED'].includes(selectedUnit.status) && <><Button type="button" size="sm" variant="outline" onClick={() => openAction(selectedUnit, 'reprint')}><Tag className="mr-1 h-4 w-4" /> Reprint label</Button><Button type="button" size="sm" variant="outline" onClick={() => openAction(selectedUnit, 'replace-barcode')}><Barcode className="mr-1 h-4 w-4" /> Replace barcode</Button></>}</div>}
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(action)} onOpenChange={(open) => { if (!open) setAction(null); }}>
        <DialogContent title={actionTitle} onOpenChange={(open) => { if (!open) setAction(null); }}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Unit <span className="font-mono font-semibold text-foreground">{barcode(selectedUnit || {})}</span>. Every reservation change and barcode operation is append-only and reasoned.</p>
            {(action === 'reserve' || action === 'reassign') && <div className="space-y-2"><Label htmlFor="packed-stock-customer">Customer</Label><select id="packed-stock-customer" value={actionForm.customerId} onChange={(event) => setActionForm((previous) => ({ ...previous, customerId: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select customer…</option>{customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.displayName || customer.id}</option>)}</select></div>}
            {action === 'replace-barcode' && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">The server will generate the replacement Packed Unit identity. After saving the reason, confirm the returned barcode before printing its label.</div>}
            <div className="space-y-2"><Label htmlFor="packed-stock-reason">Reason {action !== 'reserve' && '(required)'}</Label><textarea id="packed-stock-reason" value={actionForm.reason} onChange={(event) => setActionForm((previous) => ({ ...previous, reason: event.target.value }))} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Explain this controlled action" /></div>
            {actionError && <p className="text-sm text-destructive">{actionError.message}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAction(null)} disabled={labelPrinting}>Cancel</Button><Button type="button" onClick={submitAction} disabled={stock.loading || labelPrinting}>{labelPrinting ? 'Printing…' : 'Save action'}</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(replacementConfirmation)} onOpenChange={(open) => { if (!open && !labelPrinting) cancelReplacementPrint(); }}>
        <DialogContent title="Confirm server-generated replacement" onOpenChange={(open) => { if (!open && !labelPrinting) cancelReplacementPrint(); }}>
          {replacementConfirmation && <div className="space-y-4">
            <p className="text-sm text-muted-foreground">The server created a new physical identity. Confirm the returned barcode and reason before the physical label is printed.</p>
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-2">
              <div><span className="block text-xs text-muted-foreground">Previous barcode</span><span className="font-mono">{replacementConfirmation.oldBarcode}</span></div>
              <div><span className="block text-xs text-muted-foreground">Server-generated replacement</span><span className="font-mono font-semibold text-primary">{replacementConfirmation.newBarcode}</span></div>
              <div><span className="block text-xs text-muted-foreground">Label item identity</span>{replacementConfirmation.label.itemName}</div>
              <div><span className="block text-xs text-muted-foreground">Exact base count</span>{replacementConfirmation.label.baseCount}</div>
            </div>
            <div className="rounded-lg border p-3 text-sm"><span className="block text-xs text-muted-foreground">Reason</span>{replacementConfirmation.reason}</div>
            {actionError && <p className="text-sm text-destructive">{actionError.message}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={cancelReplacementPrint} disabled={labelPrinting}>Keep printing pending</Button><Button type="button" onClick={confirmReplacementPrint} disabled={labelPrinting}>{labelPrinting ? 'Printing…' : 'Confirm identity & print'}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PackedStockView;
