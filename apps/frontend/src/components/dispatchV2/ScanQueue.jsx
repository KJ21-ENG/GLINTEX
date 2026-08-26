import React from 'react';
import { AlertTriangle, Layers3, ScanLine, Trash2, X } from 'lucide-react';
import { Button, Input, Card, CardContent, Badge } from '../ui';
import { cn } from '../../lib/utils';

function numericValue(value) {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

function labelFor(item) {
  return item.barcode || item.sourceBarcode || item.lotLabel || item.lotNo || item.pieceId || item.sourceId || 'Unnamed source';
}

export function ScanQueue({
  queue = [],
  onUpdate,
  onRemove,
  onClear,
  disabled = false,
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">2. Exact scan queue</p>
            <p className="mt-1 text-xs text-muted-foreground">Every line keeps its source identity. Packed parent Parcels remain atomic unless the server permits a child-level operation.</p>
          </div>
          {queue.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
              <X className="mr-1 h-4 w-4" /> Clear queue
            </Button>
          )}
        </div>

        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            <ScanLine className="h-5 w-5" /> Scan a barcode or add a source above.
          </div>
        ) : (
          <div className="space-y-3">
            {queue.map((item) => {
              const hasCount = item.availableCount !== null && item.availableCount !== undefined;
              const parent = item.isParentParcel || item.parentPackedUnitId;
              const fullCount = item.availableCount;
              const fullWeight = item.availableNetWeightKg;
              const partialAllowed = item.sourceType !== 'PACKED' || item.allowPartialDispatch;
              const partialEligible = item.sourceType === 'PACKED' && partialAllowed;
              const countChanged = hasCount && Number(item.dispatchBaseCount) !== Number(item.availableCount);
              const weightChanged = fullWeight != null && Number(item.dispatchNetWeightKg) < Number(fullWeight) - 0.0015;
              const damageChanged = Number(item.damagedLostBaseCount || 0) > 0 || Number(item.damagedLostNetWeightKg || 0) > 0.0015;
              const showPartialFields = partialEligible && (item.partialDispatch || countChanged || weightChanged || damageChanged);
              return (
                <div key={item.queueId} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm font-semibold">{labelFor(item)}</span>
                        <Badge variant="outline">{item.sourceType}</Badge>
                        {parent && <Badge variant="secondary"><Layers3 className="mr-1 h-3 w-3" /> Parent Parcel</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{item.itemName || '—'} · {item.packageKind || 'Source'}</p>
                      {item.customerName && <p className="mt-1 text-xs text-muted-foreground">Reserved to {item.customerName}</p>}
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(item.queueId)} disabled={disabled} aria-label={`Remove ${labelFor(item)}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {hasCount && (
                      <label className="space-y-1 text-xs font-medium">
                        <span>Exact base count</span>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={numericValue(item.dispatchBaseCount)}
                          onChange={(event) => onUpdate(item.queueId, { dispatchBaseCount: event.target.value })}
                          disabled={disabled || !partialAllowed}
                          aria-label={`Dispatch count for ${labelFor(item)}`}
                        />
                      </label>
                    )}
                    <label className="space-y-1 text-xs font-medium">
                      <span>Actual net kg</span>
                      <Input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={numericValue(item.dispatchNetWeightKg)}
                        onChange={(event) => onUpdate(item.queueId, { dispatchNetWeightKg: event.target.value })}
                        disabled={disabled || !partialAllowed}
                        aria-label={`Dispatch weight for ${labelFor(item)}`}
                      />
                    </label>
                  </div>

                  {partialEligible && (
                    <div className="mt-3 space-y-3 rounded-md border border-dashed p-3">
                      <label className="flex items-start gap-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          checked={Boolean(item.partialDispatch)}
                          onChange={(event) => onUpdate(item.queueId, {
                            partialDispatch: event.target.checked,
                            ...(event.target.checked ? {} : {
                              residualBaseCount: 0,
                              residualNetWeightKg: 0,
                              damagedLostBaseCount: 0,
                              damagedLostNetWeightKg: 0,
                              salvageableBaseCount: 0,
                              salvageableWeightKg: 0,
                              partialDispatchReason: '',
                            }),
                          })}
                          disabled={disabled}
                          className="mt-0.5"
                        />
                        <span><span className="font-semibold">Partial dispatch / split residual</span><span className="mt-1 block font-normal text-muted-foreground">This recipe permits a new dispatched child plus a separately resealed residual child. Count conservation is checked before submission.</span></span>
                      </label>

                      {showPartialFields && (
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1 text-xs font-medium">
                              <span>Exact residual base count</span>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={numericValue(item.residualBaseCount)}
                                onChange={(event) => onUpdate(item.queueId, { residualBaseCount: event.target.value })}
                                disabled={disabled}
                                aria-label={`Residual count for ${labelFor(item)}`}
                              />
                            </label>
                            <label className="space-y-1 text-xs font-medium">
                              <span>Exact residual net kg</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                value={numericValue(item.residualNetWeightKg)}
                                onChange={(event) => onUpdate(item.queueId, { residualNetWeightKg: event.target.value })}
                                disabled={disabled}
                                aria-label={`Residual weight for ${labelFor(item)}`}
                              />
                            </label>
                          </div>
                          <label className="space-y-1 text-xs font-medium">
                            <span>Explicit damaged/lost count</span>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={numericValue(item.damagedLostBaseCount)}
                              onChange={(event) => onUpdate(item.queueId, { damagedLostBaseCount: event.target.value })}
                              disabled={disabled}
                              aria-label={`Damaged or lost count for ${labelFor(item)}`}
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium">
                            <span>Damaged/lost net kg (if applicable)</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={numericValue(item.damagedLostNetWeightKg)}
                              onChange={(event) => onUpdate(item.queueId, { damagedLostNetWeightKg: event.target.value })}
                              disabled={disabled}
                              aria-label={`Damaged or lost weight for ${labelFor(item)}`}
                            />
                          </label>
                          {damageChanged && (
                            <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:col-span-2">
                              <p className="text-xs font-semibold text-amber-800">Salvageable content for the damaged/lost portion</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-1 text-xs font-medium">
                                  <span>Salvageable base count</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={numericValue(item.salvageableBaseCount)}
                                    onChange={(event) => onUpdate(item.queueId, { salvageableBaseCount: event.target.value })}
                                    disabled={disabled}
                                    aria-label={`Salvageable count for ${labelFor(item)}`}
                                  />
                                </label>
                                <label className="space-y-1 text-xs font-medium">
                                  <span>Salvageable net kg</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={numericValue(item.salvageableWeightKg)}
                                    onChange={(event) => onUpdate(item.queueId, { salvageableWeightKg: event.target.value })}
                                    disabled={disabled}
                                    aria-label={`Salvageable weight for ${labelFor(item)}`}
                                  />
                                </label>
                              </div>
                              <p className="text-xs text-muted-foreground">Enter both salvage values or leave both at zero. Neither may exceed the damaged/lost count or weight; salvage becomes a Repacking identity instead of a full write-off.</p>
                            </div>
                          )}
                          <label className="space-y-1 text-xs font-medium">
                            <span>Partial dispatch reason <span className="text-destructive">*</span></span>
                            <textarea
                              value={item.partialDispatchReason || ''}
                              onChange={(event) => onUpdate(item.queueId, { partialDispatchReason: event.target.value })}
                              disabled={disabled}
                              rows={2}
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              placeholder="Explain the split, residual, or damaged/lost count"
                              aria-label={`Partial dispatch reason for ${labelFor(item)}`}
                            />
                          </label>
                          {(countChanged || weightChanged || damageChanged) && !item.partialDispatch && <p className="text-xs text-amber-700">The requested values differ from the full unit. Enable partial dispatch to submit residual and damaged/lost details.</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {!partialAllowed && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Whole-unit dispatch is required by this recipe. The exact available count ({fullCount ?? '—'}) and net weight ({fullWeight == null ? '—' : Number(fullWeight).toFixed(3)} kg) are locked.
                    </p>
                  )}
                  {parent && item.children?.length > 0 && (
                    <p className={cn('mt-2 text-xs text-muted-foreground')}>{item.children.length} active child stock unit(s) will be evaluated atomically by Dispatch V2.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ScanQueue;
