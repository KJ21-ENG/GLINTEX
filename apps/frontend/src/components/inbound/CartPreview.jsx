/**
 * CartPreview component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../../context';
import { SecondaryButton } from '../common';
import { formatKg } from '../../utils';

export function CartPreview({ previewLotNo, cart, removeFromCart }) {
  const { cls } = useBrand();
  return (
    <div className="mt-6">
      <h3 className={`text-sm uppercase tracking-wide mb-2 ${cls.muted}`}>Cart</h3>
      {cart.length === 0 ? (
        <div className={`${cls.muted} text-sm`}>No pieces yet. Enter weight and click <b>Add</b>.</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Piece ID (preview)</th><th className="py-2 pr-2">Weight (kg)</th><th className="py-2 pr-2">Actions</th></tr></thead>
            <tbody>
              {cart.map((r) => (
                <tr key={r.tempId} className={`border-t ${cls.rowBorder}`}>
                  <td className="py-2 pr-2">{r.seq}</td>
                  <td className="py-2 pr-2">{previewLotNo ? `${previewLotNo}-${r.seq}` : 'Auto-generated'}</td>
                  <td className="py-2 pr-2">{formatKg(r.weight)}</td>
                  <td className="py-2 pl-2"><SecondaryButton onClick={()=>removeFromCart(r.tempId)}>Remove</SecondaryButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
