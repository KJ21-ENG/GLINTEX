/**
 * Settings page with tabs
 */

import React, { useState, useEffect } from 'react';
import { useBrand } from '../context';
import { AdminData } from './AdminData.jsx';
import { Section, Button } from '../components';
import * as api from '../api';

export function Settings({ db, onSaveBrand, savingBrand, refreshDb }) {
  const { cls } = useBrand();
  const [tab, setTab] = useState('whatsapp'); // 'admin' | 'whatsapp'
  const [status, setStatus] = useState({ status: 'disconnected', initializing: true });
  const [qr, setQr] = useState(null);
  const [working, setWorking] = useState(false);
  const [primaryMobile, setPrimaryMobile] = useState('');
  const [savingNumber, setSavingNumber] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [originalTemplates, setOriginalTemplates] = useState({});
  const [savingTemplates, setSavingTemplates] = useState({});
  const [templateQuery, setTemplateQuery] = useState('');
  const [availableGroups, setAvailableGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]); // {id,name}
  const [groupQuery, setGroupQuery] = useState('');
  const [savingGroups, setSavingGroups] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const filteredTemplates = templates.filter(t => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) return true;
    return (t.event || '').toLowerCase().includes(q) || (t.template || '').toLowerCase().includes(q);
  });
  const [showTemplates, setShowTemplates] = useState(false);
  // helper to apply wrappers to current selection for a given event
  function wrapSelectedText(eventName, wrapType) {
    const sel = activeSelection;
    if (!sel || sel.event !== eventName || sel.end <= sel.start) return;
    const tpl = templates.find(x => x.event === eventName)?.template || '';
    const s = sel.start, e = sel.end;
    const selectedText = tpl.slice(s, e);
    let wrapped = selectedText;
    if (wrapType === 'bold') wrapped = `*${selectedText}*`;
    else if (wrapType === 'italic') wrapped = `_${selectedText}_`;
    else if (wrapType === 'strike') wrapped = `~${selectedText}~`;
    else if (wrapType === 'mono') wrapped = '```' + selectedText + '```';
    const next = tpl.slice(0, s) + wrapped + tpl.slice(e);
    setTemplates(prev => prev.map(x => x.event === eventName ? { ...x, template: next } : x));
    setActiveSelection({ event: null, start: 0, end: 0 });
  }
  const [activeSelection, setActiveSelection] = useState({ event: null, start: 0, end: 0 });

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const s = await api.whatsappStatus();
        if (!mounted) return;
        setStatus(s);
        if (s.status === 'qr') {
          const q = await api.whatsappQr();
          setQr(q.qr || null);
        } else {
          setQr(null);
        }
      } catch (err) {
        console.error(err);
      }
    }
    load();
    // load templates
    (async function loadTemplates(){
      setLoadingTemplates(true);
      try {
        const t = await api.listWhatsappTemplates();
        if (t) {
          setTemplates(t);
          const map = {};
          t.forEach(x => { map[x.event] = { template: x.template, enabled: !!x.enabled, sendToPrimary: x.sendToPrimary !== false, groupIds: Array.isArray(x.groupIds) ? x.groupIds : [] }; });
          setOriginalTemplates(map);
        }
      } catch(e) { console.error('failed to load templates', e); }
      setLoadingTemplates(false);
    })();
    // load groups when connected
    (async function loadGroups(){
      try {
        const st = await api.whatsappStatus();
        if (st && st.status === 'connected') {
          const groups = await api.whatsappGroups();
          setAvailableGroups(groups || []);
        } else {
          setAvailableGroups([]);
        }
      } catch (e) { /* ignore */ }
    })();
    // use SSE to receive real-time events
    const evtSrc = new EventSource(`${window.location.protocol}//${window.location.hostname}:4000/api/whatsapp/events`);
    evtSrc.addEventListener('status', (ev) => { try { const d = JSON.parse(ev.data); setStatus(d); } catch(e){} });
    evtSrc.addEventListener('qr', (ev) => { try { const d = JSON.parse(ev.data); setQr(d.qr); } catch(e){} });
    const iv = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // Reload groups whenever whatsapp connection status changes so we have names for stored ids
  useEffect(() => {
    if (status && status.status === 'connected') {
      (async function refreshGroups() {
        try {
          const groups = await api.whatsappGroups();
          setAvailableGroups(groups || []);
        } catch (e) {
          console.error('failed to refresh groups', e);
        }
      })();
    } else {
      setAvailableGroups([]);
    }
  }, [status && status.status]);

  useEffect(() => {
    const num = db?.settings?.[0]?.whatsappNumber || '';
    // Show number to user without leading country code (91) so they enter 10-digit local number
    const display = num ? String(num).replace(/^91/, '') : '';
    setPrimaryMobile(display);
  }, [db]);

  useEffect(() => {
    const ids = Array.isArray(db?.settings?.[0]?.whatsappGroupIds) ? db.settings[0].whatsappGroupIds : [];
    setSelectedGroupIds(ids);
    // build selectedGroups with names if available
    setSelectedGroups(ids.map(id => {
      const g = availableGroups.find(x => x.id === id);
      return { id, name: g ? g.name : id };
    }));
    setGroupsDirty(false);
  }, [db]);

  const filteredGroups = (() => {
    const q = groupQuery.trim().toLowerCase();
    const pool = availableGroups.filter(g => !selectedGroupIds.includes(g.id));
    if (!q) return pool.slice(0, 15);
    return pool.filter(g => (g.name || '').toLowerCase().includes(q)).slice(0, 15);
  })();

  function addGroup(id) {
    if (!id) return;
    if (selectedGroupIds.includes(id)) return;
    const g = availableGroups.find(x => x.id === id);
    setSelectedGroupIds(prev => [...prev, id]);
    setSelectedGroups(prev => [...prev, { id, name: g ? g.name : id }]);
    setGroupsDirty(true);
    setGroupQuery('');
  }

  function removeGroup(id) {
    setSelectedGroupIds(prev => prev.filter(x => x !== id));
    setSelectedGroups(prev => prev.filter(x => x.id !== id));
    setGroupsDirty(true);
  }

  // keep selectedGroups in sync when availableGroups updates (resolve any unknown names)
  useEffect(() => {
    if (!availableGroups || availableGroups.length === 0) return;
    setSelectedGroups(prev => prev.map(sg => {
      if (sg.name && sg.name !== sg.id) return sg; // already resolved
      const g = availableGroups.find(x => x.id === sg.id);
      return g ? { id: sg.id, name: g.name } : sg;
    }));
  }, [availableGroups]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => setTab('whatsapp')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='whatsapp' ? cls.navActive : 'border-transparent'} ${tab!=='whatsapp' ? cls.navHover : ''}`}>
          Whatsapp Settings
        </button>
        <button onClick={() => setTab('admin')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='admin' ? cls.navActive : 'border-transparent'} ${tab!=='admin' ? cls.navHover : ''}`}>
          Admin / data
        </button>
      </div>

      <Section title={tab === 'admin' ? 'Admin / data' : 'Whatsapp Settings'}>
        {tab === 'admin' ? (
          <AdminData db={db} onSaveBrand={onSaveBrand} savingBrand={savingBrand} />
        ) : (
          <div className={`p-6 rounded-md border ${cls.cardBorder} ${cls.cardBg}`}>
            <div className="space-y-3">
              <div className={`${cls.muted}`}>Status: <strong className={status.status === 'connected' ? 'whatsapp-status-connected' : (status.status === 'disconnected' ? 'whatsapp-status-disconnected' : '')}>{status.status}</strong></div>
              {qr && (
                <div>
                  <div className="text-xs text-muted mb-1">Scan QR with WhatsApp</div>
                  <img src={qr} alt="whatsapp-qr" className="mx-auto" />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={`text-xs ${cls.muted}`}>Primary Mobile (no country code)</label>
                  <input
                    value={primaryMobile}
                    onChange={e => {
                      // allow only digits while typing
                      const digitsOnly = e.target.value.replace(/\D/g, '');
                      setPrimaryMobile(digitsOnly);
                    }}
                    className={`w-full px-3 py-2 rounded border ${cls.cardBorder} ${cls.cardBg}`}
                    placeholder="eg. 6353131826"
                  />
                  <div className="mt-1">
                    {primaryMobile && primaryMobile.replace(/\D/g, '').length < 10 && (
                      <div className="text-xs text-red-500">Enter at least 10 digits (do not include country code)</div>
                    )}
                  </div>
                </div>
                <div>
                  <label className={`text-xs ${cls.muted}`}>Allowed Groups (search and add)</label>
                  <div className="mt-1">
                    <input
                      value={groupQuery}
                      onChange={e => setGroupQuery(e.target.value)}
                      placeholder={status.status === 'connected' ? 'Search groups…' : 'Connect WhatsApp to load groups'}
                      disabled={status.status !== 'connected'}
                      className={`w-full px-3 py-2 rounded border ${cls.cardBorder} ${cls.cardBg}`}
                    />
                    {status.status === 'connected' && groupQuery && (
                      <div className={`mt-1 max-h-40 overflow-auto rounded border ${cls.cardBorder} ${cls.cardBg}`}>
                        {filteredGroups.length > 0 ? filteredGroups.map(g => (
                          <button key={g.id} type="button" onClick={() => addGroup(g.id)} className={`w-full text-left px-3 py-2 hover:bg-black/10`}>{g.name}</button>
                        )) : (
                          <div className="px-3 py-2 text-xs text-muted">No matches</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <div className="text-xs mb-1">Selected groups</div>
                    <div className="p-2 rounded border max-h-40 overflow-auto">
                      {selectedGroups.length === 0 ? (
                        <div className="text-xs text-muted">None selected</div>
                      ) : (
                        selectedGroups.map(sg => (
                          <div key={sg.id} className={`flex items-center justify-between rounded px-2 py-1 mb-1 border ${cls.cardBorder} ${cls.cardBg}`}>
                            <span className="truncate mr-2">{sg.name || sg.id}</span>
                            <button type="button" onClick={() => removeGroup(sg.id)} className="text-xs opacity-70 hover:opacity-100">Remove</button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button onClick={async () => { setSavingGroups(true); try { await api.updateSettings({ whatsappGroupIds: selectedGroupIds }); await refreshDb(); setGroupsDirty(false); } catch (err) { alert(err.message || 'Failed'); } finally { setSavingGroups(false); } }} disabled={savingGroups || !groupsDirty}>{savingGroups ? 'Saving…' : 'Save Groups'}</Button>
                    {!groupsDirty ? <div className="text-xs text-muted">Up to date</div> : null}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    onClick={async () => {
                      setSavingNumber(true);
                      try {
                        await api.updateSettings({ whatsappNumber: primaryMobile });
                        await refreshDb();
                        alert('Saved');
                      } catch (err) {
                        alert(err.message || 'Failed');
                      } finally {
                        setSavingNumber(false);
                      }
                    }}
                    disabled={savingNumber || (primaryMobile.replace(/\D/g, '').length < 10)}
                  >
                    {savingNumber ? 'Saving…' : 'Save Number'}
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={async () => { setWorking(true); try { await api.whatsappStart(); const q = await api.whatsappQr(); setQr(q.qr || null); } finally { setWorking(false); } }} disabled={working}>{working ? 'Starting…' : 'Start login'}</Button>
                  <Button onClick={async () => { setWorking(true); try { await api.whatsappLogout(); setQr(null); setStatus({ status: 'disconnected' }); } finally { setWorking(false); } }} disabled={working}>{working ? 'Logging out…' : 'Logout'}</Button>
                  <Button onClick={async () => { setWorking(true); try { const num = primaryMobile || '916353131826'; await api.whatsappSendTest(num); alert('Test sent'); } finally { setWorking(false); } }} disabled={working}>{working ? 'Sending…' : 'Send Test'}</Button>
                </div>
              </div>
              <div className="mt-4 whatsapp-templates">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">WhatsApp Templates</div>
                    <button
                      type="button"
                      onClick={() => setShowTemplates(v => !v)}
                      aria-expanded={showTemplates}
                      title={showTemplates ? 'Collapse templates' : 'Expand templates'}
                      className={`w-8 h-8 rounded-md flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ${cls.navHover}`}
                    >
                      <svg className={`w-4 h-4 transition-transform ${showTemplates ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <input value={templateQuery} onChange={e => setTemplateQuery(e.target.value)} placeholder="Search templates" className={`px-3 py-1 rounded border ${cls.cardBorder} ${cls.cardBg} ${cls.text}`} />
                    <div className="text-sm text-muted">{filteredTemplates.length} templates</div>
                  </div>
                </div>
                {showTemplates && (
                  loadingTemplates ? <div className="text-sm">Loading templates…</div> : (
                    <div className="space-y-3">
                      {filteredTemplates.map(t => (
                        <div key={t.event} className={`p-3 rounded-md border ${cls.cardBorder} ${cls.cardBg}`}>
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <div className="font-medium flex items-center gap-3">
                                  <div>{t.event}</div>
                                  { (activeSelection.event === t.event && activeSelection.end > activeSelection.start) ? (
                                    <div className="flex items-center gap-1">
                                      <button title="Bold" aria-label="Bold" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'bold')} className={`px-2 py-1 rounded ${cls.cardBorder} ${cls.cardBg}`}>B</button>
                                      <button title="Italic" aria-label="Italic" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'italic')} className={`px-2 py-1 rounded ${cls.cardBorder} ${cls.cardBg}`}>I</button>
                                      <button title="Strikethrough" aria-label="Strikethrough" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'strike')} className={`px-2 py-1 rounded ${cls.cardBorder} ${cls.cardBg}`}>S</button>
                                      <button title="Monospace" aria-label="Monospace" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'mono')} className={`px-2 py-1 rounded ${cls.cardBorder} ${cls.cardBg}`}>M</button>
                                    </div>
                                  ) : null }
                                </div>
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={t.enabled} onChange={(e) => { const next = { ...t, enabled: e.target.checked }; setTemplates(prev => prev.map(x=> x.event===t.event? next : x)); }} />
                                  <span className="text-xs">Enabled</span>
                                </label>
                              </div>
                              <div>
                                <textarea
                                  className={`w-full mt-2 p-3 rounded border ${cls.cardBorder} ${cls.cardBg} ${cls.text} min-h-[84px]`}
                                  value={t.template}
                                  onChange={(e)=> setTemplates(prev => prev.map(x=> x.event===t.event? { ...x, template: e.target.value } : x))}
                                  rows={4}
                                  onSelect={(e)=>{ const s = e.target.selectionStart; const epos = e.target.selectionEnd; setActiveSelection({ event: t.event, start: s, end: epos }); }}
                                  onKeyUp={(e)=>{ const s = e.target.selectionStart; const epos = e.target.selectionEnd; setActiveSelection({ event: t.event, start: s, end: epos }); }}
                                />
                                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={t.sendToPrimary !== false} onChange={(e) => { const next = { ...t, sendToPrimary: e.target.checked }; setTemplates(prev => prev.map(x=> x.event===t.event? next : x)); }} />
                                    <span className="text-xs">Send to primary mobile</span>
                                  </label>
                                  <div>
                                    <div className="text-xs mb-1">Send to groups</div>
                                    <div className="p-2 rounded border max-h-32 overflow-auto">
                                      {(() => {
                                        const allowed = Array.isArray(db?.settings?.[0]?.whatsappGroupIds) ? db.settings[0].whatsappGroupIds : [];
                                        const options = availableGroups.filter(g => allowed.includes(g.id));
                                        if (options.length === 0) return <div className="text-xs text-muted">Select groups in settings above</div>;
                                        const selected = Array.isArray(t.groupIds) ? t.groupIds : [];
                                        return options.map(g => {
                                          const checked = selected.includes(g.id);
                                          return (
                                            <label key={g.id} className="flex items-center gap-2 text-sm block">
                                              <input type="checkbox" checked={checked} onChange={(e)=>{
                                                const prev = Array.isArray(t.groupIds) ? t.groupIds : [];
                                                const next = e.target.checked ? Array.from(new Set([...prev, g.id])) : prev.filter(x => x !== g.id);
                                                setTemplates(prev => prev.map(x=> x.event===t.event? { ...x, groupIds: next } : x));
                                              }} />
                                              <span>{g.name}</span>
                                            </label>
                                          );
                                        });
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              { (originalTemplates[t.event] && (originalTemplates[t.event].template !== t.template || originalTemplates[t.event].enabled !== t.enabled || (t.sendToPrimary !== (originalTemplates[t.event].sendToPrimary ?? true)) || JSON.stringify(t.groupIds||[]) !== JSON.stringify(originalTemplates[t.event].groupIds||[]))) ? (
                                <>
                                  <div className="flex flex-col gap-2">
                                    <Button onClick={async ()=>{ setSavingTemplates(prev=>({ ...prev, [t.event]: true })); try { await api.updateWhatsappTemplate(t.event, { enabled: t.enabled, template: t.template, sendToPrimary: t.sendToPrimary !== false, groupIds: Array.isArray(t.groupIds)? t.groupIds: [] }); setOriginalTemplates(prev=>({ ...prev, [t.event]: { template: t.template, enabled: !!t.enabled, sendToPrimary: t.sendToPrimary !== false, groupIds: Array.isArray(t.groupIds)? t.groupIds: [] } })); alert('Saved'); } catch (err) { alert(err.message || 'Failed'); } finally { setSavingTemplates(prev=>({ ...prev, [t.event]: false })); } }} disabled={!!savingTemplates[t.event]}>{ savingTemplates[t.event] ? 'Saving…' : 'Save' }</Button>
                                    <Button onClick={async ()=>{ setTemplates(prev=> prev.map(x=> x.event === t.event ? { ...x, template: originalTemplates[t.event].template, enabled: originalTemplates[t.event].enabled, sendToPrimary: (originalTemplates[t.event].sendToPrimary ?? true), groupIds: Array.isArray(originalTemplates[t.event].groupIds)? originalTemplates[t.event].groupIds: [] } : x )); }} className="border">Cancel</Button>
                                  </div>
                                </>
                              ) : null }
                              <Button onClick={async ()=>{ try { await api.sendWhatsappEvent(t.event, { sample: true }); alert('Sent test'); } catch(err){ alert(err.message || 'Failed'); } }}>Test</Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default Settings;


