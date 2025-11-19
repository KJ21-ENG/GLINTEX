export const PROCESS_DEFINITIONS = {
  cutter: {
    id: 'cutter',
    label: 'Cutter (Bobbins)',
    unitLabel: 'Bobbin',
    unitLabelPlural: 'Bobbins',
    receiveTotalsKey: 'receive_from_cutter_machine_piece_totals',
    receiveUnitField: 'totalBob',
    receiveWeightField: 'totalNetWeight',
    receiveRowsKey: 'receive_from_cutter_machine_rows',
    issueKey: 'issue_to_cutter_machine',
  },
  holo: {
    id: 'holo',
    label: 'Holo (Rolls)',
    unitLabel: 'Roll',
    unitLabelPlural: 'Rolls',
    receiveTotalsKey: 'receive_from_holo_machine_piece_totals',
    receiveUnitField: 'totalRolls',
    receiveWeightField: 'totalNetWeight',
    receiveRowsKey: 'receive_from_holo_machine_rows',
    issueKey: 'issue_to_holo_machine',
  },
  coning: {
    id: 'coning',
    label: 'Coning (Cones)',
    unitLabel: 'Cone',
    unitLabelPlural: 'Cones',
    receiveTotalsKey: 'receive_from_coning_machine_piece_totals',
    receiveUnitField: 'totalCones',
    receiveWeightField: 'totalNetWeight',
    receiveRowsKey: 'receive_from_coning_machine_rows',
    issueKey: 'issue_to_coning_machine',
  },
};

export function getProcessDefinition(processId = 'cutter') {
  return PROCESS_DEFINITIONS[processId] || PROCESS_DEFINITIONS.cutter;
}
