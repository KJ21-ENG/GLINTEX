// Standardized barcode helpers with consistent format across all stages
// Format: {PREFIX}-{SERIES/LOT}-{SEQ}[-C{CRATE}]
// Approved Prefixes: INB, ICU, RCU, IHO, RHO, ICO, RCO

function padSeq(seq, length = 3) {
  const num = Number(seq);
  if (!Number.isFinite(num)) return String(seq || '').padStart(length, '0');
  return String(num).padStart(length, '0');
}

// ===== INBOUND =====
// Format: INB-{LOT}-{SEQ}  (e.g., INB-001-001)
export function makeInboundBarcode({ lotNo, seq }) {
  return `INB-${padSeq(lotNo)}-${padSeq(seq)}`;
}

// ===== CUTTER ISSUE =====
// Format: ICU-{LOT}-{SEQ}  (e.g., ICU-001-001)
export function makeIssueBarcode({ lotNo, seq }) {
  const suffix = seq == null ? '000' : padSeq(seq);
  return `ICU-${padSeq(lotNo)}-${suffix}`;
}

// ===== CUTTER RECEIVE =====
// Format: RCU-{LOT}-{SEQ}-C{CRATE}  (e.g., RCU-001-001-C001)
export function makeReceiveBarcode({ lotNo, seq, crateIndex = 1 }) {
  return `RCU-${padSeq(lotNo)}-${padSeq(seq)}-C${padSeq(crateIndex)}`;
}

// ===== HOLO ISSUE =====
// Format: IHO-{SERIES}  (e.g., IHO-001)
export function makeHoloIssueBarcode({ series }) {
  return `IHO-${padSeq(series)}`;
}

// ===== HOLO RECEIVE =====
// Format: RHO-{SERIES}-C{CRATE}  (e.g., RHO-001-C001)
export function makeHoloReceiveBarcode({ series, crateIndex = 1 }) {
  return `RHO-${padSeq(series)}-C${padSeq(crateIndex)}`;
}

// ===== CONING ISSUE =====
// Format: ICO-{SERIES}  (e.g., ICO-001)
export function makeConingIssueBarcode({ series }) {
  return `ICO-${padSeq(series)}`;
}

// ===== CONING RECEIVE =====
// Format: RCO-{SERIES}-C{CRATE}  (e.g., RCO-001-C001)
export function makeConingReceiveBarcode({ series, crateIndex = 1 }) {
  return `RCO-${padSeq(series)}-C${padSeq(crateIndex)}`;
}

// ===== BARCODE PARSING HELPERS =====

// Extract crate index from receive barcodes (RCU, RHO, RCO)
export function parseReceiveCrateIndex(barcode) {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/-C(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

// Extract series number from IHO/RHO barcodes
export function parseHoloSeries(barcode) {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/^(?:IHO|RHO)-(\d+)/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

// Extract series number from ICO/RCO barcodes
export function parseConingSeries(barcode) {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/^(?:ICO|RCO)-(\d+)/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

// ===== DEPRECATED (kept for backward compatibility) =====
export function deriveMaterialCodeFromItem(item) {
  // Material code is no longer used in barcodes, kept for backward compatibility
  return 'MET';
}

