/**
 * Settings page with tabs
 */

import React, { useState } from 'react';
import { useBrand } from '../context';
import { AdminData } from './AdminData.jsx';
import { Section } from '../components';

export function Settings({ db, onSaveBrand, savingBrand, refreshDb }) {
  const { cls } = useBrand();
  const [tab, setTab] = useState('admin'); // 'admin' | 'whatsapp'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => setTab('admin')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='admin' ? cls.navActive : 'border-transparent'} ${tab!=='admin' ? cls.navHover : ''}`}>
          Admin / data
        </button>
        <button onClick={() => setTab('whatsapp')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='whatsapp' ? cls.navActive : 'border-transparent'} ${tab!=='whatsapp' ? cls.navHover : ''}`}>
          Whatsapp Settings
        </button>
      </div>

      <Section title={tab === 'admin' ? 'Admin / data' : 'Whatsapp Settings'}>
        {tab === 'admin' ? (
          <AdminData db={db} onSaveBrand={onSaveBrand} savingBrand={savingBrand} />
        ) : (
          <div className={`p-6 rounded-md border ${cls.cardBorder} ${cls.cardBg}`}>
            <div className={`text-sm ${cls.muted}`}>Whatsapp settings coming soon. I will add configuration options here when you tell me what you need.</div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default Settings;


