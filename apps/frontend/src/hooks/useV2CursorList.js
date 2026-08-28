import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const stableStringify = (obj) => {
  try {
    const seen = new WeakSet();
    const normalize = (value) => {
      if (value == null) return value;
      const t = typeof value;
      if (t === 'string' || t === 'number' || t === 'boolean') return value;
      if (t !== 'object') return String(value);

      if (seen.has(value)) return '[Circular]';
      seen.add(value);

      if (Array.isArray(value)) return value.map(normalize);

      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = normalize(value[k]);
      return out;
    };

    return JSON.stringify(normalize(obj));
  } catch {
    return '';
  }
};

export function useV2CursorList({
  enabled,
  fetchPage, // ({limit, cursor, search, dateFrom, dateTo, filters, order, signal}) => page
  fetchSummary = null, // ({search, dateFrom, dateTo, filters, order, signal}) => {summary, computedAt}
  limit = 50,
  scopeKey = '',
  search = '',
  dateFrom = '',
  dateTo = '',
  filters = [],
  order = 'desc',
}) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const activePageRequestRef = useRef(null);
  const genRef = useRef(0);
  const activeControllersRef = useRef(new Set());

  // Keep cursor/hasMore in refs so loadMore's identity stays stable across fetches.
  // This prevents the IntersectionObserver from being torn down & re-created on every
  // page load, which was the root cause of the end-of-list jitter/shaking.
  const cursorRef = useRef(cursor);
  const hasMoreRef = useRef(hasMore);
  cursorRef.current = cursor;
  hasMoreRef.current = hasMore;
  const queryParamsRef = useRef({ search, dateFrom, dateTo, filters, order });
  queryParamsRef.current = { search, dateFrom, dateTo, filters, order };

  const key = useMemo(
    () => stableStringify({ scopeKey, search, dateFrom, dateTo, filters, order }),
    [scopeKey, search, dateFrom, dateTo, filters, order],
  );

  const refresh = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setSummary(null);
    setSummaryError(null);
    setRefreshNonce((n) => n + 1);
  }, []);

  // Use refs for fetchPage too, so the callback identity only changes with
  // search/filter params (via `key`), not on every render.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const fetchSummaryRef = useRef(fetchSummary);
  fetchSummaryRef.current = fetchSummary;

  const loadMore = useCallback(async () => {
    if (!enabled) return;
    if (activePageRequestRef.current) return;
    if (!hasMoreRef.current) return;
    const requestToken = Symbol('v2-page-request');
    activePageRequestRef.current = requestToken;
    setLoading(true);
    setError(null);
    const genAtStart = genRef.current;
    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    try {
      const currentCursor = cursorRef.current;
      const {
        search: currentSearch,
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        filters: currentFilters,
        order: currentOrder,
      } = queryParamsRef.current;
      const res = await fetchPageRef.current({
        limit,
        cursor: currentCursor,
        search: currentSearch,
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        filters: currentFilters,
        order: currentOrder,
        signal: controller.signal,
      });
      // Params changed while request was in flight: drop stale response.
      if (genAtStart !== genRef.current) return;
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      const nextCursor = res?.nextCursor ?? null;
      const nextHasMore = Boolean(res?.hasMore);
      // Only update summary when the server actually provides one (first page).
      // Subsequent pages return summary: null; preserve the existing one.
      if (res?.summary != null) {
        setSummary(res.summary);
      } else if (!currentCursor) {
        // First page with no summary — clear any stale value.
        setSummary(null);
      }
      setItems((prev) => (currentCursor ? [...prev, ...nextItems] : nextItems));
      cursorRef.current = nextCursor;
      hasMoreRef.current = nextHasMore;
      setCursor(nextCursor);
      setHasMore(nextHasMore);
    } catch (e) {
      if (e?.name !== 'AbortError' && genAtStart === genRef.current) setError(e);
    } finally {
      activeControllersRef.current.delete(controller);
      if (activePageRequestRef.current === requestToken) {
        activePageRequestRef.current = null;
        if (genAtStart === genRef.current) setLoading(false);
      }
    }
    // Only re-create when the *parameters* change (via `key`), not when cursor/hasMore change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, limit]);

  // Reset + load first page on param changes.
  useEffect(() => {
    if (!enabled) return;
    for (const controller of activeControllersRef.current) controller.abort();
    activeControllersRef.current.clear();
    genRef.current += 1;
    setItems([]);
    setCursor(null);
    setHasMore(true); // Should initially be true so we can fetch page 1
    setError(null);
    setSummary(null);
    setSummaryLoading(Boolean(fetchSummaryRef.current));
    setSummaryError(null);
    setLoading(false);

    // Synchronously update refs so the subsequent loadMore() call sees the reset state immediately
    cursorRef.current = null;
    hasMoreRef.current = true;
    // The aborted generation still runs its `finally`. Clear its ownership now;
    // the token check prevents that stale `finally` from releasing a newer page.
    activePageRequestRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, refreshNonce]);

  useEffect(() => {
    if (!enabled) return;
    loadMore();
  }, [enabled, key, refreshNonce, loadMore]);

  useEffect(() => {
    if (!enabled || !fetchSummaryRef.current) return undefined;
    const controller = new AbortController();
    const genAtStart = genRef.current;
    activeControllersRef.current.add(controller);
    const current = queryParamsRef.current;
    setSummaryLoading(true);
    setSummaryError(null);
    fetchSummaryRef.current({ ...current, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || genAtStart !== genRef.current) return;
        setSummary(res?.summary ?? null);
        setSummaryLoading(false);
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || genAtStart !== genRef.current) return;
        setSummaryError(error);
        setSummaryLoading(false);
      })
      .finally(() => activeControllersRef.current.delete(controller));
    return () => controller.abort();
  }, [enabled, key, refreshNonce]);

  useEffect(() => () => {
    for (const controller of activeControllersRef.current) controller.abort();
    activeControllersRef.current.clear();
  }, []);

  return {
    items,
    hasMore,
    nextCursor: cursor,
    isLoading: loading,
    error,
    loadMore,
    refresh,
    summary,
    summaryLoading,
    summaryError,
  };
}
