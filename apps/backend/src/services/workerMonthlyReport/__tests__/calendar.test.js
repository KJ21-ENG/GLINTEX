import test from 'node:test';
import assert from 'node:assert/strict';
import { workerCalendar, calendarWeight } from '../calendar.js';
import { exportFixture } from './exportFixtures.js';
import { exportWorkerPdf } from '../exportPdf.js';
import { toWorkerStatement } from '../service.js';

test('calendar includes full month, combines daily yarn entries, and preserves unknown and zero', () => {
  const report = exportFixture({ count: 280, workers: 2, unknown: true });
  for (const statement of report.statements) {
    const calendar = workerCalendar(statement, report.month);
    assert.equal(calendar.days.length, 31);
    assert.equal(calendar.columns.length, 1);
    assert.deepEqual(calendar.totals, statement.monthlyTotals);
    assert.equal(calendar.days.reduce((sum, day) => sum + (day.totals?.netGrams || 0), 0), statement.monthlyTotals.netGrams);
    assert.equal(calendar.columns.reduce((sum, column) => sum + column.totals.netGrams, 0), statement.monthlyTotals.netGrams);
    assert.ok(calendar.days.slice(28).every(day => day.totals === null && day.cells.every(cell => cell === null)));
    const pdf = exportWorkerPdf(toWorkerStatement(report, statement.worker.id));
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  }
  assert.equal(calendarWeight(null), '-');
  assert.equal(calendarWeight({ rowCount: 1, unknownWeightRows: 1 }), '?');
  assert.equal(calendarWeight({ rowCount: 1, unknownWeightRows: 0, netKg: 0, weightComplete: true }), '0.000');
});

test('calendar respects leap years, short months and worker-specific yarns', () => {
  for (const [month, count] of [['2024-02', 29], ['2025-02', 28], ['2026-04', 30], ['2026-08', 31]]) {
    const report = exportFixture({ count: 2, workers: 2, month });
    for (const statement of report.statements) {
      const calendar = workerCalendar(statement, month);
      assert.equal(calendar.days.length, count);
      assert.equal(calendar.columns.length, 1);
      assert.equal(calendar.workedDays, 1);
    }
  }
});


test('yarn columns combine different items and keep distinct yarn IDs separate', () => {
  const report = exportFixture({ count: 14, workers: 1 });
  const statement = report.statements[0];
  statement.rows[0].quality.yarn = { state: 'resolved', values: [{ id: 'other-yarn', name: 'Other yarn' }], label: 'Other yarn' };
  const calendar = workerCalendar(statement, report.month);
  assert.equal(calendar.columns.length, 2);
  assert.deepEqual(calendar.columns.map(column => column.label), ['Other yarn', 'Yarn']);
  assert.equal(calendar.columns[1].totals.rowCount, 13);
  assert.equal(calendar.columns.reduce((sum, column) => sum + column.totals.netGrams, 0), statement.monthlyTotals.netGrams);
});
