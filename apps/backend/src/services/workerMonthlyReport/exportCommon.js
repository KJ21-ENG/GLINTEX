import { createHash } from 'node:crypto';

export const SOURCE_DISCLOSURE = 'Generated from current records. Later edits may change a regenerated statement.';
export const qualityText = quality => [
  `Item: ${quality.item.label} (${quality.side})`, `Yarn: ${quality.yarn.label}`,
  `Cut: ${quality.cut.label}`, `Twist: ${quality.twist.label}`,
  `Cone: ${quality.coneType.label}; target ${quality.targetSizeGrams == null ? 'unrecorded' : `${quality.targetSizeGrams} g`}`,
].join('\n');
export const quantityText = (value, kg = false) => value == null ? 'Unknown' : kg ? value.toFixed(3) : String(value);
export const totalText = (total, kg = false) => `${quantityText(kg ? total.netKg : total.cones, kg)}${(kg ? total.weightComplete : total.conesComplete) ? '' : '*'}`;
export const completenessText = total => total.weightComplete && total.conesComplete ? 'Complete' :
  `Incomplete: ${total.unknownWeightRows} unknown weight row(s), ${total.unknownConeRows} unknown cone row(s). Totals show known quantities only.`;
export const periodText = statement => `${statement.month}${statement.period.monthToDate ? ' | Month to date' : ''} | Cutoff: ${statement.period.cutoff} (${statement.period.timeZone})`;
const safePart = value => String(value).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'worker';
export function workerFilename(statement, extension) {
  // Full ID digest prevents collisions caused by duplicate names, sanitization or truncation.
  const discriminator = createHash('sha256').update(statement.worker.id).digest('hex');
  return `coning-${safePart(statement.month)}-${safePart(statement.worker.name)}-${safePart(statement.worker.reference)}-${discriminator}.${extension}`;
}
