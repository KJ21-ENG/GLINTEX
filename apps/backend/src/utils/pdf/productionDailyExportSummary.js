function asTrimmedText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function roundTo3Decimals(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

export function sortByLabel(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function normalizeMachineLabel(value) {
  return asTrimmedText(value, 'Unassigned');
}

export function normalizeItemLabel(value) {
  return asTrimmedText(value, 'Unassigned');
}

export function normalizeYarnLabel(value) {
  return asTrimmedText(value, 'Unassigned');
}

export function getMachineSummaryGroupLabel(value) {
  const machine = normalizeMachineLabel(value);
  const [prefix] = machine.split('-');
  return asTrimmedText(prefix, machine);
}

export function buildMachineSummary(rows = []) {
  const summaryMap = new Map();
  rows.forEach((row) => {
    const machine = getMachineSummaryGroupLabel(row.machine);
    const current = summaryMap.get(machine) || {
      machine,
      totalQuantity: 0,
      totalNetProduction: 0,
    };
    current.totalQuantity += Number(row.quantity || 0);
    current.totalNetProduction += Number(row.net || 0);
    summaryMap.set(machine, current);
  });
  return Array.from(summaryMap.values())
    .map((entry) => ({
      machine: entry.machine,
      totalQuantity: roundTo3Decimals(entry.totalQuantity),
      totalNetProduction: roundTo3Decimals(entry.totalNetProduction),
    }))
    .sort((a, b) => sortByLabel(a.machine, b.machine));
}

export function buildItemSummary(rows = []) {
  const summaryMap = new Map();
  rows.forEach((row) => {
    const item = normalizeItemLabel(row.item);
    const current = summaryMap.get(item) || {
      item,
      totalQuantity: 0,
      totalNetProduction: 0,
    };
    current.totalQuantity += Number(row.quantity || 0);
    current.totalNetProduction += Number(row.net || 0);
    summaryMap.set(item, current);
  });
  return Array.from(summaryMap.values())
    .map((entry) => ({
      item: entry.item,
      totalQuantity: roundTo3Decimals(entry.totalQuantity),
      totalNetProduction: roundTo3Decimals(entry.totalNetProduction),
    }))
    .sort((a, b) => sortByLabel(a.item, b.item));
}

export function buildYarnSummary(rows = []) {
  const summaryMap = new Map();
  rows.forEach((row) => {
    const yarn = normalizeYarnLabel(row.yarn);
    const current = summaryMap.get(yarn) || {
      yarn,
      totalQuantity: 0,
      totalNetProduction: 0,
    };
    current.totalQuantity += Number(row.quantity || 0);
    current.totalNetProduction += Number(row.net || 0);
    summaryMap.set(yarn, current);
  });
  return Array.from(summaryMap.values())
    .map((entry) => ({
      yarn: entry.yarn,
      totalQuantity: roundTo3Decimals(entry.totalQuantity),
      totalNetProduction: roundTo3Decimals(entry.totalNetProduction),
    }))
    .sort((a, b) => sortByLabel(a.yarn, b.yarn));
}
