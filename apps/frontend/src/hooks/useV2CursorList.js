import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const stableStringify = (obj) => {
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
  fetchPage, // ({limit, cursor, search, dateFrom, dateTo, filters}) => {items, hasMore, nextCursor}
  limit = 50,
  scopeKey = '',
  search = '',
  dateFrom = '',
  dateTo = '',
  filters = [],
}) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const inFlightRef = useRef(false);
  const genRef = useRef(0);

  // Keep cursor/hasMore in refs so loadMore's identity stays stable across fetches.
  // This prevents the IntersectionObserver from being torn down & re-created on every
  // page load, which was the root cause of the end-of-list jitter/shaking.
  const cursorRef = useRef(cursor);
  const hasMoreRef = useRef(hasMore);
  cursorRef.current = cursor;
  hasMoreRef.current = hasMore;
  const queryParamsRef = useRef({ search, dateFrom, dateTo, filters });
  queryParamsRef.current = { search, dateFrom, dateTo, filters };

  const key = useMemo(
    () => stableStringify({ scopeKey, search, dateFrom, dateTo, filters }),
    [scopeKey, search, dateFrom, dateTo, filters],
  );

  const refresh = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setSummary(null);
    setRefreshNonce((n) => n + 1);
  }, []);

  // Use refs for fetchPage too, so the callback identity only changes with
  // search/filter params (via `key`), not on every render.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const loadMore = useCallback(async () => {
    if (!enabled) return;
    if (inFlightRef.current) return;
    if (!hasMoreRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    const genAtStart = genRef.current;
    try {
      const currentCursor = cursorRef.current;
      const {
        search: currentSearch,
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        filters: currentFilters,
      } = queryParamsRef.current;
      const res = await fetchPageRef.current({
        limit,
        cursor: currentCursor,
        search: currentSearch,
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        filters: currentFilters,
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
      if (genAtStart === genRef.current) setError(e);
    } finally {
      if (genAtStart === genRef.current) setLoading(false);
      inFlightRef.current = false;
    }
    // Only re-create when the *parameters* change (via `key`), not when cursor/hasMore change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, limit]);

  // Reset + load first page on param changes.
  useEffect(() => {
    if (!enabled) return;
    genRef.current += 1;
    setItems([]);
    setCursor(null);
    setHasMore(true); // Should initially be true so we can fetch page 1
    setError(null);
    setSummary(null);
    setLoading(false);

    // Synchronously update refs so the subsequent loadMore() call sees the reset state immediately
    cursorRef.current = null;
    hasMoreRef.current = true;
    inFlightRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, refreshNonce]);

  useEffect(() => {
    if (!enabled) return;
    loadMore();
  }, [enabled, key, refreshNonce, loadMore]);

  return {
    items,
    hasMore,
    nextCursor: cursor,
    isLoading: loading,
    error,
    loadMore,
    refresh,
    summary,
  };
}
