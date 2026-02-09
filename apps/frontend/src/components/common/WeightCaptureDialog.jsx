import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, PlugZap, Unplug } from 'lucide-react';
import * as api from '../../api/client';
import { getScaleManager, isWebSerialSupported } from '../../utils/weightScale';
import { Button, Input, Label, Select, Badge } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';

const toFixed3 = (val) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return '';
  return (Math.round(num * 1000) / 1000).toFixed(3);
};

export function WeightCaptureDialog({
  open,
  onOpenChange,
  onWeightCaptured,
  context = null, // Optional object to help audit (stage/field/etc.)
}) {
  const manager = useMemo(() => getScaleManager(), []);
  const supported = isWebSerialSupported();

  const [mode, setMode] = useState(supported ? 'scale' : 'manual'); // scale | manual
  const [state, setState] = useState(manager.getState());
  const [ports, setPorts] = useState([]);
  const [selectedPortLabel, setSelectedPortLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [rawLines, setRawLines] = useState([]);

  const rawLinesRef = useRef([]);
  const showRawRef = useRef(false);

  const selectedPort = useMemo(() => {
    if (!ports.length) return null;
    const match = ports.find(p => p.label === selectedPortLabel);
    return match?.port || ports[0].port;
  }, [ports, selectedPortLabel]);

  useEffect(() => {
    if (!open) return;

    setError('');
    setBusy(false);
    setMode(supported ? 'scale' : 'manual');
    setManualWeight('');
    setManualReason('');
    setShowRaw(false);
    setRawLines([]);
    rawLinesRef.current = [];
    showRawRef.current = false;

    const unsub = manager.subscribe(setState);
    const unsubRaw = manager.subscribeRaw((line) => {
      rawLinesRef.current = [line, ...rawLinesRef.current].slice(0, 12);
      if (showRawRef.current) setRawLines(rawLinesRef.current);
    });

    (async () => {
      try {
        const list = await manager.listAuthorizedPorts();
        setPorts(list);
        if (list.length) {
          const preferred = await manager.getPreferredAuthorizedPort().catch(() => null);
          const match = preferred ? list.find(p => p.port === preferred) : null;
          setSelectedPortLabel((match || list[0]).label);
        }
      } catch (e) {
        setPorts([]);
      }
    })();

    return () => {
      try { unsub(); } catch (_) { }
      try { unsubRaw(); } catch (_) { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    showRawRef.current = showRaw;
    if (showRaw) setRawLines(rawLinesRef.current);
  }, [showRaw]);

  const liveWeight = state?.lastReading?.weightKg;
  const stableWeight = state?.stableReading?.weightKg;

  async function refreshPorts() {
    const list = await manager.listAuthorizedPorts();
    setPorts(list);
    if (!list.length) {
      setSelectedPortLabel('');
      return;
    }
    if (selectedPortLabel && list.some(p => p.label === selectedPortLabel)) return;
    const preferred = await manager.getPreferredAuthorizedPort().catch(() => null);
    const match = preferred ? list.find(p => p.port === preferred) : null;
    setSelectedPortLabel((match || list[0]).label);
  }

  async function handleAuthorize() {
    if (!supported) return;
    setBusy(true);
    setError('');
    try {
      await manager.requestPort();
      await refreshPorts();
    } catch (e) {
      setError(e?.message || 'Failed to authorize port');
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    if (!supported) return;
    setBusy(true);
    setError('');
    try {
      if (!selectedPort) {
        throw new Error('No authorized ports. Click "Authorize Scale" first.');
      }
      await manager.connect({ port: selectedPort, autoBaud: true });
    } catch (e) {
      setError(e?.message || 'Failed to connect to scale');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError('');
    try {
      await manager.disconnect();
    } catch (e) {
      setError(e?.message || 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  }

  async function handleCapture() {
    if (!supported) return;
    setBusy(true);
    setError('');
    try {
      const result = await manager.captureStableWeight({ port: selectedPort, timeoutMs: 8000, allowUserPrompt: false });
      const weightKg = result.weightKg;
      const meta = {
        source: 'scale',
        weightKg,
        portInfo: result.portInfo || null,
        baudRate: result.baudRate || null,
        parser: result.meta?.parser || null,
        raw: result.meta?.raw || null,
        stableFlag: Boolean(result.meta?.stable),
      };
      try {
        await api.logWeightCapture({ ...meta, context });
      } catch (e) {
        // Best-effort: don't block capture if audit logging fails.
        console.warn('Failed to log weight capture', e);
      }
      onWeightCaptured?.(weightKg, meta);
      onOpenChange(false);
    } catch (e) {
      setError(e?.message || 'Failed to capture weight');
    } finally {
      setBusy(false);
    }
  }

  async function handleManualUse() {
    const parsed = Number.parseFloat(manualWeight);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid weight');
      return;
    }
    if (!manualReason || manualReason.trim().length < 3) {
      setError('Manual entry requires a short reason');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const weightKg = Math.round(parsed * 1000) / 1000;
      const meta = {
        source: 'manual',
        weightKg,
        reason: manualReason.trim(),
      };
      await api.logWeightCapture({ ...meta, context });
      onWeightCaptured?.(weightKg, meta);
      onOpenChange(false);
    } catch (e) {
      setError(e?.message || 'Failed to save manual weight');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Capture Weight"
        onOpenChange={onOpenChange}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          {!supported && (
            <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 text-destructive" />
              <div>
                <div className="font-medium">Web Serial is not supported in this browser.</div>
                <div className="text-muted-foreground">Use Chrome/Edge on desktop to connect a scale, or enter weight manually.</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={mode === 'scale' ? 'default' : 'outline'}
                onClick={() => setMode('scale')}
                disabled={!supported}
              >
                Scale
              </Button>
              <Button
                type="button"
                variant={mode === 'manual' ? 'default' : 'outline'}
                onClick={() => setMode('manual')}
              >
                Manual
              </Button>
            </div>

            {error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : null}
          </div>

          {mode === 'scale' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="space-y-1">
                  <Label>Port</Label>
                  <Select
                    value={selectedPortLabel}
                    onChange={(e) => setSelectedPortLabel(e.target.value)}
                    disabled={!supported || busy}
                  >
                    {!ports.length && <option value="">No authorized ports</option>}
                    {ports.map(p => (
                      <option key={p.label} value={p.label}>{p.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleAuthorize} disabled={!supported || busy} className="gap-2">
                    <PlugZap className="w-4 h-4" />
                    Authorize Scale
                  </Button>
                  {state?.isConnected ? (
                    <Button type="button" variant="outline" onClick={handleDisconnect} disabled={busy} className="gap-2">
                      <Unplug className="w-4 h-4" />
                      Disconnect
                    </Button>
                  ) : (
                    <Button type="button" onClick={handleConnect} disabled={!supported || busy || !ports.length} className="gap-2">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Connect
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 justify-start md:justify-end">
                  <Badge className={state?.isConnected ? 'bg-green-600' : 'bg-muted text-foreground'}>
                    {state?.isConnected ? 'Connected' : 'Not Connected'}
                  </Badge>
                  {state?.baudRate ? (
                    <Badge variant="outline">Baud: {state.baudRate}</Badge>
                  ) : null}
                </div>
              </div>

              <div className="rounded-md border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">Live</div>
                  {stableWeight != null ? (
                    <Badge className="bg-green-600">Stable</Badge>
                  ) : (
                    <Badge variant="outline">Waiting</Badge>
                  )}
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <div className="text-5xl font-mono font-bold tabular-nums tracking-tight">
                    {liveWeight != null ? toFixed3(liveWeight) : '---'}
                  </div>
                  <div className="text-lg text-muted-foreground pb-1">kg</div>
                </div>
                <div className="mt-3 flex gap-2 items-center">
                  <Button
                    type="button"
                    onClick={handleCapture}
                    disabled={!supported || busy || !state?.isConnected}
                    className="gap-2"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Capture Stable
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowRaw(v => !v)}
                    disabled={!supported}
                  >
                    {showRaw ? 'Hide Raw' : 'Show Raw'}
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    {stableWeight != null ? `Stable: ${toFixed3(stableWeight)} kg` : 'Tip: keep the scale steady for 1–2 seconds.'}
                  </div>
                </div>

                {showRaw && (
                  <div className="mt-3">
                    <div className="text-xs text-muted-foreground mb-1">Latest output</div>
                    <div className="bg-black/90 text-green-300 font-mono text-xs p-3 rounded max-h-40 overflow-y-auto">
                      {rawLines.length ? rawLines.map((l, i) => <div key={i}>{l}</div>) : <div className="opacity-60">No data yet…</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === 'manual' && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                <div className="space-y-1">
                  <Label>Weight (kg)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={manualWeight}
                    onChange={(e) => setManualWeight(e.target.value)}
                    disabled={busy}
                    className="font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Reason (required)</Label>
                  <Input
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    disabled={busy}
                    placeholder="e.g., scale unavailable / unstable / browser not supported"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={handleManualUse} disabled={busy} className="gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Use Manual Weight
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
