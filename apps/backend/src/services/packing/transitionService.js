import { badRequest } from './errors.js';
import { BATCH_TRANSITIONS, UNIT_TRANSITIONS } from './constants.js';

export function transitionBatch(current, next) {
  if (!BATCH_TRANSITIONS[current]?.includes(next)) {
    throw badRequest('invalid_batch_transition', `Packing batch cannot transition from ${current} to ${next}.`, { current, next });
  }
  return next;
}

export function transitionUnit(current, next) {
  if (!UNIT_TRANSITIONS[current]?.includes(next)) {
    throw badRequest('invalid_unit_transition', `Packed Unit cannot transition from ${current} to ${next}.`, { current, next });
  }
  return next;
}
