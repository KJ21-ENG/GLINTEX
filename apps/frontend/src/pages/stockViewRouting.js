const PROCESS_INDEPENDENT_VIEWS = new Set(['combined', 'packed']);

export function getProcessStockViewAlignment(view, processId) {
  if (PROCESS_INDEPENDENT_VIEWS.has(view)) {
    return { view, clearUrl: false };
  }
  if (processId === 'holo') {
    return { view: 'holo', clearUrl: true };
  }
  if (processId !== 'cutter') {
    return { view: 'jumbo', clearUrl: true };
  }
  if (view === 'holo') {
    return { view: 'jumbo', clearUrl: false };
  }
  return { view, clearUrl: false };
}
