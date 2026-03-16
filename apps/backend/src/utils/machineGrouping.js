function asTrimmedText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

export function getBaseMachineName(value, fallback = 'Unassigned') {
  const machine = asTrimmedText(value, fallback);
  const [prefix] = machine.split('-');
  return asTrimmedText(prefix, machine);
}

export function getSortedBaseMachineNames(machines = [], { processType, includeShared = true } = {}) {
  const normalizedProcess = processType ? String(processType).trim().toLowerCase() : null;

  const baseMachines = new Set();
  (machines || []).forEach((machine) => {
    if (!machine?.name) return;
    const machineProcessType = String(machine.processType || 'all').trim().toLowerCase();
    if (normalizedProcess) {
      const matchesTarget = machineProcessType === normalizedProcess;
      const matchesShared = includeShared && machineProcessType === 'all';
      if (!matchesTarget && !matchesShared) return;
    }
    baseMachines.add(getBaseMachineName(machine.name));
  });

  return Array.from(baseMachines).sort((a, b) => String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  }));
}

export function buildBaseMachineSpindleSummary(machines = [], { processType, includeShared = true } = {}) {
  const normalizedProcess = processType ? String(processType).trim().toLowerCase() : null;

  const summary = new Map();
  (machines || []).forEach((machine) => {
    if (!machine?.name) return;
    const machineProcessType = String(machine.processType || 'all').trim().toLowerCase();
    if (normalizedProcess) {
      const matchesTarget = machineProcessType === normalizedProcess;
      const matchesShared = includeShared && machineProcessType === 'all';
      if (!matchesTarget && !matchesShared) return;
    }

    const baseMachine = getBaseMachineName(machine.name);
    const current = summary.get(baseMachine) || {
      baseMachine,
      totalSpindle: 0,
      missingSections: [],
      sectionNames: [],
    };
    current.sectionNames.push(machine.name);
    if (machine.spindle === null || machine.spindle === undefined || machine.spindle === '') {
      current.missingSections.push(machine.name);
    } else {
      const spindle = Number(machine.spindle);
      if (Number.isFinite(spindle)) {
        current.totalSpindle += spindle;
      } else {
        current.missingSections.push(machine.name);
      }
    }
    summary.set(baseMachine, current);
  });

  return summary;
}

export default {
  getBaseMachineName,
  getSortedBaseMachineNames,
  buildBaseMachineSpindleSummary,
};
