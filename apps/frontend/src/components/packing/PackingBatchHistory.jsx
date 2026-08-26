import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History, Loader2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui';
import { getPackingBatchHistory } from '../../api/packing';
import { formatDateTime, getNextCursor, labelize } from './packingUtils';
import { EmptyState, SectionHeading } from './PackingPrimitives';

const HISTORY_PAGE_SIZE = 25;

function eventSnapshot(event) {
  if (!event?.payload) return null;
  try {
    return typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  } catch (_) {
    return event.payload;
  }
}

export function PackingBatchHistory({ batch }) {
  const batchId = batch?.id || batch?.batchId || batch?.batchNo;
  const [events, setEvents] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const loadHistory = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!batchId || (append && !cursor)) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await getPackingBatchHistory(batchId, {
        limit: HISTORY_PAGE_SIZE,
        cursor: append ? cursor : undefined,
      });
      const page = Array.isArray(response?.events) ? response.events : (Array.isArray(response?.items) ? response.items : []);
      setEvents((current) => append ? [...current, ...page] : page);
      setNextCursor(getNextCursor(response));
    } catch (historyError) {
      setError(historyError);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [batchId]);

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    setExpanded(null);
    setError(null);
    void loadHistory();
  }, [batchId, loadHistory]);

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-4">
        <SectionHeading title="Batch history" description="Append-only events load on demand in bounded pages for audit and lineage." />
      </CardHeader>
      <CardContent>
        {error ? <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error.message || 'Unable to load batch history.'}</p> : null}
        {loading && !events.length ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</div>
        ) : !events.length ? (
          <EmptyState title="No events returned" description="This batch has no history events in the current bounded page." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" aria-label="Expand" />
                  <TableHead>Event</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event, index) => {
                  const key = event.id || event.idempotencyKey || `${event.type}-${index}`;
                  const isOpen = expanded === key;
                  const snapshot = eventSnapshot(event);
                  return (
                    <React.Fragment key={key}>
                      <TableRow>
                        <TableCell>
                          {snapshot ? (
                            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setExpanded(isOpen ? null : key)} aria-label={isOpen ? 'Hide event payload' : 'Show event payload'}>
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          ) : <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="whitespace-nowrap">{labelize(event.type)}</Badge></TableCell>
                        <TableCell className="max-w-56 whitespace-normal text-sm">{event.reason || '—'}</TableCell>
                        <TableCell className="text-sm">{event.actor?.displayName || event.actor?.username || event.actorId || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatDateTime(event.createdAt || event.at)}</TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/20">
                            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {nextCursor ? <Button type="button" variant="outline" onClick={() => loadHistory({ append: true, cursor: nextCursor })} disabled={loadingMore} className="mt-3 w-full">{loadingMore && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}{loadingMore ? 'Loading more history…' : 'Load more history'}</Button> : null}
      </CardContent>
    </Card>
  );
}
