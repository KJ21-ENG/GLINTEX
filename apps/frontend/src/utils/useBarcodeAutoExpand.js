import { useEffect, useRef } from 'react';

export function useBarcodeAutoExpand({
  enabled,
  groupBy,
  search,
  filteredLots,
  getLotKey,
  expandedLot,
  setExpandedLot,
}) {
  const lastAutoExpandRef = useRef(null);
  const autoExpandedLotRef = useRef(null);
  const manualInteractionRef = useRef(false);
  const expandedLotRef = useRef(expandedLot);

  useEffect(() => {
    expandedLotRef.current = expandedLot;
  }, [expandedLot]);

  useEffect(() => {
    const searchLower = String(search || '').trim().toLowerCase();
    const isBarcodeSearch = enabled && searchLower.length >= 6;

    if (groupBy || !isBarcodeSearch) {
      lastAutoExpandRef.current = null;
      if (
        autoExpandedLotRef.current
        && expandedLotRef.current === autoExpandedLotRef.current
        && !manualInteractionRef.current
      ) {
        setExpandedLot(null);
      }
      autoExpandedLotRef.current = null;
      manualInteractionRef.current = false;
      return;
    }

    const firstHit = filteredLots.find((lot) => !!lot.hasBarcodeHit);
    if (!firstHit) {
      if (
        autoExpandedLotRef.current
        && expandedLotRef.current === autoExpandedLotRef.current
        && !manualInteractionRef.current
      ) {
        setExpandedLot(null);
      }
      autoExpandedLotRef.current = null;
      lastAutoExpandRef.current = null;
      manualInteractionRef.current = false;
      return;
    }

    const lotKey = getLotKey(firstHit);
    if (!lotKey) return;
    const autoKey = `${searchLower}::${lotKey}`;
    if (lastAutoExpandRef.current === autoKey) return;

    lastAutoExpandRef.current = autoKey;
    autoExpandedLotRef.current = lotKey;
    manualInteractionRef.current = false;
    setExpandedLot(lotKey);
  }, [enabled, groupBy, search, filteredLots, getLotKey, setExpandedLot]);

  const markManualInteraction = () => {
    manualInteractionRef.current = true;
  };

  return { markManualInteraction };
}
