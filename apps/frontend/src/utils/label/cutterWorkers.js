// The C. Worker field of the Issue to Holo label: the cutter operators of the scanned crates.
// One operator prints in full, two are cut to fit, and more than two are read from Reports.
export const formatCutterWorkers = (names = []) => {
  const unique = new Map();
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (name && name.toLowerCase() !== 'no operator') unique.set(name.toLowerCase(), name);
  }
  const workers = [...unique.values()];
  if (workers.length > 2) return 'Multiple Operators';
  if (workers.length === 2) return workers.map((name) => `${name.slice(0, 3).trim().toUpperCase()}..`).join(', ');
  return workers[0] || '';
};
