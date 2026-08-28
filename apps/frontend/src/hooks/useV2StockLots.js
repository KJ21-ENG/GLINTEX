import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as v2 from '../api/v2';

/**
 * useV2StockLots - paginated stock groups and lazy lot rows for every process.
 *
 * Moved verbatim out of pages/Stock.jsx so the Stock page and the Combined Stock
 * view read lots through the exact same code path. `enabled` replaces the page's
 * local `v2StockEnabled` flag; everything else (state, effects, guards, dependency
 * arrays) is unchanged.
 *
 * Returns the same shape the views already expect as their `v2` prop:
 * { lots, rowsByKey, loadLotRows, barcodeHitKeys, lotsLoading, lotsError, retryLots }
 */
export function useV2StockLots(processId, {
  enabled = false,
  loadGroups = true,
  search = '',
  filters = {},
} = {}) {
  const [v2Lots, setV2Lots] = useState([]);
  const [v2LotsLoading, setV2LotsLoading] = useState(false);
  const [v2LotsError, setV2LotsError] = useState(null);
  const [v2LotsNonce, setV2LotsNonce] = useState(0);
  const [v2LotsCursor, setV2LotsCursor] = useState(null);
  const [v2LotsHasMore, setV2LotsHasMore] = useState(false);
  const [v2LotsLoadingMore, setV2LotsLoadingMore] = useState(false);
  const [v2Summary, setV2Summary] = useState(null);
  const [v2SummaryLoading, setV2SummaryLoading] = useState(false);
  const [v2SummaryError, setV2SummaryError] = useState(null);
  const [v2RowsByKey, setV2RowsByKey] = useState({});
  const [v2RowPagesByKey, setV2RowPagesByKey] = useState({});
  const [v2BarcodeKeys, setV2BarcodeKeys] = useState(new Set());
  const v2BarcodeReqId = useRef(0);
  const queryGeneration = useRef(0);
  const summaryGeneration = useRef(0);
  const activeControllers = useRef(new Set());
  const filterParams = useMemo(() => ({
    search,
    view: filters.view || '',
    groupBy: filters.groupBy ? 'true' : '',
    item: filters.item || '',
    cut: filters.cut || '',
    yarn: filters.yarn || '',
    firm: filters.firm || '',
    supplier: filters.supplier || '',
    status: filters.status || '',
    steamed: filters.steamed || '',
    from: filters.from || '',
    to: filters.to || '',
  }), [search, filters.view, filters.groupBy, filters.item, filters.cut, filters.yarn, filters.firm, filters.supplier, filters.status, filters.steamed, filters.from, filters.to]);

  useEffect(() => {
    const generation = ++queryGeneration.current;
    if (!enabled || !loadGroups) {
      setV2Lots([]);
      setV2RowsByKey({});
      setV2RowPagesByKey({});
      setV2LotsCursor(null);
      setV2LotsHasMore(false);
      setV2LotsLoading(false);
      setV2LotsLoadingMore(false);
      return;
    }
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setV2Lots([]);
    setV2RowsByKey({});
    setV2RowPagesByKey({});
    setV2BarcodeKeys(new Set());
    setV2LotsCursor(null);
    setV2LotsHasMore(false);
    setV2LotsLoadingMore(false);
    setV2LotsLoading(true);
    setV2LotsError(null);
    v2.getV2StockLots(processId, { ...filterParams, limit: 100, summaryMode: 'separate' }, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || generation !== queryGeneration.current) return;
        setV2Lots(Array.isArray(res?.items) ? res.items : []);
        setV2LotsCursor(res?.nextCursor || null);
        setV2LotsHasMore(Boolean(res?.hasMore));
        setV2LotsLoading(false);
        activeControllers.current.delete(controller);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || generation !== queryGeneration.current) return;
        console.error('Failed to load v2 stock lots', err);
        setV2Lots([]);
        setV2LotsError(err);
        setV2LotsLoading(false);
        activeControllers.current.delete(controller);
      });
    return () => {
      controller.abort();
      activeControllers.current.delete(controller);
    };
  }, [enabled, loadGroups, processId, v2LotsNonce, filterParams]);

  useEffect(() => {
    const generation = ++summaryGeneration.current;
    if (!enabled) {
      setV2Summary(null);
      setV2SummaryLoading(false);
      setV2SummaryError(null);
      return undefined;
    }
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setV2Summary(null);
    setV2SummaryLoading(true);
    setV2SummaryError(null);
    v2.getV2StockSummary(processId, filterParams, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || generation !== summaryGeneration.current) return;
        setV2Summary(res?.summary || null);
        setV2SummaryLoading(false);
        activeControllers.current.delete(controller);
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || generation !== summaryGeneration.current) return;
        setV2SummaryError(error);
        setV2SummaryLoading(false);
        activeControllers.current.delete(controller);
      });
    return () => {
      controller.abort();
      activeControllers.current.delete(controller);
    };
  }, [enabled, processId, v2LotsNonce, filterParams]);

  const loadMoreLots = useCallback(async () => {
    if (!enabled || !loadGroups || !v2LotsHasMore || !v2LotsCursor || v2LotsLoadingMore) return;
    const generation = queryGeneration.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setV2LotsLoadingMore(true);
    try {
      const res = await v2.getV2StockLots(processId, {
        ...filterParams,
        limit: 100,
        cursor: v2LotsCursor,
        summaryMode: 'separate',
      }, { signal: controller.signal });
      if (generation !== queryGeneration.current) return;
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      const itemIdentity = (item) => item?.groupKey || item?.lotKey || null;
      setV2Lots((prev) => {
        const existingKeys = new Set(prev.map(itemIdentity).filter(Boolean));
        const additions = nextItems.filter((item) => {
          const identity = itemIdentity(item);
          if (!identity) return true;
          if (existingKeys.has(identity)) return false;
          existingKeys.add(identity);
          return true;
        });
        return [...prev, ...additions];
      });
      setV2LotsCursor(res?.nextCursor || null);
      setV2LotsHasMore(Boolean(res?.hasMore));
      if (res?.summary) setV2Summary(res.summary);
    } catch (err) {
      if (err?.name !== 'AbortError' && generation === queryGeneration.current) {
        console.error('Failed to load more v2 stock lots', err);
        setV2LotsError(err);
      }
    } finally {
      activeControllers.current.delete(controller);
      if (generation === queryGeneration.current) setV2LotsLoadingMore(false);
    }
  }, [enabled, loadGroups, filterParams, processId, v2LotsCursor, v2LotsHasMore, v2LotsLoadingMore]);

  const loadV2LotRows = useCallback(async (lotKey) => {
    if (!enabled) return [];
    if (Object.prototype.hasOwnProperty.call(v2RowsByKey, lotKey)) return v2RowsByKey[lotKey];
    const generation = queryGeneration.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setV2RowPagesByKey((prev) => ({
      ...prev,
      [lotKey]: { ...(prev[lotKey] || {}), loading: true, error: null },
    }));
    try {
      const res = await v2.getV2StockLotRows(processId, { key: lotKey, limit: 100 }, { signal: controller.signal });
      const items = Array.isArray(res?.items) ? res.items : [];
      if (generation === queryGeneration.current) {
        setV2RowsByKey(prev => ({ ...prev, [lotKey]: items }));
        setV2RowPagesByKey((prev) => ({
          ...prev,
          [lotKey]: {
            loading: false,
            loadingMore: false,
            error: null,
            hasMore: Boolean(res?.hasMore),
            nextCursor: res?.nextCursor || null,
          },
        }));
      }
      return items;
    } catch (error) {
      if (generation === queryGeneration.current) {
        setV2RowPagesByKey((prev) => ({
          ...prev,
          [lotKey]: { loading: false, loadingMore: false, error, hasMore: false, nextCursor: null },
        }));
      }
      throw error;
    } finally {
      activeControllers.current.delete(controller);
    }
  }, [enabled, processId, v2RowsByKey]);

  const loadMoreV2LotRows = useCallback(async (lotKey) => {
    const pageState = v2RowPagesByKey[lotKey];
    if (!enabled || !pageState?.hasMore || !pageState?.nextCursor || pageState.loadingMore) return [];
    const generation = queryGeneration.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setV2RowPagesByKey((prev) => ({
      ...prev,
      [lotKey]: { ...prev[lotKey], loadingMore: true, error: null },
    }));
    try {
      const res = await v2.getV2StockLotRows(processId, {
        key: lotKey,
        limit: 100,
        cursor: pageState.nextCursor,
      }, { signal: controller.signal });
      if (generation !== queryGeneration.current) return [];
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      setV2RowsByKey((prev) => {
        const existing = prev[lotKey] || [];
        const ids = new Set(existing.map((row) => row?.id).filter(Boolean));
        return {
          ...prev,
          [lotKey]: [...existing, ...nextItems.filter((row) => !row?.id || !ids.has(row.id))],
        };
      });
      setV2RowPagesByKey((prev) => ({
        ...prev,
        [lotKey]: {
          loading: false,
          loadingMore: false,
          error: null,
          hasMore: Boolean(res?.hasMore),
          nextCursor: res?.nextCursor || null,
        },
      }));
      return nextItems;
    } catch (error) {
      if (generation === queryGeneration.current) {
        setV2RowPagesByKey((prev) => ({
          ...prev,
          [lotKey]: { ...prev[lotKey], loadingMore: false, error },
        }));
      }
      return [];
    } finally {
      activeControllers.current.delete(controller);
    }
  }, [enabled, processId, v2RowPagesByKey]);

  useEffect(() => {
    if (!enabled) return;
    const q = String(search || '').trim();
    if (q.length < 6) {
      setV2BarcodeKeys(new Set());
      return;
    }
    const myId = ++v2BarcodeReqId.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    const t = setTimeout(() => {
      v2.getV2StockBarcodeLotKeys(processId, { q, view: filterParams.view }, { signal: controller.signal })
        .then((res) => {
          if (v2BarcodeReqId.current !== myId) return;
          const keys = Array.isArray(res?.keys) ? res.keys : [];
          setV2BarcodeKeys(new Set(keys));
        })
        .catch((err) => {
          if (v2BarcodeReqId.current !== myId) return;
          console.error('Failed to lookup v2 stock barcode keys', err);
          setV2BarcodeKeys(new Set());
        })
        .finally(() => activeControllers.current.delete(controller));
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
      activeControllers.current.delete(controller);
    };
  }, [enabled, filterParams.view, processId, search]);

  useEffect(() => () => {
    for (const controller of activeControllers.current) controller.abort();
    activeControllers.current.clear();
  }, []);

  const retryV2Lots = useCallback(() => setV2LotsNonce((n) => n + 1), []);

  return useMemo(() => ({
    lots: v2Lots,
    rowsByKey: v2RowsByKey,
    rowPagesByKey: v2RowPagesByKey,
    loadLotRows: loadV2LotRows,
    loadMoreLotRows: loadMoreV2LotRows,
    barcodeHitKeys: v2BarcodeKeys,
    lotsLoading: v2LotsLoading,
    lotsError: v2LotsError,
    retryLots: retryV2Lots,
    loadMoreLots,
    lotsHasMore: v2LotsHasMore,
    lotsLoadingMore: v2LotsLoadingMore,
    summary: v2Summary,
    summaryLoading: v2SummaryLoading,
    summaryError: v2SummaryError,
  }), [v2Lots, v2RowsByKey, v2RowPagesByKey, loadV2LotRows, loadMoreV2LotRows, v2BarcodeKeys, v2LotsLoading, v2LotsError, retryV2Lots, loadMoreLots, v2LotsHasMore, v2LotsLoadingMore, v2Summary, v2SummaryLoading, v2SummaryError]);
}
