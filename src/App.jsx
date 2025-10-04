import React, { useCallback, useContext, useEffect, useMemo, useState, createContext } from "react";
import api from './api.js';

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
  const lots = ensureArr(raw?.lots);
  const inbound_items = ensureArr(raw?.inbound_items);
  const consumptions = ensureArr(raw?.consumptions).map((c) => ({
    ...c,
    pieceIds: typeof c.pieceIds === 'string' ? c.pieceIds.split(',').filter(Boolean) : ensureArr(c.pieceIds),
  }));
  const settings = ensureArr(raw?.settings);
  return { items, firms, lots, inbound_items, consumptions, settings };
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

const Input = ({ className = "", ...props }) => {
  const { cls } = useBrand();
  return (
    <input
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
          {tab === "stock" && <Stock db={db} />}
          {tab === "issue" && <IssueToMachine db={db} onIssuePieces={handleIssuePieces} refreshing={refreshing} />}
          {tab === "masters" && <Masters
            db={db}
            onAddItem={handleCreateItem}
            onDeleteItem={handleDeleteItem}
            onAddFirm={handleCreateFirm}
            onDeleteFirm={handleDeleteFirm}
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
  const [itemId, setItemId] = useState(db.items[0]?.id || "");
  const [firmId, setFirmId] = useState(db.firms[0]?.id || "");
  const [lotNo, setLotNo] = useState("");
  const [weight, setWeight] = useState("");
  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (db.items.length && !db.items.some(i => i.id === itemId)) setItemId(db.items[0]?.id || ""); }, [db.items, itemId]);
  useEffect(() => { if (db.firms.length && !db.firms.some(f => f.id === firmId)) setFirmId(db.firms[0]?.id || ""); }, [db.firms, firmId]);

  const canAdd = date && itemId && firmId && lotNo && Number(weight) > 0;
  const canSave = cart.length > 0 && date && itemId && firmId && lotNo && !saving;

  function startNewLot() {
    if (!date || !itemId || !firmId) { alert('Select date, item and firm first.'); return; }
    const seq = nextLotSequence(db, date);
    const newLotNo = `${yyyymmdd(date)}-${String(seq).padStart(3, "0")}`;
    setLotNo(newLotNo);
    setCart([]);
    setWeight("");
  }

  function addPiece() {
    if (!canAdd) return;
    const nextSeq = cart.length + 1;
    setCart([...cart, { seq: nextSeq, tempId: uid("piece"), weight: Number(weight) }]);
    setWeight("");
  }

  function removeFromCart(tempId) {
    setCart(cart.filter(c => c.tempId !== tempId).map((c, idx) => ({...c, seq: idx+1})));
  }

  async function saveLot() {
    if (!canSave) return;
    if (db.lots.some(l => l.lotNo === lotNo)) { alert(`Lot ${lotNo} already exists.`); return; }
    setSaving(true);
    try {
      const pieces = cart.map((row, idx) => ({ seq: idx + 1, weight: Number(row.weight) }));
      await onCreateLot({ lotNo, date, itemId, firmId, pieces });
      const totalPieces = cart.length;
      const totalWeight = cart.reduce((s, r) => s + (Number(r.weight)||0), 0);
      alert(`Saved Lot ${lotNo} with ${totalPieces} pcs / ${formatKg(totalWeight)} kg`);
      setCart([]);
      setWeight("");
      setLotNo("");
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
        actions={<><SecondaryButton onClick={startNewLot}>Start New Lot</SecondaryButton><Pill>Lot No is auto-generated & stored in database</Pill></>}
      >
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>{setDate(e.target.value); setLotNo(""); setCart([]);}} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Firm (Supplier)</label><Select value={firmId} onChange={e=>setFirmId(e.target.value)}>{db.firms.length===0? <option>No firms</option> : db.firms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot No (auto)</label><Input value={lotNo} readOnly placeholder="Click Start New Lot" /></div>
          <div><label className={`text-xs ${cls.muted}`}>Weight (kg)</label><Input type="number" min="0" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} placeholder="e.g. 1.250" /></div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={addPiece} disabled={!canAdd}>Add</Button>
          <SecondaryButton onClick={()=>setCart([])} disabled={cart.length===0}>Clear Cart</SecondaryButton>
          <Button onClick={saveLot} disabled={!canSave || refreshing} className="ml-auto">{saving ? 'Saving…' : 'Save Lot'}</Button>
        </div>
        <CartPreview lotNo={lotNo} cart={cart} removeFromCart={removeFromCart} />
      </Section>
      <Section title="Recent Lots"><RecentLots db={db} /></Section>
    </div>
  );
}

function CartPreview({ lotNo, cart, removeFromCart }) {
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
                  <td className="py-2 pr-2">{lotNo ? `${lotNo}-${r.seq}` : "—"}</td>
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

function nextLotSequence(db, dateISO) {
  const countForDate = db.lots.filter(l => l.date === dateISO).length;
  return countForDate + 1;
}

function RecentLots({ db }) {
  const { cls } = useBrand();
  const rows = [...db.lots].sort((a,b)=> b.createdAt?.localeCompare?.(a.createdAt) || 0).slice(0,8).map(l=>({
    ...l,
    itemName: db.items.find(i=>i.id===l.itemId)?.name || "—",
    firmName: db.firms.find(f=>f.id===l.firmId)?.name || "—",
  }));
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Lot No</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
        <tbody>
          {rows.length===0? <tr><td colSpan={6} className="py-4">No lots yet.</td></tr> : rows.map(r=> (
            <tr key={r.lotNo} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2 font-medium">{r.lotNo}</td><td className="py-2 pr-2">{r.date}</td><td className="py-2 pr-2">{r.itemName}</td><td className="py-2 pr-2">{r.firmName}</td><td className="py-2 pr-2 text-right">{r.totalPieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/*********************
|* Stock On Hand Tab  *
\*********************/
function Stock({ db }) {
  const { cls } = useBrand();
  const available = db.inbound_items.filter(x => x.status === "available");
  const byItem = groupBy(available, i => i.itemId);
  const rows = Object.entries(byItem).map(([itemId, arr]) => ({ itemId, itemName: db.items.find(i=>i.id===itemId)?.name || "—", pieces: arr.length, weight: arr.reduce((s,x)=>s+x.weight,0), byLot: groupBy(arr, x=>x.lotNo) }));
  return (
    <div className="space-y-6">
      <Section title="Stock on Hand (by Item)">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Item</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
            <tbody>
              {rows.length===0? <tr><td colSpan={3} className="py-4">No stock.</td></tr> : rows.map(r=> (
                <tr key={r.itemId} className={`border-t ${cls.rowBorder} align-top`}><td className="py-2 pr-2"><div className="font-medium">{r.itemName}</div><div className={`${cls.muted} mt-1`}>{Object.entries(r.byLot).map(([lotNo, arr])=> (<div key={lotNo} className="text-xs">• Lot <b>{lotNo}</b>: {arr.length} pcs / {formatKg(arr.reduce((s,x)=>s+x.weight,0))} kg</div>))}</div></td><td className="py-2 pr-2 text-right">{r.pieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.weight)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Pieces (Detailed)">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Lot</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
            <tbody>
              {available.length===0? <tr><td colSpan={4} className="py-4">No available pieces.</td></tr> : available.sort((a,b)=>a.id.localeCompare(b.id)).map(p=> (
                <tr key={p.id} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2 font-mono">{p.id}</td><td className="py-2 pr-2">{db.items.find(i=>i.id===p.itemId)?.name || "—"}</td><td className="py-2 pr-2">{p.lotNo}</td><td className="py-2 pr-2 text-right">{formatKg(p.weight)}</td></tr>
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
  const [itemId, setItemId] = useState(db.items[0]?.id || "");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [issuing, setIssuing] = useState(false);

  useEffect(() => {
    if (db.items.length && !db.items.some(i => i.id === itemId)) {
      setItemId(db.items[0]?.id || "");
    }
  }, [db.items, itemId]);

  const candidateLots = useMemo(() => db.lots.filter(l => l.itemId === itemId), [db.lots, itemId]);
  const [lotNo, setLotNo] = useState(candidateLots[0]?.lotNo || "");

  useEffect(() => {
    const first = candidateLots[0]?.lotNo || "";
    setLotNo(first);
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
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot</label><Select value={lotNo} onChange={e=>setLotNo(e.target.value)}>{candidateLots.length===0? <option>No lots</option> : candidateLots.map(l=> <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}</Select></div>
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
function Masters({ db, onAddItem, onDeleteItem, onAddFirm, onDeleteFirm, refreshing }) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");
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

  const disable = working || refreshing;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Section title="Items">
        <div className="flex gap-2 mb-3"><Input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New item name" /><Button onClick={addItem} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.items.map(i => (
          <li key={i.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{i.name}</span>
            <SecondaryButton onClick={()=>deleteItem(i.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>

      <Section title="Firms (Suppliers)">
        <div className="flex gap-2 mb-3"><Input value={firmName} onChange={e=>setFirmName(e.target.value)} placeholder="New firm name" /><Button onClick={addFirm} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.firms.map(f => (
          <li key={f.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{f.name}</span>
            <SecondaryButton onClick={()=>deleteFirm(f.id)} disabled={disable}>Delete</SecondaryButton>
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
  const byFirm = groupBy(db.lots, l => l.firmId);
  const firmRows = Object.entries(byFirm).map(([firmId, lots]) => ({ firmName: db.firms.find(f=>f.id===firmId)?.name || "—", lotsCount: lots.length, pieces: lots.reduce((s,l)=>s+l.totalPieces,0), weight: lots.reduce((s,l)=>s+l.totalWeight,0) }));
  return (
    <div className="space-y-6">
      <Section title="Supplier-wise Purchases">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Lots</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
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
  return (
    <div className="mb-6">
      <h3 className={`text-sm uppercase tracking-wide mb-2 ${cls.muted}`}>{title}</h3>
      {rows.length === 0 ? (<div className="text-sm">No rows.</div>) : (
        <div className="overflow-auto">
          <table className="w-full text-xs md:text-sm"><thead className={`text-left ${cls.muted}`}><tr>{keys.map(k => <th key={k} className="py-1 pr-2">{k}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (<tr key={i} className={`border-t ${cls.rowBorder}`}>{keys.map(k => <td key={k} className="py-1 pr-2 font-mono whitespace-pre">{String(r[k])}</td>)}</tr>))}
            </tbody>
          </table>
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
