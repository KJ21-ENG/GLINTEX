import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Grid3x3, Magnet, Save, RotateCcw, Eye, ChevronDown, X, RefreshCw, CheckCircle2, CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../../components/common/ConfirmDialog';
import { Button } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import { usePermission } from '../../../hooks/usePermission';
import { useSubmitLock } from '../../../hooks/useSubmitLock';
import { useUnsavedGuard } from '../../../context/UnsavedChangesContext';
import { LABEL_STAGE_KEYS, STAGE_GROUPS, getStageLabel, getStageVariables, loadTemplateVariants, saveTemplateVariants, newVariantId, getDefaultTemplate, printStageTemplatesBatch, hasDesktopPrinting } from '../../../utils/labelPrint';
import { askForInput } from '../../../utils/inputPrompt';
import { ActionMenu } from '../../../components/ui';
import { buildSampleData, SAMPLE_VARIANTS } from '../../../utils/label/sampleData';
import { canvasSize, normalizeTemplate } from '../../../utils/label/model';
import { designerReducer, initialDesignerState, isDirty } from './designerState';
import { useDesignerLayout } from './useDesignerLayout';
import DesignCanvas from './DesignCanvas';
import Inspector from './Inspector';
import LayersPanel from './LayersPanel';
import MediaPanel from './MediaPanel';
import PrintPreviewDialog from './PrintPreviewDialog';

const STAGE_STORAGE_KEY = 'labelDesigner.stage';
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;

const readStoredStage = () => {
  try {
    const value = window.localStorage.getItem(STAGE_STORAGE_KEY);
    return Object.values(LABEL_STAGE_KEYS).includes(value) ? value : LABEL_STAGE_KEYS.INBOUND;
  } catch {
    return LABEL_STAGE_KEYS.INBOUND;
  }
};

export default function LabelDesigner() {
  const navigate = useNavigate();
  const { canEdit } = usePermission('settings');
  const [state, dispatch] = useReducer(designerReducer, undefined, initialDesignerState);
  const [stageKey, setStageKey] = useState(readStoredStage);
  const [variant, setVariant] = useState('typical');
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [printerDpi, setPrinterDpi] = useState(203);
  const [sideTab, setSideTab] = useState('element');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [editRequest, setEditRequest] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Saved variants of this stage and which one prints; on-screen edits live in `state`.
  const [variantSet, setVariantSet] = useState({ variants: [], activeId: null });
  const [currentVariantId, setCurrentVariantId] = useState(null);
  const canvasAreaRef = useRef(null);
  const dirty = useMemo(() => isDirty(state), [state.template, state.savedJson, state.origin, state.past.length, state.transaction]); // eslint-disable-line react-hooks/exhaustive-deps
  useUnsavedGuard('label-designer', dirty);

  const notify = useCallback((tone, message) => {
    setStatus({ tone, message, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!status || status.tone === 'error') return undefined;
    const timer = setTimeout(() => setStatus((s) => (s && s.at === status.at ? null : s)), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  // Printer profile from the desktop app decides the dot pitch used for barcodes.
  useEffect(() => {
    if (!hasDesktopPrinting()) return undefined;
    let live = true;
    const refresh = () => window.glintexDesktop.printers.status().then((s) => { if (live && s.profile?.dpi) setPrinterDpi(s.profile.dpi); }).catch(() => {});
    refresh();
    window.addEventListener('glintex:printer-profile-changed', refresh);
    return () => { live = false; window.removeEventListener('glintex:printer-profile-changed', refresh); };
  }, []);

  // Load the stage design: saved, or the factory default when none was saved yet.
  useEffect(() => {
    let live = true;
    dispatch({ type: 'loading' });
    try { window.localStorage.setItem(STAGE_STORAGE_KEY, stageKey); } catch { /* ignore */ }
    loadTemplateVariants(stageKey)
      .then(({ variants, activeId, origin }) => {
        if (!live) return;
        setVariantSet({ variants, activeId });
        setCurrentVariantId(activeId);
        dispatch({ type: 'load', stageKey, template: variants.find((v) => v.id === activeId).template, origin });
      })
      .catch((error) => {
        if (!live) return;
        dispatch({ type: 'loadFailed', error: error.message || 'Could not load this label' });
      });
    return () => { live = false; };
  }, [stageKey, reloadNonce]);

  const sampleData = useMemo(() => buildSampleData(stageKey, variant), [stageKey, variant]);
  const stressData = useMemo(() => buildSampleData(stageKey, 'long'), [stageKey]);
  const variables = useMemo(() => getStageVariables(stageKey), [stageKey]);
  const { layout, markup, css, warnings } = useDesignerLayout(state.template, sampleData, printerDpi, stressData);
  const canvas = canvasSize(state.template.media);

  const fitZoom = useCallback(() => {
    const area = canvasAreaRef.current;
    if (!area) return;
    const availableW = area.clientWidth - 110;
    const availableH = area.clientHeight - 110;
    const pxW = (canvas.widthMm / 25.4) * 96;
    const pxH = (canvas.heightMm / 25.4) * 96;
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(availableW / pxW, availableH / pxH))));
  }, [canvas.widthMm, canvas.heightMm]);
  useEffect(() => { fitZoom(); }, [fitZoom, stageKey]);

  const changeStage = (next) => {
    if (next === stageKey) return;
    if (dirty) { setConfirm({ kind: 'stage', next }); return; }
    setStageKey(next);
  };

  const [saving, save] = useSubmitLock();
  const stageName = getStageLabel(stageKey);
  const currentVariant = variantSet.variants.find((v) => v.id === currentVariantId) || null;
  const activeVariant = variantSet.variants.find((v) => v.id === variantSet.activeId) || null;
  const currentInUse = Boolean(currentVariant && currentVariant.id === variantSet.activeId);
  const withCurrentEdits = () => {
    const now = new Date().toISOString();
    return variantSet.variants.map((v) => (v.id === currentVariantId ? { ...v, template: normalizeTemplate(state.template), updatedAt: now } : v));
  };
  const persist = async (variants, activeId) => {
    const result = await saveTemplateVariants(stageKey, { variants, activeId });
    if (!result.success) { notify('error', result.error || 'Save failed'); return false; }
    setVariantSet({ variants, activeId });
    return true;
  };
  const openVariant = (variant) => {
    setCurrentVariantId(variant.id);
    dispatch({ type: 'load', stageKey, template: variant.template, origin: 'saved' });
  };
  const handleSave = save(async () => {
    if (!currentVariant) return;
    const variants = withCurrentEdits();
    if (!(await persist(variants, variantSet.activeId))) return;
    dispatch({ type: 'markSaved', template: variants.find((v) => v.id === currentVariantId).template });
    notify('success', currentInUse
      ? `${currentVariant.name} saved. Every new ${stageName.toLowerCase()} label prints this design.`
      : `${currentVariant.name} saved. ${activeVariant?.name || 'Another variant'} is still the one in use; choose Use for printing to switch.`);
  });
  const handleUseForPrinting = save(async () => {
    if (!currentVariant || currentInUse) return;
    const variants = withCurrentEdits();
    if (!(await persist(variants, currentVariant.id))) return;
    dispatch({ type: 'markSaved', template: variants.find((v) => v.id === currentVariantId).template });
    notify('success', `${currentVariant.name} is now in use. Every new ${stageName.toLowerCase()} label prints this design.`);
  });
  const uniqueName = (exceptId) => (value) => {
    const name = String(value || '').trim();
    if (!name) return 'Enter a name';
    if (name.length > 60) return 'Keep the name under 60 characters';
    if (variantSet.variants.some((v) => v.id !== exceptId && v.name.toLowerCase() === name.toLowerCase())) return 'Another variant already has this name';
    return null;
  };
  const handleNewVariant = save(async () => {
    if (!currentVariant) return;
    if (variantSet.variants.length >= 20) { notify('error', 'A label can have at most 20 variants'); return; }
    const name = await askForInput({ title: `New ${stageName.toLowerCase()} variant`, label: 'Name of the new variant. It starts as a copy of the design on screen.', defaultValue: `${currentVariant.name} copy`, confirmLabel: 'Create', validate: uniqueName(null) });
    if (name === null) return;
    const variant = { id: newVariantId(), name: name.trim(), template: normalizeTemplate(state.template), updatedAt: new Date().toISOString() };
    if (!(await persist([...variantSet.variants, variant], variantSet.activeId))) return;
    openVariant(variant);
    notify('success', `${variant.name} created from the design on screen. ${activeVariant?.name || 'The current variant'} is still the one in use.`);
  });
  const handleRenameVariant = save(async () => {
    if (!currentVariant) return;
    const name = await askForInput({ title: 'Rename variant', label: 'Variant name', defaultValue: currentVariant.name, confirmLabel: 'Rename', validate: uniqueName(currentVariant.id) });
    if (name === null || name.trim() === currentVariant.name) return;
    const variants = variantSet.variants.map((v) => (v.id === currentVariant.id ? { ...v, name: name.trim() } : v));
    if (await persist(variants, variantSet.activeId)) notify('success', `Renamed to ${name.trim()}.`);
  });
  const deleteCurrentVariant = save(async () => {
    if (!currentVariant || currentInUse || variantSet.variants.length < 2) return;
    const variants = variantSet.variants.filter((v) => v.id !== currentVariant.id);
    if (!(await persist(variants, variantSet.activeId))) return;
    openVariant(variants.find((v) => v.id === variantSet.activeId));
    notify('success', `${currentVariant.name} deleted.`);
  });
  const changeVariant = (id) => {
    if (id === currentVariantId) return;
    if (dirty) { setConfirm({ kind: 'variant', next: id }); return; }
    const next = variantSet.variants.find((v) => v.id === id);
    if (next) openVariant(next);
  };

  const handleTestPrint = async () => {
    setPrinting(true);
    try {
      const result = await printStageTemplatesBatch(stageKey, [sampleData], { template: state.template, copies: 1 });
      notify('success', result.message || (result.job?.id ? `Test label submitted (job ${result.job.id}). Check the printer.` : 'Test label sent. Check the printer.'));
    } catch (error) {
      notify('error', error.message || 'Test print failed');
    } finally {
      setPrinting(false);
    }
  };

  const applyFactoryDesign = () => {
    dispatch({ type: 'replaceTemplate', template: getDefaultTemplate(stageKey, currentVariantId) });
    notify('info', 'Factory design loaded. Press Save to keep it.');
  };
  const handleReset = () => setConfirm({ kind: 'factory' });

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        // Element shortcuts work wherever focus is, as long as nobody is typing.
        if (typing || !state.selectedIds.length || !canEdit) return;
        const step = event.shiftKey ? 1 : 0.25;
        const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (nudge) {
          event.preventDefault();
          dispatch({ type: 'updateElements', ids: state.selectedIds.filter((id) => !state.template.elements.find((el) => el.id === id)?.locked), patch: (el) => ({ x: Math.round((el.x + nudge[0]) * 100) / 100, y: Math.round((el.y + nudge[1]) * 100) / 100 }) });
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          dispatch({ type: 'removeElements', ids: state.selectedIds });
        } else if (event.key === 'Escape') {
          dispatch({ type: 'select', ids: [] });
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !typing) { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); }
      else if (key === 'y' && !typing) { event.preventDefault(); dispatch({ type: 'redo' }); }
      else if (key === 'd' && !typing && state.selectedIds.length && canEdit) { event.preventDefault(); dispatch({ type: 'duplicateElements', ids: state.selectedIds }); }
      else if (key === 's') { event.preventDefault(); if (canSave && !saving) handleSave(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (state.selectedIds.length) setSideTab('element'); }, [state.selectedIds]);

  const zoomBy = (factor) => setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
  const canSave = canEdit && (dirty || state.origin !== 'saved') && !state.loading && !state.error && state.stageKey === stageKey;
  const originTone = state.origin === 'default' || state.origin === 'legacy' || dirty ? 'text-amber-700' : 'text-muted-foreground';
  const originLabel = state.error ? '' : state.origin === 'default' ? 'Factory default · not saved yet' : state.origin === 'legacy' ? 'Converted from the old designer · review and save' : dirty ? 'Unsaved changes' : 'Saved';

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] min-h-[600px] rounded-lg border border-border bg-card shadow-sm overflow-hidden" data-testid="label-designer">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/70 bg-background">
        <Button variant="ghost" size="sm" className="px-2" onClick={() => navigate('/app/settings')} aria-label="Back to settings"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-base font-semibold whitespace-nowrap">Label designer</h1>
          <div className="relative">
            <select aria-label="Label stage" className="h-9 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={stageKey} onChange={(e) => changeStage(e.target.value)}>
              {STAGE_GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.stages.map((key) => <option key={key} value={key}>{getStageLabel(key)}</option>)}
                </optgroup>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          {variantSet.variants.length ? (
            <div className="flex items-center gap-1">
              <div className="relative">
                <select aria-label="Label variant" className="h-9 max-w-[200px] appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={currentVariantId || ''} onChange={(e) => changeVariant(e.target.value)} disabled={state.loading || saving}>
                  {variantSet.variants.map((v) => <option key={v.id} value={v.id}>{v.id === variantSet.activeId ? `${v.name} · in use` : v.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              {currentInUse
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400" title="New labels of this stage print this variant"><CheckCircle2 className="h-3 w-3" />In use</span>
                : <Button size="sm" variant="outline" className="h-8" onClick={handleUseForPrinting} disabled={!canEdit || state.loading || saving} title="Make new labels of this stage print this variant">Use for printing</Button>}
              <ActionMenu actions={[
                { label: 'New variant from this design', icon: <CopyPlus className="w-4 h-4" />, onClick: handleNewVariant, disabled: !canEdit || state.loading || saving },
                { label: 'Rename variant', icon: <Pencil className="w-4 h-4" />, onClick: handleRenameVariant, disabled: !canEdit || state.loading || saving || state.origin !== 'saved' },
                { label: 'Delete variant', icon: <Trash2 className="w-4 h-4" />, variant: 'destructive', onClick: () => setConfirm({ kind: 'deleteVariant' }), disabled: !canEdit || saving || currentInUse || variantSet.variants.length < 2, disabledReason: currentInUse ? 'The variant in use cannot be deleted' : 'The only variant cannot be deleted' },
              ]} />
            </div>
          ) : null}
          <span className={cn('text-xs whitespace-nowrap', originTone)}>{state.loading ? 'Loading…' : originLabel}</span>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Undo (Ctrl/Cmd+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 className="h-4 w-4" /></Button>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}><ZoomOut className="h-4 w-4" /></Button>
          <button type="button" className="h-9 min-w-[52px] text-xs font-medium tabular-nums rounded-md hover:bg-accent" title="Reset to 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Zoom in" onClick={() => zoomBy(1.2)}><ZoomIn className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Fit label" onClick={fitZoom}><Maximize2 className="h-4 w-4" /></Button>
          <Button variant={showGrid ? 'secondary' : 'ghost'} size="icon" className="h-9 w-9" title="Grid" aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)}><Grid3x3 className="h-4 w-4" /></Button>
          <Button variant={snap ? 'secondary' : 'ghost'} size="icon" className="h-9 w-9" title="Snap to edges and other elements" aria-pressed={snap} onClick={() => setSnap((v) => !v)}><Magnet className="h-4 w-4" /></Button>
          <span className="mx-1 h-6 w-px bg-border" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Sample</span>
            <select aria-label="Sample data" className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={variant} onChange={(e) => setVariant(e.target.value)}>
              {SAMPLE_VARIANTS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} disabled={state.loading}><Eye className="h-4 w-4 mr-1.5" />Preview &amp; test print</Button>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!canEdit || state.loading} title="Replace this design with the factory design"><RotateCcw className="h-4 w-4 mr-1.5" />Factory design</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || saving}><Save className="h-4 w-4 mr-1.5" />{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </header>
      {status ? (
        <div role="status" className={cn('flex items-center gap-2 px-3 py-1.5 text-sm border-b', status.tone === 'error' ? 'bg-destructive/10 text-destructive border-destructive/30' : status.tone === 'success' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30' : 'bg-primary/10 text-foreground border-primary/30')}>
          <span className="flex-1">{status.message}</span>
          <button type="button" className="p-0.5 rounded hover:bg-background/60" aria-label="Dismiss" onClick={() => setStatus(null)}><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
      {state.error ? (
        <div className="m-4 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex-1">{state.error}</span>
          <Button size="sm" variant="outline" onClick={() => setReloadNonce((n) => n + 1)}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Retry</Button>
        </div>
      ) : null}
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(360px,1fr)_auto] lg:grid-rows-none lg:grid-cols-[232px_minmax(0,1fr)_312px]">
        <aside className="hidden lg:flex flex-col min-h-0 border-r border-border/70 bg-background overflow-hidden" aria-label="Elements">
          <LayersPanel template={state.template} selectedIds={state.selectedIds} warnings={warnings} dispatch={dispatch} canEdit={canEdit} canvas={canvas} />
        </aside>
        <section ref={canvasAreaRef} className="flex flex-col min-h-0 min-w-0" aria-label="Design canvas">
          <DesignCanvas template={state.template} layout={layout} markup={markup} css={css} zoom={zoom} selectedIds={state.selectedIds} warnings={warnings} snap={snap} showGrid={showGrid} loading={state.loading} stageLabel={getStageLabel(stageKey)} dispatch={dispatch} onZoom={zoomBy} onOpenInspector={() => { setSideTab('element'); setEditRequest((n) => n + 1); }} />
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 border-t border-border/70 bg-background text-[11px] text-muted-foreground">
            <span>Label {canvas.widthMm} × {canvas.heightMm} mm as you read it · prints on {state.template.media.widthMm} × {state.template.media.heightMm} mm{state.template.media.kind === 'sheet' ? ` · ${state.template.media.pageWidthMm} × ${state.template.media.pageHeightMm} mm sheet, ${state.template.media.columns} × ${state.template.media.rows}` : state.template.media.columns > 1 ? ` · ${state.template.media.columns} across` : ''}</span>
            <span>Preview is the exact printed artwork · {printerDpi} dpi</span>
            {warnings.length ? <span className="text-amber-700">{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</span> : null}
            {state.selectedIds.length ? <span>{state.selectedIds.length} selected</span> : null}
          </footer>
        </section>
        <aside className="flex flex-col min-h-0 max-h-[45vh] lg:max-h-none border-t lg:border-t-0 lg:border-l border-border/70 bg-background overflow-hidden" aria-label="Inspector">
          <div className="flex border-b border-border/70 text-sm">
            {[['element', 'Element'], ['label', 'Label & roll']].map(([key, label]) => (
              <button key={key} type="button" className={cn('flex-1 px-3 py-2 font-medium', sideTab === key ? 'text-foreground border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground')} onClick={() => setSideTab(key)}>{label}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {sideTab === 'element'
              ? <Inspector template={state.template} selectedIds={state.selectedIds} variables={variables} warnings={warnings} dispatch={dispatch} canEdit={canEdit} editRequest={editRequest} onNotify={notify} />
              : <MediaPanel template={state.template} dispatch={dispatch} canEdit={canEdit} />}
          </div>
          <div className="lg:hidden border-t border-border/70">
            <LayersPanel template={state.template} selectedIds={state.selectedIds} warnings={warnings} dispatch={dispatch} canEdit={canEdit} canvas={canvas} />
          </div>
        </aside>
      </div>
      <PrintPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} template={state.template} stageKey={stageKey} sampleData={sampleData} dpi={printerDpi} onTestPrint={handleTestPrint} printing={printing} />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'factory' ? 'Load the factory design?' : confirm?.kind === 'deleteVariant' ? `Delete ${currentVariant?.name || 'this variant'}?` : 'Discard unsaved changes?'}
        message={confirm?.kind === 'factory' ? 'Your current design is replaced on screen. Nothing changes on the server until you press Save.'
          : confirm?.kind === 'deleteVariant' ? 'This variant is removed for everyone. The variant in use is not affected.'
          : confirm?.kind === 'variant' ? `${currentVariant?.name || 'This variant'} has unsaved changes. Open another variant anyway?`
          : `${getStageLabel(stageKey)} has unsaved changes. Switch stage anyway?`}
        confirmLabel={confirm?.kind === 'factory' ? 'Load factory design' : confirm?.kind === 'deleteVariant' ? 'Delete variant' : 'Discard & switch'}
        cancelLabel={confirm?.kind === 'factory' ? 'Keep mine' : confirm?.kind === 'deleteVariant' ? 'Keep it' : 'Stay'}
        destructive={confirm?.kind !== 'factory'}
        onConfirm={() => {
          const c = confirm; setConfirm(null);
          if (c?.kind === 'factory') applyFactoryDesign();
          else if (c?.kind === 'deleteVariant') deleteCurrentVariant();
          else if (c?.kind === 'variant') { const next = variantSet.variants.find((v) => v.id === c.next); if (next) openVariant(next); }
          else if (c?.next) setStageKey(c.next);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
