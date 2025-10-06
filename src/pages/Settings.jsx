/**
 * Settings page with tabs
 */

import React, { useState, useEffect } from 'react';
import { useBrand } from '../context';
import { AdminData } from './AdminData.jsx';
import { Section, Button } from '../components';
import * as api from '../api';

export function Settings({ db, onSaveBrand, savingBrand, refreshDb }) {
  const { cls } = useBrand();
  const [tab, setTab] = useState('admin'); // 'admin' | 'whatsapp'
  const [status, setStatus] = useState({ status: 'disconnected' });
  const [qr, setQr] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const s = await api.whatsappStatus();
        if (!mounted) return;
        setStatus(s);
        if (s.status === 'qr') {
          const q = await api.whatsappQr();
          setQr(q.qr || null);
        }
      } catch (err) {
        console.error(err);
      }
    }
    load();
    const iv = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

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
            <div className="space-y-3">
              <div className={`${cls.muted}`}>Status: <strong>{status.status}</strong></div>
              {qr && (
                <div>
                  <div className="text-xs text-muted mb-1">Scan QR with WhatsApp</div>
                  <img src={qr} alt="whatsapp-qr" className="mx-auto" />
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={async () => { await api.whatsappStart(); const q = await api.whatsappQr(); setQr(q.qr || null); }}>Start login</Button>
                <Button onClick={async () => { await api.whatsappLogout(); setQr(null); setStatus({ status: 'disconnected' }); }}>Logout</Button>
                <Button onClick={async () => { await api.whatsappSendTest('916353131826'); alert('Test sent'); }}>Send Test</Button>
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default Settings;


