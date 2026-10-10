import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Grid3x3, Magnet, Save, Printer, RotateCcw, Eye, ChevronDown } from 'lucide-react';
import { Button } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import { usePermission } from '../../../hooks/usePermission';
import { useSubmitLock } from '../../../hooks/useSubmitLock';
import { useUnsavedGuard } from '../../../context/UnsavedChangesContext';
import { LABEL_STAGE_KEYS, STAGE_GROUPS, getStageLabel, getStageVariables, loadTemplateWithOrigin, saveTemplate, getDefaultTemplate, printStageTemplatesBatch, hasDesktopPrinting } from '../../../utils/labelPrint';
import { buildSampleData, SAMPLE_VARIANTS } from '../../../utils/label/sampleData';
import { canvasSize } from '../../../utils/label/model';
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
  const canvasAreaRef = useRef(null);
  const dirty = isDirty(state);
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
    loadTemplateWithOrigin(stageKey)
      .then(({ template, origin }) => { if (live) dispatch({ type: 'load', stageKey, template, origin }); })
      .catch((error) => {
        if (!live) return;
        if (error.status === 404) dispatch({ type: 'load', stageKey, template: getDefaultTemplate(stageKey), origin: 'default' });
        else dispatch({ type: 'loadFailed', error: error.message || 'Could not load this label' });
      });
    return () => { live = false; };
  }, [stageKey]);

  const sampleData = useMemo(() => buildSampleData(stageKey, variant), [stageKey, variant]);
  const variables = useMemo(() => getStageVariables(stageKey), [stageKey]);
  const { layout, markup, css, warnings } = useDesignerLayout(state.template, sampleData, printerDpi);
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
    if (dirty && !window.confirm('Discard unsaved changes to this label?')) return;
    setStageKey(next);
  };

  const [saving, save] = useSubmitLock();
  const handleSave = save(async () => {
    const result = await saveTemplate(stageKey, state.template);
    if (!result.success) { notify('error', result.error || 'Save failed'); return; }
    dispatch({ type: 'markSaved', template: result.template });
    notify('success', `${getStageLabel(stageKey)} saved. Every new ${getStageLabel(stageKey).toLowerCase()} label prints this design.`);
  });

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

  const handleReset = () => {
    if (!window.confirm('Replace this design with the factory default? Nothing is saved until you press Save.')) return;
    dispatch({ type: 'replaceTemplate', template: getDefaultTemplate(stageKey) });
    notify('info', 'Factory default loaded. Press Save to keep it.');
  };

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !typing) { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); }
      else if (key === 'y' && !typing) { event.preventDefault(); dispatch({ type: 'redo' }); }
      else if (key === 's') { event.preventDefault(); if (canEdit) handleSave(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (state.selectedIds.length) setSideTab('element'); }, [state.selectedIds]);

  const zoomBy = (factor) => setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
  const canSave = canEdit && (dirty || state.origin !== 'saved') && !state.loading && !state.error;
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
          <select aria-label="Sample data" className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={variant} onChange={(e) => setVariant(e.target.value)}>
            {SAMPLE_VARIANTS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} disabled={state.loading}><Eye className="h-4 w-4 mr-1.5" />Print preview</Button>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!canEdit || state.loading} title="Load the factory design"><RotateCcw className="h-4 w-4 mr-1.5" />Reset</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || saving}><Save className="h-4 w-4 mr-1.5" />{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </header>
      {status ? (
        <div role="status" className={cn('px-3 py-1.5 text-sm border-b', status.tone === 'error' ? 'bg-red-50 text-red-800 border-red-200' : status.tone === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-sky-50 text-sky-900 border-sky-200')}>
          {status.message}
        </div>
      ) : null}
      {state.error ? <div className="m-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</div> : null}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)_312px]">
        <aside className="hidden lg:flex flex-col min-h-0 border-r border-border/70 bg-background overflow-hidden" aria-label="Elements">
          <LayersPanel template={state.template} selectedIds={state.selectedIds} warnings={warnings} dispatch={dispatch} canEdit={canEdit} canvas={canvas} />
        </aside>
        <section ref={canvasAreaRef} className="flex flex-col min-h-0 min-w-0" aria-label="Design canvas">
          <DesignCanvas template={state.template} layout={layout} markup={markup} css={css} zoom={zoom} selectedIds={state.selectedIds} warnings={warnings} snap={snap} showGrid={showGrid} dispatch={dispatch} onZoom={zoomBy} onOpenInspector={() => setSideTab('element')} />
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 border-t border-border/70 bg-background text-[11px] text-muted-foreground">
            <span>Label {canvas.widthMm} × {canvas.heightMm} mm as you read it · prints on {state.template.media.widthMm} × {state.template.media.heightMm} mm{state.template.media.columns > 1 ? ` · ${state.template.media.columns} across` : ''}</span>
            <span>Preview is the exact printed artwork · {printerDpi} dpi</span>
            {warnings.length ? <span className="text-amber-700">{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</span> : null}
            {state.selectedIds.length ? <span>{state.selectedIds.length} selected</span> : null}
          </footer>
        </section>
        <aside className="flex flex-col min-h-0 border-t lg:border-t-0 lg:border-l border-border/70 bg-background overflow-hidden" aria-label="Inspector">
          <div className="flex border-b border-border/70 text-sm">
            {[['element', 'Element'], ['label', 'Label & roll']].map(([key, label]) => (
              <button key={key} type="button" className={cn('flex-1 px-3 py-2 font-medium', sideTab === key ? 'text-foreground border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground')} onClick={() => setSideTab(key)}>{label}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {sideTab === 'element'
              ? <Inspector template={state.template} selectedIds={state.selectedIds} variables={variables} warnings={warnings} dispatch={dispatch} canEdit={canEdit} />
              : <MediaPanel template={state.template} dispatch={dispatch} canEdit={canEdit} />}
          </div>
          <div className="lg:hidden border-t border-border/70">
            <LayersPanel template={state.template} selectedIds={state.selectedIds} warnings={warnings} dispatch={dispatch} canEdit={canEdit} canvas={canvas} />
          </div>
        </aside>
      </div>
      <PrintPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} template={state.template} stageKey={stageKey} sampleData={sampleData} dpi={printerDpi} onTestPrint={handleTestPrint} printing={printing} />
    </div>
  );
}
