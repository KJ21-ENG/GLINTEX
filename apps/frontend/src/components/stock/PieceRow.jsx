import React, { useState, useRef, useEffect } from 'react';
import { Input, Button } from '../ui';
import { formatKg } from '../../utils';
import * as api from '../../api';
import { Check, X, Edit2, AlertTriangle, MoreVertical, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DisabledWithTooltip } from '../common/DisabledWithTooltip';
import { HighlightMatch } from '../../components/common/HighlightMatch';

export function PieceRow({
  p,
  selected,
  onToggle,
  onSaved,
  pendingWeight = 0,
  isIssued = false,
  issuedLabel = '',
  wastageWeight = 0,
  totalUnits = 0,
  onDelete,
  isDeleting = false,
  hidePending = false,
  canEdit = false,
  canDelete = false,
  selectDisabled = false,
  search = ''
}) {
  const EPSILON = 1e-9;
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(p.weight);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => { setWeight(p.weight); }, [p.weight]);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isWastageMarked = Number(pendingWeight || 0) <= EPSILON && Number(wastageWeight || 0) > 0;
  const isAvailable = p.status === 'available';
  const hasPending = Number(pendingWeight || 0) > EPSILON;

  async function save() {
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) {
      alert('Weight must be positive');
      return;
    }
    setSaving(true);
    try {
      await api.updateInboundItem(p.id, { weight: Number(weight) });
      setEditing(false);
      onSaved && onSaved();
    } catch (err) {
      alert(err.message || 'Failed to save piece');
    } finally {
      setSaving(false);
    }
  }

  const allowEdit = !!canEdit && !isWastageMarked && !isIssued;
  const allowDelete = !!canDelete && !isWastageMarked && !isIssued && p.status !== 'consumed';
  const barcodeMatch = search && search.trim().length >= 6 && String(p.barcode || '').toLowerCase().includes(search.trim().toLowerCase());

  return (
    <tr className={cn(
      "border-t transition-colors hover:bg-muted/50",
      isWastageMarked && "opacity-50 bg-muted",
      barcodeMatch && "bg-primary/10"
    )}>
      <td className="py-2 pr-2 pl-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={selectDisabled || !isAvailable || !hasPending}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
      </td>
      <td className="py-2 pr-2">
        <div className="flex flex-col">
          <span className="font-mono text-xs">{p.id}</span>
          {issuedLabel ? (
            <span className="text-[10px] text-muted-foreground">({issuedLabel})</span>
          ) : null}
        </div>
      </td>
      <td className="py-2 pr-2 font-mono text-xs">
        {p.barcode ? (
          <a href={api.barcodeImageUrl(p.barcode)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            <HighlightMatch text={p.barcode} query={search} />
          </a>
        ) : '—'}
      </td>
      <td className="py-2 pr-2 text-sm">{p.seq}</td>
      <td className="py-2 pr-2">
        <div className="flex items-center justify-end gap-2 h-9">
          {editing ? (
            <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
              <Input
                type="number"
                step="0.001"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                className="w-20 h-8 text-xs"
              />
              <Button size="icon" variant="ghost" onClick={() => { setEditing(false); setWeight(p.weight); }} className="h-7 w-7">
                <X className="w-3 h-3 text-destructive" />
              </Button>
              <Button size="icon" variant="ghost" onClick={save} disabled={saving} className="h-7 w-7">
                <Check className="w-3 h-3 text-green-600" />
              </Button>
            </div>
          ) : (
            <span className={cn("text-sm", isWastageMarked && "line-through")}>
              {formatKg(p.weight)}
            </span>
          )}
        </div>
      </td>
      <td className="py-2 pr-2 text-sm">
        {!hidePending && (
          <div className="flex flex-col items-end">
            <span>{formatKg(pendingWeight)}</span>
            {wastageWeight > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                {formatKg(wastageWeight)} kg ({((p.weight && p.weight > 0) ? ((wastageWeight / p.weight) * 100) : 0).toFixed(1)}%)
              </span>
            )}
          </div>
        )}
      </td>
      <td className="py-2 pr-2 text-sm">{totalUnits || 0}</td>
      <td className="py-2 pr-2 relative">
        <div ref={menuRef}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreVertical className="w-4 h-4" />
          </Button>
          {menuOpen && (
            <div className="absolute right-8 top-0 z-50 w-40 rounded-md border bg-popover p-1 shadow-md animate-in fade-in zoom-in-95 duration-100">
              <DisabledWithTooltip
                disabled={!allowEdit}
                tooltip="You do not have permission to edit inbound records."
                className="w-full"
              >
                <button
                  className="w-full flex items-center px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  onClick={() => { setEditing(true); setMenuOpen(false); }}
                >
                  <Edit2 className="mr-2 h-3 w-3" /> Edit Weight
                </button>
              </DisabledWithTooltip>
              <DisabledWithTooltip
                disabled={!allowDelete || isDeleting}
                tooltip="You do not have permission to delete inbound records."
                className="w-full"
              >
                <button
                  className="w-full flex items-center px-2 py-1.5 text-xs rounded-sm hover:bg-destructive/10 text-destructive disabled:opacity-50"
                  onClick={() => { onDelete && onDelete(p.id); setMenuOpen(false); }}
                >
                  <Trash2 className="mr-2 h-3 w-3" /> {isDeleting ? 'Deleting...' : 'Delete Piece'}
                </button>
              </DisabledWithTooltip>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
