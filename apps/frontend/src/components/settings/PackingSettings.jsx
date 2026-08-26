import React, { useEffect, useState } from 'react';
import { Check, Edit3, Plus, RotateCcw, Save, Settings2, ToggleLeft, ToggleRight, X } from 'lucide-react';
import AccessDenied from '../common/AccessDenied';
import { usePermission } from '../../hooks/usePermission';
import { getBootstrap } from '../../api';
import {
  activatePackingRecipe,
  createPackingColor,
  createPackingPackageType,
  createPackingRecipe,
  listPackingColors,
  listPackingPackageTypes,
  listPackingRecipes,
  retirePackingRecipe,
  updatePackingColor,
  updatePackingPackageType,
  updatePackingRecipe,
} from '../../api/packing';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { DELIVERY_MODES, PACKAGE_KINDS, asArray, entityId, formatDateTime, labelize, packageTypeLabel, recipeLabel, recipeLevels } from '../packing/packingUtils';
import { EmptyState, ErrorNotice, Field, NativeSelect, ReadOnlyNotice, SectionHeading, StatusBadge, SuccessNotice } from '../packing/PackingPrimitives';
import { buildRecipeLifecyclePayload, RECIPE_LIFECYCLE_DEFAULTS } from './recipeLifecycle';
import { validateRecipeDraft } from './recipeValidation';
import { activateOnNativeSettingsKey } from './settingsKeyboard';

const SETTING_TABS = [
  { id: 'colors', label: 'Colors' },
  { id: 'packages', label: 'Package types' },
  { id: 'recipes', label: 'Recipe families & versions' },
  { id: 'rules', label: 'Rules' },
];

function responseItems(response, keys = []) {
  for (const key of keys) {
    if (Array.isArray(response?.[key])) return response[key];
  }
  return asArray(response);
}

function activeLabel(entity) {
  return entity?.isActive === false ? 'Inactive' : 'Active';
}

function MasterEditor({ type, item, canWrite, saving, onCancel, onSubmit }) {
  const [name, setName] = useState(item?.name || '');
  const [kind, setKind] = useState(item?.kind || 'PACKET');
  const [tare, setTare] = useState(item?.defaultTareKg ?? '0');
  const [isActive, setIsActive] = useState(item?.isActive !== false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (type === 'package' && (!Number.isFinite(Number(tare)) || Number(tare) < 0)) {
      setError('Default tare must be zero or greater.');
      return;
    }
    try {
      await onSubmit(type === 'package'
        ? { name: name.trim(), kind, defaultTareKg: Number(tare), isActive }
        : { name: name.trim(), isActive });
    } catch (submitError) {
      setError(submitError?.message || 'Unable to save master data.');
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">{item ? 'Edit' : 'Add'} {type === 'package' ? 'package type' : 'color'}</CardTitle><Button type="button" variant="ghost" size="icon" onClick={onCancel}><X className="h-4 w-4" /></Button></div></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required><Input value={name} onChange={(event) => setName(event.target.value)} disabled={!canWrite || saving} placeholder={type === 'package' ? 'e.g. 150 PAC' : 'e.g. NEW 3435'} /></Field>
            {type === 'package' ? <Field label="Kind" required><NativeSelect value={kind} onChange={(event) => setKind(event.target.value)} options={PACKAGE_KINDS.map((value) => ({ value, label: labelize(value) }))} placeholder="" disabled={!canWrite || saving} /></Field> : null}
            {type === 'package' ? <Field label="Default tare (kg)" required><Input type="number" min="0" step="0.001" value={tare} onChange={(event) => setTare(event.target.value)} disabled={!canWrite || saving} /></Field> : null}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={!canWrite || saving} className="h-4 w-4 rounded border-input" />Available for new recipes and batches</label>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel} onKeyDown={(event) => activateOnNativeSettingsKey(event, onCancel)} disabled={saving}>Cancel</Button><Button type="submit" disabled={!canWrite || saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function MasterList({ type, items, canWrite, saving, onEdit, onCreate }) {
  const isPackage = type === 'package';
  const activateCreate = (event) => activateOnNativeSettingsKey(event, onCreate);
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4"><SectionHeading title={isPackage ? 'Package types' : 'Packing colors'} description={isPackage ? 'Outbound package types are separate from the existing receive Box/tare master.' : 'Names are normalized and unique on the server.'} actions={<Button type="button" size="sm" onClick={onCreate} onKeyDown={activateCreate} disabled={!canWrite}><Plus className="mr-2 h-4 w-4" />Add {isPackage ? 'package type' : 'color'}</Button>} /></CardHeader>
      <CardContent>
        {!items.length ? <EmptyState title={`No ${isPackage ? 'package types' : 'colors'} configured`} description="Add the master values used by active Packing recipes." action={canWrite ? <Button type="button" onClick={onCreate} onKeyDown={activateCreate}><Plus className="mr-2 h-4 w-4" />Add first value</Button> : null} /> : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead>{isPackage ? <><TableHead>Kind</TableHead><TableHead className="text-right">Default tare</TableHead></> : null}<TableHead>Status</TableHead><TableHead>Updated</TableHead><TableHead className="w-20" aria-label="Edit" /></TableRow></TableHeader>
              <TableBody>{items.map((item) => <TableRow key={entityId(item)}><TableCell className="font-medium">{item.name || '—'}<p className="mt-1 font-mono text-[11px] text-muted-foreground">{item.normalizedName || 'normalized by server'}</p></TableCell>{isPackage ? <><TableCell>{labelize(item.kind)}</TableCell><TableCell className="text-right tabular-nums">{item.defaultTareKg ?? '0'} kg</TableCell></> : null}<TableCell><span className={`inline-flex items-center gap-1 text-xs ${item.isActive === false ? 'text-muted-foreground' : 'text-emerald-700'}`}>{item.isActive === false ? <ToggleLeft className="h-4 w-4" /> : <ToggleRight className="h-4 w-4" />}{activeLabel(item)}</span></TableCell><TableCell className="text-xs text-muted-foreground">{formatDateTime(item.updatedAt || item.createdAt)}</TableCell><TableCell><Button type="button" variant="ghost" size="sm" onClick={() => onEdit(item)} disabled={!canWrite}><Edit3 className="mr-2 h-3.5 w-3.5" />Edit</Button></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const emptyRecipe = {
  familyKey: '',
  version: '1',
  itemId: '',
  wrapperId: '',
  colorId: '',
  coneTypeId: '',
  customerId: '',
  nominalGram: '',
  deliveryMode: 'UNSPECIFIED',
  allowPartialDispatch: false,
  requiresQualityHold: false,
  warningVariancePercent: '2',
  approvalVariancePercent: '5',
  stockUnitLevelIndex: '1',
  notes: '',
  levels: [{ levelIndex: 1, packageTypeId: '', childUnitsPerContainer: '', barcodeEnabled: false }],
};

function recipeFormFrom(recipe) {
  if (!recipe) return emptyRecipe;
  return {
    familyKey: recipe.familyKey || recipe.family || '',
    version: String(recipe.version ?? '1'),
    itemId: recipe.itemId || recipe.item?.id || '',
    wrapperId: recipe.wrapperId || recipe.wrapper?.id || '',
    colorId: recipe.colorId || recipe.color?.id || '',
    coneTypeId: recipe.coneTypeId || recipe.coneType?.id || '',
    customerId: recipe.customerId || recipe.customer?.id || '',
    nominalGram: recipe.nominalGram ?? '',
    deliveryMode: recipe.deliveryMode || 'UNSPECIFIED',
    allowPartialDispatch: !!recipe.allowPartialDispatch,
    requiresQualityHold: !!recipe.requiresQualityHold,
    warningVariancePercent: recipe.warningVariancePercent ?? '2',
    approvalVariancePercent: recipe.approvalVariancePercent ?? '5',
    stockUnitLevelIndex: String(recipe.stockUnitLevelIndex ?? '1'),
    notes: recipe.notes || '',
    levels: recipeLevels(recipe).length ? recipeLevels(recipe).map((level) => ({
      levelIndex: Number(level.levelIndex),
      packageTypeId: level.packageTypeId || level.packageType?.id || '',
      childUnitsPerContainer: level.childUnitsPerContainer ?? '',
      barcodeEnabled: !!level.barcodeEnabled,
    })) : emptyRecipe.levels,
  };
}

function RecipeEditor({ recipe, items, wrappers, colors, coneTypes, customers, packageTypes, canWrite, saving, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => recipeFormFrom(recipe));
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const updateLevel = (index, key, value) => setForm((current) => ({ ...current, levels: current.levels.map((level, levelIndex) => levelIndex === index ? { ...level, [key]: value } : level) }));
  const addLevel = () => setForm((current) => ({ ...current, levels: [...current.levels, { levelIndex: current.levels.length + 1, packageTypeId: '', childUnitsPerContainer: '', barcodeEnabled: false }] }));
  const removeLevel = (index) => setForm((current) => ({ ...current, levels: current.levels.filter((_, levelIndex) => levelIndex !== index).map((level, levelIndex) => ({ ...level, levelIndex: levelIndex + 1 })) }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    const validationError = validateRecipeDraft(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      await onSubmit({
        familyKey: form.familyKey.trim(),
        version: Number(form.version),
        status: 'DRAFT',
        supersedesRecipeId: recipe?.id || null,
        itemId: form.itemId || null,
        wrapperId: form.wrapperId || null,
        colorId: form.colorId || null,
        coneTypeId: form.coneTypeId || null,
        customerId: form.customerId || null,
        nominalGram: form.nominalGram === '' ? null : Number(form.nominalGram),
        deliveryMode: form.deliveryMode,
        allowPartialDispatch: form.allowPartialDispatch,
        requiresQualityHold: form.requiresQualityHold,
        warningVariancePercent: Number(form.warningVariancePercent),
        approvalVariancePercent: Number(form.approvalVariancePercent),
        stockUnitLevelIndex: Number(form.stockUnitLevelIndex),
        notes: form.notes.trim() || null,
        levels: form.levels.map((level, index) => ({
          levelIndex: index + 1,
          packageTypeId: level.packageTypeId,
          childUnitsPerContainer: Number(level.childUnitsPerContainer),
          barcodeEnabled: level.barcodeEnabled,
        })),
      });
    } catch (submitError) {
      setError(submitError?.message || 'Unable to save recipe.');
    }
  };

  const option = (list, labelKeys = ['name']) => list.filter(Boolean).map((item) => ({ value: item.id, label: labelKeys.map((key) => item[key]).filter(Boolean).join(' · ') || item.id }));

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{recipe ? `Edit draft: ${recipeLabel(recipe)}` : 'Create draft recipe version'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Active recipes are immutable. Save a new draft version when physical meaning changes.</p></div><Button type="button" variant="ghost" size="icon" onClick={onCancel}><X className="h-4 w-4" /></Button></div></CardHeader>
      <CardContent>
        <form className="space-y-5" noValidate onSubmit={submit}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Family key" required><Input value={form.familyKey} onChange={(event) => update('familyKey', event.target.value)} disabled={!canWrite || saving} placeholder="e.g. 110 NYLON-ANMOL 10" /></Field>
            <Field label="Version" required hint="Unique within the family."><Input type="number" min="1" step="1" value={form.version} onChange={(event) => update('version', event.target.value)} disabled={!canWrite || saving || !!recipe} /></Field>
            <Field label="Delivery mode" required><NativeSelect value={form.deliveryMode} onChange={(event) => update('deliveryMode', event.target.value)} options={DELIVERY_MODES} placeholder="" disabled={!canWrite || saving} /></Field>
            <Field label="Item"><NativeSelect value={form.itemId} onChange={(event) => update('itemId', event.target.value)} options={option(items, ['name'])} placeholder="Unresolved while draft" disabled={!canWrite || saving} /></Field>
            <Field label="Wrapper / Brand"><NativeSelect value={form.wrapperId} onChange={(event) => update('wrapperId', event.target.value)} options={option(wrappers, ['name'])} placeholder="Unresolved while draft" disabled={!canWrite || saving} /></Field>
            <Field label="Packing color"><NativeSelect value={form.colorId} onChange={(event) => update('colorId', event.target.value)} options={option(colors, ['name'])} placeholder="Unresolved while draft" disabled={!canWrite || saving} /></Field>
            <Field label="Cone type"><NativeSelect value={form.coneTypeId} onChange={(event) => update('coneTypeId', event.target.value)} options={option(coneTypes, ['name'])} placeholder="Unresolved while draft" disabled={!canWrite || saving} /></Field>
            <Field label="Customer restriction" hint="Blank means generic recipe."><NativeSelect value={form.customerId} onChange={(event) => update('customerId', event.target.value)} options={option(customers, ['name', 'displayName'])} placeholder="Generic" disabled={!canWrite || saving} /></Field>
            <Field label="Nominal gram" hint="Required before activation."><Input type="number" min="0" step="0.001" value={form.nominalGram} onChange={(event) => update('nominalGram', event.target.value)} disabled={!canWrite || saving} /></Field>
          </div>

          <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 md:grid-cols-3">
            <Field label="Warning variance %" required><Input type="number" min="0" step="0.001" value={form.warningVariancePercent} onChange={(event) => update('warningVariancePercent', event.target.value)} disabled={!canWrite || saving} /></Field>
            <Field label="Approval variance %" required><Input type="number" min="0" step="0.001" value={form.approvalVariancePercent} onChange={(event) => update('approvalVariancePercent', event.target.value)} disabled={!canWrite || saving} /></Field>
            <Field label="Stock-unit level" required hint="One-based recipe level that independently enters stock."><Input type="number" min="1" step="1" value={form.stockUnitLevelIndex} onChange={(event) => update('stockUnitLevelIndex', event.target.value)} disabled={!canWrite || saving} /></Field>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.allowPartialDispatch} onChange={(event) => update('allowPartialDispatch', event.target.checked)} disabled={!canWrite || saving} className="mt-0.5 h-4 w-4 rounded border-input" /><span><strong className="font-medium">Allow partial Dispatch</strong><span className="mt-1 block text-xs text-muted-foreground">Enables exact split with residual resealing.</span></span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.requiresQualityHold} onChange={(event) => update('requiresQualityHold', event.target.checked)} disabled={!canWrite || saving} className="mt-0.5 h-4 w-4 rounded border-input" /><span><strong className="font-medium">Require quality hold</strong><span className="mt-1 block text-xs text-muted-foreground">Sealed units wait for Packing WRITE release.</span></span></label>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <SectionHeading title="Recipe levels" description="Level 1 contains base cones/pieces. Higher levels contain immediately lower-level containers." actions={<Button type="button" variant="outline" size="sm" onClick={addLevel} disabled={!canWrite || saving}><Plus className="mr-2 h-4 w-4" />Add level</Button>} />
            <div className="space-y-3">
              {form.levels.map((level, index) => <div key={level.levelIndex} className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[5rem_1fr_1fr_auto_auto] sm:items-end"><Field label="Level"><Input value={level.levelIndex} readOnly className="bg-muted" /></Field><Field label="Package type" required><NativeSelect value={level.packageTypeId} onChange={(event) => updateLevel(index, 'packageTypeId', event.target.value)} options={packageTypes.map((packageType) => ({ value: packageType.id, label: packageTypeLabel(packageType) }))} placeholder="Select package" disabled={!canWrite || saving} /></Field><Field label="Child units / container" required><Input type="number" min="1" step="1" value={level.childUnitsPerContainer} onChange={(event) => updateLevel(index, 'childUnitsPerContainer', event.target.value)} disabled={!canWrite || saving} /></Field><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={level.barcodeEnabled} onChange={(event) => updateLevel(index, 'barcodeEnabled', event.target.checked)} disabled={!canWrite || saving} className="h-4 w-4 rounded border-input" />Barcode</label><Button type="button" variant="ghost" size="icon" onClick={() => removeLevel(index)} disabled={!canWrite || saving || form.levels.length === 1} aria-label={`Remove level ${level.levelIndex}`}><X className="h-4 w-4 text-destructive" /></Button></div>)}
            </div>
          </div>

          <Field label="Notes"><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} disabled={!canWrite || saving} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" /></Field>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel} onKeyDown={(event) => activateOnNativeSettingsKey(event, onCancel)} disabled={saving}>Cancel</Button><Button type="submit" disabled={!canWrite || saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save draft'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PackingSettings() {
  const { canRead, canWrite } = usePermission('packing');
  const [tab, setTab] = useState('colors');
  const [colors, setColors] = useState([]);
  const [packageTypes, setPackageTypes] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [wrappers, setWrappers] = useState([]);
  const [coneTypes, setConeTypes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [editor, setEditor] = useState(null);
  const [masterEditor, setMasterEditor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleError, setLifecycleError] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [colorResponse, packageResponse, recipeResponse, bootstrapResponse] = await Promise.all([
        listPackingColors({ limit: 100 }),
        listPackingPackageTypes({ limit: 100 }),
        listPackingRecipes({ limit: 200 }),
        getBootstrap(),
      ]);
      setColors(responseItems(colorResponse, ['colors', 'items']));
      setPackageTypes(responseItems(packageResponse, ['packageTypes', 'package_types', 'items']));
      setRecipes(responseItems(recipeResponse, ['recipes', 'items']));
      const slices = bootstrapResponse?.slices || bootstrapResponse || {};
      setItems(asArray(slices.items));
      setWrappers(asArray(slices.wrappers));
      setConeTypes(asArray(slices.cone_types || slices.coneTypes));
      setCustomers(asArray(slices.customers));
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canRead) load();
  }, [canRead]);

  const runSave = async (callback, message) => {
    setSaving(true);
    setError(null);
    setSuccess('');
    try {
      await callback();
      setSuccess(message);
      await load();
    } catch (saveError) {
      setError(saveError);
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  const saveMaster = (payload) => runSave(async () => {
    const isPackage = masterEditor.type === 'package';
    if (masterEditor.item) {
      await (isPackage ? updatePackingPackageType(masterEditor.item.id, payload) : updatePackingColor(masterEditor.item.id, payload));
    } else {
      await (isPackage ? createPackingPackageType(payload) : createPackingColor(payload));
    }
    setMasterEditor(null);
  }, 'Packing master saved.');

  const saveRecipe = (payload) => runSave(async () => {
    if (editor.recipe) await updatePackingRecipe(editor.recipe.id, payload);
    else await createPackingRecipe(payload);
    setEditor(null);
  }, 'Draft recipe version saved.');

  const openLifecycleDialog = (action, recipe) => {
    setLifecycleAction({ action, recipe });
    setLifecycleReason(RECIPE_LIFECYCLE_DEFAULTS[action]);
    setLifecycleError('');
  };

  const closeLifecycleDialog = () => {
    if (saving) return;
    setLifecycleAction(null);
    setLifecycleError('');
  };

  const submitLifecycleAction = async (event) => {
    event.preventDefault();
    if (!lifecycleAction || !canWrite || saving) return;
    setLifecycleError('');
    try {
      const payload = buildRecipeLifecyclePayload(lifecycleAction.action, lifecycleReason);
      const mutation = lifecycleAction.action === 'activate' ? activatePackingRecipe : retirePackingRecipe;
      const message = lifecycleAction.action === 'activate' ? 'Recipe activated.' : 'Recipe retired.';
      await runSave(() => mutation(lifecycleAction.recipe.id, payload), message);
      setLifecycleAction(null);
    } catch (lifecycleMutationError) {
      setLifecycleError(lifecycleMutationError?.message || 'The recipe lifecycle action could not be completed.');
    }
  };

  if (!canRead) return <AccessDenied message="You do not have access to Packing settings. Contact an administrator." />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-bold tracking-tight">Packing settings</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Manage the masters and immutable recipe versions that control physical Packing behavior.</p></div><Button type="button" variant="outline" onClick={load} disabled={loading}><RotateCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></div>
      <ErrorNotice error={error} onRetry={load} /><SuccessNotice>{success}</SuccessNotice>{!canWrite ? <ReadOnlyNotice /> : null}
      <div className="flex gap-1 overflow-x-auto border-b pb-px" role="tablist" aria-label="Packing settings sections">{SETTING_TABS.map((settingTab) => <button key={settingTab.id} type="button" role="tab" aria-selected={tab === settingTab.id} onClick={() => { setTab(settingTab.id); setEditor(null); setMasterEditor(null); }} onKeyDown={(event) => activateOnNativeSettingsKey(event, () => { setTab(settingTab.id); setEditor(null); setMasterEditor(null); })} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === settingTab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{settingTab.label}</button>)}</div>

      {masterEditor ? <MasterEditor type={masterEditor.type} item={masterEditor.item} canWrite={canWrite} saving={saving} onCancel={() => setMasterEditor(null)} onSubmit={saveMaster} /> : null}
      {editor ? <RecipeEditor recipe={editor.recipe} items={items} wrappers={wrappers} colors={colors} coneTypes={coneTypes} customers={customers} packageTypes={packageTypes} canWrite={canWrite} saving={saving} onCancel={() => setEditor(null)} onSubmit={saveRecipe} /> : null}

      {!masterEditor && !editor && tab === 'colors' ? <MasterList type="color" items={colors} canWrite={canWrite} saving={saving} onCreate={() => setMasterEditor({ type: 'color', item: null })} onEdit={(item) => setMasterEditor({ type: 'color', item })} /> : null}
      {!masterEditor && !editor && tab === 'packages' ? <MasterList type="package" items={packageTypes} canWrite={canWrite} saving={saving} onCreate={() => setMasterEditor({ type: 'package', item: null })} onEdit={(item) => setMasterEditor({ type: 'package', item })} /> : null}
      {!masterEditor && !editor && tab === 'recipes' ? (
        <Card className="shadow-none"><CardHeader className="pb-4"><SectionHeading title="Recipe families and versions" description="DRAFT versions may be edited. Activation validates masters, levels, stock-unit level, and thresholds." actions={<Button type="button" onClick={() => setEditor({ recipe: null })} disabled={!canWrite}><Plus className="mr-2 h-4 w-4" />New draft recipe</Button>} /></CardHeader><CardContent>{!recipes.length ? <EmptyState title="No recipes configured" description="Importing the workbook seed creates DRAFT recipes only; unresolved rows remain blocked until edited." action={canWrite ? <Button type="button" onClick={() => setEditor({ recipe: null })}><Plus className="mr-2 h-4 w-4" />Create first recipe</Button> : null} /> : <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Family / version</TableHead><TableHead>Status</TableHead><TableHead>Delivery</TableHead><TableHead>Stock level</TableHead><TableHead>Rules</TableHead><TableHead>Updated</TableHead><TableHead className="w-48" aria-label="Actions" /></TableRow></TableHeader><TableBody>{recipes.map((recipe) => <TableRow key={entityId(recipe)}><TableCell><p className="font-medium">{recipe.familyKey || recipe.family || recipe.name || '—'} <span className="font-mono text-xs text-muted-foreground">v{recipe.version ?? '—'}</span></p><p className="mt-1 text-xs text-muted-foreground">{recipe.item?.name || recipe.itemId || 'Item unresolved'}{recipe.customer?.name || recipe.customerId ? ` · ${recipe.customer?.name || recipe.customerId}` : ' · Generic'}</p></TableCell><TableCell><StatusBadge status={recipe.status} /></TableCell><TableCell>{labelize(recipe.deliveryMode)}</TableCell><TableCell className="text-center">L{recipe.stockUnitLevelIndex ?? '—'}</TableCell><TableCell className="text-xs">Warn {recipe.warningVariancePercent ?? '—'}% · Approve {recipe.approvalVariancePercent ?? '—'}%</TableCell><TableCell className="text-xs text-muted-foreground">{formatDateTime(recipe.updatedAt || recipe.createdAt)}</TableCell><TableCell><div className="flex flex-wrap justify-end gap-1">{recipe.status === 'DRAFT' ? <Button type="button" variant="ghost" size="sm" onClick={() => setEditor({ recipe })} disabled={!canWrite}><Edit3 className="mr-1 h-3.5 w-3.5" />Edit</Button> : null}{recipe.status === 'DRAFT' ? <Button type="button" variant="outline" size="sm" onClick={() => openLifecycleDialog('activate', recipe)} disabled={!canWrite}><Check className="mr-1 h-3.5 w-3.5" />Activate</Button> : null}{recipe.status === 'ACTIVE' ? <Button type="button" variant="ghost" size="sm" onClick={() => openLifecycleDialog('retire', recipe)} disabled={!canWrite}>Retire</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
      ) : null}
      {!masterEditor && !editor && tab === 'rules' ? <RulesPanel canWrite={canWrite} onOpenRecipe={() => { setTab('recipes'); setEditor({ recipe: null }); }} /> : null}
      <Dialog open={Boolean(lifecycleAction)} onOpenChange={(open) => { if (!open) closeLifecycleDialog(); }}>
        <DialogContent
          title={lifecycleAction?.action === 'retire' ? 'Retire recipe' : 'Activate recipe'}
          onOpenChange={(open) => { if (!open) closeLifecycleDialog(); }}
          role="dialog"
          aria-modal="true"
          aria-describedby="recipe-lifecycle-description"
        >
          <form onSubmit={submitLifecycleAction} className="space-y-4">
            <p id="recipe-lifecycle-description" className="text-sm text-muted-foreground">
              {lifecycleAction?.action === 'retire'
                ? 'Retirement is permanent for this recipe version. Enter the reason retained with the request.'
                : 'Activation makes this validated recipe version immutable. An activation note is optional.'}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="recipe-lifecycle-reason" className="text-sm">
                {lifecycleAction?.action === 'retire' ? 'Retirement reason' : 'Activation note'}
                {lifecycleAction?.action === 'retire' ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
              </Label>
              <Input
                id="recipe-lifecycle-reason"
                autoFocus
                value={lifecycleReason}
                onChange={(event) => setLifecycleReason(event.target.value)}
                disabled={!canWrite || saving}
                required={lifecycleAction?.action === 'retire'}
                aria-required={lifecycleAction?.action === 'retire' ? 'true' : 'false'}
                placeholder={lifecycleAction?.action === 'retire' ? RECIPE_LIFECYCLE_DEFAULTS.retire : 'Optional activation note'}
              />
            </div>
            {lifecycleError ? <p className="text-sm text-destructive" role="alert">{lifecycleError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeLifecycleDialog} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={!canWrite || saving}>{saving ? 'Saving…' : lifecycleAction?.action === 'retire' ? 'Retire recipe' : 'Activate recipe'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RulesPanel({ canWrite, onOpenRecipe }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="shadow-none"><CardHeader><CardTitle className="text-base">Sealing variance</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Each recipe stores its own warning and approval thresholds. Sealing within the warning threshold proceeds normally; higher variance requires a reason, and above approval requires explicit Packing WRITE confirmation.</p><p>Actual count and weight, planned values, computed variance, reason, and actor are retained in the append-only event payload.</p><Button type="button" variant="outline" onClick={onOpenRecipe} disabled={!canWrite}><Settings2 className="mr-2 h-4 w-4" />Configure on a recipe</Button></CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle className="text-base">Customer and quality rules</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>A customer-restricted recipe can only be used for that customer. Generic recipes keep customer-neutral output eligible for later reservation when physical composition remains compatible.</p><p>Quality hold is also recipe-defined. When enabled, sealed units stay QUALITY_HOLD until a Packing WRITE user records a release event.</p><Button type="button" variant="outline" onClick={onOpenRecipe} disabled={!canWrite}><Settings2 className="mr-2 h-4 w-4" />Configure on a recipe</Button></CardContent></Card>
      <Card className="shadow-none lg:col-span-2"><CardHeader><CardTitle className="text-base">Partial Dispatch</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><p>Partial Dispatch is recipe-controlled. When enabled, Dispatch V2 must capture exact dispatched and residual counts and weights, retire the source identity, and create a newly sealed residual barcode. This screen only configures the recipe permission; the operation remains owned by Dispatch V2.</p></CardContent></Card>
    </div>
  );
}

export default PackingSettings;
