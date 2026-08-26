export const PACKING_BATCH_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'IN_PROGRESS',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'SHORT_CLOSED',
  'VOIDED',
];

export const PACKING_UNIT_STATUSES = [
  'IN_PROGRESS',
  'LABEL_PENDING',
  'QUALITY_HOLD',
  'AVAILABLE',
  'RESERVED',
  'DISPATCHED',
  'RETURNED_PENDING_INSPECTION',
  'DAMAGED',
  'REPACKED',
  'SPLIT_CONSUMED',
  'OPENED',
  'VOIDED',
];

export const DELIVERY_MODES = [
  { value: 'UNSPECIFIED', label: 'Unspecified' },
  { value: 'LOCAL', label: 'Local' },
  { value: 'PARCEL', label: 'Parcel' },
];

export const BATCH_KINDS = [
  { value: 'INITIAL', label: 'Initial packing' },
  { value: 'REPACKING', label: 'Repacking' },
  { value: 'OPENING', label: 'Opening stock' },
];

export const SOURCE_TYPES = [
  { value: 'CONING_RECEIVE', label: 'Coning receive' },
  { value: 'PACKED_UNIT', label: 'Packed unit' },
];

export const PACKAGE_KINDS = ['PACKET', 'BOX', 'BORI', 'PARCEL'];

export const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  return [];
};

export const getNextCursor = (value) => value?.nextCursor || value?.next_cursor || value?.pageInfo?.nextCursor || null;

export const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

export const entityId = (entity) => firstValue(entity?.id, entity?.uuid, entity?.key, entity?.batchId, entity?.unitId, '');

export const formatCount = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return value === 0 ? '0' : '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(number);
};

export const formatDecimal = (value, maximumFractionDigits = 3) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return value === 0 ? '0' : '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(number);
};

export const formatKg = (value) => {
  const formatted = formatDecimal(value, 3);
  return formatted === '—' ? formatted : `${formatted} kg`;
};

export const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
};

export const labelize = (value) => String(value || '')
  .toLowerCase()
  .split('_')
  .filter(Boolean)
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(' ');

export const batchStatusVariant = (status) => {
  if (status === 'COMPLETED') return 'success';
  if (status === 'VOIDED' || status === 'SHORT_CLOSED') return 'destructive';
  if (status === 'IN_PROGRESS' || status === 'PARTIALLY_COMPLETED') return 'warning';
  return 'outline';
};

export const unitStatusVariant = (status) => {
  if (status === 'AVAILABLE') return 'success';
  if (status === 'RESERVED' || status === 'QUALITY_HOLD' || status === 'RETURNED_PENDING_INSPECTION') return 'warning';
  if (status === 'DAMAGED' || status === 'VOIDED') return 'destructive';
  return 'outline';
};

export const recipeLabel = (recipe) => {
  if (!recipe) return 'Recipe unavailable';
  const family = firstValue(recipe.familyKey, recipe.family, recipe.name, 'Recipe');
  const version = recipe.version === undefined || recipe.version === null ? '' : ` v${recipe.version}`;
  const status = recipe.status ? ` · ${labelize(recipe.status)}` : '';
  return `${family}${version}${status}`;
};

export const packageTypeLabel = (packageType) => {
  if (!packageType) return 'Package type unavailable';
  const name = firstValue(packageType.name, packageType.kind, 'Package');
  const kind = packageType.kind && packageType.kind !== packageType.name ? ` · ${packageType.kind}` : '';
  return `${name}${kind}`;
};

export const unitLabel = (unit, packageTypes = []) => {
  const packageType = packageTypes.find((candidate) => String(entityId(candidate)) === String(unit?.packageTypeId));
  return firstValue(packageType?.name, unit?.packageTypeName, unit?.packageKind, unit?.packageType?.name, 'Container');
};

export const unitIdentity = (unit) => firstValue(unit?.barcode, unit?.id, unit?.unitSequence, 'Unsealed unit');

export const sourceIdentity = (source) => firstValue(
  source?.sourceBarcode,
  source?.barcode,
  source?.sourceId,
  source?.id,
  'Source',
);

export const batchSources = (batch) => asArray(batch?.sources || batch?.batchSources || batch?.sourceRows);

export const batchUnits = (batch) => asArray(batch?.units || batch?.packedUnits || batch?.packed_units);

export const batchEvents = (batch) => asArray(batch?.events || batch?.history || batch?.eventHistory);

export const recipeLevels = (recipe) => asArray(recipe?.levels || recipe?.recipeLevels || recipe?.packingRecipeLevels)
  .slice()
  .sort((left, right) => Number(left.levelIndex || 0) - Number(right.levelIndex || 0));

export const activeRecipe = (recipe) => String(recipe?.status || '').toUpperCase() === 'ACTIVE';

export const isBatchMutable = (status) => ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED'].includes(status);

export const canAddUnit = (status) => ['IN_PROGRESS', 'PARTIALLY_COMPLETED'].includes(status);

export const isExceptionalUnitStatus = (status) => [
  'LABEL_PENDING',
  'QUALITY_HOLD',
  'RETURNED_PENDING_INSPECTION',
  'DAMAGED',
].includes(status);

export const todayISO = () => new Date().toISOString().slice(0, 10);
