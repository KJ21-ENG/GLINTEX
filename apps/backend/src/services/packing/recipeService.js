import prisma from '../../lib/prisma.js';
import { runIdempotent } from '../inventory/idempotency.js';
import { PACKAGE_KINDS, DELIVERY_MODES, RECIPE_STATUSES } from './constants.js';
import {
  actorCreateFields,
  actorId,
  actorUpdateFields,
  assertEnumValue,
  normalizeMasterName,
  normalizeWhitespace,
  recipeInclude,
} from './common.js';
import {
  badRequest,
  conflict,
  notFound,
  optionalString,
  parseNonNegativeNumber,
  parsePositiveInt,
  requireNonEmptyString,
} from './errors.js';
import { serialize } from './serialization.js';

function normalizeLevels(levels) {
  if (levels === undefined) return undefined;
  if (!Array.isArray(levels)) throw badRequest('invalid_recipe_levels', 'levels must be an array.');
  const seen = new Set();
  return levels.map((level) => {
    const levelIndex = parsePositiveInt(level?.levelIndex, 'levelIndex');
    if (seen.has(levelIndex)) throw badRequest('duplicate_recipe_level', 'Recipe levelIndex values must be unique.');
    seen.add(levelIndex);
    return {
      levelIndex,
      packageTypeId: requireNonEmptyString(level?.packageTypeId, 'packageTypeId', 100),
      childUnitsPerContainer: parsePositiveInt(level?.childUnitsPerContainer, 'childUnitsPerContainer'),
      barcodeEnabled: level?.barcodeEnabled === true,
    };
  }).sort((a, b) => a.levelIndex - b.levelIndex);
}

function normalizeRecipeFields(payload, { partial = false } = {}) {
  const data = {};
  if (!partial || payload.familyKey !== undefined) data.familyKey = requireNonEmptyString(payload.familyKey, 'familyKey', 200);
  if (!partial || payload.version !== undefined) data.version = parsePositiveInt(payload.version ?? 1, 'version');
  if (!partial || payload.deliveryMode !== undefined) data.deliveryMode = assertEnumValue(payload.deliveryMode || 'UNSPECIFIED', DELIVERY_MODES, 'deliveryMode');
  if (!partial || payload.customerId !== undefined) data.customerId = optionalString(payload.customerId, 100);
  for (const field of ['itemId', 'wrapperId', 'colorId', 'coneTypeId', 'supersedesRecipeId']) {
    if (!partial || payload[field] !== undefined) data[field] = optionalString(payload[field], 100);
  }
  if (!partial || payload.nominalGram !== undefined) {
    data.nominalGram = payload.nominalGram === null || payload.nominalGram === ''
      ? null
      : parseNonNegativeNumber(payload.nominalGram, 'nominalGram');
  }
  if (!partial || payload.allowPartialDispatch !== undefined) data.allowPartialDispatch = payload.allowPartialDispatch === true;
  if (!partial || payload.requiresQualityHold !== undefined) data.requiresQualityHold = payload.requiresQualityHold === true;
  if (!partial || payload.warningVariancePercent !== undefined) data.warningVariancePercent = parseNonNegativeNumber(payload.warningVariancePercent ?? 2, 'warningVariancePercent');
  if (!partial || payload.approvalVariancePercent !== undefined) data.approvalVariancePercent = parseNonNegativeNumber(payload.approvalVariancePercent ?? 5, 'approvalVariancePercent');
  if (data.approvalVariancePercent !== undefined && data.warningVariancePercent !== undefined && data.approvalVariancePercent < data.warningVariancePercent) {
    throw badRequest('invalid_variance_thresholds', 'approvalVariancePercent must be greater than or equal to warningVariancePercent.');
  }
  if (!partial || payload.stockUnitLevelIndex !== undefined) data.stockUnitLevelIndex = parsePositiveInt(payload.stockUnitLevelIndex ?? 1, 'stockUnitLevelIndex');
  if (!partial || payload.notes !== undefined) data.notes = optionalString(payload.notes, 2000);
  if (payload.sourceMetadata !== undefined && payload.sourceMetadata !== null) {
    data.sourceMetadata = payload.sourceMetadata;
  }
  return data;
}

async function ensureRecipeReferences(tx, data) {
  const checks = [
    ['item', 'itemId', data.itemId, 'Item'],
    ['wrapper', 'wrapperId', data.wrapperId, 'Wrapper'],
    ['packingColor', 'colorId', data.colorId, 'Packing color'],
    ['coneType', 'coneTypeId', data.coneTypeId, 'Cone type'],
    ['customer', 'customerId', data.customerId, 'Customer'],
  ];
  for (const [model, field, id, label] of checks) {
    if (!id) continue;
    const record = await tx[model].findUnique({ where: { id } });
    if (!record) throw notFound('recipe_reference_not_found', `${label} was not found.`, { field, id });
    if (model === 'customer' && record.isActive === false) throw badRequest('customer_inactive', 'An inactive customer cannot be assigned to a new recipe.');
  }
}

async function ensureRecipeLevels(tx, levels, stockUnitLevelIndex, { requireComplete = false } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    if (requireComplete) throw badRequest('recipe_levels_required', 'An active recipe requires at least one valid level.');
    return;
  }
  const indexes = levels.map((level) => level.levelIndex);
  if (!indexes.includes(stockUnitLevelIndex)) {
    throw badRequest('invalid_stock_unit_level', 'stockUnitLevelIndex must reference a recipe level.');
  }
  for (const level of levels) {
    const packageType = await tx.packingPackageType.findUnique({ where: { id: level.packageTypeId } });
    if (!packageType) throw notFound('package_type_not_found', 'A recipe package type was not found.', { packageTypeId: level.packageTypeId });
  }
}

export async function createPackingColor({ payload, actorUserId, idempotencyKey, client = prisma }) {
  const name = requireNonEmptyString(payload?.name, 'name', 200);
  const normalizedName = normalizeMasterName(name);
  return runIdempotent({ operation: 'packing.color.create', idempotencyKey, actorUserId, client, work: async (tx) => {
    const created = await tx.packingColor.create({ data: { name, normalizedName, isActive: payload?.isActive !== false, ...actorCreateFields(actorUserId) } });
    return serialize(created);
  } });
}

export async function updatePackingColor({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const colorId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.color.update', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await tx.packingColor.findUnique({ where: { id: colorId } });
    if (!existing) throw notFound('color_not_found', 'Packing color not found.', { id: colorId });
    const data = {};
    if (payload?.name !== undefined) {
      data.name = requireNonEmptyString(payload.name, 'name', 200);
      data.normalizedName = normalizeMasterName(data.name);
    }
    if (payload?.isActive !== undefined) data.isActive = payload.isActive === true;
    if (!Object.keys(data).length) throw badRequest('no_changes', 'At least one color field must change.');
    const updated = await tx.packingColor.update({ where: { id: colorId }, data: { ...data, ...actorUpdateFields(actorUserId) } });
    return serialize(updated);
  } });
}

export async function listPackingColors({ includeInactive = false, client = prisma } = {}) {
  return client.packingColor.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export async function createPackingPackageType({ payload, actorUserId, idempotencyKey, client = prisma }) {
  const name = requireNonEmptyString(payload?.name, 'name', 200);
  const kind = assertEnumValue(payload?.kind, PACKAGE_KINDS, 'kind');
  const defaultTareKg = parseNonNegativeNumber(payload?.defaultTareKg ?? 0, 'defaultTareKg');
  return runIdempotent({ operation: 'packing.package_type.create', idempotencyKey, actorUserId, client, work: async (tx) => {
    const created = await tx.packingPackageType.create({ data: { name, normalizedName: normalizeMasterName(name), kind, defaultTareKg, isActive: payload?.isActive !== false, ...actorCreateFields(actorUserId) } });
    return serialize(created);
  } });
}

export async function updatePackingPackageType({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const packageTypeId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.package_type.update', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await tx.packingPackageType.findUnique({ where: { id: packageTypeId } });
    if (!existing) throw notFound('package_type_not_found', 'Packing package type not found.', { id: packageTypeId });
    const data = {};
    if (payload?.name !== undefined) {
      data.name = requireNonEmptyString(payload.name, 'name', 200);
      data.normalizedName = normalizeMasterName(data.name);
    }
    if (payload?.kind !== undefined) data.kind = assertEnumValue(payload.kind, PACKAGE_KINDS, 'kind');
    if (payload?.defaultTareKg !== undefined) data.defaultTareKg = parseNonNegativeNumber(payload.defaultTareKg, 'defaultTareKg');
    if (payload?.isActive !== undefined) data.isActive = payload.isActive === true;
    if (!Object.keys(data).length) throw badRequest('no_changes', 'At least one package type field must change.');
    const updated = await tx.packingPackageType.update({ where: { id: packageTypeId }, data: { ...data, ...actorUpdateFields(actorUserId) } });
    return serialize(updated);
  } });
}

export async function listPackingPackageTypes({ includeInactive = false, kind, client = prisma } = {}) {
  const where = {};
  if (!includeInactive) where.isActive = true;
  if (kind) where.kind = assertEnumValue(kind, PACKAGE_KINDS, 'kind');
  return client.packingPackageType.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
}

export async function getPackingRecipeSnapshot(tx, recipeId) {
  const recipe = await tx.packingRecipe.findUnique({ where: { id: String(recipeId) }, include: recipeInclude });
  if (!recipe) throw notFound('recipe_not_found', 'Packing recipe not found.', { id: recipeId });
  return serialize(recipe);
}

export function effectiveRecipeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (!snapshot.base || typeof snapshot.base !== 'object') return snapshot;
  const base = { ...snapshot.base };
  if (snapshot.override && typeof snapshot.override === 'object') {
    return {
      ...base,
      ...snapshot.override,
      levels: snapshot.override.levels || base.levels,
      override: snapshot.override,
      overrideReason: snapshot.overrideReason || null,
    };
  }
  return base;
}

export function resolveRecipeSupersedesRecipeId(data, activeRecipe) {
  if (data?.supersedesRecipeId) return data.supersedesRecipeId;
  if (activeRecipe && Number(data?.version) > Number(activeRecipe.version)) return activeRecipe.id;
  return null;
}

export async function createPackingRecipe({ payload, actorUserId, idempotencyKey, client = prisma }) {
  const data = normalizeRecipeFields({ ...payload, status: 'DRAFT' });
  const levels = normalizeLevels(payload?.levels) || [];
  return runIdempotent({ operation: 'packing.recipe.create', idempotencyKey, actorUserId, client, work: async (tx) => {
    await ensureRecipeReferences(tx, data);
    await ensureRecipeLevels(tx, levels, data.stockUnitLevelIndex);
    const activeRecipe = data.supersedesRecipeId
      ? null
      : await tx.packingRecipe.findFirst({
        where: { familyKey: data.familyKey, status: RECIPE_STATUSES.ACTIVE },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
    const created = await tx.packingRecipe.create({
      data: {
        ...data,
        supersedesRecipeId: resolveRecipeSupersedesRecipeId(data, activeRecipe),
        status: RECIPE_STATUSES.DRAFT,
        levels: levels.length ? { create: levels } : undefined,
        ...actorCreateFields(actorUserId),
      },
      include: recipeInclude,
    });
    return serialize(created);
  } });
}

export async function listPackingRecipes({ status, familyKey, cursor, limit = 100, client = prisma } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const where = {};
  if (status) where.status = assertEnumValue(status, Object.values(RECIPE_STATUSES), 'status');
  if (familyKey) where.familyKey = String(familyKey).trim();
  const rows = await client.packingRecipe.findMany({
    where,
    take: take + 1,
    ...(cursor ? { skip: 1, cursor: { id: String(cursor) } } : {}),
    orderBy: [{ familyKey: 'asc' }, { version: 'desc' }, { id: 'asc' }],
    include: recipeInclude,
  });
  const hasMore = rows.length > take;
  const recipes = hasMore ? rows.slice(0, take) : rows;
  return { recipes, nextCursor: hasMore ? recipes[recipes.length - 1].id : null };
}

export async function getPackingRecipe(id, client = prisma) {
  const recipe = await client.packingRecipe.findUnique({ where: { id: String(id) }, include: recipeInclude });
  if (!recipe) throw notFound('recipe_not_found', 'Packing recipe not found.', { id });
  return recipe;
}

export async function updatePackingRecipe({ id, payload, actorUserId, idempotencyKey, client = prisma }) {
  const recipeId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.recipe.update', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await tx.packingRecipe.findUnique({ where: { id: recipeId }, include: { levels: true } });
    if (!existing) throw notFound('recipe_not_found', 'Packing recipe not found.', { id: recipeId });
    const patch = normalizeRecipeFields(payload || {}, { partial: true });
    const levels = normalizeLevels(payload?.levels);
    if (existing.status === RECIPE_STATUSES.ACTIVE) {
      const latest = await tx.packingRecipe.findFirst({ where: { familyKey: existing.familyKey }, orderBy: { version: 'desc' }, select: { version: true } });
      const nextVersion = Number(latest?.version || existing.version) + 1;
      const nextLevels = levels || existing.levels.map((level) => ({
        levelIndex: level.levelIndex,
        packageTypeId: level.packageTypeId,
        childUnitsPerContainer: level.childUnitsPerContainer,
        barcodeEnabled: level.barcodeEnabled,
      }));
      const nextData = {
        familyKey: existing.familyKey,
        version: nextVersion,
        status: RECIPE_STATUSES.DRAFT,
        supersedesRecipeId: existing.id,
        itemId: patch.itemId !== undefined ? patch.itemId : existing.itemId,
        wrapperId: patch.wrapperId !== undefined ? patch.wrapperId : existing.wrapperId,
        colorId: patch.colorId !== undefined ? patch.colorId : existing.colorId,
        coneTypeId: patch.coneTypeId !== undefined ? patch.coneTypeId : existing.coneTypeId,
        customerId: patch.customerId !== undefined ? patch.customerId : existing.customerId,
        nominalGram: patch.nominalGram !== undefined ? patch.nominalGram : existing.nominalGram,
        deliveryMode: patch.deliveryMode !== undefined ? patch.deliveryMode : existing.deliveryMode,
        allowPartialDispatch: patch.allowPartialDispatch !== undefined ? patch.allowPartialDispatch : existing.allowPartialDispatch,
        requiresQualityHold: patch.requiresQualityHold !== undefined ? patch.requiresQualityHold : existing.requiresQualityHold,
        warningVariancePercent: patch.warningVariancePercent !== undefined ? patch.warningVariancePercent : existing.warningVariancePercent,
        approvalVariancePercent: patch.approvalVariancePercent !== undefined ? patch.approvalVariancePercent : existing.approvalVariancePercent,
        stockUnitLevelIndex: patch.stockUnitLevelIndex !== undefined ? patch.stockUnitLevelIndex : existing.stockUnitLevelIndex,
        notes: patch.notes !== undefined ? patch.notes : existing.notes,
        sourceMetadata: patch.sourceMetadata !== undefined ? patch.sourceMetadata : existing.sourceMetadata,
        levels: { create: nextLevels },
        ...actorCreateFields(actorUserId),
      };
      await ensureRecipeReferences(tx, nextData);
      await ensureRecipeLevels(tx, nextLevels, nextData.stockUnitLevelIndex);
      const created = await tx.packingRecipe.create({ data: nextData, include: recipeInclude });
      return serialize(created);
    }

    if (existing.status === RECIPE_STATUSES.RETIRED) throw conflict('retired_recipe_immutable', 'A retired recipe cannot be edited. Create a new version from an active recipe.');
    const nextData = { ...patch, ...actorUpdateFields(actorUserId) };
    if (levels) {
      await ensureRecipeLevels(tx, levels, patch.stockUnitLevelIndex ?? existing.stockUnitLevelIndex);
      nextData.levels = { deleteMany: {}, create: levels };
    }
    await ensureRecipeReferences(tx, { ...existing, ...patch });
    const updated = await tx.packingRecipe.update({ where: { id: recipeId }, data: nextData, include: recipeInclude });
    return serialize(updated);
  } });
}

export function normalizeRecipeLifecycleReason(payload, { required = false } = {}) {
  return required
    ? requireNonEmptyString(payload?.reason, 'reason', 1000)
    : optionalString(payload?.reason, 1000);
}

export async function activatePackingRecipe({ id, payload = {}, actorUserId, idempotencyKey, client = prisma }) {
  normalizeRecipeLifecycleReason(payload);
  const recipeId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.recipe.activate', idempotencyKey, actorUserId, client, work: async (tx) => {
    const recipe = await tx.packingRecipe.findUnique({ where: { id: recipeId }, include: recipeInclude });
    if (!recipe) throw notFound('recipe_not_found', 'Packing recipe not found.', { id: recipeId });
    if (recipe.status !== RECIPE_STATUSES.DRAFT) throw conflict('recipe_not_draft', 'Only DRAFT recipes can be activated.');
    if (!recipe.itemId || !recipe.wrapperId || !recipe.colorId || !recipe.coneTypeId || recipe.nominalGram === null || recipe.nominalGram === undefined) {
      throw badRequest('recipe_incomplete', 'Item, Brand, Color, Cone Type, and nominal gram are required before activation.');
    }
    await ensureRecipeReferences(tx, recipe);
    await ensureRecipeLevels(tx, recipe.levels.map((level) => ({
      levelIndex: level.levelIndex,
      packageTypeId: level.packageTypeId,
      childUnitsPerContainer: level.childUnitsPerContainer,
      barcodeEnabled: level.barcodeEnabled,
    })), recipe.stockUnitLevelIndex, { requireComplete: true });
    await tx.packingRecipe.updateMany({ where: { familyKey: recipe.familyKey, status: RECIPE_STATUSES.ACTIVE, NOT: { id: recipe.id } }, data: { status: RECIPE_STATUSES.RETIRED, ...actorUpdateFields(actorUserId) } });
    const activated = await tx.packingRecipe.update({ where: { id: recipe.id }, data: { status: RECIPE_STATUSES.ACTIVE, ...actorUpdateFields(actorUserId) }, include: recipeInclude });
    return serialize(activated);
  } });
}

export async function retirePackingRecipe({ id, payload = {}, actorUserId, idempotencyKey, client = prisma }) {
  normalizeRecipeLifecycleReason(payload, { required: true });
  const recipeId = requireNonEmptyString(id, 'id', 100);
  return runIdempotent({ operation: 'packing.recipe.retire', idempotencyKey, actorUserId, client, work: async (tx) => {
    const existing = await tx.packingRecipe.findUnique({ where: { id: recipeId }, include: recipeInclude });
    if (!existing) throw notFound('recipe_not_found', 'Packing recipe not found.', { id: recipeId });
    if (existing.status !== RECIPE_STATUSES.ACTIVE) throw conflict('recipe_not_active', 'Only ACTIVE recipes can be retired.');
    const retired = await tx.packingRecipe.update({ where: { id: recipeId }, data: { status: RECIPE_STATUSES.RETIRED, ...actorUpdateFields(actorUserId) }, include: recipeInclude });
    return serialize(retired);
  } });
}
