import React, { useMemo, useState } from 'react';
import { Archive, ChevronRight, ClipboardList, PackageCheck, Plus, RefreshCw, Settings2, Weight } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui';
import { batchSources, batchUnits, entityId, formatCount, formatDateTime, formatKg, labelize, recipeLabel } from './packingUtils';
import { EmptyState, LoadingState, MetricCard, NativeSelect, SectionHeading, StatusBadge } from './PackingPrimitives';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'PARTIALLY_COMPLETED', label: 'Partially completed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'SHORT_CLOSED', label: 'Short-closed' },
  { value: 'VOIDED', label: 'Voided' },
];

export function PackingOverview({ batches = [], loading, error, canWrite, onRefresh, onLoadMore, hasMore, onCreateBatch, onSelectBatch, onOpenSettings }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return batches.filter((batch) => {
      if (status && String(batch.status) !== status) return false;
      if (!terms.length) return true;
      const searchable = [
        batch.batchNo,
        batch.id,
        batch.status,
        batch.kind,
        batch.recipe?.familyKey,
        batch.recipe?.name,
        batch.customer?.name,
        batch.customerId,
      ].filter(Boolean).join(' ').toLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
  }, [batches, query, status]);

  const metrics = useMemo(() => {
    const active = batches.filter((batch) => !['COMPLETED', 'SHORT_CLOSED', 'VOIDED'].includes(String(batch.status || '')));
    const units = batches.reduce((total, batch) => total + batchUnits(batch).length, 0);
    const reservedSources = batches.reduce((total, batch) => total + batchSources(batch).length, 0);
    const plannedWeight = batches.reduce((total, batch) => total + Number(batch.plannedNetWeightKg || 0), 0);
    return { active: active.length, units, reservedSources, plannedWeight };
  }, [batches]);

  if (loading && !batches.length) return <LoadingState />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Packing</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Transform authoritative Coning balances into sealed, independently actionable stock units.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenSettings ? <Button type="button" variant="outline" onClick={onOpenSettings}><Settings2 className="mr-2 h-4 w-4" />Packing settings</Button> : null}
          <Button type="button" variant="outline" onClick={onRefresh} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
          <Button type="button" onClick={onCreateBatch} disabled={!canWrite}><Plus className="mr-2 h-4 w-4" />New batch</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active batches" value={formatCount(metrics.active)} detail="Draft through partially completed" icon={ClipboardList} tone="blue" />
        <MetricCard label="Planned weight" value={formatKg(metrics.plannedWeight)} detail="Loaded batch page" icon={Weight} tone="amber" />
        <MetricCard label="Physical units" value={formatCount(metrics.units)} detail="Loaded batch details" icon={PackageCheck} tone="green" />
        <MetricCard label="Reserved sources" value={formatCount(metrics.reservedSources)} detail="Server-authoritative reservations" icon={Archive} tone="slate" />
      </div>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error.message || String(error)}</div> : null}

      <Card className="shadow-none">
        <CardHeader className="pb-4">
          <SectionHeading title="Batch work queue" description="Open a batch to reserve sources, build containers, seal labels, handle exceptions, and inspect history." actions={<Badge variant="outline">{formatCount(filtered.length)} shown</Badge>} />
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search batch, recipe, customer, status…" aria-label="Search Packing batches" />
            <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)} options={STATUS_FILTERS} placeholder="" />
          </div>
        </CardHeader>
        <CardContent>
          {!filtered.length ? (
            <EmptyState title="No Packing batches found" description={query || status ? 'Try a different filter or create a new batch.' : 'Create a draft batch when an active recipe and physical source are ready.'} action={canWrite ? <Button type="button" onClick={onCreateBatch}><Plus className="mr-2 h-4 w-4" />Create draft</Button> : null} />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recipe / customer</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Sources</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead className="w-12" aria-label="Open" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((batch) => (
                    <TableRow key={entityId(batch)} className="cursor-pointer" onClick={() => onSelectBatch(batch)}>
                      <TableCell>
                        <p className="font-mono text-xs">{batch.batchNo || batch.id || '—'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{labelize(batch.kind)}</p>
                      </TableCell>
                      <TableCell><StatusBadge status={batch.status} /></TableCell>
                      <TableCell>
                        <p className="max-w-56 truncate text-sm">{recipeLabel(batch.recipe || batch.recipeSnapshot)}</p>
                        <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{batch.customer?.name || batch.customerId || 'Customer-neutral'}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums"><p>{formatCount(batch.plannedBaseCount)} units</p><p className="mt-1 text-xs text-muted-foreground">{formatKg(batch.plannedNetWeightKg)}</p></TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(batchSources(batch).length)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatDateTime(batch.updatedAt || batch.createdAt)}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {hasMore ? <div className="mt-4 flex justify-center"><Button type="button" variant="outline" onClick={onLoadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more batches'}</Button></div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
