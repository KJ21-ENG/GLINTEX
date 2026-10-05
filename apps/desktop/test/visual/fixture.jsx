import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LabelDesigner from '../../../frontend/src/pages/Settings/LabelDesigner';
import '@fontsource/inter';
import '@fontsource/roboto-mono';
import '@fontsource/ibm-plex-sans';
import { DEFAULT_STAGE_TEMPLATES } from '../../../frontend/src/utils/labelPrint';
import { buildPrintableArtifact, renderLabelToCanvas } from '../../../frontend/src/utils/labelBitmap';
import DesktopWorkstation from '../../../frontend/src/components/common/DesktopWorkstation';
import { AuthProvider } from '../../../frontend/src/context/AuthContext';
let profile={printerName:'Fixture TSC TE244',dpi:203};
window.fixtureSetDpi = dpi => { profile = { ...profile, dpi }; window.dispatchEvent(new CustomEvent('glintex:printer-profile-changed', {detail:profile})); };
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
  const parsed = new URL(String(url), location.href);
  if (parsed.origin === location.origin && parsed.pathname.startsWith('/api/sticker_templates/')) return Promise.resolve(new Response(JSON.stringify({template:DEFAULT_STAGE_TEMPLATES[decodeURIComponent(parsed.pathname.split('/').pop())]}), {status:200,headers:{'Content-Type':'application/json'}}));
  return originalFetch(url,options);
};
const ports=[{path:'COM7',serialNumber:'SIMULATED-ONLY',manufacturer:'QA fixture'}];
const jobs=[{id:'fixture-job-uncertain',state:'outcome uncertain',createdAt:'2026-10-05T08:00:00.000Z',profile,error:'Simulated timeout: check labels before reprinting'}];
window.glintexDesktop={getController:async()=>({version:'1.0.0-test',platform:'win32',capabilities:['printing','serial']}),settings:{get:async()=>({printer:profile}),update:async v=>v},server:{status:async()=>({state:'connected'})},scale:{status:async()=>({state:'unsupported',error:'Select a verified protocol. No scale connected.'}),enumerate:async()=>ports,onStatus:()=>()=>{},configure:async v=>v,diagnostics:async()=>[],capture:async()=>{throw Error('Unknown scale protocol; capture refused')}},printers:{status:async()=>({profile,available:true,pending:0}),enumerate:async()=>[{name:profile.printerName}],configure:async v=>v,listJobs:async()=>jobs,reprint:async()=>({success:false,error:'Simulated offline printer'}),submit:async()=>({success:false,error:'Simulated offline printer'})}};
createRoot(document.getElementById('editor')).render(<MemoryRouter><LabelDesigner/></MemoryRouter>);
// Synthetic helper outcomes only: this fixture never launches PowerShell.
let driverExit = 0, connected = false;
window.fixtureDriverCalls = 0;
window.fixtureDriverOutcome = code => { driverExit = code; };
window.fixtureScaleConnected = value => { connected = value; };
window.glintexDesktop.getController = async () => ({ version: '1.0.1-fixture', scaleDriver: { available: true } });
window.glintexDesktop.scale.status = async () => ({ state: connected ? 'connected' : 'unsupported', isConnected: connected, error: connected ? null : 'Select a verified protocol. No scale connected.' });
window.glintexDesktop.scale.driverSetup = async () => {
  window.fixtureDriverCalls++;
  return { success: driverExit === 0 || driverExit === 3010, exitCode: driverExit, restartRequired: driverExit === 3010, logPath: 'SIMULATED user profile/scale-driver/setup.log', output: driverExit === 1 ? 'SIMULATED verification failure or UAC cancellation' : 'SIMULATED healthy driver retained; actual port COM7' };
};
createRoot(document.getElementById('panel')).render(<AuthProvider><DesktopWorkstation/></AuthProvider>);
const results=[];
const data={barcode:'RCO-123456-C001',lotNo:'123456',seq:'0001',pieceId:'123456-0001',itemName:'POLYESTER METALLIC SILVER EXTRA LONG MATERIAL NAME',firmName:'GLINTEX',operatorName:'REPRESENTATIVE OPERATOR',machineName:'MACHINE 007',netWeight:'12.345',grossWeight:'13.000',tareWeight:'0.655',weight:'12.345',totalWeight:'24.690',date:'2026-10-05',cut:'1/64',twist:'120',yarnName:'POLYESTER',coneCount:'6',rollCount:'2',shift:'DAY'};
async function run(){
 for(const [stage,template] of Object.entries(DEFAULT_STAGE_TEMPLATES)){
  const a=await buildPrintableArtifact(template,[data],{stageKey:stage,copies:1,dpi:203});
  const img=new Image();img.src=a.pages[0].pngDataUrl;await img.decode();
  const full=document.createElement('canvas');full.width=img.width;full.height=img.height;full.getContext('2d').drawImage(img,0,0);
  const p=renderLabelToCanvas(template,data,{stageKey:stage,pixelsPerMm:203/25.4,preserveColor:false,printerMode:true});
  const preview=p.canvas.getContext('2d').getImageData(0,0,p.canvas.width,p.canvas.height).data;
  const printed=full.getContext('2d').getImageData(Math.round((template.dimensions.marginLeft||0)*203/25.4),Math.round((template.dimensions.marginTop||0)*203/25.4),p.canvas.width,p.canvas.height).data;
  let different=0;for(let i=0;i<preview.length;i++)if(preview[i]!==printed[i])different++;
  const section=document.createElement('section');section.className='label-card';section.innerHTML=`<h2>${stage}</h2><p>${a.widthMm} × ${a.heightMm} mm / ${img.width} × ${img.height} pixels / 203 dpi / differing bytes: ${different}</p>`;img.style.width=Math.round(a.widthMm*3.78)+'px';img.alt=stage+' canonical print artifact';section.append(img);document.getElementById('labels').append(section);
  await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:stage,png:a.pages[0].pngDataUrl,dimensions:{widthMm:a.widthMm,heightMm:a.heightMm,widthPx:img.naturalWidth,heightPx:img.naturalHeight},different})});
  results.push({stage,different,width:img.naturalWidth,height:img.naturalHeight});
 }
 const status=document.getElementById('results');status.textContent=JSON.stringify({completed:results.length,results});status.dataset.finished='true';
}
run().catch(e=>{document.getElementById('results').textContent='FAILED: '+e.stack;});
