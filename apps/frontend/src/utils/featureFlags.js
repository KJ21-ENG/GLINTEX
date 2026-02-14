export const getFeatureFlags = () => ({
  v2Stock: String(import.meta.env.VITE_FF_V2_STOCK || '').toLowerCase() === 'true',
  v2IssueTracking: String(import.meta.env.VITE_FF_V2_ISSUE_TRACKING || '').toLowerCase() === 'true',
  v2ReceiveHistory: String(import.meta.env.VITE_FF_V2_RECEIVE_HISTORY || '').toLowerCase() === 'true',
  v2OpeningStock: String(import.meta.env.VITE_FF_V2_OPENING_STOCK || '').toLowerCase() === 'true',
  v2OnMachine: String(import.meta.env.VITE_FF_V2_ON_MACHINE || '').toLowerCase() === 'true',
});

