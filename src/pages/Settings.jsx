/**
 * Settings page with tabs
 * UI/UX refined for the "WhatsApp" tab — behavior unchanged.
 * This revision makes Message Templates render as responsive tiles (multi-column).
 */

import React, { useState, useEffect } from 'react';
import { useBrand } from '../context';
import { AdminData } from './AdminData.jsx';
import { Section, Button } from '../components';
import * as api from '../api';

// ---------- Small UI helpers (no new deps) ----------
function Divider({ className = '' }) {
  return <div className={`h-px w-full my-4 opacity-50 ${className}`} style={{ background: 'currentColor', opacity: 0.08 }} />;
}

function Badge({ tone = 'default', children }) {
  const toneCls =
    tone === 'success'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
      : tone === 'warn'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
      : tone === 'danger'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
      : 'bg-black/5 dark:bg-white/5 text-[color:inherit] border-black/10 dark:border-white/10';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium ${toneCls}`}>
      {children}
    </span>
  );
}

function Label({ children, hint, className = '' }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-xs opacity-70">{children}</span>
      {hint ? <span className="text-[11px] opacity-60 mt-0.5">{hint}</span> : null}
    </div>
  );
}

export function Settings({ db, onSaveBrand, savingBrand, refreshDb }) {
  const { cls } = useBrand();
  const [tab, setTab] = useState('whatsapp'); // 'admin' | 'whatsapp'

  // WhatsApp connection + QR
  const [status, setStatus] = useState({ status: 'disconnected', initializing: true });
  const [qr, setQr] = useState(null);
  const [working, setWorking] = useState(false);

  // Primary mobile
  const [primaryMobile, setPrimaryMobile] = useState('');
  const [savingNumber, setSavingNumber] = useState(false);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [originalTemplates, setOriginalTemplates] = useState({});
  const [savingTemplates, setSavingTemplates] = useState({});
  const [templateQuery, setTemplateQuery] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [activeSelection, setActiveSelection] = useState({ event: null, start: 0, end: 0 });
  const [editingGroupsFor, setEditingGroupsFor] = useState(null);

  // Groups
  const [availableGroups, setAvailableGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]); // {id,name}
  const [groupQuery, setGroupQuery] = useState('');
  const [savingGroups, setSavingGroups] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);

  const isConnected = status?.status === 'connected';
  const filteredTemplates = templates.filter(t => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) return true;
    return (t.event || '').toLowerCase().includes(q) || (t.template || '').toLowerCase().includes(q);
  });

  // helper to apply wrappers to current selection for a given event (unchanged behavior)
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

  // -------- Lifecycle & data loading (behavior preserved) --------
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
    // Show number without leading country code (91)
    const display = num ? String(num).replace(/^91/, '') : '';
    setPrimaryMobile(display);
  }, [db]);

  useEffect(() => {
    const ids = Array.isArray(db?.settings?.[0]?.whatsappGroupIds) ? db.settings[0].whatsappGroupIds : [];
    setSelectedGroupIds(ids);
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

  // Keep selectedGroups in sync when availableGroups updates
  useEffect(() => {
    if (!availableGroups || availableGroups.length === 0) return;
    setSelectedGroups(prev => prev.map(sg => {
      if (sg.name && sg.name !== sg.id) return sg;
      const g = availableGroups.find(x => x.id === sg.id);
      return g ? { id: sg.id, name: g.name } : sg;
    }));
  }, [availableGroups]);

  // ----------- UI -----------
  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('whatsapp')}
          className={`px-3 py-1 rounded-lg text-sm border ${tab==='whatsapp' ? cls.navActive : 'border-transparent'} ${tab!=='whatsapp' ? cls.navHover : ''}`}
        >
          WhatsApp
        </button>
        <button
          onClick={() => setTab('admin')}
          className={`px-3 py-1 rounded-lg text-sm border ${tab==='admin' ? cls.navActive : 'border-transparent'} ${tab!=='admin' ? cls.navHover : ''}`}
        >
          Admin / Data
        </button>
      </div>

      <Section title={tab === 'admin' ? 'Admin / Data' : 'WhatsApp Settings'}>
        {tab === 'admin' ? (
          <AdminData db={db} onSaveBrand={onSaveBrand} savingBrand={savingBrand} />
        ) : (
          <div className={`p-6 rounded-md border ${cls.cardBorder} ${cls.cardBg} space-y-6`}>
            {/* Header: Connection status & quick actions */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-medium">Connection</span>
                {isConnected ? (
                  <Badge tone="success">Connected</Badge>
                ) : status?.status === 'qr' ? (
                  <Badge tone="warn">Awaiting Scan</Badge>
                ) : (
                  <Badge tone="danger">Disconnected</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={async () => {
                    setWorking(true);
                    try {
                      await api.whatsappStart();
                      const q = await api.whatsappQr();
                      setQr(q.qr || null);
                    } finally {
                      setWorking(false);
                    }
                  }}
                  disabled={working}
                  className="text-xs px-2 py-1"
                >
                  {working ? 'Starting…' : (isConnected ? 'Refresh Login' : 'Start Login')}
                </Button>
                <Button
                  onClick={async () => {
                    setWorking(true);
                    try {
                      await api.whatsappLogout();
                      setQr(null);
                      setStatus({ status: 'disconnected' });
                    } finally {
                      setWorking(false);
                    }
                  }}
                  disabled={working}
                  className="text-xs px-2 py-1"
                >
                  {working ? 'Logging out…' : 'Logout'}
                </Button>
                <Button
                  onClick={async () => {
                    setWorking(true);
                    try {
                      const num = primaryMobile || '916353131826';
                      await api.whatsappSendTest(num);
                      alert('Test sent');
                    } finally {
                      setWorking(false);
                    }
                  }}
                  disabled={working}
                  className="text-xs px-2 py-1"
                >
                  {working ? 'Sending…' : 'Send Test'}
                </Button>
              </div>
            </div>

            {/* QR */}
            {qr ? (
              <div className={`p-3 rounded-md border ${cls.cardBorder} ${cls.cardBg} transform transition-transform duration-150 hover:-translate-y-1 hover:shadow-lg`}>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium">Scan to Link WhatsApp</span>
                    <span className="text-xs opacity-70 mt-1">Open WhatsApp → Linked Devices → Link a device</span>
                  </div>
                  <Badge tone="warn">QR Active</Badge>
                </div>
                <div className="mt-2 grid place-items-center">
                  <img src={qr} alt="WhatsApp QR" className="max-h-52 rounded-md" />
                </div>
              </div>
            ) : null}

            <Divider />

            {/* Grid: Number + Groups */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Primary Mobile */}
              <div className={`p-3 rounded-md border ${cls.cardBorder} ${cls.cardBg} transform transition-transform duration-150 hover:-translate-y-1 hover:shadow-lg`}>
                <Label hint="10-digit local number without country code (e.g., 9876543210)">Primary Mobile</Label>
                <input
                  value={primaryMobile}
                  onChange={e => {
                    const digitsOnly = e.target.value.replace(/\D/g, '');
                    setPrimaryMobile(digitsOnly);
                  }}
                  className={`w-full px-3 py-2 mt-2 rounded border ${cls.cardBorder} ${cls.cardBg}`}
                  placeholder="e.g., 6353131826"
                  aria-label="Primary WhatsApp mobile number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
                <div className="mt-1 min-h-[16px]">
                  {primaryMobile && primaryMobile.replace(/\D/g, '').length < 10 ? (
                    <div className="text-[11px] text-red-500">Enter at least 10 digits — do not include country code</div>
                  ) : (
                    <div className="text-[11px] opacity-60">This number receives direct notifications (if enabled per template).</div>
                  )}
                </div>
                <div className="mt-1">
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
                    className="text-xs px-2 py-1"
                  >
                    {savingNumber ? 'Saving…' : 'Save Number'}
                  </Button>
                </div>
              </div>

              {/* Groups */}
              <div className={`lg:col-span-2 p-3 rounded-md border ${cls.cardBorder} ${cls.cardBg}`}>
                <div className="flex items-center justify-between">
                  <Label hint={isConnected ? 'Search and add WhatsApp groups' : 'Connect WhatsApp to load groups'}>Allowed Groups</Label>
                </div>

                <div className="mt-1 grid gap-2">
                  <input
                    value={groupQuery}
                    onChange={e => setGroupQuery(e.target.value)}
                    placeholder={isConnected ? 'Search groups…' : 'Connect WhatsApp to load groups'}
                    disabled={!isConnected}
                    className={`w-full px-3 py-2 rounded border ${cls.cardBorder} ${cls.cardBg}`}
                    aria-label="Search groups"
                  />
                  {isConnected && groupQuery && (
                    <div className={`mt-1 max-h-40 overflow-auto rounded border ${cls.cardBorder} ${cls.cardBg}`} role="listbox" aria-label="Matching groups">
                      {filteredGroups.length > 0 ? (
                        filteredGroups.map(g => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => addGroup(g.id)}
                            className="w-full text-left px-3 py-2 hover:bg-black/10"
                            role="option"
                          >
                            {g.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-xs opacity-60">No matches</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-2">
                  <div className="text-xs mb-1 opacity-70">Selected</div>
                  <div className={`p-2 rounded border max-h-36 overflow-auto ${cls.cardBorder} ${cls.cardBg}`}>
                    {selectedGroups.length === 0 ? (
                      <div className="text-xs opacity-60">No groups selected yet</div>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-1">
                        {selectedGroups.map(sg => (
                          <div key={sg.id} className={`flex items-center justify-between rounded px-2 py-1 border ${cls.cardBorder} ${cls.cardBg}`}>
                            <span className="truncate mr-2">{sg.name || sg.id}</span>
                            <button
                              type="button"
                              onClick={() => removeGroup(sg.id)}
                              className="text-[11px] opacity-70 hover:opacity-100 underline"
                              aria-label={`Remove ${sg.name || sg.id}`}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2">
                    <Button
                      onClick={async () => {
                        setSavingGroups(true);
                        try {
                          await api.updateSettings({ whatsappGroupIds: selectedGroupIds });
                          await refreshDb();
                          setGroupsDirty(false);
                        } catch (err) {
                          alert(err.message || 'Failed');
                        } finally {
                          setSavingGroups(false);
                        }
                      }}
                      disabled={savingGroups || !groupsDirty}
                      className="text-xs px-2 py-1"
                    >
                      {savingGroups ? 'Saving…' : 'Save Groups'}
                    </Button>
                    {!groupsDirty ? <div className="text-xs opacity-60">Up to date</div> : null}
                  </div>
                </div>
              </div>
            </div>

            <Divider />

            {/* Templates as responsive tiles */}
            <div className="whatsapp-templates">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="font-medium">Message Templates</div>
                  <button
                    type="button"
                    onClick={() => setShowTemplates(v => !v)}
                    aria-expanded={showTemplates}
                    title={showTemplates ? 'Collapse templates' : 'Expand templates'}
                    className={`w-7 h-7 rounded-md flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ${cls.navHover}`}
                  >
                    <svg className={`w-4 h-4 transition-transform ${showTemplates ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={templateQuery}
                    onChange={e => setTemplateQuery(e.target.value)}
                    placeholder="Search templates"
                    className={`px-3 py-1.5 rounded border text-sm ${cls.cardBorder} ${cls.cardBg}`}
                    aria-label="Search templates"
                  />
                  <div className="text-xs opacity-70">{filteredTemplates.length} templates</div>
                </div>
              </div>

              {showTemplates && (
                loadingTemplates ? (
                  <div className="text-sm">Loading templates…</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-3 gap-3">
                    {filteredTemplates.map(t => {
                      const isDirty =
                        originalTemplates[t.event] &&
                        (originalTemplates[t.event].template !== t.template ||
                          originalTemplates[t.event].enabled !== t.enabled ||
                          (t.sendToPrimary !== (originalTemplates[t.event].sendToPrimary ?? true)) ||
                          JSON.stringify(t.groupIds||[]) !== JSON.stringify(originalTemplates[t.event].groupIds||[]));

                      return (
                        <div key={t.event} className={`p-3 rounded-md border ${cls.cardBorder} ${cls.cardBg} flex flex-col transform transition-transform duration-150 hover:-translate-y-1 hover:shadow-lg` }>
                          {/* Header row */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium truncate" title={t.event}>{t.event}</div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isDirty && (
                                <>
                                  <Button
                                    onClick={async ()=>{
                                      setSavingTemplates(prev=>({ ...prev, [t.event]: true }));
                                      try {
                                        await api.updateWhatsappTemplate(t.event, {
                                          enabled: t.enabled,
                                          template: t.template,
                                          sendToPrimary: t.sendToPrimary !== false,
                                          groupIds: Array.isArray(t.groupIds)? t.groupIds: []
                                        });
                                        setOriginalTemplates(prev=>({ ...prev, [t.event]: {
                                          template: t.template,
                                          enabled: !!t.enabled,
                                          sendToPrimary: t.sendToPrimary !== false,
                                          groupIds: Array.isArray(t.groupIds)? t.groupIds: []
                                        }}));
                                        alert('Saved');
                                      } catch (err) {
                                        alert(err.message || 'Failed');
                                      } finally {
                                        setSavingTemplates(prev=>({ ...prev, [t.event]: false }));
                                      }
                                    }}
                                    disabled={!!savingTemplates[t.event]}
                                    className="text-[11px] px-2 py-1"
                                    title="Save changes"
                                  >
                                    { savingTemplates[t.event] ? 'Saving…' : 'Save' }
                                  </Button>
                                  <button
                                    type="button"
                                    onClick={()=>{
                                      setTemplates(prev=> prev.map(x=> x.event === t.event ? {
                                        ...x,
                                        template: originalTemplates[t.event].template,
                                        enabled: originalTemplates[t.event].enabled,
                                        sendToPrimary: (originalTemplates[t.event].sendToPrimary ?? true),
                                        groupIds: Array.isArray(originalTemplates[t.event].groupIds)? originalTemplates[t.event].groupIds: []
                                      } : x ));
                                    }}
                                    className="text-[11px] opacity-75 hover:opacity-100 underline"
                                    title="Discard changes"
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={async ()=>{
                                  try {
                                    await api.sendWhatsappEvent(t.event, { sample: true });
                                    alert('Sent test');
                                  } catch(err){
                                    alert(err.message || 'Failed');
                                  }
                                }}
                                className="text-[11px] opacity-75 hover:opacity-100 underline"
                                title="Send test message"
                              >
                                Test
                              </button>
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  checked={t.enabled}
                                  onChange={(e) => {
                                    const next = { ...t, enabled: e.target.checked };
                                    setTemplates(prev => prev.map(x=> x.event===t.event? next : x));
                                  }}
                                />
                                <span className="opacity-80">Enabled</span>
                              </label>
                            </div>
                          </div>

                          {/* Formatting mini-bar shows only when text is selected */}
                          {(activeSelection.event === t.event && activeSelection.end > activeSelection.start) ? (
                            <div className="mt-2 flex items-center gap-1">
                              <button title="Bold" aria-label="Bold" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'bold')} className={`px-1.5 py-0.5 rounded border text-xs ${cls.cardBorder} ${cls.cardBg}`}>B</button>
                              <button title="Italic" aria-label="Italic" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'italic')} className={`px-1.5 py-0.5 rounded border text-xs ${cls.cardBorder} ${cls.cardBg}`}>I</button>
                              <button title="Strikethrough" aria-label="Strikethrough" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'strike')} className={`px-1.5 py-0.5 rounded border text-xs ${cls.cardBorder} ${cls.cardBg}`}>S</button>
                              <button title="Monospace" aria-label="Monospace" onMouseDown={e=>e.preventDefault()} onClick={()=>wrapSelectedText(t.event,'mono')} className={`px-1.5 py-0.5 rounded border text-xs ${cls.cardBorder} ${cls.cardBg}`}>M</button>
                            </div>
                          ) : null}

                          {/* Editor */}
                          <textarea
                            className={`w-full mt-2 p-2 rounded border text-sm leading-5 ${cls.cardBorder} ${cls.cardBg} ${cls.text} min-h-[68px]`}
                            value={t.template}
                            onChange={(e)=> setTemplates(prev => prev.map(x=> x.event===t.event? { ...x, template: e.target.value } : x))}
                            rows={4}
                            onSelect={(e)=>{ const s = e.target.selectionStart; const epos = e.target.selectionEnd; setActiveSelection({ event: t.event, start: s, end: epos }); }}
                            onKeyUp={(e)=>{ const s = e.target.selectionStart; const epos = e.target.selectionEnd; setActiveSelection({ event: t.event, start: s, end: epos }); }}
                            aria-label={`${t.event} template text`}
                          />

                          {/* Recipients (tight) */}
                          <div className="mt-2 flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={t.sendToPrimary !== false}
                                onChange={(e) => {
                                  const next = { ...t, sendToPrimary: e.target.checked };
                                  setTemplates(prev => prev.map(x=> x.event===t.event? next : x));
                                }}
                              />
                              <span className="opacity-80 whitespace-nowrap">Send to primary mobile number</span>
                              <button
                                type="button"
                                title={primaryMobile ? `Primary: +91${primaryMobile}` : 'No primary mobile set'}
                                aria-label={primaryMobile ? `Primary mobile +91${primaryMobile}` : 'No primary mobile set'}
                                className={`ml-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] opacity-80 border ${cls.cardBorder} bg-black/5 dark:bg-white/5 hover:bg-black/10`}
                                onClick={() => {
                                  if (primaryMobile) alert(`Primary mobile: +91${primaryMobile}`);
                                  else alert('No primary mobile set');
                                }}
                              >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                  <path d="M12 8h.01" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M11 12h1v4h1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </label>
                            <div>
                              <div className="text-[11px] mb-1 opacity-70">Groups</div>
                              <div className="p-2 rounded border max-h-28 overflow-auto">
                                {(() => {
                                  const allowedIds = Array.isArray(db?.settings?.[0]?.whatsappGroupIds) ? db.settings[0].whatsappGroupIds : [];
                                  const options = availableGroups.filter(g => allowedIds.includes(g.id));
                                  const selected = Array.isArray(t.groupIds) ? t.groupIds : [];

                                  // Show only selected groups by default to avoid overwhelming the UI.
                                  return (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <div className="flex flex-wrap gap-1">
                                          {selected.length === 0 ? (
                                            <div className="text-[11px] opacity-60">No groups selected for this template</div>
                                          ) : (
                                            selected.map(id => {
                                              const g = options.find(o => o.id === id) || availableGroups.find(o => o.id === id) || { id, name: id };
                                              return (
                                                <span key={id} className="px-2 py-0.5 rounded border text-xs">{g.name || id}</span>
                                              );
                                            })
                                          )}
                                        </div>
                                        <button type="button" onClick={() => setEditingGroupsFor(t.event === editingGroupsFor ? null : t.event)} className="text-[11px] underline ml-auto">{selected.length === 0 ? 'Add' : 'Edit'}</button>
                                      </div>

                                      {editingGroupsFor === t.event && (
                                        <div className="mt-2">
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                            {options.length === 0 ? (
                                              <div className="text-[11px] opacity-60">Select groups in settings above</div>
                                            ) : (
                                              options.map(g => {
                                                const checked = selected.includes(g.id);
                                                return (
                                                  <label key={g.id} className="flex items-center gap-2 text-xs">
                                                    <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      onChange={(e) => {
                                                        const prev = Array.isArray(t.groupIds) ? t.groupIds : [];
                                                        const next = e.target.checked ? Array.from(new Set([...prev, g.id])) : prev.filter(x => x !== g.id);
                                                        setTemplates(prevArr => prevArr.map(x => x.event === t.event ? { ...x, groupIds: next } : x));
                                                      }}
                                                    />
                                                    <span className="truncate">{g.name}</span>
                                                  </label>
                                                );
                                              })
                                            )}
                                          </div>
                                          <div className="mt-2">
                                            <button type="button" onClick={() => setEditingGroupsFor(null)} className="text-[11px] px-2 py-1">Done</button>
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default Settings;
