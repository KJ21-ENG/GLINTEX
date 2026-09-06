import { issue, row, sources } from './fixtures.js';
import { normalizeReport } from '../service.js';
import { validateFilters } from '../filters.js';
export function exportFixture({ count = 1872, workers = 26, month = '2026-08', workerId = 'all', unknown = false } = {}) {
  const refs = Array.from({ length: 11 }, (_, i) => ({ rowId: `h${i}`, coneTypeId: 'cone1' }));
  const records = Array.from({ length: count }, (_, i) => row({ id: `r${String(i).padStart(6, '0')}`,
    date: `${month}-${String(1 + Math.floor(i / workers) % 28).padStart(2, '0')}`,
    issue: issue({ id: `i${i % 7}`, itemId: `item${i % 7}`, receivedRowRefs: refs }),
    operatorId: `worker/${i % workers}`, operator: { id: `worker/${i % workers}`, name: i % workers < 2 ? 'Same / Worker' : `Worker ${i % workers}` },
    netWeight: unknown && i === 0 ? null : i === 1 ? 0 : 1.2345,
  }));
  const fixture = sources(records, {
    items: Array.from({ length: 7 }, (_, i) => ({ id: `item${i}`, name: `Quality ${i} extra long descriptive metallic yarn label with several specifications and a long unbroken reference ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`, side: i % 2 ? 'BOTH' : 'SINGLE' })),
    graph: new Map(refs.map((ref, i) => [ref.rowId, { stage: 'holo', row: { id: ref.rowId, issue: { id: `hi${i}`, cutId: i % 2 ? 'c1' : 'c2' } } }])),
  });
  return normalizeReport(fixture, validateFilters({ month, workerId }, new Date('2026-09-06T12:00:00Z')));
}
