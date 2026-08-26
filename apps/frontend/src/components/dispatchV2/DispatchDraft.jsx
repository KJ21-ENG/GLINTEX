import React from 'react';
import { CheckCircle2, LockKeyhole, Loader2 } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '../ui';

export function DispatchDraft({
  customers = [],
  draft,
  onChange,
  lockedCustomerId,
  queueLength,
  submitting,
  onSubmit,
  readOnly = false,
}) {
  const customerLocked = Boolean(lockedCustomerId);
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div>
          <p className="text-sm font-semibold">3. Dispatch draft</p>
          <p className="mt-1 text-xs text-muted-foreground">Customer and business date are stored on the immutable challan snapshot.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dispatch-v2-customer">Customer</Label>
            <div className="relative">
              <select
                id="dispatch-v2-customer"
                value={draft.customerId || ''}
                onChange={(event) => onChange({ customerId: event.target.value })}
                disabled={readOnly || customerLocked}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                required
              >
                <option value="">Select customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name || customer.displayName || customer.id}</option>
                ))}
              </select>
              {customerLocked && <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />}
            </div>
            {customerLocked && <p className="text-xs text-muted-foreground">Locked by a customer-reserved source in the queue.</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dispatch-v2-date">Business date</Label>
            <Input
              id="dispatch-v2-date"
              type="date"
              value={draft.businessDate || ''}
              onChange={(event) => onChange({ businessDate: event.target.value })}
              disabled={readOnly || submitting}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dispatch-v2-notes">Notes</Label>
          <textarea
            id="dispatch-v2-notes"
            value={draft.notes || ''}
            onChange={(event) => onChange({ notes: event.target.value })}
            disabled={readOnly || submitting}
            rows={3}
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Optional challan note"
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{queueLength} exact line{queueLength === 1 ? '' : 's'} staged.</p>
          <Button type="button" onClick={onSubmit} disabled={readOnly || submitting || queueLength === 0}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {submitting ? 'Creating challan…' : 'Create Dispatch Challan'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default DispatchDraft;
