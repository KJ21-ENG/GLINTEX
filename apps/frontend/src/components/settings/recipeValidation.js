export function validateRecipeDraft(form) {
  if (!String(form?.familyKey || '').trim()) return 'Recipe family is required.';

  const version = Number(form?.version);
  if (!Number.isInteger(version) || version <= 0) return 'Version must be a positive whole number.';

  const levels = Array.isArray(form?.levels) ? form.levels : [];
  if (!levels.length || levels.some((level) => {
    const childUnits = Number(level?.childUnitsPerContainer);
    return !String(level?.packageTypeId || '').trim() || !Number.isInteger(childUnits) || childUnits <= 0;
  })) {
    return 'Every recipe level needs a package type and positive whole child-unit count.';
  }

  const warning = Number(form?.warningVariancePercent);
  const approval = Number(form?.approvalVariancePercent);
  if (!Number.isFinite(warning) || warning < 0 || !Number.isFinite(approval) || approval < warning) {
    return 'Approval variance cannot be below the warning variance.';
  }

  return null;
}
