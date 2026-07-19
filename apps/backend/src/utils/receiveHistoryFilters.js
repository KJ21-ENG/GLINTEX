function buildConingMachineFilter(match) {
  return {
    OR: [
      { machineNo: match },
      {
        AND: [
          {
            OR: [
              { machineNo: null },
              { machineNo: '' },
            ],
          },
          { issue: { machine: { name: match } } },
        ],
      },
    ],
  };
}

export function buildReceiveMachineInFilter(values, { process } = {}) {
  const match = { in: values };
  if (process === 'coning') return buildConingMachineFilter(match);
  return { machineNo: match };
}

export function buildReceiveMachineContainsFilter(value, { process } = {}) {
  const match = { contains: value, mode: 'insensitive' };
  if (process === 'coning') return buildConingMachineFilter(match);
  return { machineNo: match };
}

export function resolveDisplayedReceiveMachineName(row, { process } = {}) {
  if (row?.machineNo) return row.machineNo;
  if (process === 'coning') return row?.issue?.machine?.name || '';
  return '';
}
