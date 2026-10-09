import React from 'react';
import { formatKg } from '../../utils';

export function ConingSupplyHistory({ issue }) {
  if (!issue?.coningBatchEnabled) return null;
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Supply history · {issue.barcode} · {(issue.supplies || []).length} deliveries
      </summary>
      <p className="my-2 text-xs text-muted-foreground">Every delivery keeps its own issue number. All supervisor stickers use {issue.barcode}.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b"><th className="p-2">Delivery</th><th className="p-2">Issued at (IST)</th><th className="p-2">Source crates</th><th className="p-2 text-right">Rolls</th><th className="p-2 text-right">Net kg</th></tr></thead>
          <tbody>{(issue.supplies || []).map((supply) => (
            <tr key={supply.id} className="border-b last:border-0">
              <td className="p-2 font-mono">{supply.barcode}</td>
              <td className="p-2 whitespace-nowrap">{new Date(supply.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
              <td className="p-2">{(supply.current?.receivedRowRefs || supply.receivedRowRefs || []).map((ref) => ref.barcode || ref.rowId).join(', ')}</td>
              <td className="p-2 text-right">{supply.current?.rollsIssued ?? supply.rollsIssued}</td>
              <td className="p-2 text-right">{formatKg(supply.current?.issuedWeight ?? supply.issuedWeight)}
                {supply.corrections?.length > 0 && <div className="text-xs text-muted-foreground">Originally {supply.rollsIssued} rolls / {formatKg(supply.issuedWeight)} kg</div>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {(issue.corrections || []).length > 0 && <div className="mt-3 space-y-2">
        {issue.corrections.some((correction) => correction.requiresStickerReprint) && <p className="text-xs text-amber-700">Corrected details require replacing stickers printed before the correction. The receiving barcode remains {issue.barcode}.</p>}
        {issue.corrections.map((correction) => {
          const supply = (issue.supplies || []).find((entry) => entry.id === correction.supplyId);
          const fields = ['date', 'machineId', 'operatorId', 'shift', 'note'].filter((field) => correction.before?.[field] !== correction.after?.[field]);
          const labels = { date: 'Date', machineId: 'Machine', operatorId: 'Operator', shift: 'Shift', note: 'Note' };
          const value = (snapshot, field) => snapshot[field === 'machineId' ? 'machineName' : field === 'operatorId' ? 'operatorName' : field] || 'Empty';
          return <details key={correction.id} className="rounded border p-2 text-xs">
            <summary className="cursor-pointer">{supply ? `Delivery ${supply.barcode}` : 'Batch details'} corrected · {new Date(correction.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</summary>
            {fields.map((field) => <p key={field} className="mt-1">{labels[field]}: {value(correction.before, field)} → {value(correction.after, field)}</p>)}
            {supply && <>
              <p className="mt-2">Before: {correction.before.rollsIssued} rolls / {formatKg(correction.before.issuedWeight)} kg · {(correction.before.receivedRowRefs || []).map((ref) => `${ref.barcode || ref.rowId}: ${ref.issueRolls} rolls / ${formatKg(ref.issueWeight)} kg`).join('; ')}</p>
              <p className="mt-1">After: {correction.after.rollsIssued} rolls / {formatKg(correction.after.issuedWeight)} kg · {(correction.after.receivedRowRefs || []).map((ref) => `${ref.barcode || ref.rowId}: ${ref.issueRolls} rolls / ${formatKg(ref.issueWeight)} kg`).join('; ')}</p>
            </>}
            {correction.reason && <p className="mt-1">Reason: {correction.reason}</p>}
            {correction.requiresStickerReprint && <p className="mt-1 text-amber-700">Reprint supervisor stickers using the current batch details.</p>}
          </details>;
        })}
      </div>}
    </details>
  );
}
