/**
 * GLINTEX Inventory — Main App Component
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BrandCtx } from "../../context";
import { Button, SecondaryButton, Select } from "../../components";
import { Inbound, Stock, IssueToMachine, Masters, Reports, Settings, ReceiveFromMachine } from "../../pages";
import { THEME_KEY, defaultBrand, themeClasses, normalizeDb, extractBrandFromDb } from "../../utils";
import { getProcessDefinition, PROCESS_DEFINITIONS } from "../../constants/processes";
import * as api from "../../api";

const TABS = [
  { key: "inbound", label: "Inbound" },
  { key: "stock", label: "Stock" },
  { key: "issue", label: "Issue to machine" },
  { key: "receive", label: "Receive from machine" },
  { key: "masters", label: "Masters" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
];

const DEFAULT_TAB = "inbound";
const PROCESS_KEY = "glintex_active_process";

function isValidTab(value) {
  return TABS.some((tab) => tab.key === value);
}

function tabFromPath(pathname) {
  if (!pathname) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return null;
  if (segments[0] !== "app") return null;
  const candidate = segments[1] || DEFAULT_TAB;
  return isValidTab(candidate) ? candidate : null;
}

function tabToPath(tabKey) {
  return `/app/${tabKey}`;
}

export default function InventoryApp() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const LAST_TAB_KEY = "glintex_last_tab";
  const [tab, setTab] = useState(() => {
    const pathTab = typeof window !== "undefined" ? tabFromPath(window.location.pathname) : null;
    if (pathTab) return pathTab;
    return localStorage.getItem(LAST_TAB_KEY) || DEFAULT_TAB;
  });
  const [process, setProcess] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(PROCESS_KEY) || "cutter";
    }
    return "cutter";
  });
  const [brandPreview, setBrandPreview] = useState(defaultBrand);
  const [savingBrand, setSavingBrand] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const cls = useMemo(() => themeClasses(theme), [theme]);
  const processDef = getProcessDefinition(process);
  const processOptions = Object.values(PROCESS_DEFINITIONS);

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

  useEffect(() => {
    const routeTab = tabFromPath(location.pathname);
    if (!routeTab) {
      navigate(tabToPath(tab), { replace: true });
      return;
    }
    if (routeTab !== tab) {
      setTab(routeTab);
    }
  }, [location.pathname, tab, navigate]);

  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // Persist last active tab so a reload restores where the user was
  useEffect(() => { localStorage.setItem(LAST_TAB_KEY, tab); }, [tab]);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', brandPreview.primary);
    document.documentElement.style.setProperty('--brand-gold', brandPreview.gold);
  }, [brandPreview.primary, brandPreview.gold]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PROCESS_KEY, process);
  }, [process]);

  const brandCtxValue = useMemo(() => ({ theme, setTheme, brand: brandPreview, setBrand: setBrandPreview, cls }), [theme, setTheme, brandPreview, cls]);
  const handleSelectTab = useCallback((nextTab) => {
    setTab(nextTab);
    const targetPath = tabToPath(nextTab);
    if (location.pathname !== targetPath) {
      navigate(targetPath);
    }
  }, [location.pathname, navigate]);

  const handleCreateLot = useCallback(async (payload) => {
    await api.createLot(payload);
    await refreshDb();
  }, [refreshDb]);

  const handleIssueToMachine = useCallback(async (payload) => {
    const result = await api.createIssueToMachine(payload);
    await refreshDb();
    return result;
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

  const handleCreateWorker = useCallback(async (name, role) => {
    await api.createOperator(name, role);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteWorker = useCallback(async (id) => {
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

  const handleUpdateWorker = useCallback(async (id, name, role) => {
    await api.updateOperator(id, name, role);
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

  const handleCreateBox = useCallback(async (name, weight) => {
    await api.createBox(name, weight);
    await refreshDb();
  }, [refreshDb]);

  const handleDeleteBox = useCallback(async (id) => {
    await api.deleteBox(id);
    await refreshDb();
  }, [refreshDb]);

  const handleUpdateBox = useCallback(async (id, name, weight) => {
    await api.updateBox(id, name, weight);
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
                <button key={t.key} onClick={() => handleSelectTab(t.key)} className={`px-3 py-1.5 rounded-lg text-sm border ${tab===t.key?cls.navActive:"border-transparent"} ${tab!==t.key?cls.navHover:""} underline-on-hover` }>
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <div className="md:hidden">
                <Select value={tab} onChange={e=>handleSelectTab(e.target.value)}>
                  {TABS.map(t=> <option key={t.key} value={t.key}>{t.label}</option>)}
                </Select>
              </div>
            </div>
          </div>
        </header>

        <div className={`max-w-6xl mx-auto px-4 py-3 border-b ${cls.cardBorder} ${cls.cardBg} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="text-sm font-semibold">Active process: {processDef.label}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`${cls.muted}`}>Units:</span>
            <Select value={process} onChange={(e) => setProcess(e.target.value)}>
              {processOptions.map((proc) => (
                <option key={proc.id} value={proc.id}>{proc.label}</option>
              ))}
            </Select>
          </div>
        </div>

        {error && (
          <div className="bg-orange-500/10 border border-orange-400/30 text-orange-200 px-4 py-2 text-sm text-center">
            {error} <button className="underline ml-2" onClick={() => refreshDb().catch(() => {})}>Retry</button>
          </div>
        )}

        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {tab === "inbound" && <Inbound db={db} onCreateLot={handleCreateLot} refreshing={refreshing} />}
          {tab === "stock" && <Stock db={db} onIssueToMachine={handleIssueToMachine} refreshing={refreshing} refreshDb={refreshDb} process={process} />}
          {tab === "issue" && <IssueToMachine db={db} onIssueToMachine={handleIssueToMachine} refreshing={refreshing} refreshDb={refreshDb} process={process} />}
          {tab === "receive" && <ReceiveFromMachine db={db} refreshDb={refreshDb} onIssueToMachine={handleIssueToMachine} process={process} />}
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
            onAddWorker={handleCreateWorker}
            onDeleteWorker={handleDeleteWorker}
            onEditWorker={handleUpdateWorker}
            onAddBobbin={handleCreateBobbin}
            onDeleteBobbin={handleDeleteBobbin}
            onEditBobbin={handleUpdateBobbin}
            onAddBox={handleCreateBox}
            onDeleteBox={handleDeleteBox}
            onEditBox={handleUpdateBox}
            refreshing={refreshing}
          />}
          {tab === "reports" && <Reports db={db} />}
          {tab === "settings" && <Settings db={db} onSaveBrand={handleSaveBrand} savingBrand={savingBrand || refreshing} refreshDb={refreshDb} />}
        </main>
      </div>
    </BrandCtx.Provider>
  );
}
