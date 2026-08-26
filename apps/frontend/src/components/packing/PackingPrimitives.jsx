import React from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input, Label } from '../ui';
import { cn } from '../../lib/utils';
import { batchStatusVariant, labelize, unitStatusVariant } from './packingUtils';

export function StatusBadge({ status, type = 'batch', className = '' }) {
  const variant = type === 'unit' ? unitStatusVariant(status) : batchStatusVariant(status);
  return <Badge variant={variant} className={cn('whitespace-nowrap', className)}>{labelize(status) || 'Unknown'}</Badge>;
}

export function MetricCard({ label, value, detail, icon: Icon, tone = 'blue' }) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/30',
    green: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30',
    amber: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30',
    slate: 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40',
  };
  return (
    <Card className={cn('shadow-none', toneClasses[tone] || toneClasses.blue)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
            {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
          </div>
          {Icon ? <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SectionHeading({ title, description, actions, className = '' }) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, hint, error, className = '', children, required = false }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? <Label className="text-sm">{label}{required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}</Label> : null}
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NativeSelect({ value, onChange, options, placeholder = 'Select', disabled = false, className = '', ...props }) {
  return (
    <select
      value={value ?? ''}
      onChange={onChange}
      disabled={disabled}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={String(option.value)} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ErrorNotice({ error, onRetry, className = '' }) {
  if (!error) return null;
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between', className)} role="alert">
      <div className="flex min-w-0 items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-destructive">Packing request failed</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{error.message || String(error)}</p>
        </div>
      </div>
      {onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading packing data…' }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <Info className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SuccessNotice({ children, className = '' }) {
  if (!children) return null;
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200', className)} role="status">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function ReadOnlyNotice({ children = 'Packing is read-only for this account.' }) {
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{children}</div>;
}

export function TextInput({ label, hint, error, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={props.required}>
      <Input {...props} />
    </Field>
  );
}
