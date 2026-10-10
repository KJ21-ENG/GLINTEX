import React, { useEffect, useState } from 'react';
import { cn } from '../../../lib/utils';

// Compact form controls for the inspector panels.

export function Field({ label, children, className, hint }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground mt-1">{hint}</span> : null}
    </label>
  );
}

export const inputClass = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

// Numeric input that commits on blur/Enter and tolerates partial typing.
export function NumberField({ value, onChange, step = 0.5, min, max, suffix, disabled, className, placeholder }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const commit = () => {
    if (draft === '' || draft === '-') { setDraft(value ?? ''); return; }
    let n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(value ?? ''); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    n = Math.round(n * 1000) / 1000;
    setDraft(n);
    if (n !== value) onChange(n);
  };
  return (
    <div className={cn('relative', className)}>
      <input
        type="number"
        inputMode="decimal"
        className={cn(inputClass, suffix && 'pr-8')}
        value={draft}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur(); } }}
      />
      {suffix ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

export function SelectField({ value, onChange, options, disabled, className }) {
  return (
    <select className={cn(inputClass, 'appearance-none', className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Segmented({ value, onChange, options, disabled, className }) {
  return (
    <div className={cn('inline-flex h-8 rounded-md border border-input bg-background p-0.5', className)} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          title={o.title || o.label}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('flex-1 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 min-w-[28px]', value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}
        >
          {o.icon ? <o.icon className="h-3.5 w-3.5" /> : null}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={cn('flex items-center gap-2 text-sm select-none', disabled && 'opacity-50')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, defaultOpen = true, actions }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/70 last:border-b-0">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" className="text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {title}
        </button>
        {actions}
      </div>
      {open ? <div className="px-3 pb-3 space-y-3">{children}</div> : null}
    </div>
  );
}
