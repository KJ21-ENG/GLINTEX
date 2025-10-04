import React, { useCallback, useContext, useEffect, useMemo, useState, createContext, useRef } from "react";
import * as api from './api.js';
import * as exporters from './exporters.js';

/**
 * GLINTEX Inventory — DB-backed React app
 */

const THEME_KEY = "glintex_theme";

const BrandCtx = createContext(null);
function useBrand() { return useContext(BrandCtx); }

const defaultBrand = {
  primary: "#2E4CA6",
  gold: "#D4AF37",
  logoDataUrl: "",
};

function formatKg(n) { if (n == null || Number.isNaN(n)) return "0.000"; return Number(n).toFixed(3); }
function uid(prefix = "id") { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function yyyymmdd(dateISO) { return dateISO.replaceAll("-", ""); }

function themeClasses(theme) {
  const dark = theme === "dark";
  const baseText = dark ? "text-white" : "text-slate-900";
  const headerBg = dark ? "bg-slate-900/60 border-white/10" : "bg-white/80 border-slate-200";
  const cardBg = dark ? "bg-white/5" : "bg-white";
  const cardBorder = dark ? "border-white/10" : "border-slate-200";
  const input = dark ? "bg-white/10 border-white/15 text-white placeholder-white/50" : "bg-white border-slate-300 text-slate-900 placeholder-slate-400";
  const muted = dark ? "text-white/70" : "text-slate-600";
  const rowBorder = dark ? "border-white/10" : "border-slate-200";
  const pill = dark ? "bg-white/10 border-white/10" : "bg-slate-100 border-slate-200";
  const navActive = dark ? "bg-white/15 border-white/20" : "bg-slate-100 border-slate-300";
  const navHover = dark ? "hover:bg-white/5" : "hover:bg-slate-100";
  return { baseText, headerBg, cardBg, cardBorder, input, muted, rowBorder, pill, navActive, navHover };
}

function normalizeDb(raw) {
  const ensureArr = (val) => (Array.isArray(val) ? val : []);
  const items = ensureArr(raw?.items);
  const firms = ensureArr(raw?.firms);
  const suppliers = ensureArr(raw?.suppliers);
  const lots = ensureArr(raw?.lots);
  const inbound_items = ensureArr(raw?.inbound_items);
  const consumptions = ensureArr(raw?.consumptions).map((c) => ({
    ...c,
    pieceIds: typeof c.pieceIds === 'string' ? c.pieceIds.split(',').filter(Boolean) : ensureArr(c.pieceIds),
  }));
  const settings = ensureArr(raw?.settings);
  return { items, firms, suppliers, lots, inbound_items, consumptions, settings };
}

function extractBrandFromDb(db) {
  const settingsRow = db?.settings?.[0];
  if (!settingsRow) return { ...defaultBrand };
  return {
    primary: settingsRow.brandPrimary || defaultBrand.primary,
    gold: settingsRow.brandGold || defaultBrand.gold,
    logoDataUrl: settingsRow.logoDataUrl || "",
  };
}

const Section = ({ title, actions, children }) => {
  const { cls } = useBrand();
  return (
    <div className={`rounded-2xl p-4 md:p-6 shadow-sm border ${cls.cardBorder} ${cls.cardBg}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
        <div className="flex gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
};

const Button = ({ children, className = "", style = {}, ...props }) => {
  const { brand } = useBrand();
  return (
    <button
      className={
        "px-3 md:px-4 py-2 rounded-xl active:scale-[.99] transition text-white text-sm md:text-base disabled:opacity-60 disabled:cursor-not-allowed " +
        className
      }
      style={{ backgroundColor: brand.primary, ...style }}
      {...props}
    >
      {children}
    </button>
  );
};

const SecondaryButton = ({ children, className = "", ...props }) => {
  const { cls } = useBrand();
  return (
    <button
      className={`px-3 md:px-4 py-2 rounded-xl border ${cls.cardBorder} ${cls.cardBg} ${cls.baseText} text-sm md:text-base ${cls.navHover} ` + className}
      {...props}
    >
      {children}
    </button>
  );
};

const Input = ({ className = "", inputRef, ...props }) => {
  const { cls } = useBrand();
  return (
    <input
      ref={inputRef}
      className={`w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${cls.input} ` + className}
      {...props}
    />
  );
};

const Select = ({ className = "", children, ...props }) => {
  const { cls } = useBrand();
  return (
    <select
      className={`w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] ${cls.input} ` + className}
      {...props}
    >
      {children}
    </select>
  );
};

const Pill = ({ children, className = "" }) => {
  const { cls, brand } = useBrand();
  return (
    <span
      className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border ${cls.pill} ` + className}
      style={{ borderColor: brand.gold }}
    >
      {children}
    </span>
  );
};

function Pagination({ total, page, setPage, pageSize = 8 }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) pages.push(i);
  return (
    <div className="mt-3 flex items-center gap-2">
      <SecondaryButton onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>Prev</SecondaryButton>
      {pages.map(p => (
        <button key={p} onClick={() => setPage(p)} className={`px-2 py-1 rounded ${p===page?"bg-slate-700 text-white":""}`}>{p}</button>
      ))}
      <SecondaryButton onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next</SecondaryButton>
    </div>
  );
}

const TABS = [
  { key: "inbound", label: "Inbound" },
  { key: "stock", label: "Stock" },
  { key: "issue", label: "Issue to machine" },
  { key: "masters", label: "Masters" },
  { key: "reports", label: "Reports" },
  { key: "data", label: "Admin / Data" },
];

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("inbound");
  const [brandPreview, setBrandPreview] = useState(defaultBrand);
  const [savingBrand, setSavingBrand] = useState(false);

  const cls = useMemo(() => themeClasses(theme), [theme]);

  const loadDb = useCallback(async () => {
    const raw = await api.getDB();
    const normalized = normalizeDb(raw);
    setDb(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const normalized = await loadDb();
        if (cancelled) return;
        setBrandPreview(extractBrandFromDb(normalized));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load DB", err);
        setError(err.message || "Failed to load data from server");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadDb]);

  const refreshDb = useCallback(async () => {
    setRefreshing(true);
    try {
      const normalized = await loadDb();
      setBrandPreview(extractBrandFromDb(normalized));
      setError(null);
      return normalized;
    } catch (err) {
      console.error("Refresh failed", err);
      setError(err.message || "Failed to refresh data");
      throw err;
    } finally {
      setRefreshing(false);
    }
  }, [loadDb]);

  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', brandPreview.primary);
    document.documentElement.style.setProperty('--brand-gold', brandPreview.gold);
  }, [brandPreview.primary, brandPreview.gold]);

  const brandCtxValue = useMemo(() => ({ theme, setTheme, brand: brandPreview, setBrand: setBrandPreview, cls }), [theme, setTheme, brandPreview, cls]);

  const handleCreateLot = useCallback(async (payload) => {
    await api.createLot(payload);
    await refreshDb();
  }, [refreshDb]);

  const handleIssuePieces = useCallback(async (payload) => {
    await api.issuePieces(payload);
    await refreshDb();
  }, [refreshDb]);

  const handleCreateItem = useCallback(async (name) => {
    await api.createItem(name);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteItem = useCallback(async (id) => {
    await api.deleteItem(id);
    await refreshDb();
  }, [refreshDb]);

  const handleCreateFirm = useCallback(async (name) => {
    await api.createFirm(name);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteFirm = useCallback(async (id) => {
    await api.deleteFirm(id);
    await refreshDb();
  }, [refreshDb]);

  const handleCreateSupplier = useCallback(async (name) => {
    await api.createSupplier(name);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteSupplier = useCallback(async (id) => {
    await api.deleteSupplier(id);
    await refreshDb();
  }, [refreshDb]);

  const handleSaveBrand = useCallback(async (values) => {
    setSavingBrand(true);
    try {
      await api.updateSettings(values);
      setBrandPreview(values);
      await refreshDb();
    } finally {
      setSavingBrand(false);
    }
  }, [refreshDb]);

  const headerLogo = brandPreview.logoDataUrl || "/brand-logo.jpg";

  if (loading) {
    return (
      <BrandCtx.Provider value={brandCtxValue}>
        <div className={`min-h-screen w-full grid place-items-center ${cls.baseText}`}>
          <div className="text-center space-y-2">
            <div className="text-lg font-semibold">Loading inventory…</div>
            {error && <div className="text-sm opacity-70">{error}</div>}
          </div>
        </div>
      </BrandCtx.Provider>
    );
  }

  if (!db) {
    return (
      <BrandCtx.Provider value={brandCtxValue}>
        <div className={`min-h-screen w-full grid place-items-center ${cls.baseText}`}>
          <div className="text-center space-y-3">
            <div className="text-lg font-semibold">Unable to load data</div>
            {error && <div className="text-sm opacity-70">{error}</div>}
            <div>
              <Button onClick={() => { setLoading(true); refreshDb().finally(() => setLoading(false)); }}>Retry</Button>
            </div>
          </div>
        </div>
      </BrandCtx.Provider>
    );
  }

  return (
    <BrandCtx.Provider value={brandCtxValue}>
      <div className={`min-h-screen w-full ${cls.baseText}`} style={{ backgroundColor: 'var(--bg)' }}>
        <header className={`sticky top-0 z-20 backdrop-blur border-b ${cls.headerBg}`}>
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl grid place-items-center font-bold border overflow-hidden" style={{ background: "#fff", borderColor: brandPreview.gold }}>
                <img src={headerLogo} alt="GLINTEX" className="w-9 h-9 object-contain" />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-bold">GLINTEX Inventory</h1>
                <p className={`text-xs -mt-0.5 ${cls.muted}`}>Single warehouse · Piece + weight (kg) · Lots</p>
              </div>
            </div>
            <nav className="hidden md:flex gap-2">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-lg text-sm border ${tab===t.key?cls.navActive:"border-transparent"} ${tab!==t.key?cls.navHover:""}`}>
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <div className="md:hidden">
                <Select value={tab} onChange={e=>setTab(e.target.value)}>
                  {TABS.map(t=> <option key={t.key} value={t.key}>{t.label}</option>)}
                </Select>
              </div>
              <SecondaryButton onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}>{theme === "dark" ? "☀️ Light" : "🌙 Dark"}</SecondaryButton>
            </div>
          </div>
        </header>

        {error && (
          <div className="bg-orange-500/10 border border-orange-400/30 text-orange-200 px-4 py-2 text-sm text-center">
            {error} <button className="underline ml-2" onClick={() => refreshDb().catch(() => {})}>Retry</button>
          </div>
        )}

        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {tab === "inbound" && <Inbound db={db} onCreateLot={handleCreateLot} refreshing={refreshing} />}
          {tab === "stock" && <Stock db={db} onIssuePieces={handleIssuePieces} refreshing={refreshing} refreshDb={refreshDb} />}
          {tab === "issue" && <IssueToMachine db={db} onIssuePieces={handleIssuePieces} refreshing={refreshing} />}
          {tab === "masters" && <Masters
            db={db}
            onAddItem={handleCreateItem}
            onDeleteItem={handleDeleteItem}
            onAddFirm={handleCreateFirm}
            onDeleteFirm={handleDeleteFirm}
            onAddSupplier={handleCreateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            refreshing={refreshing}
          />}
          {tab === "reports" && <Reports db={db} />}
          {tab === "data" && <AdminData db={db} onSaveBrand={handleSaveBrand} savingBrand={savingBrand || refreshing} />}
        </main>
      </div>
    </BrandCtx.Provider>
  );
}

/*********************
|* Inbound Receiving  *
\*********************/
function Inbound({ db, onCreateLot, refreshing }) {
  const { cls } = useBrand();
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [firmId, setFirmId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [weight, setWeight] = useState("");
  const [previewLotNo, setPreviewLotNo] = useState("");
  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);

  // Keep selects empty by default; if current value disappears from DB, clear it
  useEffect(() => { if (db.items.length && !db.items.some(i => i.id === itemId)) setItemId(""); }, [db.items, itemId]);
  useEffect(() => { if (db.firms.length && !db.firms.some(f => f.id === firmId)) setFirmId(""); }, [db.firms, firmId]);
  useEffect(() => { if (db.suppliers.length && !db.suppliers.some(s => s.id === supplierId)) setSupplierId(""); }, [db.suppliers, supplierId]);

  // Fetch next sequence preview
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
        const j = await res.json();
        if (!cancelled) setPreviewLotNo(j.next);
      } catch (e) {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const canAdd = date && itemId && firmId && supplierId && Number(weight) > 0;
  const canSave = cart.length > 0 && date && itemId && firmId && supplierId && !saving;

  const weightRef = useRef(null);

  function addPiece() {
    if (!canAdd) return;
    const nextSeq = cart.length + 1;
    setCart([...cart, { seq: nextSeq, tempId: uid("piece"), weight: Number(weight) }]);
    setWeight("");
    // focus back to weight input
    setTimeout(() => { try { weightRef.current?.focus(); } catch (e) {} }, 0);
  }

  function removeFromCart(tempId) {
    setCart(cart.filter(c => c.tempId !== tempId).map((c, idx) => ({...c, seq: idx+1})));
  }

  async function saveLot() {
    if (!canSave) return;
    setSaving(true);
    try {
      const pieces = cart.map((row, idx) => ({ seq: idx + 1, weight: Number(row.weight) }));
      try {
        await onCreateLot({ date, itemId, firmId, supplierId, pieces });
      } catch (err) {
        // If lot already exists (race), refresh preview and retry once
        if ((err && String(err.message || '').toLowerCase().includes('lot already exists')) || (err && String(err.message || '').toLowerCase().includes('already exists'))) {
          try {
            const res = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
            const j = await res.json();
            setPreviewLotNo(j.next);
          } catch (e) {
            // ignore
          }
          // retry once
          await onCreateLot({ date, itemId, firmId, supplierId, pieces });
        } else {
          throw err;
        }
      }

      const totalPieces = cart.length;
      const totalWeight = cart.reduce((s, r) => s + (Number(r.weight)||0), 0);
      alert(`Saved Lot with ${totalPieces} pcs / ${formatKg(totalWeight)} kg`);

      // reset inbound form fields
      setCart([]);
      setWeight("");
      setDate(todayISO());
      setItemId("");
      setFirmId("");
      setSupplierId("");
      // focus back to weight input for quick entry
      try { weightRef.current?.focus(); } catch (e) {}

      // refresh preview
      try {
        const res2 = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:4000') + '/api/sequence/next');
        const j2 = await res2.json();
        setPreviewLotNo(j2.next);
      } catch (e) {}
    } catch (err) {
      alert(err.message || 'Failed to save lot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="Inbound Receiving"
        actions={<Pill>Lot No is auto-generated from database sequence</Pill>}
      >
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>{setDate(e.target.value); setCart([]);}} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select</option>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Firm</label><Select value={firmId} onChange={e=>setFirmId(e.target.value)}><option value="">Select</option>{db.firms.length===0? <option>No firms</option> : db.firms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Supplier</label><Select value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Select</option>{db.suppliers.length===0? <option>No suppliers</option> : db.suppliers.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot No (preview)</label><Input value={previewLotNo} readOnly /></div>
          <div><label className={`text-xs ${cls.muted}`}>Weight (kg)</label><Input inputRef={weightRef} type="number" min="0" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); if(e.shiftKey){ saveLot(); } else { addPiece(); } } }} placeholder="e.g. 1.250" /></div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={addPiece} disabled={!canAdd}>Add</Button>
          <SecondaryButton onClick={()=>setCart([])} disabled={cart.length===0}>Clear Cart</SecondaryButton>
          <Button onClick={saveLot} disabled={!canSave || refreshing} className="ml-auto">{saving ? 'Saving…' : 'Save Lot'}</Button>
        </div>
        <CartPreview previewLotNo={previewLotNo} cart={cart} removeFromCart={removeFromCart} />
      </Section>
      <Section title="Recent Lots"><RecentLots db={db} /></Section>
    </div>
  );
}

function CartPreview({ previewLotNo, cart, removeFromCart }) {
  const { cls } = useBrand();
  return (
    <div className="mt-6">
      <h3 className={`text-sm uppercase tracking-wide mb-2 ${cls.muted}`}>Cart</h3>
      {cart.length === 0 ? (
        <div className={`${cls.muted} text-sm`}>No pieces yet. Enter weight and click <b>Add</b>.</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Piece ID (preview)</th><th className="py-2 pr-2">Weight (kg)</th><th className="py-2 pr-2 text-right">Actions</th></tr></thead>
            <tbody>
              {cart.map((r) => (
                <tr key={r.tempId} className={`border-t ${cls.rowBorder}`}>
                  <td className="py-2 pr-2">{r.seq}</td>
                  <td className="py-2 pr-2">{previewLotNo ? `${previewLotNo}-${r.seq}` : 'Auto-generated'}</td>
                  <td className="py-2 pr-2">{formatKg(r.weight)}</td>
                  <td className="py-2 pl-2 text-right"><SecondaryButton onClick={()=>removeFromCart(r.tempId)}>Remove</SecondaryButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecentLots({ db }) {
  const { cls } = useBrand();
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const sorted = [...db.lots].sort((a,b)=> b.createdAt?.localeCompare?.(a.createdAt) || 0);
  const rows = sorted.slice((page-1)*pageSize, page*pageSize).map(l=>({
    ...l,
    itemName: db.items.find(i=>i.id===l.itemId)?.name || "—",
    firmName: db.firms.find(f=>f.id===l.firmId)?.name || "—",
    supplierName: db.suppliers.find(s=>s.id===l.supplierId)?.name || "—",
  }));
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Lot No</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
        <tbody>
          {rows.length===0? <tr><td colSpan={7} className="py-4">No lots yet.</td></tr> : rows.map(r=> (
            <tr key={r.lotNo} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2 font-medium">{r.lotNo}</td><td className="py-2 pr-2">{r.date}</td><td className="py-2 pr-2">{r.itemName}</td><td className="py-2 pr-2">{r.firmName}</td><td className="py-2 pr-2">{r.supplierName}</td><td className="py-2 pr-2 text-right">{r.totalPieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td></tr>
          ))}
        </tbody>
      </table>
      <Pagination total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} />
    </div>
  );
}

/*********************
|* Stock On Hand Tab  *
\*********************/
function Stock({ db, onIssuePieces, refreshing, refreshDb }) {
  const { cls, brand } = useBrand();
  const [filters, setFilters] = useState({ itemId: '', firmId: '', supplierId: '', from: '', to: '', lotSearch: '', type: 'active' });
  const [expandedLot, setExpandedLot] = useState(null);
  const [selectedByLot, setSelectedByLot] = useState({});
  const [issueMetaByLot, setIssueMetaByLot] = useState({});
  const [issuingLot, setIssuingLot] = useState(null);

  // Prepare lots with all pieces (include non-available ones too) and compute available/pending totals
  const lotsMap = useMemo(() => {
    const m = {};
    for (const lot of db.lots) {
      m[lot.lotNo] = {
        ...lot,
        itemName: db.items.find(i => i.id === lot.itemId)?.name || '—',
        firmName: db.firms.find(f => f.id === lot.firmId)?.name || '—',
        supplierName: db.suppliers.find(s => s.id === lot.supplierId)?.name || '—',
        pieces: [],
        availableCount: 0,
        pendingWeight: 0,
      };
    }
    for (const p of db.inbound_items) {
      if (!m[p.lotNo]) continue;
      m[p.lotNo].pieces.push(p);
      if (p.status === 'available') {
        m[p.lotNo].availableCount = (m[p.lotNo].availableCount || 0) + 1;
        m[p.lotNo].pendingWeight = (m[p.lotNo].pendingWeight || 0) + Number(p.weight || 0);
      }
    }
    return m;
  }, [db.lots, db.items, db.firms, db.suppliers, db.inbound_items]);

  // Include all lots (even those with zero available pieces) so filters like "inactive" work
  const allLots = useMemo(() => Object.values(lotsMap), [lotsMap]);

  // Apply filters
  const filteredLots = useMemo(() => {
    return allLots.filter(l => {
      if (filters.itemId && l.itemId !== filters.itemId) return false;
      if (filters.firmId && l.firmId !== filters.firmId) return false;
      if (filters.supplierId && l.supplierId !== filters.supplierId) return false;
      if (filters.lotSearch && !l.lotNo.toLowerCase().includes(filters.lotSearch.toLowerCase())) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      // client-side type filter: active / inactive
      // pending = weight available to be issued (computed earlier on lotsMap)
      const pending = Number(l.pendingWeight || 0);
      const initialWeight = Number(l.totalWeight || 0);
      if (filters.type === 'active') {
        // show lots where pending > 0 and pending <= initial
        if (!(pending > 0 && pending <= initialWeight)) return false;
      } else if (filters.type === 'inactive') {
        // show lots where pending === 0
        if (!(Math.abs(pending) < 1e-9)) return false;
      } else if (filters.type === 'all') {
        // no filtering
      }
      return true;
    }).sort((a,b) => (b.date || '').localeCompare(a.date));
  }, [allLots, filters]);

  function toggleExpand(lotNo) { setExpandedLot(prev => (prev === lotNo ? null : lotNo)); }

  function togglePiece(lotNo, pieceId) {
    setSelectedByLot(prev => {
      const next = { ...prev };
      const arr = new Set(next[lotNo] || []);
      if (arr.has(pieceId)) arr.delete(pieceId); else arr.add(pieceId);
      next[lotNo] = Array.from(arr);
      return next;
    });
  }

  function selectAll(lotNo) { setSelectedByLot(prev => ({ ...prev, [lotNo]: (lotsMap[lotNo].pieces || []).map(p=>p.id) })); }
  function clearSel(lotNo) { setSelectedByLot(prev => ({ ...prev, [lotNo]: [] })); }

  function setIssueMeta(lotNo, meta) { setIssueMetaByLot(prev => ({ ...prev, [lotNo]: { ...(prev[lotNo]||{}), ...meta } })); }

  async function doIssue(lotNo) {
    const pieceIds = (selectedByLot[lotNo] || []).slice();
    if (!pieceIds.length) { alert('Select pieces to issue'); return; }
    const meta = issueMetaByLot[lotNo] || {};
    const payload = { date: meta.date || todayISO(), itemId: lotsMap[lotNo].itemId, lotNo, pieceIds, note: meta.note || '' };
    setIssuingLot(lotNo);
    try {
      await onIssuePieces(payload);
      alert(`Issued ${pieceIds.length} pcs from Lot ${lotNo}`);
      // clear selection for this lot
      setSelectedByLot(prev => ({ ...prev, [lotNo]: [] }));
      setIssueMetaByLot(prev => ({ ...prev, [lotNo]: {} }));
      setExpandedLot(null);
    } catch (err) {
      alert(err.message || 'Failed to issue pieces');
    } finally {
      setIssuingLot(null);
    }
  }

  // Export helpers
  function piecesByLot() {
    const map = {};
    for (const l of filteredLots) map[l.lotNo] = (l.pieces || []).map(p => ({ id: p.id, seq: p.seq, weight: p.weight }));
    return map;
  }

  return (
    <div className="space-y-6">
      <Section title="Stock (Lot-wise)" actions={<div className="flex gap-2"><Button onClick={()=>exporters?.exportXlsx(filteredLots, piecesByLot())} >Export XLSX</Button><SecondaryButton onClick={()=>exporters?.exportCsv(filteredLots, piecesByLot())}>Export CSV</SecondaryButton><SecondaryButton onClick={()=>exporters?.exportPdf(filteredLots, piecesByLot(), brand)}>Export PDF</SecondaryButton></div>}>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3 md:gap-4 mb-3">
          <div><label className={`text-xs ${cls.muted}`}>Lot search</label><Input value={filters.lotSearch} onChange={e=>setFilters(f=>({ ...f, lotSearch: e.target.value }))} placeholder="Search lot no" /></div>
          <div><label className={`text-xs ${cls.muted}`}>Date From</label><Input type="date" value={filters.from} onChange={e=>setFilters(f=>({ ...f, from: e.target.value }))} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Date To</label><Input type="date" value={filters.to} onChange={e=>setFilters(f=>({ ...f, to: e.target.value }))} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={filters.itemId} onChange={e=>setFilters(f=>({ ...f, itemId: e.target.value }))}><option value="">Any</option>{db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Firm</label><Select value={filters.firmId} onChange={e=>setFilters(f=>({ ...f, firmId: e.target.value }))}><option value="">Any</option>{db.firms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Supplier</label><Select value={filters.supplierId} onChange={e=>setFilters(f=>({ ...f, supplierId: e.target.value }))}><option value="">Any</option>{db.suppliers.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Type</label><Select value={filters.type} onChange={e=>setFilters(f=>({ ...f, type: e.target.value }))}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
        </div>

          <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Lot No</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Pieces (available/out)</th><th className="py-2 pr-2 text-right">Initial Weight (kg)</th><th className="py-2 pr-2 text-right">Pending Weight (kg)</th></tr></thead>
            <tbody>
              {filteredLots.length===0? <tr><td colSpan={8} className="py-4">No lots match filters.</td></tr> : filteredLots.map(l=> (
                <React.Fragment key={l.lotNo}>
                  <tr className={`border-t ${cls.rowBorder} align-top`} onClick={()=>toggleExpand(l.lotNo)} style={{ cursor: 'pointer' }}>
                    <td className="py-2 pr-2 font-medium">{l.lotNo}</td>
                    <td className="py-2 pr-2">{l.date}</td>
                    <td className="py-2 pr-2">{l.itemName}</td>
                    <td className="py-2 pr-2">{l.firmName}</td>
                    <td className="py-2 pr-2">{l.supplierName}</td>
                    <td className="py-2 pr-2 text-right">{`${(l.pieces||[]).filter(p=>p.status==='available').length} / ${l.totalPieces ?? 0}`}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(l.totalWeight || 0)}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(Number(l.pendingWeight || 0))}</td>
                  </tr>
                  {expandedLot === l.lotNo && (
                    <tr className={`border-t ${cls.rowBorder}`}>
                      <td colSpan={7} className="p-3">
                        <div className={`p-3 rounded-xl border ${cls.cardBorder} ${cls.cardBg}`}>
                          <div className="mb-2 flex items-center gap-2">
                          <Pill>Available: {(l.pieces||[]).length} pcs</Pill>
                          <button onClick={(e)=>{ e.stopPropagation(); if(!confirm('Delete lot '+l.lotNo+'? This will remove all pieces and history for this lot.')) return; api.deleteLot(l.lotNo).then(()=>{ refreshDb().catch(()=>{}); alert('Deleted'); }).catch(err=>alert(err.message || err)); }} title="Delete lot" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} ml-2 hover:opacity-90`}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-red-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18M8 6v12a2 2 0 002 2h4a2 2 0 002-2V6M10 6V4a2 2 0 012-2h0a2 2 0 012 2v2"/></svg>
                          </button>
                          <div className="ml-auto flex items-center gap-2">
                            <label className={`text-xs ${cls.muted}`}>Date</label>
                            <Input type="date" value={(issueMetaByLot[l.lotNo]||{}).date || todayISO()} onChange={e=>{ setIssueMeta(l.lotNo, { date: e.target.value }); }} style={{ width: 140 }} />
                            <Input value={(issueMetaByLot[l.lotNo]||{}).note || ''} onChange={e=>setIssueMeta(l.lotNo, { note: e.target.value })} placeholder="Note (optional)" style={{ width: 220 }} />
                            <Button onClick={(e)=>{ e.stopPropagation(); doIssue(l.lotNo); }} disabled={!(selectedByLot[l.lotNo]||[]).length || issuingLot===l.lotNo || refreshing}>{issuingLot===l.lotNo ? 'Issuing…' : 'Issue'}</Button>
                          </div>
                          </div>

                          <div className="overflow-auto">
                            {(() => {
                              const initialWeight = Number(l.totalWeight || 0);
                              const pendingWeightVal = Number(l.pendingWeight || 0);
                              return (
                                <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Select</th><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2">Seq</th><th className="py-2 pr-2 text-right">Initial Weight (kg)</th><th className="py-2 pr-2 text-right">Pending Weight (kg)</th></tr></thead>
                                  <tbody>
                                    {(l.pieces||[]).sort((a,b)=> a.seq - b.seq).map(p=> (
                                      <PieceRow key={p.id} p={p} lotNo={l.lotNo} selected={(selectedByLot[l.lotNo]||[]).includes(p.id)} onToggle={() => togglePiece(l.lotNo, p.id)} onSaved={() => { refreshDb().catch(()=>{}); }} initialWeight={initialWeight} pendingWeight={p.status === 'available' ? p.weight : 0} />
                                    ))}
                                  </tbody>
                                </table>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

/***************************
|* Issue to Machine        *
\***************************/
function IssueToMachine({ db, onIssuePieces, refreshing }) {
  const { cls } = useBrand();
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [issuing, setIssuing] = useState(false);

  useEffect(() => {
    if (db.items.length && !db.items.some(i => i.id === itemId)) {
      setItemId("");
    }
  }, [db.items, itemId]);

  const candidateLots = useMemo(() => db.lots.filter(l => l.itemId === itemId), [db.lots, itemId]);
  const [lotNo, setLotNo] = useState("");

  useEffect(() => {
    // Do not auto-select first lot; leave user to choose from Select
    if (!candidateLots.some(l => l.lotNo === lotNo)) setLotNo("");
  }, [candidateLots]);

  useEffect(() => { setSelected([]); }, [lotNo]);

  const availablePieces = useMemo(() => db.inbound_items
    .filter(ii => ii.lotNo===lotNo && ii.itemId===itemId && ii.status==='available')
    .sort((a,b)=> a.seq - b.seq), [db.inbound_items, lotNo, itemId]);

  const lastIssueForLot = useMemo(() => {
    const rows = db.consumptions.filter(c => c.lotNo===lotNo).sort((a,b)=> b.date.localeCompare(a.date));
    return rows[0] || null;
  }, [db.consumptions, lotNo]);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function selectAll() { setSelected(availablePieces.map(p=>p.id)); }
  function clearSel() { setSelected([]); }

  async function issue() {
    if (!date || !itemId || !lotNo || selected.length===0) return;
    const availSet = new Set(availablePieces.map(p=>p.id));
    const chosen = selected.filter(id => availSet.has(id));
    if (chosen.length===0) { alert("Nothing to issue. Selected pieces are not available."); return; }
    setIssuing(true);
    try {
      await onIssuePieces({ date, itemId, lotNo, pieceIds: chosen, note });
      const picked = availablePieces.filter(p=> chosen.includes(p.id));
      const totalWeight = picked.reduce((s,p)=>s+p.weight,0);
      alert(`Issued ${chosen.length} pcs from Lot ${lotNo} (Total ${formatKg(totalWeight)} kg)`);
      setSelected([]);
      setNote("");
    } catch (err) {
      alert(err.message || 'Failed to issue pieces');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Issue to machine">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
  <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select</option>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
  <div><label className={`text-xs ${cls.muted}`}>Lot</label><Select value={lotNo} onChange={e=>setLotNo(e.target.value)}><option value="">Select</option>{candidateLots.length===0? <option>No lots</option> : candidateLots.map(l=> <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}</Select></div>
          <div className="md:col-span-2"><label className={`text-xs ${cls.muted}`}>Note (optional)</label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reference / reason" /></div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Pill>Available: {availablePieces.length} pcs</Pill>
          <Pill>Selected: {selected.length} pcs</Pill>
          <SecondaryButton onClick={selectAll} disabled={availablePieces.length===0}>Select all</SecondaryButton>
          <SecondaryButton onClick={clearSel} disabled={selected.length===0}>Clear</SecondaryButton>
          <Button onClick={issue} disabled={selected.length===0 || refreshing || issuing} className="ml-auto">{issuing ? 'Issuing…' : 'Issue'}</Button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Select</th><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
              <tbody>
                {availablePieces.length===0? <tr><td colSpan={3} className="py-4">No available pieces in this lot.</td></tr> : availablePieces.map(p=> (
                  <tr key={p.id} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)} /></td>
                    <td className="py-2 pr-2 font-mono">{p.id}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(p.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`p-3 rounded-xl border ${cls.cardBorder} ${cls.cardBg}`}>
            <div className={`mb-2 font-medium`}>Last issued in this lot</div>
            {!lastIssueForLot? (
              <div className={`text-sm ${cls.muted}`}>No past issues for this lot.</div>
            ) : (
              <div className="text-sm">
                <div className={`${cls.muted} mb-1`}>{lastIssueForLot.date} · {lastIssueForLot.count} pcs · {formatKg(lastIssueForLot.totalWeight)} kg</div>
                <div className="flex flex-wrap gap-1">
                  {lastIssueForLot.pieceIds.map(id => <span key={id} className={`px-2 py-0.5 rounded-md text-xs border ${cls.pill} font-mono`}>{id}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Issue History"><IssueHistory db={db} /></Section>
    </div>
  );
}

/*********************
|* Issue History table *
\*********************/
function IssueHistory({ db }) {
  const { cls } = useBrand();
  const rows = [...db.consumptions].sort((a,b)=> b.date.localeCompare(a.date));
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Lot</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Weight (kg)</th><th className="py-2 pr-2">Pieces</th><th className="py-2 pr-2">Note</th></tr></thead>
        <tbody>
          {rows.length===0? <tr><td colSpan={7} className="py-4">No issues yet.</td></tr> : rows.map((r, idx) => (
            <tr key={r.id || idx} className={`border-t ${cls.rowBorder} align-top`}>
              <td className="py-2 pr-2">{r.date}</td>
              <td className="py-2 pr-2">{db.items.find(i=>i.id===r.itemId)?.name || "—"}</td>
              <td className="py-2 pr-2">{r.lotNo}</td>
              <td className="py-2 pr-2 text-right">{r.count}</td>
              <td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td>
              <td className="py-2 pr-2 font-mono whitespace-pre-wrap">{r.pieceIds.join(", ")}</td>
              <td className="py-2 pr-2">{r.note || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/*********************
|* Masters (Items/Firms)
\*********************/
function Masters({ db, onAddItem, onDeleteItem, onAddFirm, onDeleteFirm, onAddSupplier, onDeleteSupplier, refreshing }) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [working, setWorking] = useState(false);

  async function addItem() {
    const name = itemName.trim();
    if (!name) return;
    if (db.items.some(i => i.name.toLowerCase() === name.toLowerCase())) { alert("Item already exists"); return; }
    setWorking(true);
    try {
      await onAddItem(name);
      setItemName("");
    } catch (err) {
      alert(err.message || 'Failed to add item');
    } finally {
      setWorking(false);
    }
  }

  async function deleteItem(id) {
    if (!confirm("Delete item? You cannot remove it if referenced by lots.")) return;
    setWorking(true);
    try {
      await onDeleteItem(id);
    } catch (err) {
      alert(err.message || 'Failed to delete item');
    } finally {
      setWorking(false);
    }
  }

  async function addFirm() {
    const name = firmName.trim();
    if (!name) return;
    if (db.firms.some(f => f.name.toLowerCase() === name.toLowerCase())) { alert("Firm already exists"); return; }
    setWorking(true);
    try {
      await onAddFirm(name);
      setFirmName("");
    } catch (err) {
      alert(err.message || 'Failed to add firm');
    } finally {
      setWorking(false);
    }
  }

  async function deleteFirm(id) {
    if (!confirm("Delete firm? You cannot remove it if referenced by lots.")) return;
    setWorking(true);
    try {
      await onDeleteFirm(id);
    } catch (err) {
      alert(err.message || 'Failed to delete firm');
    } finally {
      setWorking(false);
    }
  }

  async function addSupplier() {
    const name = supplierName.trim();
    if (!name) return;
    if (db.suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) { alert("Supplier already exists"); return; }
    setWorking(true);
    try {
      await onAddSupplier(name);
      setSupplierName("");
    } catch (err) {
      alert(err.message || 'Failed to add supplier');
    } finally {
      setWorking(false);
    }
  }

  async function deleteSupplier(id) {
    if (!confirm("Delete supplier? You cannot remove it if referenced by lots.")) return;
    setWorking(true);
    try {
      await onDeleteSupplier(id);
    } catch (err) {
      alert(err.message || 'Failed to delete supplier');
    } finally {
      setWorking(false);
    }
  }

  const disable = working || refreshing;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Section title="Items">
        <div className="flex gap-2 mb-3"><Input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New item name" /><Button onClick={addItem} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.items.map(i => (
          <li key={i.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{i.name}</span>
            <SecondaryButton onClick={()=>deleteItem(i.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>

      <Section title="Firms">
        <div className="flex gap-2 mb-3"><Input value={firmName} onChange={e=>setFirmName(e.target.value)} placeholder="New firm name" /><Button onClick={addFirm} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.firms.map(f => (
          <li key={f.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{f.name}</span>
            <SecondaryButton onClick={()=>deleteFirm(f.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>

      <Section title="Suppliers">
        <div className="flex gap-2 mb-3"><Input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="New supplier name" /><Button onClick={addSupplier} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.suppliers.map(s => (
          <li key={s.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{s.name}</span>
            <SecondaryButton onClick={()=>deleteSupplier(s.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>
    </div>
  );
}

/*********************
|* Reports            *
\*********************/
function Reports({ db }) {
  const { cls } = useBrand();
  const bySupplier = groupBy(db.lots.filter(l => l.supplierId), l => l.supplierId);
  const supplierRows = Object.entries(bySupplier).map(([supplierId, lots]) => ({ supplierName: db.suppliers.find(s=>s.id===supplierId)?.name || "—", lotsCount: lots.length, pieces: lots.reduce((s,l)=>s+l.totalPieces,0), weight: lots.reduce((s,l)=>s+l.totalWeight,0) }));
  
  const byFirm = groupBy(db.lots, l => l.firmId);
  const firmRows = Object.entries(byFirm).map(([firmId, lots]) => ({ firmName: db.firms.find(f=>f.id===firmId)?.name || "—", lotsCount: lots.length, pieces: lots.reduce((s,l)=>s+l.totalPieces,0), weight: lots.reduce((s,l)=>s+l.totalWeight,0) }));
  
  return (
    <div className="space-y-6">
      <Section title="Supplier-wise Purchases">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Lots</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
            <tbody>
              {supplierRows.length===0? <tr><td colSpan={4} className="py-4">No data.</td></tr> : supplierRows.map((r, idx)=> (
                <tr key={idx} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2">{r.supplierName}</td><td className="py-2 pr-2 text-right">{r.lotsCount}</td><td className="py-2 pr-2 text-right">{r.pieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.weight)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      
      <Section title="Firm-wise Summary">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2 text-right">Lots</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
            <tbody>
              {firmRows.length===0? <tr><td colSpan={4} className="py-4">No data.</td></tr> : firmRows.map((r, idx)=> (
                <tr key={idx} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2">{r.firmName}</td><td className="py-2 pr-2 text-right">{r.lotsCount}</td><td className="py-2 pr-2 text-right">{r.pieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.weight)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Valuation (Info)"><div className={`${cls.muted} text-sm`}>Costing method not required. Valuation is disabled. If you want to enable it later, we can add Weighted Average at lot level and compute COGS during issue.</div></Section>
    </div>
  );
}

/*********************
|* Admin / Data       *
\*********************/
function AdminData({ db, onSaveBrand, savingBrand }) {
  const { brand, setBrand, cls } = useBrand();
  const [localBrand, setLocalBrand] = useState(brand);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalBrand(brand);
  }, [brand.primary, brand.gold, brand.logoDataUrl]);

  function updateBrandField(field, value) {
    const next = { ...localBrand, [field]: value };
    setLocalBrand(next);
    setBrand(next);
  }

  function onLogo(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateBrandField('logoDataUrl', String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  async function saveBrand() {
    setSaving(true);
    try {
      await onSaveBrand(localBrand);
      alert('Branding updated');
    } catch (err) {
      alert(err.message || 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Branding (GLINTEX)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={`text-xs ${cls.muted}`}>Primary (Blue) — HEX</label>
            <Input value={localBrand.primary} onChange={e=>updateBrandField('primary', e.target.value)} />
          </div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Accent (Gold) — HEX</label>
            <Input value={localBrand.gold} onChange={e=>updateBrandField('gold', e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <label className="inline-flex items-center gap-2">
              <SecondaryButton as="span">Upload Logo</SecondaryButton>
              <input type="file" accept="image/*" onChange={onLogo} className="hidden" />
            </label>
            <img src={localBrand.logoDataUrl || "/brand-logo.jpg"} alt="logo" className="h-9 object-contain border rounded-lg" />
          </div>
        </div>
        <div className="mt-3 flex gap-2 items-center">
          <Pill>Preview</Pill>
          <Button disabled={saving || savingBrand} onClick={saveBrand}>{saving || savingBrand ? 'Saving…' : 'Save Branding'}</Button>
          <SecondaryButton onClick={() => setLocalBrand(brand)}>Reset</SecondaryButton>
        </div>
      </Section>

      <Section title="Raw Tables (Read-only preview)">
        <RawTable title="Items" rows={db.items} />
        <RawTable title="Firms" rows={db.firms} />
        <RawTable title="Suppliers" rows={db.suppliers} />
        <RawTable title="Lots" rows={db.lots} />
        <RawTable title="Inbound Items" rows={db.inbound_items} />
        <RawTable title="Issues to Machine" rows={db.consumptions} />
      </Section>
    </div>
  );
}

function RawTable({ title, rows }) {
  const { cls } = useBrand();
  const keys = Object.keys(rows[0] || {});
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const start = (page-1)*pageSize;
  const pageRows = rows.slice(start, start+pageSize);
  return (
    <div className="mb-6">
      <h3 className={`text-sm uppercase tracking-wide mb-2 ${cls.muted}`}>{title}</h3>
      {rows.length === 0 ? (<div className="text-sm">No rows.</div>) : (
        <div className="overflow-auto">
          <table className="w-full text-xs md:text-sm"><thead className={`text-left ${cls.muted}`}><tr>{keys.map(k => <th key={k} className="py-1 pr-2">{k}</th>)}</tr></thead>
            <tbody>
              {pageRows.map((r, i) => (<tr key={start+i} className={`border-t ${cls.rowBorder}`}>{keys.map(k => <td key={k} className="py-1 pr-2 font-mono whitespace-pre">{String(r[k])}</td>)}</tr>))}
            </tbody>
          </table>
          <Pagination total={rows.length} page={page} setPage={setPage} pageSize={pageSize} />
        </div>
      )}
    </div>
  );
}

/*********************
|* Utilities          *
\*********************/
function groupBy(arr, keyFn) { const m = {}; for (const x of arr) { const k = keyFn(x); (m[k] ||= []).push(x);} return m; }

export { useBrand };

function PieceRow({ p, lotNo, selected, onToggle, onSaved, initialWeight = 0, pendingWeight = 0 }) {
  const { cls } = useBrand();
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(p.weight);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setWeight(p.weight); }, [p.weight]);

  async function save() {
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) { alert('Weight must be positive'); return; }
    setSaving(true);
    try {
      await api.updateInboundItem(p.id, { weight: Number(weight) });
      setEditing(false);
      onSaved && onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save piece');
    } finally {
      setSaving(false);
    }
  }

  const isAvailable = p.status === 'available';

  return (
    <tr className={`border-t ${cls.rowBorder} ${!isAvailable ? 'piece-disabled' : ''}`}>
      <td className="py-2 pr-2"><input type="checkbox" checked={selected} onChange={onToggle} disabled={!isAvailable} /></td>
      <td className="py-2 pr-2 font-mono">{p.id}</td>
      <td className="py-2 pr-2">{p.seq}</td>
      <td className="py-2 pr-2 text-right">
        <div className="flex items-center justify-end gap-2">
              {editing ? (
            <>
              <Input type="number" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} style={{ width: 120 }} />
              <button onClick={(e)=>{ e.stopPropagation(); setEditing(false); setWeight(p.weight); }} disabled={saving} title="Cancel" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} hover:opacity-90`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-red-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <button onClick={(e)=>{ e.stopPropagation(); save(); }} disabled={saving} title="Save" className={`w-8 h-8 rounded-full flex items-center justify-center border ${cls.cardBorder} ${cls.cardBg} hover:opacity-90`}>
                {saving ? <svg xmlns="http://www.w3.org/2000/svg" className="animate-spin w-4 h-4 text-emerald-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8z"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-emerald-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>}
              </button>
            </>
          ) : (
            <>
              <span className="mr-2">{formatKg(p.weight)}</span>
              <button onClick={(e)=>{ e.stopPropagation(); setEditing(true); }} className={`text-sm ${cls.muted}`} title="Edit weight" disabled={!isAvailable}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z"/></svg>
              </button>
            </>
          )}
        </div>
      </td>
      <td className="py-2 pr-2 text-right">{formatKg(pendingWeight)}</td>
    </tr>
  );
}
