import { useAuth } from '../../context/AuthContext';
import React, { useEffect, useRef, useState } from 'react';
import { buildPrintableArtifact, CALIBRATION_TEMPLATE } from '../../utils/labelPrint';
import LabelArtifactPreview from '../labels/LabelArtifactPreview';
import { DEFAULT_SCALE_SETTINGS } from '../../utils/weightScaleParser';
import ScaleSettingsFields from './ScaleSettingsFields';
import DesktopUpdateNotice from './DesktopUpdateNotice';

const initialScale = { path: '', ...DEFAULT_SCALE_SETTINGS };
const fieldClass = 'border rounded bg-background px-2 py-1 w-full';
const buttonClass = 'border rounded px-3 py-2 disabled:opacity-50 hover:bg-muted';
function Field({ label, children }) { return <label className="block text-sm space-y-1"><span>{label}</span>{children}</label>; }

export default function DesktopWorkstation() {
  const { user } = useAuth();
  const canConfigure = user?.isAdmin || user?.permissions?.settings >= 2;
  const bridge = window.glintexDesktop;
  const [open, setOpen] = useState(false);
  const setupRef = useRef(null);
  const [server, setServer] = useState({ state: 'checking' });
  const [scaleStatus, setScaleStatus] = useState({ state: 'not configured' });
  const [printerStatus, setPrinterStatus] = useState({});
  const [controller, setController] = useState({});
  const [update, setUpdate] = useState({ state: 'idle' });
  const [updateError, setUpdateError] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);
  const updatePending = useRef(false);
  const updateGeneration = useRef(0);
  const updateStatusRevision = useRef(0);
  const [scale, setScale] = useState(initialScale);
  const [ports, setPorts] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [printer, setPrinter] = useState({ printerName: '', dpi: 203 });
  const [jobs, setJobs] = useState([]);
  const [startAtLogin, setStartAtLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [driverResult, setDriverResult] = useState(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [testArtifact, setTestArtifact] = useState(null);
  const [media, setMedia] = useState({ width: 48, height: 25, pageWidth: 104, columns: 2, horizontalGap: 2, verticalGap: 2, marginLeft: 0, marginTop: 0, offsetX: 0, offsetY: 0 });

  async function refreshStatus() {
    const [s, sc, p] = await Promise.allSettled([bridge.server.status(), bridge.scale.status(), bridge.printers.status()]);
    setServer(s.status === 'fulfilled' ? s.value : { state: 'unavailable', message: s.reason?.message });
    setScaleStatus(sc.status === 'fulfilled' ? sc.value : { status: 'unavailable', error: sc.reason?.message });
    setPrinterStatus(p.status === 'fulfilled' ? p.value : { available: false, error: p.reason?.message });
  }
  async function refreshDevices() {
    const [p, pr, j] = await Promise.allSettled([bridge.scale.enumerate(), bridge.printers.enumerate(), bridge.printers.listJobs()]);
    if (p.status === 'fulfilled') setPorts(p.value);
    if (pr.status === 'fulfilled') setPrinters(pr.value);
    if (j.status === 'fulfilled') setJobs(j.value);
    const failures = [p, pr, j].filter(r => r.status === 'rejected');
    if (failures.length) throw new Error(failures.map(r => r.reason?.message || 'Device refresh failed').join('; '));
  }
  async function act(fn) {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); await refreshStatus(); }
    catch (e) { setError(e.message || 'Operation failed'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    Promise.all([bridge.getController(), bridge.settings.get()]).then(([c, s]) => {
      if (!live) return;
      setController(c); setScale({ ...initialScale, ...s.scale });
      setPrinter(s.printer || { printerName: '', dpi: 203 }); setStartAtLogin(Boolean(s.startAtLogin));
    }).catch(e => live && setError(e.message));
    refreshStatus().catch(e => live && setError(e.message));
    const unsubscribe = bridge.scale.onStatus?.(s => live && setScaleStatus(s));
    const timer = setInterval(() => { if (live) refreshStatus().catch(() => {}); }, 30000);
    return () => { live = false; clearInterval(timer); unsubscribe?.(); };
  }, [bridge]);
  useEffect(() => {
    const showSetup = () => { setOpen(true); setupRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    window.addEventListener('glintex:open-workstation', showSetup);
    return () => window.removeEventListener('glintex:open-workstation', showSetup);
  }, []);
  useEffect(() => {
    if (!open || !bridge) return;
    refreshDevices().catch(e => setError(e.message));
    const timer = setInterval(() => bridge.printers.listJobs().then(setJobs).catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [open, bridge]);
  useEffect(() => {
    if (!bridge?.updates) return;
    let live = true;
    let receivedStatus = false;
    const unsubscribe = bridge.updates.onStatus(state => { receivedStatus = true; if (live) { updateStatusRevision.current++; setUpdate(state); } });
    bridge.updates.status().then(state => { if (live && !receivedStatus) setUpdate(state); }).catch(e => live && setUpdateError(e.message));
    const retry = () => { bridge.updates.retry?.().catch(() => {}); };
    window.addEventListener('online', retry);
    return () => { live = false; unsubscribe?.(); window.removeEventListener('online', retry); };
  }, [bridge]);
  if (!bridge) return null;
  const updateAction = async (action, cancelDownload = false) => {
    if (updatePending.current && !cancelDownload) return;
    updatePending.current = true; setUpdateBusy(true); setUpdateError('');
    const generation = ++updateGeneration.current;
    const revision = updateStatusRevision.current;
    try { const state = await action(); if (generation === updateGeneration.current && revision === updateStatusRevision.current) setUpdate(state); }
    catch (e) { if (generation === updateGeneration.current) setUpdateError(e.message || 'Update operation failed'); }
    finally { if (generation === updateGeneration.current) { updatePending.current = false; setUpdateBusy(false); } }
  };
  const changeScale = (key, value) => setScale(s => ({ ...s, [key]: value }));
  const changeMedia = (key, value) => { setMedia(s => ({ ...s, [key]: Number(value) })); setTestArtifact(null); };
  const scaleLabel = scaleStatus.state || scaleStatus.status || (scaleStatus.isConnected ? 'connected' : 'disconnected');
  async function prepareCalibration() {
    const template = { ...CALIBRATION_TEMPLATE, media: { ...CALIBRATION_TEMPLATE.media, widthMm: Number(media.width) || 75, heightMm: Number(media.height) || 125, rollWidthMm: Number(media.pageWidth) || Number(media.width) || 75, columns: Number(media.columns) || 1, columnGapMm: Number(media.horizontalGap) || 0, rowGapMm: Number(media.verticalGap) || 0, marginLeftMm: Number(media.marginLeft) || 0, marginTopMm: Number(media.marginTop) || 0 } };
    const artifact = await buildPrintableArtifact(template, [{}], { stageKey: 'calibration', dpi: printer.dpi, copies: 1 });
    setTestArtifact(artifact); setMessage('Check the media dimensions and preview before submitting the test label. No production record is created.');
  }
  return <section ref={setupRef} className="border-b bg-card text-foreground" aria-label="Desktop workstation">
    <div className="flex flex-wrap gap-4 items-center px-4 py-2 text-sm">
      <span>Server: {server.state}</span><span>Scale: {scaleLabel}</span>
      <span>Printer: {printerStatus.available ? `${printerStatus.profile?.printerName || 'Selected'} (installed)` : 'unavailable / not selected'}</span>
      <span>GLINTEX {controller.version || update.installedVersion || '…'}</span>
      <button type="button" className="underline ml-auto" onClick={() => setOpen(v => !v)} aria-expanded={open}>Workstation setup & print jobs</button>
    </div>
    {bridge.updates && <DesktopUpdateNotice update={update} installedVersion={update.installedVersion || controller.version || '…'} open={open} busy={updateBusy} error={updateError} onAction={updateAction} updates={bridge.updates}/>}
    {open && <div className="p-4 space-y-5 max-h-[75vh] overflow-auto border-t">
      <div className="text-xs text-muted-foreground">Controller {controller.version || '…'} · API {controller.apiOrigin || server.apiOrigin} · Settings apply to this Windows user on this workstation</div>
      {error && <div role="alert" className="border border-destructive text-destructive rounded p-3">{error}</div>}
      {server.message && <p className="text-sm">Server: {server.message}</p>}
      {printerStatus.error && <p className="text-sm text-destructive">Printer: {printerStatus.error}</p>}
      {message && <div role="status" className="border rounded p-3">{message}</div>}
      {printerStatus.available && <p className="text-xs">Windows driver status: {printerStatus.driverStatus ?? 'not reported'}. Installed does not confirm paper readiness or physical printing; check the Windows queue when in doubt.</p>}
      {!canConfigure && <p className="text-sm">Device configuration requires Settings write permission. Contact your administrator to change this workstation.</p>}
      <button type="button" className={buttonClass} disabled={busy} onClick={() => act(refreshDevices)}>Refresh devices and jobs</button>
      <button type="button" className={`${buttonClass} ml-2`} disabled={busy} onClick={() => act(async () => { const saved = await bridge.settings.get(); setScale({ ...initialScale, ...saved.scale }); setPrinter(saved.printer || { printerName: '', dpi: 203 }); setStartAtLogin(Boolean(saved.startAtLogin)); setTestArtifact(null); setMessage('Saved workstation settings reloaded.'); })}>Reload saved settings</button>
      {controller.scaleDriver?.available && <section className="border rounded p-3 space-y-2" aria-label="Optional scale driver setup">
        <h2 className="font-semibold">Optional one-time scale driver setup</h2>
        <p className="text-sm">For the BAFO BF-812 / Prolific PL2303GT adapter with hardware ID USB\VID_067B&amp;PID_23A3&amp;REV_0305 on Windows 10 x64. The Windows driver exposes a COM port; GLINTEX still needs the correct port and scale protocol. Leave a working driver unchanged.</p>
        <p className="text-sm">Preparation downloads and verifies the pinned Microsoft package, or verifies a prepared offline cache. It runs with your current permissions and installs nothing. Disconnect the scale in GLINTEX before preparation.</p>
        <button type="button" className={buttonClass} disabled={busy || !canConfigure || scaleStatus.isConnected || scaleLabel === 'connecting'} onClick={() => act(async () => {
          setDriverResult(null);
          const result = await bridge.scale.driverSetup(); setDriverResult(result);
          if (!result.success) throw new Error('Driver preparation failed. No driver was installed or changed. Review the log below.');
          setMessage('Driver package verified. No driver was installed. If needed, continue in Windows Device Manager as described below.');
        })}>Prepare verified scale driver</button>
        {driverResult?.success && <div className="text-sm space-y-2">
          <p>Open Device Manager from Windows Start. Check the adapter’s Hardware IDs: use this package only for USB\VID_067B&amp;PID_23A3&amp;REV_0305 on Windows 10 x64. If the adapter already has a working COM port, skip installation.</p>
          <p>If the compatible adapter has no working driver: select it &gt; Update driver &gt; Browse my computer for drivers and select this verified folder:</p>
          <p className="font-mono break-all select-all">{driverResult.packageDirectory}</p>
          <p>Windows handles administrator permission and checks the signed driver package. Do not run the bundled scripts as administrator. Follow any Windows restart request manually.</p>
          <p>Then refresh devices, select this PC’s actual COM port, save the documented scale settings, connect and test a fresh capture.</p>
        </div>}
        {driverResult && <details open={!driverResult.success}><summary className="cursor-pointer">Driver preparation log</summary><p className="text-xs break-all">{driverResult.logPath}</p><pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto">{driverResult.output}</pre></details>}
      </section>}
      <fieldset className="border rounded p-3 space-y-3" disabled={busy || !canConfigure}>
        <legend className="px-2 font-semibold">Scale connection</legend>
        <p className="text-sm">Select the exact scale and its documented protocol. Unknown protocol never produces a measurement. Disconnect before changing settings; no automatic port substitution.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="COM port"><select className={fieldClass} value={scale.path} onChange={e => { const device = ports.find(p => p.path === e.target.value); setScale(s => ({ ...s, path: e.target.value, serialNumber: device?.serialNumber || undefined, vendorId: device?.vendorId || undefined, productId: device?.productId || undefined, pnpId: device?.pnpId || undefined })); }}><option value="">Choose scale</option>{scale.path && !ports.some(p => p.path === scale.path) && <option value={scale.path}>{scale.path} (not present)</option>}{ports.map(p => <option key={p.path} value={p.path}>{p.path} {p.manufacturer || ''} {p.serialNumber || ''}</option>)}</select></Field>
          <Field label="Stable sample count"><input className={fieldClass} type="number" min="2" max="20" value={scale.stabilitySamples} onChange={e => changeScale('stabilitySamples', Number(e.target.value))}/></Field>
          <Field label="Stability tolerance (kg)"><input className={fieldClass} type="number" min="0" step="0.0001" value={scale.toleranceKg} onChange={e => changeScale('toleranceKg', Number(e.target.value))}/></Field>
          <Field label="Minimum accepted weight (kg)"><input className={fieldClass} type="number" value={scale.minKg} onChange={e => changeScale('minKg', Number(e.target.value))}/></Field>
          <Field label="Maximum accepted weight (kg)"><input className={fieldClass} type="number" value={scale.maxKg} onChange={e => changeScale('maxKg', Number(e.target.value))}/></Field>
          <Field label="Stale after (ms)"><input className={fieldClass} type="number" min="100" max="10000" value={scale.staleMs} onChange={e => changeScale('staleMs', Number(e.target.value))}/></Field>
        </div>
        <ScaleSettingsFields value={scale} onChange={changeScale} disabled={busy || !canConfigure}/>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => act(async () => { await bridge.scale.configure(scale); setMessage('Scale settings saved.'); })}>Save scale settings</button>
          <button type="button" className={buttonClass} onClick={() => act(() => bridge.scale.connect())}>Connect saved scale</button>
          <button type="button" className={buttonClass} onClick={() => act(() => bridge.scale.disconnect())}>Disconnect</button>
          <button type="button" className={buttonClass} disabled={!scaleStatus.isConnected || scaleStatus.config?.profileId === 'unknown'} onClick={() => act(async () => { const r = await bridge.scale.capture({ timeoutMs: 8000 }); setMessage(`Test capture: ${r.weightKg} kg · ${r.captureId}. Diagnostic only; no receipt saved.`); })}>Test fresh capture</button>
          <button type="button" className={buttonClass} onClick={() => setDiagnostics(v => !v)}>{diagnostics ? 'Hide' : 'Show'} bounded diagnostics</button>
        </div>
        {scaleStatus.identityWarning && <p className="text-amber-700">{scaleStatus.identityWarning}</p>}
        {scaleStatus.error && <p role="alert">{typeof scaleStatus.error === 'string' ? scaleStatus.error : scaleStatus.error.message}</p>}
        {diagnostics && <pre className="text-xs whitespace-pre-wrap max-h-40 overflow-auto border p-2">{JSON.stringify({ state: scaleLabel, lastReading: scaleStatus.lastReading, diagnostics: scaleStatus.diagnostics, rawFrames: scaleStatus.rawFrames }, null, 2).slice(0, 6000)}</pre>}
      </fieldset>
      <fieldset className="border rounded p-3 space-y-3" disabled={busy || !canConfigure}>
        <legend className="px-2 font-semibold">Windows printer</legend>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Explicit printer"><select className={fieldClass} value={printer.printerName} onChange={e => { setPrinter(p => ({ ...p, printerName: e.target.value })); setTestArtifact(null); }}><option value="">Choose printer</option>{printer.printerName && !printers.some(p => p.name === printer.printerName) && <option>{printer.printerName}</option>}{printers.map(p => <option key={p.name} value={p.name}>{p.displayName || p.name}</option>)}</select></Field><Field label="Driver resolution (verify in Windows)"><select className={fieldClass} value={printer.dpi} onChange={e => { setPrinter(p => ({ ...p, dpi: Number(e.target.value) })); setTestArtifact(null); }}>{[203,300,600].map(v => <option key={v} value={v}>{v} dpi</option>)}</select></Field></div>
        <button type="button" className={buttonClass} onClick={() => act(async () => { const savedProfile = await bridge.printers.configure(printer); setPrinter(savedProfile); window.dispatchEvent(new CustomEvent('glintex:printer-profile-changed', { detail: savedProfile })); setMessage('Printer saved. Confirm matching stock size in Windows Printing Preferences.'); })}>Save printer</button>
        <p className="text-sm">TE244 at 203 dpi is an initial profile. Confirm your actual driver and stock. Successful submission means accepted by the print system, not confirmed on paper.</p>
        <details><summary className="cursor-pointer">Calibration / test label</summary><p className="text-xs mt-2">Match verticalGap in Windows driver stock/gap-sensor settings. It records the physical media gap; the printed page excludes that gap.</p><div className="grid sm:grid-cols-3 gap-3 mt-3">{Object.entries(media).map(([key,value]) => <Field key={key} label={`${key}${key === 'columns' ? '' : ' (mm)'}`}><input type="number" step={key === 'columns' ? '1' : '0.1'} className={fieldClass} value={value} onChange={e => changeMedia(key,e.target.value)}/></Field>)}</div>
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => act(prepareCalibration)}>Prepare test preview</button>
          {testArtifact && <div className="mt-3"><LabelArtifactPreview artifact={testArtifact} maxWidthPx={360} /><p>{testArtifact.widthMm} × {testArtifact.heightMm} mm · exact document sent to the printer · {testArtifact.dpi} dpi profile</p><button type="button" className={buttonClass} onClick={() => act(async () => { const r = await bridge.printers.submit({ artifact: testArtifact, profile: printer }); if (!r.success) throw new Error(r.error || 'Print submission failed'); setMessage(`Test job ${r.job.id}: ${r.job.state}`); await refreshDevices(); })}>Submit test label</button></div>}
        </details>
      </fieldset>
      <section aria-label="Print queue" className="space-y-2"><h2 className="font-semibold">Retained print jobs</h2><p className="text-sm">A reprint creates a new label job only. Check the printer before reprinting an uncertain submission; the original might already have printed.</p>{jobs.length === 0 ? <p>No retained jobs.</p> : <ul className="space-y-2">{jobs.slice(0,100).map(job => <li className="border rounded p-2 text-sm" key={job.id}><div className="font-mono">{job.id}</div><div>{job.state} · {job.profile?.printerName} · {job.createdAt}</div>{(job.error || job.message) && <div>{job.error || job.message}</div>}{['submitted','failed','outcome uncertain','outcome-uncertain','outcome_uncertain'].includes(job.state) && <button type="button" className={buttonClass} disabled={busy} onClick={() => { if (window.confirm('Reprint this retained artwork? Check for already printed labels first. This does not save another receipt.')) act(async () => { const r = await bridge.printers.reprint(job.id); if (!r.success) throw new Error(r.error || 'Reprint failed'); setMessage(`Reprint ${r.job.id}: ${r.job.state}`); await refreshDevices(); }); }}>Controlled reprint</button>}</li>)}</ul>}</section>
      <label className="flex gap-2"><input type="checkbox" checked={startAtLogin} disabled={busy || !canConfigure} onChange={e => { const enabled = e.target.checked; act(async () => { await bridge.settings.update({ startAtLogin: enabled }); setStartAtLogin(enabled); }); }}/>Start GLINTEX when I sign in to Windows</label>
    </div>}
  </section>;
}
