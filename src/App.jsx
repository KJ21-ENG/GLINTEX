import React, { useEffect, useMemo, useState, useContext, createContext } from "react";

/**
 * GLINTEX Inventory — Vite app
 * Matches Canvas v4 features with branding + theme toggle.
 */

const DB_KEY = "glintex_db_v1";
const THEME_KEY = "glintex_theme";

const BrandCtx = createContext(null);
function useBrand() { return useContext(BrandCtx); }

function formatKg(n) { if (n==null || Number.isNaN(n)) return "0.000"; return Number(n).toFixed(3); }
function uid(prefix = "id") { return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function yyyymmdd(dateISO) { return dateISO.replaceAll("-", ""); }

function loadDB() { try { const raw = localStorage.getItem(DB_KEY); if (!raw) return null; return JSON.parse(raw); } catch { return null; } }
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

const defaultBrand = {
  primary: "#2E4CA6", // GLINTEX blue (tweak if you prefer exact sample)
  gold: "#D4AF37",    // gold
  logoDataUrl: "",    // uploaded logo preview (optional)
};

const makeEmptyDB = () => ({
  items: [],
  firms: [],
  lots: [],
  inbound_items: [], // {id, lotNo, itemId, weight, status, seq, createdAt}
  consumptions: [],  // issues to machine entries
  counters: { lot: {} },
  ui: {
    issueSelections: {}, // { [lotNo]: string[] }
    brand: defaultBrand,
  },
});

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

/****************************\
|* Small UI helpers (no libs)*
\****************************/
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

/*************************\
|* App root & navigation *|
\*************************/
const TABS = [
  { key: "inbound", label: "Inbound" },
  { key: "stock", label: "Stock" },
  { key: "issue", label: "Issue to machine" },
  { key: "masters", label: "Masters" },
  { key: "reports", label: "Reports" },
  { key: "data", label: "Admin / Data" },
];

export default function App() {
  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");

  // Data
  const [db, setDb] = useState(() => loadDB() || seedInitial());
  const [tab, setTab] = useState("inbound");

  // Derived UI helpers
  const brand = db.ui?.brand || defaultBrand;
  const cls = themeClasses(theme);

  useEffect(() => { saveDB(db); }, [db]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  // Keep the document <html> data-theme in sync so CSS variables switch
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setBrand = (fnOrObj) => {
    setDb(prev => {
      const next = typeof fnOrObj === 'function' ? fnOrObj(prev.ui?.brand || defaultBrand) : fnOrObj;
      return { ...prev, ui: { ...(prev.ui||{}), brand: next } };
    });
  };

  useEffect(() => {
    // Sync brand colors to CSS custom properties so pure-CSS parts pick them up
    document.documentElement.style.setProperty('--brand-primary', brand.primary);
    document.documentElement.style.setProperty('--brand-gold', brand.gold);
  }, [brand.primary, brand.gold]);

  // Helper: convert #RRGGBB to rgba() with alpha
  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    const h = hex.replace('#', '').trim();
    if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  // Static logo fallback from /public/brand-logo.jpg if user hasn't uploaded
  const headerLogo = brand.logoDataUrl || "/brand-logo.jpg";

  return (
    <BrandCtx.Provider value={{ theme, setTheme, brand, setBrand, cls }}>
      <div className={`min-h-screen w-full ${cls.baseText}`}
        style={{ backgroundColor: 'var(--bg)' }}
      >
        <header className={`sticky top-0 z-20 backdrop-blur border-b ${cls.headerBg}`}>
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl grid place-items-center font-bold border overflow-hidden" style={{ background: "#fff", borderColor: brand.gold }}>
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
              <SecondaryButton onClick={toggleTheme}>{theme === "dark" ? "☀️ Light" : "🌙 Dark"}</SecondaryButton>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {tab === "inbound" && <Inbound db={db} setDb={setDb} />}
          {tab === "stock" && <Stock db={db} />}
          {tab === "issue" && <IssueToMachine db={db} setDb={setDb} />}
          {tab === "masters" && <Masters db={db} setDb={setDb} />}
          {tab === "reports" && <Reports db={db} />}
          {tab === "data" && <AdminData db={db} setDb={setDb} />}
        </main>
      </div>
    </BrandCtx.Provider>
  );
}

/****************
 * Seed helpers *
 ****************/
function seedInitial() {
  const db = makeEmptyDB();
  const i1 = { id: uid("item"), name: "Metallic Yarn" };
  const i2 = { id: uid("item"), name: "Polyester Yarn" };
  const f1 = { id: uid("firm"), name: "ABC Suppliers" };
  const f2 = { id: uid("firm"), name: "Shree Traders" };
  db.items.push(i1, i2); db.firms.push(f1, f2);
  saveDB(db);
  return db;
}

/*********************
|* Inbound Receiving  *
\*********************/
function Inbound({ db, setDb }) {
  const { cls } = useBrand();
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState(db.items[0]?.id || "");
  const [firmId, setFirmId] = useState(db.firms[0]?.id || "");
  const [lotNo, setLotNo] = useState("");
  const [weight, setWeight] = useState("");
  const [cart, setCart] = useState([]);

  const canAdd = date && itemId && firmId && lotNo && Number(weight) > 0;
  const canSave = cart.length > 0 && date && itemId && firmId && lotNo;

  function startNewLot() {
    const seq = nextLotSequence(db, date);
    const newLotNo = `${yyyymmdd(date)}-${String(seq).padStart(3, "0")}`;
    setLotNo(newLotNo); setCart([]); setWeight("");
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

  function saveLot() {
    if (!canSave) return;
    if (db.lots.some(l => l.lotNo === lotNo)) { alert(`Lot ${lotNo} already exists.`); return; }

    const totalPieces = cart.length;
    const totalWeight = cart.reduce((s, r) => s + (Number(r.weight)||0), 0);

    const lot = { lotNo, date, itemId, firmId, totalPieces, totalWeight, createdAt: new Date().toISOString() };
    const items = cart.map((row, idx) => ({ id: `${lotNo}-${idx+1}`, lotNo, itemId, weight: Number(row.weight), status: "available", seq: idx+1, createdAt: new Date().toISOString() }));

    const nextCounters = { ...db.counters };
    const dkey = yyyymmdd(date);
    nextCounters.lot = { ...nextCounters.lot, [dkey]: (nextCounters.lot?.[dkey] || 0) + 1 };

    setDb({ ...db, counters: nextCounters, lots: [...db.lots, lot], inbound_items: [...db.inbound_items, ...items] });
    setCart([]); setWeight("");
    alert(`Saved Lot ${lotNo} with ${totalPieces} pcs / ${formatKg(totalWeight)} kg`);
  }

  return (
    <div className="space-y-6">
      <Section
        title="Inbound Receiving"
        actions={<><SecondaryButton onClick={startNewLot}>Start New Lot</SecondaryButton><Pill>Lot No is auto‑generated & non‑editable</Pill></>}
      >
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>{setDate(e.target.value); setLotNo(""); setCart([]);}} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}>{db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Firm (Supplier)</label><Select value={firmId} onChange={e=>setFirmId(e.target.value)}>{db.firms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot No (auto)</label><Input value={lotNo} readOnly placeholder="Click Start New Lot" /></div>
          <div><label className={`text-xs ${cls.muted}`}>Weight (kg)</label><Input type="number" min="0" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} placeholder="e.g. 1.250" /></div>
        </div>
        <div className="mt-3 flex gap-2"><Button onClick={addPiece} disabled={!canAdd}>Add</Button><SecondaryButton onClick={()=>setCart([])} disabled={cart.length===0}>Clear Cart</SecondaryButton><Button onClick={saveLot} disabled={!canSave} className="ml-auto">Save Lot</Button></div>
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

function nextLotSequence(db, dateISO) { const key = yyyymmdd(dateISO); const current = db.counters?.lot?.[key] || 0; return current + 1; }

function RecentLots({ db }) {
  const { cls } = useBrand();
  const rows = [...db.lots].sort((a,b)=> b.createdAt.localeCompare(a.createdAt)).slice(0,8).map(l=>({ ...l, itemName: db.items.find(i=>i.id===l.itemId)?.name || "—", firmName: db.firms.find(f=>f.id===l.firmId)?.name || "—" }));
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
function IssueToMachine({ db, setDb }) {
  const { cls } = useBrand();
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState(db.items[0]?.id || "");
  const candidateLots = useMemo(() => db.lots.filter(l => l.itemId === itemId), [db.lots, itemId]);
  const [lotNo, setLotNo] = useState(candidateLots[0]?.lotNo || "");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    const lots = db.lots.filter(l => l.itemId === itemId);
    const first = lots[0]?.lotNo || "";
    setLotNo(first);
  }, [itemId, db.lots]);

  useEffect(() => {
    if (!lotNo) { setSelected([]); return; }
    const saved = db.ui?.issueSelections?.[lotNo] || [];
    const availSet = new Set(db.inbound_items.filter(ii => ii.lotNo===lotNo && ii.status==='available').map(ii=>ii.id));
    const filtered = saved.filter(id => availSet.has(id));
    setSelected(filtered);
  }, [lotNo, db.inbound_items]);

  const availablePieces = useMemo(() => db.inbound_items
    .filter(ii => ii.lotNo===lotNo && ii.itemId===itemId && ii.status==='available')
    .sort((a,b)=> a.seq - b.seq), [db.inbound_items, lotNo, itemId]);

  const lastIssueForLot = useMemo(() => {
    const rows = db.consumptions.filter(c => c.lotNo===lotNo).sort((a,b)=> b.date.localeCompare(a.date));
    return rows[0] || null;
  }, [db.consumptions, lotNo]);

  function persistSelection(l, ids) {
    setDb(prev => ({ ...prev, ui: { ...prev.ui, issueSelections: { ...(prev.ui?.issueSelections||{}), [l]: ids } } }));
  }
  function toggle(id) { const next = selected.includes(id) ? selected.filter(x=>x!==id) : [...selected, id]; setSelected(next); persistSelection(lotNo, next); }
  function selectAll() { const all = availablePieces.map(p=>p.id); setSelected(all); persistSelection(lotNo, all); }
  function clearSel() { setSelected([]); persistSelection(lotNo, []); }

  function issue() {
    if (!date || !itemId || !lotNo || selected.length===0) return;
    const availSet = new Set(availablePieces.map(p=>p.id));
    const chosen = selected.filter(id => availSet.has(id));
    if (chosen.length===0) { alert("Nothing to issue. Selected pieces are not available."); return; }

    const picked = availablePieces.filter(p=> chosen.includes(p.id));
    const totalWeight = picked.reduce((s,p)=>s+p.weight,0);

    const updatedItems = db.inbound_items.map(ii => chosen.includes(ii.id) ? { ...ii, status: 'consumed' } : ii);
    const entry = { id: uid("use"), date, itemId, lotNo, count: chosen.length, totalWeight, pieceIds: chosen, reason: 'internal', note };

    const remainingSel = (db.ui?.issueSelections?.[lotNo] || []).filter(id => !chosen.includes(id));
    setDb({ ...db, inbound_items: updatedItems, consumptions: [...db.consumptions, entry], ui: { ...db.ui, issueSelections: { ...(db.ui?.issueSelections||{}), [lotNo]: remainingSel } } });
    setSelected([]); setNote("");
    alert(`Issued ${chosen.length} pcs from Lot ${lotNo} (Total ${formatKg(totalWeight)} kg)`);
  }

  return (
    <div className="space-y-6">
      <Section title="Issue to machine">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}>{db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot</label><Select value={lotNo} onChange={e=>setLotNo(e.target.value)}>{candidateLots.length===0? <option>No lots</option> : candidateLots.map(l=> <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}</Select></div>
          <div className="md:col-span-2"><label className={`text-xs ${cls.muted}`}>Note (optional)</label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reference / reason" /></div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Pill>Available: {availablePieces.length} pcs</Pill>
          <Pill>Selected: {selected.length} pcs</Pill>
          <SecondaryButton onClick={selectAll} disabled={availablePieces.length===0}>Select all</SecondaryButton>
          <SecondaryButton onClick={clearSel} disabled={selected.length===0}>Clear</SecondaryButton>
          <Button onClick={issue} disabled={selected.length===0} className="ml-auto">Issue</Button>
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
          {rows.length===0? <tr><td colSpan={7} className="py-4">No issues yet.</td></tr> : rows.map(r => (
            <tr key={r.id} className={`border-t ${cls.rowBorder} align-top`}>
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
function Masters({ db, setDb }) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");

  function addItem() { const name = itemName.trim(); if (!name) return; if (db.items.some(i => i.name.toLowerCase() === name.toLowerCase())) { alert("Item already exists"); return; } setDb({ ...db, items: [...db.items, { id: uid("item"), name }] }); setItemName(""); }
  function deleteItem(id) { if (!confirm("Delete item? You cannot remove it if referenced by lots.")) return; const used = db.lots.some(l => l.itemId === id) || db.inbound_items.some(ii => ii.itemId === id); if (used) { alert("Item in use. Cannot delete."); return; } setDb({ ...db, items: db.items.filter(i=>i.id!==id) }); }
  function addFirm() { const name = firmName.trim(); if (!name) return; if (db.firms.some(f => f.name.toLowerCase() === name.toLowerCase())) { alert("Firm already exists"); return; } setDb({ ...db, firms: [...db.firms, { id: uid("firm"), name }] }); setFirmName(""); }
  function deleteFirm(id) { if (!confirm("Delete firm? You cannot remove it if referenced by lots.")) return; const used = db.lots.some(l => l.firmId === id); if (used) { alert("Firm in use. Cannot delete."); return; } setDb({ ...db, firms: db.firms.filter(f=>f.id!==id) }); }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Section title="Items">
        <div className="flex gap-2 mb-3"><Input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New item name" /><Button onClick={addItem}>Add</Button></div>
        <ul className="space-y-2">{db.items.map(i => (<li key={i.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}><span>{i.name}</span><SecondaryButton onClick={()=>deleteItem(i.id)}>Delete</SecondaryButton></li>))}</ul>
      </Section>

      <Section title="Firms (Suppliers)">
        <div className="flex gap-2 mb-3"><Input value={firmName} onChange={e=>setFirmName(e.target.value)} placeholder="New firm name" /><Button onClick={addFirm}>Add</Button></div>
        <ul className="space-y-2">{db.firms.map(f => (<li key={f.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}><span>{f.name}</span><SecondaryButton onClick={()=>deleteFirm(f.id)}>Delete</SecondaryButton></li>))}</ul>
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
function AdminData({ db, setDb }) {
  const { brand, setBrand, cls } = useBrand();

  function exportJSON() { const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `glintex_inventory_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); }
  function importJSON(e) { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(String(reader.result)); if (!parsed || !parsed.items || !parsed.firms || !parsed.lots || !parsed.inbound_items) throw new Error("Invalid backup file"); setDb(parsed); alert("Import successful."); } catch (err) { alert("Failed to import: " + err.message); } }; reader.readAsText(file); }

  function resetDB() { if (!confirm("This will erase all data (keeps initial seeds). Continue?")) return; const fresh = seedInitial(); setDb(fresh); }

  function onLogo(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setBrand(prev => ({ ...prev, logoDataUrl: String(reader.result) })); };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-6">
      <Section title="Branding (GLINTEX)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={`text-xs ${cls.muted}`}>Primary (Blue) — HEX</label>
            <Input value={brand.primary} onChange={e=>setBrand(prev=>({ ...prev, primary: e.target.value }))} />
          </div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Accent (Gold) — HEX</label>
            <Input value={brand.gold} onChange={e=>setBrand(prev=>({ ...prev, gold: e.target.value }))} />
          </div>
          <div className="flex items-end gap-2">
            <label className="inline-flex items-center gap-2">
              <SecondaryButton as="span">Upload Logo</SecondaryButton>
              <input type="file" accept="image/*" onChange={onLogo} className="hidden" />
            </label>
            <img src={brand.logoDataUrl || "/brand-logo.jpg"} alt="logo" className="h-9 object-contain border rounded-lg" />
          </div>
        </div>
        <div className="mt-3 flex gap-2 items-center">
          <Pill>Preview</Pill>
          <Button>Primary Button</Button>
          <SecondaryButton>Secondary</SecondaryButton>
        </div>
      </Section>

      <Section title="Backup & Restore">
        <div className="flex flex-col md:flex-row gap-3"><Button onClick={exportJSON}>Export JSON</Button><label className="inline-flex items-center gap-2"><SecondaryButton>Import JSON</SecondaryButton><input type="file" accept="application/json" onChange={importJSON} className="hidden" /></label><SecondaryButton onClick={resetDB}>Reset DB</SecondaryButton></div>
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

function RawTable({ title, rows }) { const { cls } = useBrand(); const keys = Object.keys(rows[0] || {}); 
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
