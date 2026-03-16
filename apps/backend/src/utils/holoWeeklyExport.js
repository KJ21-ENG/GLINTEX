import { enumerateDatesInclusive, parseDateOnly } from './productionDailyExport.js';
import { buildBaseMachineSpindleSummary, getBaseMachineName, getSortedBaseMachineNames } from './machineGrouping.js';
import {
  buildNormalizedHoloRows,
  createProductionExportBuilderContext,
  getProductionExportDb,
} from './pdf/productionDailyExportData.js';

function asTrimmedText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function roundTo3Decimals(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function normalizeKey(value, fallback = '') {
  return asTrimmedText(value, fallback).toUpperCase();
}

function buildProblemError(message, details, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function buildWarningSummary(dates = [], baseMachines = [], metricMap = new Map()) {
  const warningMap = new Map();
  dates.forEach((date) => {
    const missingMachines = [];
    baseMachines.forEach((baseMachine) => {
      const entry = metricMap.get(`${date}::${baseMachine}`);
      if (!entry || entry.hours === null || entry.hours === undefined || entry.wastage === null || entry.wastage === undefined) {
        missingMachines.push(baseMachine);
      }
    });
    if (missingMachines.length > 0) {
      warningMap.set(date, missingMachines);
    }
  });
  return Array.from(warningMap.entries()).map(([date, machines]) => ({ date, machines }));
}

function buildRateMatchers(rateRows = []) {
  const exact = new Map();
  const anyCut = new Map();

  (rateRows || []).forEach((row) => {
    const yarnName = normalizeKey(row.yarn?.name);
    if (!yarnName) return;
    const cutName = row.cutMatcher === 'ANY' ? 'ANY' : normalizeKey(row.cut?.name);
    const normalizedRate = Number(row.productionPerHourKg || 0);
    const enriched = {
      ...row,
      cutName,
      yarnName,
      productionPerHourKg: normalizedRate,
    };
    if (cutName === 'ANY') {
      anyCut.set(yarnName, enriched);
      return;
    }
    exact.set(`${yarnName}::${cutName}`, enriched);
  });

  return { exact, anyCut };
}

export function validateHoloWeeklyExportRequest({ process, from, to }) {
  const normalizedProcess = String(process || '').trim().toLowerCase();
  if (normalizedProcess !== 'holo') {
    return { ok: false, error: 'Weekly production export supports only holo process' };
  }
  if (!from || !to) {
    return { ok: false, error: 'process, from, and to are required' };
  }

  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate) {
    return { ok: false, error: 'from and to must be valid YYYY-MM-DD dates' };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: 'from date cannot be later than to date' };
  }

  return {
    ok: true,
    process: normalizedProcess,
    fromDate,
    toDate,
    dates: enumerateDatesInclusive(fromDate, toDate),
  };
}

export async function buildHoloWeeklyExportData({ from, to, helpers = {}, db } = {}) {
  const validation = validateHoloWeeklyExportRequest({ process: 'holo', from, to });
  if (!validation.ok) {
    throw buildProblemError(validation.error, { error: 'invalid_weekly_export_request' });
  }

  const activeDb = db || await getProductionExportDb();
  const context = createProductionExportBuilderContext(helpers);
  const dates = validation.dates;

  const [machines, rateRows, metricRows, rawRows] = await Promise.all([
    activeDb.machine.findMany({
      where: { processType: { in: ['all', 'holo'] } },
      orderBy: { name: 'asc' },
    }),
    activeDb.holoProductionPerHour.findMany({
      include: {
        yarn: { select: { id: true, name: true } },
        cut: { select: { id: true, name: true } },
      },
      orderBy: [
        { yarn: { name: 'asc' } },
        { cutMatcher: 'asc' },
      ],
    }),
    activeDb.holoDailyMetric.findMany({
      where: {
        date: { gte: from, lte: to },
      },
      orderBy: [
        { date: 'asc' },
        { baseMachine: 'asc' },
      ],
    }),
    activeDb.receiveFromHoloMachineRow.findMany({
      where: {
        isDeleted: false,
        date: { gte: from, lte: to },
      },
      include: {
        box: true,
        rollType: true,
        operator: true,
        issue: {
          include: {
            machine: true,
            cut: true,
            yarn: true,
            twist: true,
          },
        },
      },
      orderBy: [
        { date: 'asc' },
        { createdAt: 'asc' },
      ],
    }),
  ]);

  const normalizedRows = await buildNormalizedHoloRows({ rows: rawRows, context, db: activeDb });
  const baseMachines = getSortedBaseMachineNames(machines, { processType: 'holo', includeShared: false });
  const allowedBaseMachines = new Set(baseMachines);

  const spindleSummary = buildBaseMachineSpindleSummary(machines, { processType: 'holo', includeShared: false });
  const missingSpindle = [];
  baseMachines.forEach((baseMachine) => {
    const spindle = spindleSummary.get(baseMachine);
    if (!spindle) {
      missingSpindle.push({ baseMachine, sections: [] });
      return;
    }
    if (spindle.missingSections.length > 0) {
      missingSpindle.push({ baseMachine, sections: spindle.missingSections });
    }
  });
  if (missingSpindle.length > 0) {
    throw buildProblemError('Weekly export requires spindle on every Holo machine section', {
      error: 'missing_spindle',
      machines: missingSpindle,
    });
  }

  const rateMatchers = buildRateMatchers(rateRows);
  const metricMap = new Map(metricRows.map((row) => [`${row.date}::${row.baseMachine}`, row]));
  const warningRows = buildWarningSummary(dates, baseMachines, metricMap);

  const unresolvedRates = [];
  const groupedProduction = new Map();
  normalizedRows.forEach((row) => {
    const baseMachine = getBaseMachineName(row.machine);
    if (!allowedBaseMachines.has(baseMachine)) return;
    const yarnName = normalizeKey(row.yarn, 'UNASSIGNED');
    const cutName = normalizeKey(row.cut);
    const exactMatch = rateMatchers.exact.get(`${yarnName}::${cutName}`);
    const anyMatch = rateMatchers.anyCut.get(yarnName);
    const matched = exactMatch || anyMatch || null;

    if (!matched) {
      unresolvedRates.push({
        date: row.date || null,
        baseMachine,
        yarn: row.yarn || 'Unassigned',
        cut: row.cut || 'Unassigned',
      });
      return;
    }

    const rateKey = matched.id;
    const grouped = groupedProduction.get(baseMachine) || {
      baseMachine,
      totalProduction: 0,
      matchedRates: new Map(),
    };
    grouped.totalProduction += Number(row.net || 0);
    // Preserve the legacy Apps Script behavior: distinct matched rate rows
    // contribute equally to the ideal-rate average for a base machine.
    grouped.matchedRates.set(rateKey, matched.productionPerHourKg);
    groupedProduction.set(baseMachine, grouped);
  });

  if (unresolvedRates.length > 0) {
    throw buildProblemError('Missing Holo production-per-hour mapping for one or more yarn/cut combinations', {
      error: 'missing_production_per_hour',
      unresolved: unresolvedRates,
    });
  }

  const rows = baseMachines.map((baseMachine) => {
    const production = groupedProduction.get(baseMachine) || {
      totalProduction: 0,
      matchedRates: new Map(),
    };
    const totalHours = dates.reduce((sum, date) => {
      const metric = metricMap.get(`${date}::${baseMachine}`);
      return sum + Number(metric?.hours || 0);
    }, 0);
    const hasExtendedHours = dates.some((date) => Number(metricMap.get(`${date}::${baseMachine}`)?.hours || 0) > 12);
    const dailyHours = hasExtendedHours ? 24 : 12;
    const dayCount = dailyHours > 0 ? (totalHours / dailyHours) : 0;
    const averageProductionValue = dayCount > 0 ? (production.totalProduction / dayCount) : 0;
    const averageProductionDisplay = dayCount > 0 ? roundTo3Decimals(averageProductionValue) : '#DIV/0!';
    const uniqueRates = Array.from(production.matchedRates.values());
    const averageRate = uniqueRates.length > 0
      ? uniqueRates.reduce((sum, value) => sum + Number(value || 0), 0) / uniqueRates.length
      : 0;
    const spindle = spindleSummary.get(baseMachine)?.totalSpindle || 0;
    const idealProduction = spindle > 0 && averageRate > 0
      ? spindle * averageRate * dailyHours
      : 0;
    const difference = averageProductionValue - idealProduction;

    return {
      baseMachine,
      totalProduction: roundTo3Decimals(production.totalProduction || 0),
      totalHours: roundTo3Decimals(totalHours),
      dayCount: roundTo3Decimals(dayCount),
      averageProductionDisplay,
      averageProductionValue: roundTo3Decimals(averageProductionValue),
      dailyHours,
      idealProduction: roundTo3Decimals(idealProduction),
      difference: roundTo3Decimals(difference),
      highlightShortfall: difference <= -5,
    };
  });

  return {
    process: 'holo',
    processLabel: 'Holo',
    from,
    to,
    dates,
    rows,
    warnings: warningRows,
  };
}

export default {
  validateHoloWeeklyExportRequest,
  buildHoloWeeklyExportData,
};
