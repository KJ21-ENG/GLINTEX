import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as legacyApi from '../../api/client';
import * as dispatchApi from '../../api/dispatchV2';
import { todayISO } from '../../utils';
import { asNumber, assertCustomerReservationCompatibility, assertDispatchableSource, buildDispatchLinePayload } from './dispatchLineValidation';

export const DISPATCH_SOURCE_TYPES = [
  { id: 'INBOUND', label: 'Inbound', description: 'Raw jumbo rolls' },
  { id: 'CUTTER', label: 'Cutter', description: 'Bobbins' },
  { id: 'HOLO', label: 'Holo', description: 'Rolls' },
  { id: 'PACKED', label: 'Packed Stock', description: 'Sealed containers' },
];

function getRows(response, keys = ['items', 'sources', 'rows', 'data']) {
  if (Array.isArray(response)) return response;
  for (const key of keys) {
    if (Array.isArray(response?.[key])) return response[key];
  }
  return [];
}

function getCursor(response) {
  return response?.nextCursor
    ?? response?.next_cursor
    ?? response?.pagination?.nextCursor
    ?? response?.pagination?.next_cursor
    ?? null;
}

function normalizeSource(raw = {}, sourceTypeHint = '') {
  const source = raw.source || raw.item || raw.unit || raw;
  const sourceType = String(source.sourceType || source.stage || source.type || sourceTypeHint || '').toUpperCase();
  const sourceId = source.sourceId || source.id || source.unitId || source.receiveId || source.rowId;
  const barcode = source.barcode || source.sourceBarcode || source.stageBarcode || source.legacyBarcode || '';
  const availableCount = asNumber(
    source.availableCount ?? source.availableBaseCount ?? source.baseCount ?? source.count
  );
  const availableNetWeightKg = asNumber(
    source.availableNetWeightKg ?? source.availableWeight ?? source.netWeightKg ?? source.weight
  );
  const customerId = source.customerId || source.reservedCustomerId || source.customer?.id || null;
  const children = Array.isArray(source.children)
    ? source.children
    : (Array.isArray(source.childUnits) ? source.childUnits : []);
  const packageKind = source.packageKind || source.packageTypeName || source.packageType?.kind || '';
  const isParentParcel = Boolean(
    source.isParentParcel
    || source.isParent
    || (String(packageKind).toUpperCase() === 'PARCEL' && children.length > 0)
  );

  return {
    ...source,
    sourceType,
    sourceId,
    barcode,
    itemName: source.itemName || source.item?.name || source.name || source.displayName || '—',
    packageKind,
    availableCount,
    availableNetWeightKg,
    customerId,
    customerName: source.customer?.name || source.customerName || '',
    allowPartialDispatch: Boolean(source.allowPartialDispatch),
    children,
    isParentParcel,
    queueId: `${sourceType}:${sourceId || barcode}`,
  };
}

function normalizeChallan(raw = {}) {
  return {
    ...raw,
    id: raw.id || raw.challanId,
    challanNo: raw.challanNo || raw.number || '—',
    businessDate: raw.businessDate || raw.date || raw.createdAt || '',
    customer: raw.customer || (raw.customerName ? { name: raw.customerName } : null),
    lines: raw.lines || raw.items || [],
  };
}

function mergeUnique(previous, next, key = (value) => value.id || value.sourceId || value.barcode) {
  const known = new Set(previous.map(key));
  return [...previous, ...next.filter((value) => !known.has(key(value)))];
}

export function useDispatchV2Controller({ enabled = true, pageSize = 25 } = {}) {
  const [customers, setCustomers] = useState([]);
  const [sourceSummary, setSourceSummary] = useState({});
  const [selectedSourceType, setSelectedSourceType] = useState('PACKED');
  const [sourceSearch, setSourceSearch] = useState('');
  const [sources, setSources] = useState([]);
  const [sourceCursor, setSourceCursor] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceLoadingMore, setSourceLoadingMore] = useState(false);
  const [sourceError, setSourceError] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [scanningBarcode, setScanningBarcode] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanQueue, setScanQueue] = useState([]);
  const [draft, setDraft] = useState({ customerId: '', businessDate: todayISO(), notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [challans, setChallans] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyFilters, setHistoryFilters] = useState({ from: '', to: '', search: '', status: '' });
  const [selectedChallan, setSelectedChallan] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const requestIdRef = useRef(0);

  const activeCustomers = useMemo(
    () => customers.filter((customer) => customer?.isActive !== false),
    [customers]
  );

  const lockedCustomerId = useMemo(() => {
    const ids = [...new Set(scanQueue.map((item) => item.customerId).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
  }, [scanQueue]);

  const refreshSummary = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await dispatchApi.getDispatchSourceSummary();
      setSourceSummary(response?.summary || response?.counts || response || {});
    } catch (error) {
      setSourceError(error);
    }
  }, [enabled]);

  const loadCustomers = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await legacyApi.listCustomers();
      setCustomers(response?.customers || response?.items || []);
    } catch (error) {
      setMutationError(error);
    }
  }, [enabled]);

  const loadSources = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!enabled) return [];
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (append) setSourceLoadingMore(true);
    else setSourceLoading(true);
    setSourceError(null);
    try {
      const response = await dispatchApi.listDispatchSources(
        selectedSourceType,
        { search: sourceSearch.trim() || undefined, limit: pageSize, cursor: cursor || undefined }
      );
      if (requestId !== requestIdRef.current) return [];
      const rows = getRows(response).map((row) => normalizeSource(row, selectedSourceType));
      setSources((previous) => append ? mergeUnique(previous, rows, (value) => value.queueId) : rows);
      setSourceCursor(getCursor(response));
      return rows;
    } catch (error) {
      if (requestId === requestIdRef.current) setSourceError(error);
      return [];
    } finally {
      if (requestId === requestIdRef.current) {
        setSourceLoading(false);
        setSourceLoadingMore(false);
      }
    }
  }, [enabled, pageSize, selectedSourceType, sourceSearch]);

  const loadHistory = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!enabled) return [];
    if (append) setHistoryLoadingMore(true);
    else setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await dispatchApi.listDispatchChallans({
        ...historyFilters,
        limit: pageSize,
        cursor: cursor || undefined,
      });
      const rows = getRows(response, ['challans', 'items', 'rows', 'data']).map(normalizeChallan);
      setChallans((previous) => append ? mergeUnique(previous, rows) : rows);
      setHistoryCursor(getCursor(response));
      return rows;
    } catch (error) {
      setHistoryError(error);
      return [];
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
    }
  }, [enabled, historyFilters, pageSize]);

  useEffect(() => {
    if (!enabled) return undefined;
    loadCustomers();
    refreshSummary();
    return undefined;
  }, [enabled, loadCustomers, refreshSummary]);

  useEffect(() => {
    setSources([]);
    setSourceCursor(null);
    loadSources({ append: false });
  }, [loadSources]);

  useEffect(() => {
    loadHistory({ append: false });
  }, [loadHistory]);

  const selectSourceType = useCallback((sourceType) => {
    setSelectedSourceType(String(sourceType || '').toUpperCase());
    setScanError(null);
  }, []);

  const updateDraft = useCallback((patch) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  }, []);

  const normalizeLookupResponse = useCallback((response) => {
    const raw = response?.source || response?.item || response?.unit || response?.data || response;
    return normalizeSource(raw, raw?.sourceType || raw?.stage || '');
  }, []);

  const addSourceToQueue = useCallback((rawSource) => {
    const source = normalizeSource(rawSource, selectedSourceType);
    assertDispatchableSource(source);
    if (!source.sourceId && !source.barcode) throw new Error('The selected source has no authoritative identity');
    assertCustomerReservationCompatibility(source.customerId, {
      queueCustomerIds: scanQueue.map((item) => item.customerId),
      draftCustomerId: draft.customerId,
    });
    setScanQueue((previous) => {
      if (previous.some((item) => item.queueId === source.queueId)) return previous;
      const queueItem = {
        ...source,
        dispatchBaseCount: source.availableCount ?? '',
        dispatchNetWeightKg: source.availableNetWeightKg ?? '',
        partialDispatch: false,
        residualBaseCount: 0,
        residualNetWeightKg: 0,
        damagedLostBaseCount: 0,
        damagedLostNetWeightKg: 0,
        salvageableBaseCount: 0,
        salvageableWeightKg: 0,
        partialDispatchReason: '',
      };
      return [...previous, queueItem];
    });
    if (source.customerId) updateDraft({ customerId: source.customerId });
    return source;
  }, [draft.customerId, scanQueue, selectedSourceType, updateDraft]);

  const scanBarcode = useCallback(async (barcode) => {
    const normalized = String(barcode || '').trim().toUpperCase();
    if (!normalized) return null;
    if (scanQueue.some((item) => String(item.barcode || '').toUpperCase() === normalized)) return null;
    setScanningBarcode(true);
    setScanError(null);
    try {
      const response = await dispatchApi.lookupDispatchBarcode(normalized);
      const source = normalizeLookupResponse(response);
      if (!source.sourceId && !source.barcode) throw new Error('Barcode lookup returned no source identity');
      assertCustomerReservationCompatibility(source.customerId, {
        queueCustomerIds: scanQueue.map((item) => item.customerId),
        draftCustomerId: draft.customerId,
      });
      return addSourceToQueue(source);
    } catch (error) {
      setScanError(error);
      throw error;
    } finally {
      setScanningBarcode(false);
    }
  }, [addSourceToQueue, draft.customerId, normalizeLookupResponse, scanQueue]);

  const updateQueueItem = useCallback((queueId, patch) => {
    setScanQueue((previous) => previous.map((item) => (
      item.queueId === queueId ? { ...item, ...patch } : item
    )));
  }, []);

  const removeQueueItem = useCallback((queueId) => {
    setScanQueue((previous) => previous.filter((item) => item.queueId !== queueId));
  }, []);

  const clearQueue = useCallback(() => setScanQueue([]), []);

  const createChallan = useCallback(async () => {
    if (!scanQueue.length) throw new Error('Add at least one exact source to the dispatch draft');
    if (!draft.customerId) throw new Error('Customer is required for a Dispatch V2 challan');
    const lines = scanQueue.map(buildDispatchLinePayload);
    setSubmitting(true);
    setMutationError(null);
    try {
      const response = await dispatchApi.createDispatchChallan({
        businessDate: draft.businessDate,
        customerId: draft.customerId,
        notes: draft.notes || null,
        lines,
      });
      setScanQueue([]);
      setDraft((previous) => ({ ...previous, notes: '' }));
      await Promise.all([refreshSummary(), loadSources({ append: false }), loadHistory({ append: false })]);
      return response?.challan || response?.data || response;
    } catch (error) {
      setMutationError(error);
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, [draft, loadHistory, loadSources, refreshSummary, scanQueue]);

  const openChallan = useCallback(async (challanOrId) => {
    const id = typeof challanOrId === 'object' ? challanOrId?.id : challanOrId;
    if (!id) return null;
    setDetailLoading(true);
    try {
      const response = await dispatchApi.getDispatchChallan(id);
      const detail = normalizeChallan(response?.challan || response?.data || response);
      setSelectedChallan(detail);
      return detail;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const voidChallan = useCallback(async (id, reason) => {
    const response = await dispatchApi.voidDispatchChallan(id, { reason });
    await loadHistory({ append: false });
    if (selectedChallan?.id === id) await openChallan(id);
    return response;
  }, [loadHistory, openChallan, selectedChallan?.id]);

  const correctLine = useCallback(async (id, payload) => {
    const response = await dispatchApi.correctDispatchLine(id, payload);
    await loadHistory({ append: false });
    if (selectedChallan?.id) await openChallan(selectedChallan.id);
    return response;
  }, [loadHistory, openChallan, selectedChallan?.id]);

  const returnLine = useCallback(async (id, payload) => {
    const response = await dispatchApi.returnDispatchLine(id, payload);
    await loadHistory({ append: false });
    if (selectedChallan?.id) await openChallan(selectedChallan.id);
    return response;
  }, [loadHistory, openChallan, selectedChallan?.id]);

  const reverseEvent = useCallback(async (id, payload) => {
    const response = await dispatchApi.reverseDispatchEvent(id, payload);
    await loadHistory({ append: false });
    if (selectedChallan?.id) await openChallan(selectedChallan.id);
    return response;
  }, [loadHistory, openChallan, selectedChallan?.id]);

  const loadMoreSources = useCallback(() => {
    if (!sourceCursor || sourceLoading || sourceLoadingMore) return Promise.resolve([]);
    return loadSources({ append: true, cursor: sourceCursor });
  }, [loadSources, sourceCursor, sourceLoading, sourceLoadingMore]);

  const loadMoreHistory = useCallback(() => {
    if (!historyCursor || historyLoading || historyLoadingMore) return Promise.resolve([]);
    return loadHistory({ append: true, cursor: historyCursor });
  }, [historyCursor, historyLoading, historyLoadingMore, loadHistory]);

  const exportHistory = useCallback(async () => {
    const response = await dispatchApi.exportDispatchV2(historyFilters);
    return response;
  }, [historyFilters]);

  return {
    customers: activeCustomers,
    sourceSummary,
    sourceTypes: DISPATCH_SOURCE_TYPES,
    selectedSourceType,
    selectSourceType,
    sourceSearch,
    setSourceSearch,
    sources,
    sourceCursor,
    sourceLoading,
    sourceLoadingMore,
    sourceError,
    refreshSummary,
    loadSources,
    loadMoreSources,
    scanInput,
    setScanInput,
    scanningBarcode,
    scanError,
    scanBarcode,
    scanQueue,
    updateQueueItem,
    addSourceToQueue,
    removeQueueItem,
    clearQueue,
    lockedCustomerId,
    draft,
    updateDraft,
    submitting,
    mutationError,
    createChallan,
    challans,
    historyCursor,
    historyLoading,
    historyLoadingMore,
    historyError,
    historyFilters,
    setHistoryFilters,
    loadHistory,
    loadMoreHistory,
    openChallan,
    selectedChallan,
    setSelectedChallan,
    detailLoading,
    voidChallan,
    correctLine,
    returnLine,
    reverseEvent,
    exportHistory,
    api: dispatchApi,
  };
}

export default useDispatchV2Controller;
