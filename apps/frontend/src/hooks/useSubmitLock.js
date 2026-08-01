import { useCallback, useRef, useState } from 'react';

/**
 * Synchronous re-entry lock for submit/save handlers.
 *
 * The existing `submitting`/`saving` state guards only take effect after a
 * render commit, so a second Enter/click that arrives before the commit (or
 * one queued behind a native window.confirm) re-enters the handler and
 * duplicates the record. The ref check here is synchronous, so the second
 * activation is dropped no matter how fast it arrives.
 *
 * Usage:
 *   const [locked, wrap] = useSubmitLock();
 *   const handleSave = wrap(async () => { ... });
 *
 * `locked` mirrors the lock as React state for `disabled={locked}` where the
 * button has no in-flight state of its own. The lock is held for the entire
 * handler run — including any window.confirm and print awaits — and released
 * in `finally` so a thrown error never wedges the form.
 */
export function useSubmitLock() {
  const lockRef = useRef(false);
  const [locked, setLocked] = useState(false);

  const wrap = useCallback((fn) => async (...args) => {
    if (lockRef.current) {
      // Swallow the duplicate activation; if it came from a <form onSubmit>,
      // stop the native submit or the page would reload.
      args[0]?.preventDefault?.();
      return;
    }
    lockRef.current = true;
    setLocked(true);
    try {
      return await fn(...args);
    } finally {
      lockRef.current = false;
      setLocked(false);
    }
  }, []);

  return [locked, wrap];
}

export default useSubmitLock;
