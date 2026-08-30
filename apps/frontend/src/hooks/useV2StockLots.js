import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as v2 from '../api/v2';

/**
 * useV2StockLots - v2 Stock Fast-Load (holo/coning only; no UI changes).
 *
 * Moved verbatim out of pages/Stock.jsx so the Stock page and the Combined Stock
 * view read lots through the exact same code path. `enabled` replaces the page's
 * local `v2StockEnabled` flag; everything else (state, effects, guards, dependency
 * arrays) is unchanged.
 *
 * Returns the same shape the views already expect as their `v2` prop:
 * { lots, rowsByKey, loadLotRows, barcodeHitKeys, lotsLoading, lotsError, retryLots }
 */
export function useV2StockLots(processId, { enabled = false, search = '' } = {}) {
  const [v2Lots, setV2Lots] = useState([]);
  const [v2LotsLoading, setV2LotsLoading] = useState(false);
  const [v2LotsError, setV2LotsError] = useState(null);
  const [v2LotsNonce, setV2LotsNonce] = useState(0);
  const [v2RowsByKey, setV2RowsByKey] = useState({});
  const [v2BarcodeKeys, setV2BarcodeKeys] = useState(new Set());
  const v2BarcodeReqId = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setV2Lots([]);
    setV2RowsByKey({});
    setV2BarcodeKeys(new Set());
    setV2LotsLoading(true);
    setV2LotsError(null);
    v2.getV2StockLots(processId)
      .then((res) => {
        if (cancelled) return;
        setV2Lots(Array.isArray(res?.items) ? res.items : []);
        setV2LotsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load v2 stock lots', err);
        setV2Lots([]);
        setV2LotsError(err);
        setV2LotsLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled, processId, v2LotsNonce]);

  const loadV2LotRows = useCallback(async (lotKey) => {
    if (!enabled) return [];
    if (v2RowsByKey[lotKey]) return v2RowsByKey[lotKey];
    const res = await v2.getV2StockLotRows(processId, { key: lotKey });
    const items = Array.isArray(res?.items) ? res.items : [];
    setV2RowsByKey(prev => ({ ...prev, [lotKey]: items }));
    return items;
  }, [enabled, processId, v2RowsByKey]);

  useEffect(() => {
    if (!enabled) return;
    const q = String(search || '').trim();
    if (q.length < 6) {
      setV2BarcodeKeys(new Set());
      return;
    }
    const myId = ++v2BarcodeReqId.current;
    const t = setTimeout(() => {
      v2.getV2StockBarcodeLotKeys(processId, { q })
        .then((res) => {
          if (v2BarcodeReqId.current !== myId) return;
          const keys = Array.isArray(res?.keys) ? res.keys : [];
          setV2BarcodeKeys(new Set(keys));
        })
        .catch((err) => {
          if (v2BarcodeReqId.current !== myId) return;
          console.error('Failed to lookup v2 stock barcode keys', err);
          setV2BarcodeKeys(new Set());
        });
    }, 250);
    return () => clearTimeout(t);
  }, [enabled, processId, search]);

  const retryV2Lots = useCallback(() => setV2LotsNonce((n) => n + 1), []);

  return useMemo(() => ({
    lots: v2Lots,
    rowsByKey: v2RowsByKey,
    loadLotRows: loadV2LotRows,
    barcodeHitKeys: v2BarcodeKeys,
    lotsLoading: v2LotsLoading,
    lotsError: v2LotsError,
    retryLots: retryV2Lots,
  }), [v2Lots, v2RowsByKey, loadV2LotRows, v2BarcodeKeys, v2LotsLoading, v2LotsError, retryV2Lots]);
}
