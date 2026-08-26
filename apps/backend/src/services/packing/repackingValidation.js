import { UNIT_STATUSES } from './constants.js';
import { badRequest, conflict } from './errors.js';

export async function validatePackingRepackingSources(tx, units, recipe, customerId) {
  if (!units.length) throw badRequest('sources_required', 'At least one Packed Unit source is required.');
  const eligibleStatuses = [UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED, UNIT_STATUSES.RETURNED_PENDING_INSPECTION, UNIT_STATUSES.DAMAGED];
  for (const unit of units) {
    if (!eligibleStatuses.includes(unit.status)) throw conflict('packed_source_ineligible', 'A Packed Unit is not eligible for repacking.', { unitId: unit.id, status: unit.status });
    if (!unit.barcode) throw badRequest('packed_source_unidentified', 'Every Packed Unit source must have a sealed barcode.', { unitId: unit.id });
    if (unit.status === UNIT_STATUSES.DAMAGED && (!unit.splitFromUnitId || unit.splitFromUnit?.status !== UNIT_STATUSES.REPACKED)) {
      throw conflict('damaged_source_has_no_salvage_identity', 'A damaged Packed Unit without an explicit salvage identity cannot enter Repacking.', { unitId: unit.id });
    }
    if (unit.itemId !== recipe.itemId || unit.wrapperId !== recipe.wrapperId || unit.colorId !== recipe.colorId || unit.coneTypeId !== recipe.coneTypeId) {
      throw badRequest('incompatible_repacking_source', 'Repacking sources must match the output recipe physical identity. A compatible recipe version is required.', { unitId: unit.id, recipeId: recipe.id });
    }
    if (customerId && unit.customerId && unit.customerId !== customerId) {
      // A customer change is an explicit repacking operation, so this is
      // allowed. The output customer is captured on the new batch and units.
    }
  }
}
