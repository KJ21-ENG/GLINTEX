import { badRequest } from './errors.js';

export function generatePackedUnitLabel(unit) {
  const barcode = String(unit?.barcode || '').trim();
  const itemName = String(unit?.item?.name || unit?.itemName || '').trim();
  const baseCount = Number(unit?.baseCount);
  if (!barcode || !itemName || !Number.isInteger(baseCount) || baseCount <= 0) {
    throw badRequest('label_generation_failed', 'The Packed Unit label could not be generated from its immutable identity.');
  }
  const label = Object.freeze({ barcode, itemName, baseCount });
  return {
    label,
    labelText: `${barcode}\n${itemName}\n${baseCount}`,
  };
}
