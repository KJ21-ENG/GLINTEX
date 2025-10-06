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
  const [status, setStatus] = useState({ status: 'disconnected', initializing: true });
  const [qr, setQr] = useState(null);
  const [working, setWorking] = useState(false);
  const [primaryMobile, setPrimaryMobile] = useState('');
  const [savingNumber, setSavingNumber] = useState(false);

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
        } else {
          setQr(null);
        }
      } catch (err) {
        console.error(err);
      }
    }
    load();
    // use SSE to receive real-time events
    const evtSrc = new EventSource(`${window.location.protocol}//${window.location.hostname}:4000/api/whatsapp/events`);
    evtSrc.addEventListener('status', (ev) => { try { const d = JSON.parse(ev.data); setStatus(d); } catch(e){} });
    evtSrc.addEventListener('qr', (ev) => { try { const d = JSON.parse(ev.data); setQr(d.qr); } catch(e){} });
    const iv = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    const num = db?.settings?.[0]?.whatsappNumber || '';
    // Show number to user without leading country code (91) so they enter 10-digit local number
    const display = num ? String(num).replace(/^91/, '') : '';
    setPrimaryMobile(display);
  }, [db]);

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
              <div className={`${cls.muted}`}>Status: <strong className={status.status === 'connected' ? 'whatsapp-status-connected' : (status.status === 'disconnected' ? 'whatsapp-status-disconnected' : '')}>{status.status}</strong></div>
              {qr && (
                <div>
                  <div className="text-xs text-muted mb-1">Scan QR with WhatsApp</div>
                  <img src={qr} alt="whatsapp-qr" className="mx-auto" />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={`text-xs ${cls.muted}`}>Primary Mobile (no country code)</label>
                  <input
                    value={primaryMobile}
                    onChange={e => {
                      // allow only digits while typing
                      const digitsOnly = e.target.value.replace(/\D/g, '');
                      setPrimaryMobile(digitsOnly);
                    }}
                    className={`w-full px-3 py-2 rounded border ${cls.cardBorder} ${cls.cardBg}`}
                    placeholder="eg. 6353131826"
                  />
                  <div className="mt-1">
                    {primaryMobile && primaryMobile.replace(/\D/g, '').length < 10 && (
                      <div className="text-xs text-red-500">Enter at least 10 digits (do not include country code)</div>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    onClick={async () => {
                      setSavingNumber(true);
                      try {
                        await api.updateSettings({ whatsappNumber: primaryMobile });
                        await refreshDb();
                        alert('Saved');
                      } catch (err) {
                        alert(err.message || 'Failed');
                      } finally {
                        setSavingNumber(false);
                      }
                    }}
                    disabled={savingNumber || (primaryMobile.replace(/\D/g, '').length < 10)}
                  >
                    {savingNumber ? 'Saving…' : 'Save Number'}
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={async () => { setWorking(true); try { await api.whatsappStart(); const q = await api.whatsappQr(); setQr(q.qr || null); } finally { setWorking(false); } }} disabled={working}>{working ? 'Starting…' : 'Start login'}</Button>
                  <Button onClick={async () => { setWorking(true); try { await api.whatsappLogout(); setQr(null); setStatus({ status: 'disconnected' }); } finally { setWorking(false); } }} disabled={working}>{working ? 'Logging out…' : 'Logout'}</Button>
                  <Button onClick={async () => { setWorking(true); try { const num = primaryMobile || '916353131826'; await api.whatsappSendTest(num); alert('Test sent'); } finally { setWorking(false); } }} disabled={working}>{working ? 'Sending…' : 'Send Test'}</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default Settings;


