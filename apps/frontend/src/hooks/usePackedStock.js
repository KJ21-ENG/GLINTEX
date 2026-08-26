import { useCallback, useEffect, useRef, useState } from 'react';
import * as packedStockApi from '../api/packedStock';
import { buildPackedStockQuery, normalizePackedStockFilters } from './packedStockQuery';
import { normalizePackingLabelResponse } from '../utils/packingLabel';

function getRows(response) {
  if (Array.isArray(response)) return response;
  return response?.items || response?.units || response?.rows || response?.data || [];
}

function getNextCursor(response) {
  return response?.nextCursor
    ?? response?.next_cursor
    ?? response?.pagination?.nextCursor
    ?? response?.pagination?.next_cursor
    ?? null;
}

function getUnitId(unit) {
  return unit?.id || unit?.unitId || unit?.sourceId || unit?.barcode;
}

export function usePackedStock({ filters = {}, pageSize = 50, enabled = true } = {}) {
  const [units, setUnits] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);
  const normalizedFilters = normalizePackedStockFilters(filters);
  const { status, customerId, search, batchKind } = normalizedFilters;
  const load = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!enabled) {
      setUnits([]);
      setNextCursor(null);
      setError(null);
      return [];
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const response = await packedStockApi.listPackedStock(
        buildPackedStockQuery({ status, customerId, search, batchKind }, pageSize, cursor),
        { signal: controller.signal }
      );
      if (requestId !== requestIdRef.current) return [];
      const rows = getRows(response);
      setUnits((previous) => {
        if (!append) return rows;
        const known = new Set(previous.map(getUnitId));
        return [...previous, ...rows.filter((row) => !known.has(getUnitId(row)))];
      });
      setNextCursor(getNextCursor(response));
      return rows;
    } catch (requestError) {
      if (requestError?.name === 'AbortError') return [];
      if (requestId === requestIdRef.current) setError(requestError);
      return [];
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [batchKind, customerId, enabled, pageSize, search, status]);

  useEffect(() => {
    load({ append: false });
    return () => abortRef.current?.abort();
  }, [load]);

  const refresh = useCallback(() => load({ append: false }), [load]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) return Promise.resolve([]);
    return load({ append: true, cursor: nextCursor });
  }, [load, loading, loadingMore, nextCursor]);

  const lookup = useCallback(async (barcode, options = {}) => {
    const response = await packedStockApi.getPackedStockByBarcode(barcode, options);
    return response?.unit || response?.item || response?.data || response;
  }, []);

  const getUnit = useCallback(async (id, options = {}) => {
    const response = await packedStockApi.getPackedStockUnit(id, options);
    return response?.unit || response?.item || response?.data || response;
  }, []);

  const getHistory = useCallback(async (id, params = {}, options = {}) => {
    const response = await packedStockApi.getPackedStockUnitHistory(id, params, options);
    return {
      events: response?.events || response?.history || response?.data?.events || [],
      nextCursor: getNextCursor(response),
      unit: response?.unit || null,
    };
  }, []);

  const mutateUnit = useCallback(async (mutation, id, payload = {}) => {
    if (typeof mutation !== 'function') throw new Error('Packed Stock mutation is required');
    const response = await mutation(id, payload);
    await refresh();
    return normalizePackingLabelResponse(response);
  }, [refresh]);

  return {
    units,
    nextCursor,
    hasMore: Boolean(nextCursor),
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
    lookup,
    getUnit,
    getHistory,
    mutateUnit,
    api: packedStockApi,
  };
}

export default usePackedStock;
