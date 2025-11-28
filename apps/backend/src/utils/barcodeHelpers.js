const DEFAULT_MATERIAL_CODE = (process.env.BARCODE_MATERIAL_CODE || 'MET').toUpperCase();

function padSeq(seq) {
  const num = Number(seq);
  if (!Number.isFinite(num)) return String(seq || '').padStart(3, '0');
  return String(num).padStart(3, '0');
}

function normalizeMaterialCode(code) {
  if (!code) return DEFAULT_MATERIAL_CODE;
  return String(code).trim().toUpperCase() || DEFAULT_MATERIAL_CODE;
}

export function deriveMaterialCodeFromItem(item) {
  if (!item) return DEFAULT_MATERIAL_CODE;
  if (item.barcodeMaterialCode) return normalizeMaterialCode(item.barcodeMaterialCode);
  return DEFAULT_MATERIAL_CODE;
}

export function makeInboundBarcode({ materialCode = DEFAULT_MATERIAL_CODE, lotNo, seq }) {
  return `INB-${normalizeMaterialCode(materialCode)}-${lotNo}-${padSeq(seq)}`;
}

export function makeIssueBarcode({ materialCode = DEFAULT_MATERIAL_CODE, lotNo, seq }) {
  const suffix = seq == null ? '000' : padSeq(seq);
  return `ISM-${normalizeMaterialCode(materialCode)}-${lotNo}-${suffix}`;
}

export function makeReceiveBarcode({ lotNo, seq, crateIndex = 1 }) {
  return `REC-${lotNo}-${padSeq(seq)}-C${padSeq(crateIndex)}`;
}

export function parseReceiveCrateIndex(barcode) {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/-C(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}
