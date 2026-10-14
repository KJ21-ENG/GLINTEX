import { useEffect, useRef } from 'react';

export function useInfiniteScrollSentinel({
  enabled,
  onLoadMore,
  root = null,
  rootRef = null,
  rootMargin = '600px',
}) {
  const ref = useRef(null);
  const lastHitRef = useRef(0);
  const armedRef = useRef(true);
  // Keep onLoadMore in a ref so the IntersectionObserver doesn't get torn down
  // and recreated when the callback identity changes. Tearing it down resets
  // armedRef and causes duplicate / jittery fetch triggers.
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const rootEl = rootRef?.current ?? root ?? null;
    // A new observer is created whenever loading finishes (enabled goes false -> true).
    // Arm it: if the bottom is still in view after a page arrived, the next page must load
    // without the user scrolling away and back (the list used to stop part-way).
    armedRef.current = true;
    let retryTimer = null;
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.some(e => e.isIntersecting);
        if (!hit) {
          armedRef.current = true;
          return;
        }
        // Only fire once per "enter" to avoid jittery repeated triggers while the sentinel stays visible.
        if (!armedRef.current) return;
        // Throttle intersection bursts, but retry instead of dropping the request.
        const wait = 250 - (Date.now() - (lastHitRef.current || 0));
        if (wait > 0) {
          if (!retryTimer) retryTimer = setTimeout(() => {
            retryTimer = null;
            const record = obs.takeRecords();
            const stillVisible = record.length ? record.some(e => e.isIntersecting) : true;
            if (stillVisible && armedRef.current) { armedRef.current = false; lastHitRef.current = Date.now(); onLoadMoreRef.current?.(); }
          }, wait);
          return;
        }
        armedRef.current = false;
        lastHitRef.current = Date.now();
        onLoadMoreRef.current?.();
      },
      { root: rootEl, rootMargin, threshold: 0.01 },
    );

    obs.observe(el);
    return () => { if (retryTimer) clearTimeout(retryTimer); obs.disconnect(); };
    // Intentionally exclude onLoadMore — it's read from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, root, rootRef, rootMargin]);

  return ref;
}

