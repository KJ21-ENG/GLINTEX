export const glintexDomainContract = {
  version: 1,
  mode: 'read_only',
  authority: {
    ownerOnly: true,
    writesSupported: false,
    deletesSupported: false,
    attachmentsSupported: false,
    selfModificationSupported: false,
  },
  resources: {
    health: { required: [], description: 'Backend availability.' },
    reference: {
      required: [],
      description: 'Live master IDs and names plus this adapter contract.',
    },
    issues: {
      required: ['process'],
      process: ['cutter', 'holo', 'coning'],
      filters: ['search', 'dateFrom', 'dateTo', 'order', 'cursor', 'limit', 'page'],
    },
    receives: {
      required: ['process'],
      process: ['cutter', 'holo', 'coning'],
      filters: ['search', 'dateFrom', 'dateTo', 'order', 'cursor', 'limit', 'page'],
    },
    on_machine: {
      required: ['process'],
      process: ['cutter', 'holo', 'coning'],
      filters: ['search', 'dateFrom', 'dateTo', 'order', 'cursor', 'limit'],
    },
    stock: {
      required: ['process'],
      process: ['holo', 'coning'],
      description: 'Current app-calculated lot availability.',
    },
    production: {
      process: ['cutter', 'holo', 'coning'],
      view: ['machine', 'operator', 'shift', 'item', 'yarn'],
      filters: ['dateFrom', 'dateTo'],
      maximumDateRangeDays: 93,
    },
    barcode_history: {
      required: ['barcode'],
      description: 'Application lineage from inbound through dispatch.',
    },
    contractor_settlements: {
      filters: ['id', 'process', 'status', 'search', 'dateFrom', 'dateTo', 'page', 'limit'],
      statuses: ['draft', 'paid'],
    },
  },
  dataRules: {
    cutTracing:
      'For downstream stages, prefer Coning Issue receivedRowRefs to Holo Receive rows to Holo Issue; use the coning issue cut only when trace data is unavailable.',
    currentFacts: 'Fresh tool reads override memory and historical chat context.',
    identifiers: 'Use exact IDs from live reference or exact record reads; never guess.',
    totals: 'Use application-computed totals and disclose active filters and date ranges.',
  },
} as const;
