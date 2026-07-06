import { useEffect, useState } from 'react';

/**
 * useDebouncedValue - Returns `value` after it has stayed unchanged for `delayMs`.
 *
 * Use for search inputs that feed server queries (e.g. useV2CursorList) so each
 * keystroke doesn't reset the list and fire a fresh API request.
 */
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default useDebouncedValue;
