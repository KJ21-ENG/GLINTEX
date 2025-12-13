import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import * as api from "../api/client";
import { normalizeDb, extractBrandFromDb, defaultBrand, THEME_KEY, themeClasses } from "../utils";

const InventoryContext = createContext(null);

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error("useInventory must be used within an InventoryProvider");
  }
  return context;
};

export const useBrand = useInventory;

export const InventoryProvider = ({ children }) => {
  // --- State ---
  const [db, setDb] = useState(() => normalizeDb({}));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light"); // Default to light for modern feel

  const [brand, setBrand] = useState(defaultBrand);
  const [process, setProcess] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem("glintex_active_process") || "cutter";
    }
    return "cutter";
  });

  // --- Derived State ---
  const cls = useMemo(() => themeClasses(theme), [theme]);

  // --- Effects ---

  // 1. Load DB
  const loadDb = useCallback(async () => {
    const raw = await api.getDB();
    const normalized = normalizeDb(raw);
    setDb(normalized);
    return normalized;
  }, []);

  const refreshDb = useCallback(async () => {
    setRefreshing(true);
    try {
      const normalized = await loadDb();
      setBrand(extractBrandFromDb(normalized));
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

  // Initial Load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const normalized = await loadDb();
        if (cancelled) return;
        setBrand(extractBrandFromDb(normalized));
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

  // 2. Theme & Brand Handling
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.setProperty("color-scheme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    // We map the brand primary color to the tailwind variable --primary
    // Note: Tailwind 3.4 with CSS vars expects HSL numbers usually if using <alpha-value>, 
    // but since our legacy config might just be hex, we might need to be careful.
    // The new index.css uses HSL variables. We need to convert Hex to HSL or just set the color directly if we override.
    // For now, let's just set a --brand-primary variable and maybe --primary if we can convert.
    // Actually, keeping it simple: We will just use the brand colors for specific branded elements, 
    // while keeping the UI structural colors (primary blue/slate) consistent.
    // OR, we update --primary to match the brand.

    root.style.setProperty('--brand-primary', brand.primary);
    root.style.setProperty('--brand-gold', brand.gold);
  }, [brand]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("glintex_active_process", process);
    }
  }, [process]);

  // --- API Actions ---
  // These wrappers handle the API call + Refresh
  const actions = useMemo(() => ({
    createLot: async (payload) => {
      const res = await api.createLot(payload);
      const normalized = await refreshDb();
      return { res, db: normalized };
    },
    deleteLot: async (lotNo) => { await api.deleteLot(lotNo); await refreshDb(); },

    createIssueToMachine: async (payload) => { const res = await api.createIssueToMachine(payload); await refreshDb(); return res; },
    deleteIssueToMachine: async (id) => { await api.deleteIssueToMachine(id); await refreshDb(); },

    // Masters - Items
    createItem: async (name) => { await api.createItem(name); await refreshDb(); },
    updateItem: async (id, name) => { await api.updateItem(id, name); await refreshDb(); },
    deleteItem: async (id) => { await api.deleteItem(id); await refreshDb(); },

    // Masters - Yarns
    createYarn: async (name) => { await api.createYarn(name); await refreshDb(); },
    updateYarn: async (id, name) => { await api.updateYarn(id, name); await refreshDb(); },
    deleteYarn: async (id) => { await api.deleteYarn(id); await refreshDb(); },

    // Masters - Cuts
    createCut: async (name) => { await api.createCut(name); await refreshDb(); },
    updateCut: async (id, name) => { await api.updateCut(id, name); await refreshDb(); },
    deleteCut: async (id) => { await api.deleteCut(id); await refreshDb(); },

    // Masters - Twists
    createTwist: async (name) => { await api.createTwist(name); await refreshDb(); },
    updateTwist: async (id, name) => { await api.updateTwist(id, name); await refreshDb(); },
    deleteTwist: async (id) => { await api.deleteTwist(id); await refreshDb(); },

    // Masters - Firms
    createFirm: async (name) => { await api.createFirm(name); await refreshDb(); },
    updateFirm: async (id, name) => { await api.updateFirm(id, name); await refreshDb(); },
    deleteFirm: async (id) => { await api.deleteFirm(id); await refreshDb(); },

    // Masters - Suppliers
    createSupplier: async (name) => { await api.createSupplier(name); await refreshDb(); },
    updateSupplier: async (id, name) => { await api.updateSupplier(id, name); await refreshDb(); },
    deleteSupplier: async (id) => { await api.deleteSupplier(id); await refreshDb(); },

    // Masters - Machines
    createMachine: async (name, processType) => { await api.createMachine(name, processType); await refreshDb(); },
    updateMachine: async (id, name, processType) => { await api.updateMachine(id, name, processType); await refreshDb(); },
    deleteMachine: async (id) => { await api.deleteMachine(id); await refreshDb(); },

    // Masters - Operators/Workers
    createOperator: async (name, role, processType) => { await api.createOperator(name, role, processType); await refreshDb(); },
    updateOperator: async (id, name, role, processType) => { await api.updateOperator(id, name, role, processType); await refreshDb(); },
    deleteOperator: async (id) => { await api.deleteOperator(id); await refreshDb(); },

    // Masters - Bobbins
    createBobbin: async (name, weight) => { await api.createBobbin(name, weight); await refreshDb(); },
    updateBobbin: async (id, name, weight) => { await api.updateBobbin(id, name, weight); await refreshDb(); },
    deleteBobbin: async (id) => { await api.deleteBobbin(id); await refreshDb(); },

    // Masters - RollTypes
    createRollType: async (name, weight) => { await api.createRollType(name, weight); await refreshDb(); },
    updateRollType: async (id, name, weight) => { await api.updateRollType(id, name, weight); await refreshDb(); },
    deleteRollType: async (id) => { await api.deleteRollType(id); await refreshDb(); },

    // Masters - ConeTypes
    createConeType: async (name, weight) => { await api.createConeType(name, weight); await refreshDb(); },
    updateConeType: async (id, name, weight) => { await api.updateConeType(id, name, weight); await refreshDb(); },
    deleteConeType: async (id) => { await api.deleteConeType(id); await refreshDb(); },

    // Masters - Wrappers
    createWrapper: async (name) => { await api.createWrapper(name); await refreshDb(); },
    updateWrapper: async (id, name) => { await api.updateWrapper(id, name); await refreshDb(); },
    deleteWrapper: async (id) => { await api.deleteWrapper(id); await refreshDb(); },

    // Masters - Boxes
    createBox: async (name, weight, processType) => { await api.createBox(name, weight, processType); await refreshDb(); },
    updateBox: async (id, name, weight, processType) => { await api.updateBox(id, name, weight, processType); await refreshDb(); },
    deleteBox: async (id) => { await api.deleteBox(id); await refreshDb(); },

    // Settings
    updateSettings: async (values) => {
      await api.updateSettings(values);
      setBrand(values); // Optimistic update
      await refreshDb();
    },
  }), [refreshDb]);

  const value = useMemo(() => ({
    db,
    loading,
    refreshing,
    error,
    theme,
    setTheme,
    cls,
    brand,
    process,
    setProcess,
    refreshDb,
    ...actions
  }), [db, loading, refreshing, error, theme, cls, brand, process, refreshDb, actions]);

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};
