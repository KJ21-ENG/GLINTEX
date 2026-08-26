export function getChallanHistorySummary(challan = {}) {
  const lines = Array.isArray(challan.lines) ? challan.lines : Array.isArray(challan.items) ? challan.items : [];
  const headerLineCount = challan.lineCount ?? challan._count?.lines;
  const headerWeight = challan.totalNetWeightKg ?? challan.totalWeightKg;
  return {
    lineCount: lines.length ? lines.length : Number(headerLineCount || 0),
    totalWeight: lines.length
      ? lines.reduce((sum, line) => sum + (Number(line.netWeightKg ?? line.weight) || 0), 0)
      : Number(headerWeight || 0),
  };
}
