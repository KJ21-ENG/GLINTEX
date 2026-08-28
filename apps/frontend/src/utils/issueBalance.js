const balanceTime = (balance) => {
  const value = Date.parse(balance?.asOf || '');
  return Number.isFinite(value) ? value : null;
};

// Targeted lookups are authoritative when a form is opened. A later mutation
// response patched into InventoryContext must then be allowed to supersede that
// scan-time balance while the form remains mounted.
export function chooseLatestIssueBalance(issueBalance, cachedBalance) {
  if (!issueBalance) return cachedBalance || null;
  if (!cachedBalance) return issueBalance;

  const issueTime = balanceTime(issueBalance);
  const cachedTime = balanceTime(cachedBalance);
  if (issueTime != null && cachedTime != null) {
    return cachedTime > issueTime ? cachedBalance : issueBalance;
  }
  if (issueTime != null) return issueBalance;
  if (cachedTime != null) return cachedBalance;
  return issueBalance;
}
