export const issue = (over = {}) => ({ id: 'i1', date: '2026-07-15', itemId: 'item1', lotNo: 'CP-001', yarnId: 'y1', twistId: 't1', cutId: 'wrong',
  machineId: 'm1', machine: { id: 'm1', name: 'Machine 1' }, operatorId: 'issue-worker', barcode: 'CI-1', requiredPerConeNetWeight: 100,
  receivedRowRefs: [{ rowId: 'h1', coneTypeId: 'cone1' }], ...over });
export const row = (over = {}) => ({ id: 'r1', issueId: 'i1', issue: issue(), date: '2026-08-15', coneCount: 10, netWeight: 1.2345,
  operatorId: 'w1', operator: { id: 'w1', name: 'Same name', processType: 'cutter' }, sourceRowRefs: [], barcode: 'CR-1', ...over });
export function sources(rows = [row()], extra = {}) {
  return { periodRows: rows, undatedRows: [], items: [{ id: 'item1', name: 'Quality', side: 'SINGLE' }], yarns: [{ id: 'y1', name: 'Yarn' }],
    twists: [{ id: 't1', name: 'Twist' }], cuts: [{ id: 'c1', name: 'Cut 1' }, { id: 'c2', name: 'Cut 2' }, { id: 'wrong', name: 'Wrong cut' }],
    coneTypes: [{ id: 'cone1', name: 'Cone' }], graph: new Map([['h1', { stage: 'holo', row: { id: 'h1', issue: { id: 'hi1', cutId: 'c1' } } }]]), ...extra };
}
