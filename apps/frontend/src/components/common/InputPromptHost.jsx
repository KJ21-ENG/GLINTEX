import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { subscribeInputPrompt } from '../../utils/inputPrompt';

// Mounted once at the app root; shows whatever askForInput() is waiting for.
export default function InputPromptHost() {
  const [request, setRequest] = useState(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => subscribeInputPrompt((next) => {
    setRequest(next);
    setValue(next ? String(next.defaultValue) : '');
    setError(null);
  }), []);

  useEffect(() => {
    if (!request) return;
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select?.(); });
    return () => cancelAnimationFrame(id);
  }, [request]);

  if (!request || typeof document === 'undefined') return null;
  const cancel = () => request.resolve(null);
  const submit = (event) => {
    event?.preventDefault();
    const problem = request.validate ? request.validate(value) : null;
    if (problem) { setError(problem); return; }
    request.resolve(value);
  };

  return createPortal(
    <Dialog open onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent title={request.title} onOpenChange={(open) => { if (!open) cancel(); }}>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          {request.label ? <label htmlFor="glintex-input-prompt" className="text-sm text-muted-foreground">{request.label}</label> : null}
          <Input
            id="glintex-input-prompt"
            ref={inputRef}
            type={request.type}
            min={request.min}
            max={request.max}
            autoComplete={request.type === 'password' ? 'new-password' : 'off'}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
            <Button type="submit">{request.confirmLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>,
    document.body,
  );
}
