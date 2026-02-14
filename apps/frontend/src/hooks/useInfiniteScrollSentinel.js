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
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.some(e => e.isIntersecting);
        if (!hit) {
          armedRef.current = true;
          return;
        }
        // Only fire once per "enter" to avoid jittery repeated triggers while the sentinel stays visible.
        if (!armedRef.current) return;
        armedRef.current = false;
        // Throttle intersection bursts (helps avoid scroll jitter / rapid-fire fetch triggers).
        const now = Date.now();
        if (now - (lastHitRef.current || 0) < 250) return;
        lastHitRef.current = now;
        onLoadMoreRef.current?.();
      },
      { root: rootEl, rootMargin, threshold: 0.01 },
    );

    obs.observe(el);
    return () => obs.disconnect();
    // Intentionally exclude onLoadMore — it's read from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, root, rootRef, rootMargin]);

  return ref;
}

