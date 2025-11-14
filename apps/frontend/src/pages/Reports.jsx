/**
 * Reports page component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../context';
import { Section } from '../components';
import { formatKg, groupBy } from '../utils';

export function Reports({ db }) {
  const { cls } = useBrand();
  const bySupplier = groupBy(db.lots.filter(l => l.supplierId), l => l.supplierId);
  const supplierRows = Object.entries(bySupplier).map(([supplierId, lots]) => ({ supplierName: db.suppliers.find(s=>s.id===supplierId)?.name || "—", lotsCount: lots.length, pieces: lots.reduce((s,l)=>s+l.totalPieces,0), weight: lots.reduce((s,l)=>s+l.totalWeight,0) }));
  
  const byFirm = groupBy(db.lots, l => l.firmId);
  const firmRows = Object.entries(byFirm).map(([firmId, lots]) => ({ firmName: db.firms.find(f=>f.id===firmId)?.name || "—", lotsCount: lots.length, pieces: lots.reduce((s,l)=>s+l.totalPieces,0), weight: lots.reduce((s,l)=>s+l.totalWeight,0) }));
  
  return (
    <div className="space-y-6">
      <Section title="Supplier-wise Purchases">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Lots</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
            <tbody>
              {supplierRows.length===0? <tr><td colSpan={4} className="py-4">No data.</td></tr> : supplierRows.map((r, idx)=> (
                <tr key={idx} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2">{r.supplierName}</td><td className="py-2 pr-2 text-right">{r.lotsCount}</td><td className="py-2 pr-2 text-right">{r.pieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.weight)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      
      <Section title="Firm-wise Summary">
        <div className="overflow-auto">
          <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2 text-right">Lots</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
            <tbody>
              {firmRows.length===0? <tr><td colSpan={4} className="py-4">No data.</td></tr> : firmRows.map((r, idx)=> (
                <tr key={idx} className={`border-t ${cls.rowBorder}`}><td className="py-2 pr-2">{r.firmName}</td><td className="py-2 pr-2 text-right">{r.lotsCount}</td><td className="py-2 pr-2 text-right">{r.pieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.weight)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Valuation (Info)"><div className={`${cls.muted} text-sm`}>Costing method not required. Valuation is disabled. If you want to enable it later, we can add Weighted Average at lot level and compute COGS during issue.</div></Section>
    </div>
  );
}
