/**
 * Simple debounce utility that returns a debounced function with a cancel method.
 */
export function debounce(fn, wait = 200) {
  let timer = null;
  function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { fn(...args); } catch (e) { /* swallow */ }
    }, wait);
  }
  debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return debounced;
}

export default debounce;


