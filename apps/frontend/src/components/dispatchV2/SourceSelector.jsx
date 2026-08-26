import React from 'react';
import { ChevronRight, Loader2, PackageSearch, Search } from 'lucide-react';
import { Button, Input, Card, CardContent, Badge } from '../ui';
import { cn } from '../../lib/utils';

function getSummaryCount(summary, sourceType) {
  if (!summary) return null;
  const value = summary[sourceType]
    ?? summary[sourceType.toLowerCase()]
    ?? summary[sourceType.toLowerCase().replace('_', '-')]
    ?? summary[sourceType]?.available
    ?? summary[sourceType.toLowerCase()]?.available;
  if (value && typeof value === 'object') return value.count ?? value.units ?? value.available ?? null;
  return value ?? null;
}

function getSourceLabel(source) {
  return source.barcode || source.sourceBarcode || source.lotLabel || source.lotNo || source.pieceId || source.sourceId || 'Unnamed source';
}

function getSourceWeight(source) {
  return source.availableNetWeightKg ?? source.availableWeight ?? source.netWeightKg ?? source.weight;
}

function getSourceCount(source) {
  return source.availableCount ?? source.availableBaseCount ?? source.baseCount ?? source.count;
}

export function SourceSelector({
  sourceTypes = [],
  selectedSourceType,
  sourceSummary,
  onSelectSourceType,
  search,
  onSearchChange,
  sources = [],
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onAddSource,
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div>
          <p className="text-sm font-semibold">1. Choose an available source</p>
          <p className="mt-1 text-xs text-muted-foreground">The list is cursor-paginated. Barcode identity is always resolved by the server.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {sourceTypes.map((sourceType) => {
            const count = getSummaryCount(sourceSummary, sourceType.id);
            const active = selectedSourceType === sourceType.id;
            return (
              <button
                type="button"
                key={sourceType.id}
                onClick={() => onSelectSourceType(sourceType.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  active ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted/50'
                )}
                aria-pressed={active}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{sourceType.label}</span>
                  {count !== null && count !== undefined && <Badge variant={active ? 'default' : 'secondary'}>{count}</Badge>}
                </div>
                <span className="mt-1 block text-xs text-muted-foreground">{sourceType.description}</span>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter this source page"
            className="pl-9"
            aria-label="Filter available dispatch sources"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading available sources…
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            <PackageSearch className="h-5 w-5" />
            No eligible {sourceTypes.find((item) => item.id === selectedSourceType)?.label || 'dispatch'} sources.
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <div key={source.queueId || source.id || source.barcode} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold">{getSourceLabel(source)}</span>
                    {source.customerName && <Badge variant="outline">Reserved: {source.customerName}</Badge>}
                    {source.isParentParcel && <Badge variant="secondary">Parent Parcel</Badge>}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {source.itemName || '—'} · {source.packageKind || source.sourceType || 'Source'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getSourceCount(source) == null ? 'Count —' : `Count ${getSourceCount(source)}`} · {getSourceWeight(source) == null ? 'Net kg —' : `Net ${Number(getSourceWeight(source)).toFixed(3)} kg`}
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => onAddSource(source)} className="shrink-0">
                  Add to draft <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            ))}
            {hasMore && (
              <Button type="button" variant="outline" onClick={onLoadMore} disabled={loadingMore} className="w-full">
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loadingMore ? 'Loading more…' : 'Load more sources'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SourceSelector;
