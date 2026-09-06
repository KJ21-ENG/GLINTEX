// Coning manual/edit/opening/import writers store total net kg in coneWeight.
// Do not use truthiness or payment positive-only resolution: zero is recorded work.
export function quantities(row) {
  const flags = [];
  const cones = row.coneCount;
  const validCones = typeof cones === 'number' && Number.isSafeInteger(cones) && cones >= 0;
  if (!validCones) flags.push('invalid_cone_count');
  let weight = null;
  let weightSource = 'unknown';
  for (const key of ['netWeight', 'coneWeight']) {
    if (row[key] !== null && row[key] !== undefined) { weight = row[key]; weightSource = key; break; }
  }
  if (weightSource === 'unknown' && row.grossWeight != null && row.tareWeight != null) {
    weightSource = 'gross_minus_tare';
    weight = typeof row.grossWeight === 'number' && typeof row.tareWeight === 'number'
      && Number.isFinite(row.grossWeight) && Number.isFinite(row.tareWeight)
      && row.grossWeight >= 0 && row.tareWeight >= 0 ? row.grossWeight - row.tareWeight : NaN;
  }
  const invalidWeight = weightSource !== 'unknown' && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || !Number.isSafeInteger(Math.round(weight * 1000)));
  if (invalidWeight) flags.push('invalid_net_weight');
  if (weightSource === 'unknown') flags.push('unknown_net_weight');
  const netGrams = weight === null || invalidWeight ? null : Math.round((weight + Number.EPSILON) * 1000);
  return { cones: validCones ? cones : null, netGrams, netKg: netGrams === null ? null : netGrams / 1000,
    weightSource, flags, invalid: !validCones || invalidWeight };
}

export function totals(rows) {
  let cones = 0;
  let grams = 0;
  let unknownWeightRows = 0;
  let unknownConeRows = 0;
  for (const row of rows) {
    if (row.cones == null) unknownConeRows++; else cones += row.cones;
    if (row.netGrams == null) unknownWeightRows++; else grams += row.netGrams;
  }
  if (!Number.isSafeInteger(cones) || !Number.isSafeInteger(grams)) throw new Error('Report totals exceed safe numeric range');
  return { rowCount: rows.length, cones, netKg: grams / 1000, netGrams: grams,
    unknownWeightRows, unknownConeRows, weightComplete: unknownWeightRows === 0, conesComplete: unknownConeRows === 0 };
}
