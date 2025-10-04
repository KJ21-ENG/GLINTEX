/**
 * Pagination component for GLINTEX Inventory
 */

import React from 'react';
import { SecondaryButton } from './SecondaryButton';

export function Pagination({ total, page, setPage, pageSize = 8 }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) pages.push(i);
  return (
    <div className="mt-3 flex items-center gap-2">
      <SecondaryButton onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>Prev</SecondaryButton>
      {pages.map(p => (
        <button key={p} onClick={() => setPage(p)} className={`px-2 py-1 rounded ${p===page?"bg-slate-700 text-white":""}`}>{p}</button>
      ))}
      <SecondaryButton onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next</SecondaryButton>
    </div>
  );
}
