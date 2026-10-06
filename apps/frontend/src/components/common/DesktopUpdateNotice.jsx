import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Download, RefreshCw } from 'lucide-react';

const buttonClass = 'rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const secondaryClass = `${buttonClass} hover:bg-muted`;
const primaryClass = `${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`;

function formatDate(value, options) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, options) : '';
}

export default function DesktopUpdateNotice({ update, installedVersion, open, busy, error, onAction, updates }) {
  const [showNotes, setShowNotes] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const release = update.release;
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0));
  const state = update.state;
  useEffect(() => { setShowNotes(false); setShowDetails(false); }, [release?.version]);
  if (!open && !update.prompt && !error && !['downloading', 'armed', 'installing'].includes(state)) return null;

  const copy = {
    idle: ['Application updates', 'Updates are checked automatically when you sign in.'],
    checking: ['Checking for updates', 'You can keep working.'],
    current: ["You're up to date", `GLINTEX ${installedVersion} is the latest version available to you.`],
    available: [`GLINTEX ${release?.version || ''} is available`, 'Download the latest version when you’re ready.'],
    downloading: [`Downloading GLINTEX ${release?.version || ''}`, `${progress}% complete. You can keep working.`],
    ready: ['Update ready to install', 'Save your work, then close GLINTEX when you’re ready to install.'],
    armed: ['Update will install when you close GLINTEX', update.closeBlocked ? update.message : 'Keep working. Installation starts after you close and confirm.'],
    installing: ['Preparing to install', 'The installer will open after GLINTEX closes.'],
    signin: ['Sign in to check for updates', 'The check will run automatically after you sign in.'],
    unavailable: ['Updates are temporarily unavailable', 'We’ll check again automatically. You can keep working.'],
    error: ['Couldn’t complete the update', update.message || 'Check your connection and try again.'],
    unsupported: ['Updates unavailable', 'Updates require the installed Windows application.'],
  };
  const [title, description] = copy[state] || copy.idle;
  const Icon = state === 'current' ? Check : ['checking', 'installing'].includes(state) ? RefreshCw : Download;
  const checkingDisabled = busy || ['unsupported', 'checking', 'downloading', 'armed', 'installing'].includes(state);
  const canDownload = release && ['available', 'error'].includes(state);
  const canDismiss = update.prompt && ['current', 'signin', 'unavailable', 'error'].includes(state);

  return <section aria-label="Application updates" aria-busy={busy || state === 'checking'} className="border-t bg-muted/30 px-4 py-3">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-1 items-start gap-3 min-w-[220px]">
        <Icon aria-hidden="true" size={18} className={`mt-0.5 shrink-0 ${state === 'error' ? 'text-destructive' : 'text-primary'}`}/>
        <div className="min-w-0" role="status" aria-live="polite">
          <h2 className="text-sm font-semibold leading-5">{title}</h2>
          <p className="mt-0.5 max-w-prose text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {release && <button type="button" className={secondaryClass} aria-expanded={showNotes} aria-controls="desktop-update-notes" onClick={() => setShowNotes(v => !v)}>What’s new<ChevronDown aria-hidden="true" size={14} className={`ml-1 inline ${showNotes ? 'rotate-180' : ''}`}/></button>}
        {canDownload && <button type="button" className={primaryClass} disabled={busy} onClick={() => onAction(updates.download)}>Download update</button>}
        {state === 'downloading' && <button type="button" className={secondaryClass} onClick={() => onAction(updates.cancel, true)}>Cancel download</button>}
        {state === 'ready' && <button type="button" className={primaryClass} disabled={busy} onClick={() => onAction(updates.arm)}>Install when I close GLINTEX</button>}
        {state === 'armed' && <button type="button" className={secondaryClass} disabled={busy} onClick={() => onAction(updates.disarm)}>Cancel installation choice</button>}
        {release && ['available', 'ready', 'error'].includes(state) && <button type="button" className={secondaryClass} disabled={busy} onClick={() => onAction(updates.later)}>Later</button>}
        {!release && canDismiss && <button type="button" className={secondaryClass} disabled={busy} onClick={() => onAction(updates.later)}>Dismiss</button>}
        {(open || (state === 'error' && !release)) && <button type="button" className={`${buttonClass} border bg-background hover:bg-muted`} disabled={checkingDisabled} onClick={() => onAction(updates.check)}>Check for updates</button>}
      </div>
    </div>
    {state === 'downloading' && <div role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${progress}%` }}/></div>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {showNotes && release && <div id="desktop-update-notes" className="mt-3 border-t pt-3 pl-8">
      <p className="text-xs text-muted-foreground">Version {release.version} • {formatDate(release.publishedAt, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm leading-6">{release.notes || 'The latest GLINTEX application update.'}</p>
      <button type="button" className="mt-2 rounded text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={showDetails} aria-controls="desktop-update-details" onClick={() => setShowDetails(v => !v)}>Details</button>
      {showDetails && <div id="desktop-update-details" className="mt-2 max-w-prose space-y-1 text-xs leading-5 text-muted-foreground">
        <p>Installed version: {installedVersion}. Download uses your GLINTEX sign-in and verifies the installer size and SHA-256.</p>
        <p>Unsigned test installer. Windows may ask you to confirm installation.</p>
        <p>Save your work, disconnect the scale and check the Windows print queue before closing. You’ll confirm before installation starts. Windows will not be restarted.</p>
      </div>}
    </div>}
    {open && update.checkedAt != null && <p className="mt-2 pl-8 text-xs text-muted-foreground">Last checked {formatDate(update.checkedAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>}
  </section>;
}
