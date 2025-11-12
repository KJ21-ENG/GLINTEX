/**
 * GLINTEX Inventory — Main App Component
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandCtx, useBrand } from './context';
import { Button, SecondaryButton, Select } from './components';
import { Inbound, Stock, IssueToMachine, Masters, Reports, Settings, ReceiveFromMachine } from './pages';
import { THEME_KEY, defaultBrand, themeClasses, normalizeDb, extractBrandFromDb } from './utils';
import * as api from './api';

const TABS = [
  { key: "inbound", label: "Inbound" },
  { key: "stock", label: "Stock" },
  { key: "issue", label: "Issue to machine" },
  { key: "receive", label: "Receive from machine" },
  { key: "masters", label: "Masters" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
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

  const handleIssueToMachine = useCallback(async (payload) => {
    await api.createIssueToMachine(payload);
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

  const handleCreateMachine = useCallback(async (name) => {
    await api.createMachine(name);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteMachine = useCallback(async (id) => {
    await api.deleteMachine(id);
    await refreshDb();
  }, [refreshDb]);

  const handleCreateOperator = useCallback(async (name) => {
    await api.createOperator(name);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteOperator = useCallback(async (id) => {
    await api.deleteOperator(id);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateItem = useCallback(async (id, name) => {
    await api.updateItem(id, name);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateFirm = useCallback(async (id, name) => {
    await api.updateFirm(id, name);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateSupplier = useCallback(async (id, name) => {
    await api.updateSupplier(id, name);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateMachine = useCallback(async (id, name) => {
    await api.updateMachine(id, name);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateOperator = useCallback(async (id, name) => {
    await api.updateOperator(id, name);
    await refreshDb();
  }, [refreshDb]);

  const handleCreateBobbin = useCallback(async (name, weight) => {
    await api.createBobbin(name, weight);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteBobbin = useCallback(async (id) => {
    await api.deleteBobbin(id);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateBobbin = useCallback(async (id, name, weight) => {
    await api.updateBobbin(id, name, weight);
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
              <div
                role="button"
                tabIndex={0}
                title="Toggle theme"
                onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTheme(t => (t === "dark" ? "light" : "dark")); } }}
                className="w-9 h-9 rounded-xl grid place-items-center font-bold border overflow-hidden cursor-pointer"
                style={{ background: "#fff", borderColor: brandPreview.gold }}
              >
                <img src={headerLogo} alt="GLINTEX" className="w-9 h-9 object-contain" />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-bold">GLINTEX Inventory</h1>
                <p className={`text-xs -mt-0.5 ${cls.muted}`}>Single warehouse · Piece + weight (kg) · Lots</p>
              </div>
            </div>
            <nav className="hidden md:flex gap-2">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-lg text-sm border ${tab===t.key?cls.navActive:"border-transparent"} ${tab!==t.key?cls.navHover:""} underline-on-hover` }>
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
          {tab === "stock" && <Stock db={db} onIssueToMachine={handleIssueToMachine} refreshing={refreshing} refreshDb={refreshDb} />}
          {tab === "issue" && <IssueToMachine db={db} onIssueToMachine={handleIssueToMachine} refreshing={refreshing} refreshDb={refreshDb} />}
          {tab === "receive" && <ReceiveFromMachine db={db} refreshDb={refreshDb} />}
          {tab === "masters" && <Masters
            db={db}
            onAddItem={handleCreateItem}
            onDeleteItem={handleDeleteItem}
            onEditItem={handleUpdateItem}
            onAddFirm={handleCreateFirm}
            onDeleteFirm={handleDeleteFirm}
            onEditFirm={handleUpdateFirm}
            onAddSupplier={handleCreateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            onEditSupplier={handleUpdateSupplier}
            onAddMachine={handleCreateMachine}
            onDeleteMachine={handleDeleteMachine}
            onEditMachine={handleUpdateMachine}
            onAddOperator={handleCreateOperator}
            onDeleteOperator={handleDeleteOperator}
            onEditOperator={handleUpdateOperator}
            onAddBobbin={handleCreateBobbin}
            onDeleteBobbin={handleDeleteBobbin}
            onEditBobbin={handleUpdateBobbin}
            refreshing={refreshing}
          />}
          {tab === "reports" && <Reports db={db} />}
          {tab === "settings" && <Settings db={db} onSaveBrand={handleSaveBrand} savingBrand={savingBrand || refreshing} refreshDb={refreshDb} />}
        </main>
      </div>
    </BrandCtx.Provider>
  );
}
