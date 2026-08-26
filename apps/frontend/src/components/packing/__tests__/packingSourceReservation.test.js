import assert from 'node:assert/strict';
import test from 'node:test';
import { canSubmitSourceDelta, releaseExceedsResidual } from '../packingSourceReservationRules.js';

test('over-release remains server-validatable while a bounded release does not exceed residual', () => {
  const residual = { count: 20, weight: 2 };
  assert.equal(releaseExceedsResidual({ releasedBaseCount: 21, releasedNetWeightKg: 2.1 }, residual), true);
  assert.equal(releaseExceedsResidual({ releasedBaseCount: 20, releasedNetWeightKg: 2 }, residual), false);
});

test('an invalid staged release remains submit-enabled for authoritative server rejection', () => {
  assert.equal(canSubmitSourceDelta({ hasActiveDelta: true, projectedMatchesTarget: false, hasInvalidStagedRelease: true }), true);
  assert.equal(canSubmitSourceDelta({ hasActiveDelta: true, projectedMatchesTarget: false, hasInvalidStagedRelease: false }), false);
  assert.equal(canSubmitSourceDelta({ hasActiveDelta: false, projectedMatchesTarget: true, hasInvalidStagedRelease: false }), false);
});
