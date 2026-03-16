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
  const names = new Set();
  (machines || []).forEach((machine) => {
    if (!machine?.name) return;
    const machineProcessType = String(machine.processType || 'all').trim().toLowerCase();
    if (normalizedProcess) {
      const matchesTarget = machineProcessType === normalizedProcess;
      const matchesShared = includeShared && machineProcessType === 'all';
      if (!matchesTarget && !matchesShared) return;
    }
    names.add(getBaseMachineName(machine.name));
  });
  return Array.from(names).sort((a, b) => String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  }));
}

export default {
  getBaseMachineName,
  getSortedBaseMachineNames,
};
