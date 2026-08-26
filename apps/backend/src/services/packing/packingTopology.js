import { UNIT_STATUSES } from './constants.js';
import { badRequest, conflict } from './errors.js';

function sortedLevels(recipeSnapshot) {
  const levels = Array.isArray(recipeSnapshot?.levels) ? recipeSnapshot.levels : [];
  return levels
    .map((level) => ({ ...level, levelIndex: Number(level.levelIndex), childUnitsPerContainer: Number(level.childUnitsPerContainer) }))
    .filter((level) => Number.isInteger(level.levelIndex) && Number.isInteger(level.childUnitsPerContainer) && level.childUnitsPerContainer > 0)
    .sort((a, b) => a.levelIndex - b.levelIndex);
}

export function getRecipeTopology(recipeSnapshot) {
  const levels = sortedLevels(recipeSnapshot);
  if (!levels.length) throw badRequest('recipe_levels_required', 'The recipe must define at least one physical level.');
  const topology = [];
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const lower = topology[index - 1] || null;
    const higher = levels[index + 1] || null;
    const expectedBaseCount = level.childUnitsPerContainer * (lower?.expectedBaseCount || 1);
    topology.push({ ...level, lower, higher, expectedBaseCount });
  }
  return topology.map((entry, index) => ({ ...entry, higher: topology[index + 1] || null }));
}

export function getRecipeLevelTopology(recipeSnapshot, levelIndex) {
  const topology = getRecipeTopology(recipeSnapshot);
  const level = topology.find((entry) => entry.levelIndex === Number(levelIndex));
  if (!level) throw badRequest('recipe_level_not_found', 'The requested container level is not defined by the immutable recipe snapshot.', { levelIndex });
  return level;
}

export function assertRecipeBaseComposition(recipeSnapshot, levelIndex, baseCount, field = 'baseCount') {
  const level = getRecipeLevelTopology(recipeSnapshot, levelIndex);
  const count = Number(baseCount);
  if (!Number.isInteger(count) || count !== level.expectedBaseCount) {
    throw badRequest('recipe_composition_mismatch', `${field} must equal the recipe-defined base composition for this level.`, {
      levelIndex: level.levelIndex,
      expectedBaseCount: level.expectedBaseCount,
      receivedBaseCount: count,
    });
  }
  return level;
}

export function assertParentLevel(recipeSnapshot, childLevelIndex, parent) {
  const childLevel = getRecipeLevelTopology(recipeSnapshot, childLevelIndex);
  if (!parent) return childLevel;
  if (!childLevel.higher || Number(parent.levelIndex) !== childLevel.higher.levelIndex) {
    throw badRequest('parent_level_invalid', 'A child must attach only to the immediately higher recipe level, including when levels are skipped.', {
      childLevelIndex,
      expectedParentLevelIndex: childLevel.higher?.levelIndex || null,
      receivedParentLevelIndex: parent.levelIndex,
    });
  }
  if (Number(parent.baseCount) !== childLevel.higher.expectedBaseCount) {
    throw badRequest('parent_composition_mismatch', 'The parent base count does not match the immutable recipe composition.', {
      parentLevelIndex: parent.levelIndex,
      expectedBaseCount: childLevel.higher.expectedBaseCount,
      receivedBaseCount: parent.baseCount,
    });
  }
  return childLevel;
}

export async function assertParentCapacity(tx, parent, childLevel) {
  const children = await tx.packedUnit.findMany({
    where: {
      parentUnitId: parent.id,
      levelIndex: childLevel.levelIndex,
      status: { notIn: [UNIT_STATUSES.VOIDED, UNIT_STATUSES.SPLIT_CONSUMED] },
    },
    select: { id: true, baseCount: true, status: true },
  });
  if (children.length >= childLevel.higher.childUnitsPerContainer) {
    throw conflict('parent_capacity_exceeded', 'The parent container has reached its immutable recipe capacity.', {
      parentUnitId: parent.id,
      capacity: childLevel.higher.childUnitsPerContainer,
      existingChildren: children.length,
    });
  }
  return children;
}

export async function assertUnitChildrenAtSeal(tx, unit, recipeSnapshot) {
  const level = getRecipeLevelTopology(recipeSnapshot, unit.levelIndex);
  const children = await tx.packedUnit.findMany({
    where: {
      parentUnitId: unit.id,
      levelIndex: level.lower?.levelIndex || -1,
      status: { in: [UNIT_STATUSES.QUALITY_HOLD, UNIT_STATUSES.AVAILABLE, UNIT_STATUSES.RESERVED] },
    },
    select: { id: true, baseCount: true, status: true },
  });
  if (!level.lower) {
    if (children.length) throw badRequest('unexpected_unit_children', 'The innermost recipe level cannot contain child containers.');
    return;
  }
  if (children.length !== level.childUnitsPerContainer) {
    throw badRequest('parent_children_incomplete', 'A parent container cannot be sealed until its recipe-defined child capacity is filled.', {
      unitId: unit.id,
      requiredChildren: level.childUnitsPerContainer,
      actualChildren: children.length,
    });
  }
  const childBaseCount = children.reduce((total, child) => total + Number(child.baseCount || 0), 0);
  if (childBaseCount !== Number(unit.baseCount)) {
    throw badRequest('parent_base_count_mismatch', 'Parent base count must equal the exact sum of its immediate child containers.', {
      unitId: unit.id,
      expectedBaseCount: childBaseCount,
      receivedBaseCount: unit.baseCount,
    });
  }
}
