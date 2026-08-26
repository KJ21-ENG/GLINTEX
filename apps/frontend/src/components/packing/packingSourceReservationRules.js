export function releaseExceedsResidual(release, residual) {
  return Number(release?.releasedBaseCount) > Number(residual?.count)
    || Number(release?.releasedNetWeightKg) > Number(residual?.weight) + 0.001;
}

export function canSubmitSourceDelta({ hasActiveDelta, projectedMatchesTarget, hasInvalidStagedRelease }) {
  return Boolean(hasActiveDelta && (projectedMatchesTarget || hasInvalidStagedRelease));
}
