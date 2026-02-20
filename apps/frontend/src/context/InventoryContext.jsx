import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
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

const BOOTSTRAP_KEYS = [
  'items',
  'yarns',
  'cuts',
  'twists',
  'firms',
  'customers',
  'suppliers',
  'machines',
  'workers',
  'bobbins',
  'boxes',
  'roll_types',
  'cone_types',
  'wrappers',
  'settings',
];

const buildRawFromDb = (db) => ({
  items: db?.items || [],
  yarns: db?.yarns || [],
  cuts: db?.cuts || [],
  twists: db?.twists || [],
  firms: db?.firms || [],
  customers: db?.customers || [],
  suppliers: db?.suppliers || [],
  machines: db?.machines || [],
  workers: db?.workers || [],
  bobbins: db?.bobbins || [],
  boxes: db?.boxes || [],
  lots: db?.lots || [],
  inbound_items: db?.inbound_items || [],
  roll_types: db?.rollTypes || [],
  cone_types: db?.cone_types || [],
  wrappers: db?.wrappers || [],
  issue_to_cutter_machine: db?.issue_to_cutter_machine || [],
  issue_to_cutter_machine_lines: db?.issue_to_cutter_machine_lines || [],
  issue_to_holo_machine: db?.issue_to_holo_machine || [],
  issue_to_coning_machine: db?.issue_to_coning_machine || [],
  issue_take_backs: db?.issue_take_backs || [],
  issue_balances: db?.issue_balances || {},
  settings: db?.settings || [],
  receive_from_cutter_machine_uploads: db?.receive_from_cutter_machine_uploads || [],
  receive_from_cutter_machine_rows: db?.receive_from_cutter_machine_rows || [],
  receive_from_cutter_machine_challans: db?.receive_from_cutter_machine_challans || [],
  receive_from_cutter_machine_piece_totals: db?.receive_from_cutter_machine_piece_totals || [],
  receive_from_holo_machine_rows: db?.receive_from_holo_machine_rows || [],
  receive_from_holo_machine_piece_totals: db?.receive_from_holo_machine_piece_totals || [],
  receive_from_coning_machine_rows: db?.receive_from_coning_machine_rows || [],
  receive_from_coning_machine_piece_totals: db?.receive_from_coning_machine_piece_totals || [],
});

const getModuleKey = (module, options = {}) => {
  if (module === 'process') {
    const process = options.process || 'cutter';
    const scope = options.full ? 'full' : 'default';
    return `process:${process}:${scope}`;
  }
  return module;
};

const normalizeProcess = (value) => {
  const stage = String(value || '').toLowerCase();
  if (stage === 'holo' || stage === 'coning' || stage === 'cutter') return stage;
  return 'cutter';
};

const normalizeOpeningStage = (value) => {
  const stage = String(value || '').toLowerCase();
  if (stage === 'inbound' || stage === 'cutter' || stage === 'holo' || stage === 'coning') return stage;
  return 'inbound';
};

export const INVENTORY_INVALIDATION_KEYS = Object.freeze({
  issueOnMachine: (process) => `issue:on-machine:${normalizeProcess(process)}`,
  issueHistory: (process) => `issue:history:${normalizeProcess(process)}`,
  receiveHistory: (process) => `receive:history:${normalizeProcess(process)}`,
  openingStockHistory: (stage) => `opening-stock:history:${normalizeOpeningStage(stage)}`,
});

export const InventoryProvider = ({ children }) => {
  // --- State ---
  const [db, setDb] = useState(() => normalizeDb({}));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [moduleLoading, setModuleLoading] = useState({});
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light"); // Default to light for modern feel
  const loadedModulesRef = useRef(new Set());
  const [loadedModules, setLoadedModules] = useState(new Set());
  const dbRef = useRef(db);
  const inflightLoadsRef = useRef(new Map());
  const invalidationSubscribersRef = useRef(new Map());
  const invalidationVersionRef = useRef(new Map());

  const [brand, setBrand] = useState(defaultBrand);
  const [process, setProcess] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem("glintex_active_process") || "cutter";
    }
    return "cutter";
  });

  // --- Derived State ---
  const cls = useMemo(() => themeClasses(theme), [theme]);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  // --- Effects ---

  const applyDbUpdate = useCallback((rawUpdate = {}, { clearKeys = [] } = {}) => {
    const baseRaw = buildRawFromDb(dbRef.current || {});
    const nextRaw = { ...baseRaw, ...rawUpdate };
    if (Object.prototype.hasOwnProperty.call(rawUpdate || {}, 'issue_balances')) {
      nextRaw.issue_balances = {
        ...(baseRaw.issue_balances || {}),
        ...((rawUpdate && rawUpdate.issue_balances) || {}),
      };
    }
    clearKeys.forEach((key) => {
      nextRaw[key] = [];
    });
    const normalized = normalizeDb(nextRaw);
    dbRef.current = normalized;
    setDb(normalized);
    return normalized;
  }, []);

  const patchDb = useCallback((rawUpdate = {}, options = {}) => {
    return applyDbUpdate(rawUpdate, options);
  }, [applyDbUpdate]);

  const loadBootstrap = useCallback(async () => {
    const key = '__bootstrap__';
    if (inflightLoadsRef.current.has(key)) {
      return await inflightLoadsRef.current.get(key);
    }

    const promise = (async () => {
      const res = await api.getBootstrap();
      const slices = res?.slices || {};
      const allowed = res?.allowed || {};
      const clearKeys = BOOTSTRAP_KEYS.filter((key) => allowed[key] === false);
      const normalized = applyDbUpdate(slices, { clearKeys });
      if (res?.brand) {
        setBrand({
          primary: res.brand.primary || defaultBrand.primary,
          gold: res.brand.gold || defaultBrand.gold,
          logoDataUrl: res.brand.logoDataUrl || '',
          faviconDataUrl: res.brand.faviconDataUrl || '',
        });
      } else {
        setBrand(extractBrandFromDb(normalized));
      }
      return normalized;
    })();

    inflightLoadsRef.current.set(key, promise);
    try {
      return await promise;
    } finally {
      inflightLoadsRef.current.delete(key);
    }
  }, [applyDbUpdate]);

  const loadModuleData = useCallback(async (module, options = {}, { force = false } = {}) => {
    const moduleKey = getModuleKey(module, options);
    if (!force && loadedModulesRef.current.has(moduleKey)) return null;
    if (inflightLoadsRef.current.has(moduleKey)) {
      return await inflightLoadsRef.current.get(moduleKey);
    }

    const promise = (async () => {
      setModuleLoading((prev) => ({ ...prev, [moduleKey]: true }));
      try {
        let raw = null;
        if (module === 'inbound') {
          raw = await api.getModuleInbound();
        } else if (module === 'process') {
          const process = options.process || 'cutter';
          raw = await api.getModuleProcess(process, { full: options.full });
        } else if (module === 'opening_stock') {
          raw = await api.getModuleOpeningStock();
        } else {
          throw new Error(`Unknown module ${module}`);
        }
        const normalized = applyDbUpdate(raw || {});
        loadedModulesRef.current.add(moduleKey);
        setLoadedModules(new Set(loadedModulesRef.current));
        return normalized;
      } catch (err) {
        console.error(`Failed to load module ${moduleKey}`, err);
        throw err;
      } finally {
        setModuleLoading((prev) => ({ ...prev, [moduleKey]: false }));
      }
    })();

    inflightLoadsRef.current.set(moduleKey, promise);
    try {
      return await promise;
    } finally {
      inflightLoadsRef.current.delete(moduleKey);
    }
  }, [applyDbUpdate]);

  const loadModuleDataByKey = useCallback(async (moduleKey, { force = false } = {}) => {
    if (moduleKey.startsWith('process:')) {
      const parts = moduleKey.split(':');
      const process = parts[1] || 'cutter';
      const scope = parts[2] || 'default';
      const full = scope === 'full';
      return await loadModuleData('process', { process, full }, { force });
    }
    return await loadModuleData(moduleKey, {}, { force });
  }, [loadModuleData]);

  const ensureModuleData = useCallback(async (module, options = {}) => {
    return await loadModuleData(module, options, { force: false });
  }, [loadModuleData]);

  const refreshModuleData = useCallback(async (module, options = {}) => {
    return await loadModuleData(module, options, { force: true });
  }, [loadModuleData]);

  const refreshProcessData = useCallback(async (process, options = {}) => {
    if (!process) return null;
    const fullKey = `process:${process}:full`;
    const wantsFull = options.full === true || loadedModulesRef.current.has(fullKey);
    return await loadModuleData('process', { process, full: wantsFull }, { force: true });
  }, [loadModuleData]);

  const refreshDb = useCallback(async () => {
    setRefreshing(true);
    try {
      const normalized = await loadBootstrap();
      const moduleKeys = Array.from(loadedModulesRef.current);
      for (const key of moduleKeys) {
        await loadModuleDataByKey(key, { force: true });
      }
      setError(null);
      return normalized;
    } catch (err) {
      console.error("Refresh failed", err);
      setError(err.message || "Failed to refresh data");
      throw err;
    } finally {
      setRefreshing(false);
    }
  }, [loadBootstrap, loadModuleDataByKey]);

  const emitInvalidation = useCallback((keyOrKeys, payload = {}) => {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    keys.forEach((rawKey) => {
      const key = String(rawKey || '').trim();
      if (!key) return;
      const nextVersion = (Number(invalidationVersionRef.current.get(key)) || 0) + 1;
      invalidationVersionRef.current.set(key, nextVersion);
      const listeners = invalidationSubscribersRef.current.get(key);
      if (!listeners || listeners.size === 0) return;
      listeners.forEach((listener) => {
        try {
          listener({
            key,
            version: nextVersion,
            payload,
          });
        } catch (err) {
          console.error(`Invalidation listener failed for key ${key}`, err);
        }
      });
    });
  }, []);

  const subscribeInvalidation = useCallback((key, callback, options = {}) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || typeof callback !== 'function') {
      return () => { };
    }
    let listeners = invalidationSubscribersRef.current.get(normalizedKey);
    if (!listeners) {
      listeners = new Set();
      invalidationSubscribersRef.current.set(normalizedKey, listeners);
    }
    listeners.add(callback);

    if (options.replayLatest) {
      const version = Number(invalidationVersionRef.current.get(normalizedKey)) || 0;
      if (version > 0) {
        try {
          callback({ key: normalizedKey, version, payload: { replay: true } });
        } catch (err) {
          console.error(`Invalidation replay failed for key ${normalizedKey}`, err);
        }
      }
    }

    return () => {
      const set = invalidationSubscribersRef.current.get(normalizedKey);
      if (!set) return;
      set.delete(callback);
      if (set.size === 0) {
        invalidationSubscribersRef.current.delete(normalizedKey);
      }
    };
  }, []);

  const patchIssueRecord = useCallback((process, updatedIssue) => {
    if (!updatedIssue?.id) return;
    const key = process === 'holo'
      ? 'issue_to_holo_machine'
      : process === 'coning'
        ? 'issue_to_coning_machine'
        : 'issue_to_cutter_machine';
    const current = dbRef.current?.[key] || [];
    const idx = current.findIndex(row => row.id === updatedIssue.id);
    const next = idx >= 0
      ? current.map(row => (row.id === updatedIssue.id ? { ...row, ...updatedIssue } : row))
      : [updatedIssue, ...current];
    applyDbUpdate({ [key]: next });
  }, [applyDbUpdate]);

  // Initial Load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadBootstrap();
        if (cancelled) return;
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load bootstrap", err);
        setError(err.message || "Failed to load data from server");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadBootstrap]);

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

    if (brand.faviconDataUrl) {
      const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
      link.type = 'image/x-icon';
      link.rel = 'shortcut icon';
      link.href = brand.faviconDataUrl;
      document.getElementsByTagName('head')[0].appendChild(link);
    } else {
      // optional: reset to default if no custom favicon
      const link = document.querySelector("link[rel*='icon']");
      if (link) link.href = '/favicon.png';
    }
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
      // Lot creation changes inbound basics; avoid full bootstrap refresh.
      const normalized = await refreshModuleData('inbound');
      return { res, db: normalized };
    },
    deleteLot: async (lotNo) => {
      await api.deleteLot(lotNo);
      // Lot deletion changes inbound basics; avoid full bootstrap refresh.
      await refreshModuleData('inbound');
    },

    createIssueToMachine: async (payload) => {
      const res = await api.createIssueToMachine(payload);
      // This action is cutter-only; avoid full bootstrap refresh.
      await refreshProcessData('cutter');
      emitInvalidation([
        INVENTORY_INVALIDATION_KEYS.issueOnMachine('cutter'),
        INVENTORY_INVALIDATION_KEYS.issueHistory('cutter'),
      ], { source: 'createIssueToMachine' });
      return res;
    },
    createIssueTakeBack: async (process, issueId, payload) => {
      const stage = process || 'cutter';
      const res = await api.createIssueTakeBack(stage, issueId, payload);
      await refreshProcessData(stage);
      emitInvalidation([
        INVENTORY_INVALIDATION_KEYS.issueOnMachine(stage),
        INVENTORY_INVALIDATION_KEYS.issueHistory(stage),
      ], { source: 'createIssueTakeBack', issueId });
      return res;
    },
    reverseIssueTakeBack: async (takeBackId, payload = {}) => {
      const res = await api.reverseIssueTakeBack(takeBackId, payload);
      const stage = res?.issue_take_back?.stage || payload?.stage || process;
      if (stage) {
        await refreshProcessData(stage);
      } else {
        await refreshDb();
      }
      if (stage) {
        emitInvalidation([
          INVENTORY_INVALIDATION_KEYS.issueOnMachine(stage),
          INVENTORY_INVALIDATION_KEYS.issueHistory(stage),
        ], { source: 'reverseIssueTakeBack', takeBackId });
      }
      return res;
    },
    deleteIssueToMachine: async (id) => {
      await api.deleteIssueToMachine(id);
      // This action is cutter-only; avoid full bootstrap refresh.
      await refreshProcessData('cutter');
    },

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
    createFirm: async (name, address, mobile) => { await api.createFirm(name, address, mobile); await refreshDb(); },
    updateFirm: async (id, name, address, mobile) => { await api.updateFirm(id, name, address, mobile); await refreshDb(); },
    deleteFirm: async (id) => { await api.deleteFirm(id); await refreshDb(); },

    // Masters - Customers
    createCustomer: async (name, phone, address) => { await api.createCustomer({ name, phone, address }); await refreshDb(); },
    updateCustomer: async (id, name, phone, address) => { await api.updateCustomer(id, { name, phone, address }); await refreshDb(); },
    deleteCustomer: async (id) => { await api.deleteCustomer(id); await refreshDb(); },

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
      const hasBrandUpdate = values && (
        Object.prototype.hasOwnProperty.call(values, 'primary')
        || Object.prototype.hasOwnProperty.call(values, 'gold')
        || Object.prototype.hasOwnProperty.call(values, 'brandPrimary')
        || Object.prototype.hasOwnProperty.call(values, 'brandGold')
        || Object.prototype.hasOwnProperty.call(values, 'logoDataUrl')
        || Object.prototype.hasOwnProperty.call(values, 'faviconDataUrl')
      );
      if (hasBrandUpdate) {
        setBrand(prev => ({
          primary: values.primary ?? values.brandPrimary ?? prev.primary,
          gold: values.gold ?? values.brandGold ?? prev.gold,
          logoDataUrl: Object.prototype.hasOwnProperty.call(values, 'logoDataUrl') ? values.logoDataUrl : prev.logoDataUrl,
          faviconDataUrl: Object.prototype.hasOwnProperty.call(values, 'faviconDataUrl') ? values.faviconDataUrl : prev.faviconDataUrl,
        }));
      }
      await refreshDb();
    },
  }), [emitInvalidation, refreshDb, refreshProcessData, refreshModuleData, process]);

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
    emitInvalidation,
    subscribeInvalidation,
    patchDb,
    patchIssueRecord,
    refreshModuleData,
    refreshProcessData,
    ensureModuleData,
    moduleLoading,
    loadedModules,
    ...actions
  }), [db, loading, refreshing, error, theme, cls, brand, process, refreshDb, emitInvalidation, subscribeInvalidation, patchDb, patchIssueRecord, refreshModuleData, refreshProcessData, ensureModuleData, moduleLoading, loadedModules, actions]);

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};
