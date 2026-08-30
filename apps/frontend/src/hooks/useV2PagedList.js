import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stableStringify } from './useV2CursorList';

/**
 * useV2PagedList - Numbered (offset) pagination over the v2 list endpoints.
 *
 * Counterpart to useV2CursorList: items are REPLACED per page instead of
 * accumulated, driven by a 1-based `page` sent to the endpoint. Any change to
 * search/filters/order resets to page 1. The server returns `summary` (with
 * totalCount) on page 1 only; it is preserved while flipping pages. If the
 * dataset shrinks below the current page (rows deleted, filters on the server
 * side), the page clamps back to the last non-empty one.
 */
export function useV2PagedList({
  enabled,
  fetchPage, // ({limit, page, search, dateFrom, dateTo, filters, order}) => {items, hasMore, summary}
  limit = 50,
  scopeKey = '',
  search = '',
  dateFrom = '',
  dateTo = '',
  filters = [],
  order = 'desc',
}) {
  const [items, setItems] = useState([]);
  const [page, setPageState] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const genRef = useRef(0);
  const lastKeyRef = useRef(null);

  const key = useMemo(
    () => stableStringify({ scopeKey, search, dateFrom, dateTo, filters, order, limit }),
    [scopeKey, search, dateFrom, dateTo, filters, order, limit],
  );

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  useEffect(() => {
    if (!enabled) return;

    // Params changed: reset to page 1 (and clear the stale summary) before fetching,
    // so we never issue a request for e.g. page 3 of a brand-new filter context.
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setSummary(null);
      if (page !== 1) {
        setPageState(1);
        return; // effect re-runs with page 1
      }
    }

    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetchPageRef.current({ limit, page, search, dateFrom, dateTo, filters, order });
        if (gen !== genRef.current) return; // stale response
        const nextItems = Array.isArray(res?.items) ? res.items : [];
        setItems(nextItems);
        setHasMore(Boolean(res?.hasMore));
        if (res?.summary != null) setSummary(res.summary);
        // Landed past the end (dataset shrank): clamp to the last real page.
        if (!nextItems.length && page > 1) {
          const total = Number(res?.summary?.totalCount);
          const lastPage = Number.isFinite(total) && total > 0 ? Math.ceil(total / limit) : page - 1;
          setPageState(Math.max(1, Math.min(page - 1, lastPage)));
        }
      } catch (e) {
        if (gen !== genRef.current) return;
        setError(e);
        setItems([]);
        setHasMore(false);
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, page, refreshNonce, limit]);

  const setPage = useCallback((p) => {
    const n = Number(p);
    if (!Number.isFinite(n)) return;
    setPageState(Math.max(1, Math.floor(n)));
  }, []);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  const totalCount = Number.isFinite(Number(summary?.totalCount)) ? Number(summary.totalCount) : null;
  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / limit)) : null;
  const rangeStart = items.length ? (page - 1) * limit + 1 : 0;

  return {
    items,
    page,
    setPage,
    totalCount,
    totalPages,
    rangeStart,
    hasMore,
    isLoading: loading,
    error,
    summary,
    refresh,
  };
}
