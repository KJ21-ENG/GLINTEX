export const RECIPE_LIFECYCLE_DEFAULTS = {
  activate: 'Recipe reviewed and ready for Packing',
  retire: 'Superseded by a newer recipe version',
};

export function buildRecipeLifecyclePayload(action, reason) {
  const normalizedReason = String(reason ?? '').trim();
  if (action === 'retire' && !normalizedReason) {
    throw new Error('A retirement reason is required.');
  }
  if (action !== 'activate' && action !== 'retire') {
    throw new Error('A supported recipe lifecycle action is required.');
  }
  return { reason: normalizedReason || null };
}
