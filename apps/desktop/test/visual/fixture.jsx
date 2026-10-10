import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LabelDesigner from '../../../frontend/src/pages/Settings/LabelDesigner';
import '@fontsource/inter';
import '@fontsource/inter/700.css';
import '@fontsource/roboto-mono';
import '@fontsource/roboto-mono/700.css';
import '@fontsource/ibm-plex-sans';
import '@fontsource/ibm-plex-sans/700.css';
import { DEFAULT_STAGE_TEMPLATES, buildPrintableArtifact, artifactToDocument } from '../../../frontend/src/utils/labelPrint';
import { buildSampleData } from '../../../frontend/src/utils/label/sampleData';
import LabelArtifactPreview from '../../../frontend/src/components/labels/LabelArtifactPreview';
import DesktopWorkstation from '../../../frontend/src/components/common/DesktopWorkstation';
import { AuthProvider } from '../../../frontend/src/context/AuthContext';
import { UnsavedChangesProvider } from '../../../frontend/src/context/UnsavedChangesContext';
let profile={printerName:'Fixture TSC TE244',dpi:203};
window.fixtureSetDpi = dpi => { profile = { ...profile, dpi }; window.dispatchEvent(new CustomEvent('glintex:printer-profile-changed', {detail:profile})); };
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
  const parsed = new URL(String(url), location.href);
  if (parsed.origin === location.origin && parsed.pathname.startsWith('/api/sticker_templates/')) {
    const key = decodeURIComponent(parsed.pathname.split('/').pop()).replace(/^v2:/, '');
    const template = DEFAULT_STAGE_TEMPLATES[key];
    if (!template) return Promise.resolve(new Response(JSON.stringify({ error: 'Template not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    return Promise.resolve(new Response(JSON.stringify({ template: { stageKey: `v2:${key}`, dimensions: { version: 2, ...template.media }, content: template } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return originalFetch(url,options);
};
const ports=[{path:'COM7',serialNumber:'SIMULATED-ONLY',manufacturer:'QA fixture'}];
const jobs=[{id:'fixture-job-uncertain',state:'outcome uncertain',createdAt:'2026-10-05T08:00:00.000Z',profile,error:'Simulated timeout: check labels before reprinting'}];
window.glintexDesktop={getController:async()=>({version:'1.0.0-test',platform:'win32',capabilities:['printing','serial']}),settings:{get:async()=>({printer:profile}),update:async v=>v},server:{status:async()=>({state:'connected'})},scale:{status:async()=>({state:'unsupported',error:'Select a verified protocol. No scale connected.'}),enumerate:async()=>ports,onStatus:()=>()=>{},configure:async v=>v,diagnostics:async()=>[],capture:async()=>{throw Error('Unknown scale protocol; capture refused')}},printers:{status:async()=>({profile,available:true,pending:0}),enumerate:async()=>[{name:profile.printerName}],configure:async v=>v,listJobs:async()=>jobs,reprint:async()=>({success:false,error:'Simulated offline printer'}),submit:async()=>({success:false,error:'Simulated offline printer'})}};
createRoot(document.getElementById('editor')).render(<AuthProvider><UnsavedChangesProvider><MemoryRouter><LabelDesigner/></MemoryRouter></UnsavedChangesProvider></AuthProvider>);
// Synthetic helper outcomes only: this fixture never launches PowerShell.
let driverExit = 0, connected = false;
window.fixtureDisarmCalls = 0;
window.fixtureDelayDisarm = false;
window.fixtureDriverCalls = 0;
window.fixtureDriverOutcome = code => { driverExit = code; };
window.fixtureScaleConnected = value => { connected = value; };
window.glintexDesktop.getController = async () => ({ version: '1.1.1-fixture', scaleDriver: { available: true } });
let updateState = { state: 'current', installedVersion: '1.1.1', message: 'No newer version is available.' }, updateListener;
const setUpdate = values => { updateState = { ...updateState, ...values }; updateListener?.(updateState); return updateState; };
window.fixtureUpdate = setUpdate;
window.fixtureRetryCalls = 0;
window.fixtureDownloadCalls = 0;
window.fixtureUpdateFeedback = state => setUpdate({ state, release: null, prompt: true, message: ({current:'No newer version is available.',signin:'Sign in again to check private updates.',unavailable:'Private update hosting is unavailable.',error:'Could not check for updates. Check your connection and retry.'})[state] });
window.fixtureUpdateChoice = 0;
window.glintexDesktop.updates = {
  status: async () => updateState, onStatus: callback => { updateListener = callback; return () => { updateListener = null; }; },
  check: async () => setUpdate({ state: 'available', prompt: true, message: 'GLINTEX 1.1.2 is available.', release: { version: '1.1.2', publishedAt: '2026-10-05T00:00:00Z', notes: 'Simulated private update' } }),
  retry: async () => { window.fixtureRetryCalls++; return window.glintexDesktop.updates.check(); },
  download: async () => {
    window.fixtureDownloadCalls++;
    setUpdate({ state: 'downloading', progress: 0, message: 'Simulated download; no file downloaded.' });
    if (window.fixtureDelayDownload) return new Promise(resolve => { window.fixtureFinishDownload = () => resolve(setUpdate({ state: 'ready', progress: 100, message: 'Simulated installer verified; no file downloaded.' })); window.fixtureCancelDownload = () => resolve(updateState); });
    return setUpdate({ state: 'ready', message: 'Simulated installer verified; no file downloaded.' });
  },
  later: async () => setUpdate({ prompt: false }), cancel: async () => {
    // Native cancellation can return its pre-abort snapshot after the status event.
    const pending = { ...updateState };
    setUpdate({ state: 'available' }); window.fixtureCancelDownload?.();
    await Promise.resolve(); return pending;
  },
  arm: async () => { window.fixtureUpdateChoice++; return setUpdate({ state: 'armed', message: 'Update selected. Finish work, disconnect the scale, then close GLINTEX to install.' }); },
  disarm: async () => { window.fixtureDisarmCalls++; setUpdate({ state: 'ready', message: 'Cancelling installation choice…' }); if (window.fixtureDelayDisarm) await new Promise(resolve => { window.fixtureFinishDisarm = resolve; }); return setUpdate({ state: 'ready', message: 'Installation cancelled.' }); },
};
window.glintexDesktop.scale.status = async () => ({ state: connected ? 'connected' : 'unsupported', isConnected: connected, error: connected ? null : 'Select a verified protocol. No scale connected.' });
window.glintexDesktop.scale.driverSetup = async () => {
  window.fixtureDriverCalls++;
  return { success: driverExit === 0, installed: false, elevationRequested: false, packageDirectory: 'SIMULATED user profile/scale-driver/cache/verified-package', logPath: 'SIMULATED user profile/scale-driver/prepare.log', output: driverExit ? 'SIMULATED checksum verification failure; no driver changed' : 'SIMULATED package verified; no driver installed' };
};
createRoot(document.getElementById('panel')).render(<AuthProvider><DesktopWorkstation/></AuthProvider>);
const results=[];
async function run(){
 for(const [stage,template] of Object.entries(DEFAULT_STAGE_TEMPLATES)){
  const data=buildSampleData(stage,'typical');
  // The real browser support path: canvas measurement with the loaded fonts, embedded font files.
  const a=await buildPrintableArtifact(template,[data],{stageKey:stage,copies:1,dpi:203});
  const doc=artifactToDocument(a);
  if(a.version!==2||!a.fonts.length||!doc.includes('@page')) throw new Error(stage+': artifact is not a complete version 2 document');
  const section=document.createElement('section');section.className='label-card';
  section.innerHTML=`<h2>${stage}</h2><p>${a.widthMm} × ${a.heightMm} mm page · ${a.pages.length} page(s) · ${a.fonts.length} embedded fonts · 203 dpi · warnings: ${a.warnings.length?a.warnings.join('; '):'none'}</p>`;
  const host=document.createElement('div');section.append(host);document.getElementById('labels').append(section);
  createRoot(host).render(<LabelArtifactPreview artifact={a} maxWidthPx={360}/>);
  await new Promise(r=>setTimeout(r,50));
  await document.fonts.load("700 16px 'Inter'");
  if(!document.fonts.check("700 16px 'Inter'")) throw new Error('Bold Inter face is not loaded in the app: '+[...document.fonts].filter(f=>f.family.includes('Inter')).map(f=>`${f.family} ${f.weight} ${f.status}`).join(', '));
  await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:stage,version:a.version,dimensions:{widthMm:a.widthMm,heightMm:a.heightMm},pages:a.pages.length,fonts:a.fonts.length,warnings:a.warnings,documentBytes:doc.length,artifact:a})});
  results.push({stage,version:a.version,warnings:a.warnings,pages:a.pages.length,fonts:a.fonts.length});
 }
 const status=document.getElementById('results');status.textContent=JSON.stringify({completed:results.length,results});status.dataset.finished='true';
}
run().catch(e=>{document.getElementById('results').textContent='FAILED: '+(e&&(e.stack||e.message||e.name)||String(e));});
