/**
 * AdminData page component for GLINTEX Inventory
 */

import React, { useState, useEffect } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Pill } from '../components';
import { RawTable } from '../components/admin';

export function AdminData({ db, onSaveBrand, savingBrand }) {
  const { brand, setBrand, cls } = useBrand();
  const [localBrand, setLocalBrand] = useState(brand);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalBrand(brand);
  }, [brand.primary, brand.gold, brand.logoDataUrl]);

  function updateBrandField(field, value) {
    const next = { ...localBrand, [field]: value };
    setLocalBrand(next);
    setBrand(next);
  }

  function onLogo(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateBrandField('logoDataUrl', String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  async function saveBrand() {
    setSaving(true);
    try {
      await onSaveBrand(localBrand);
      alert('Branding updated');
    } catch (err) {
      alert(err.message || 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Branding (GLINTEX)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={`text-xs ${cls.muted}`}>Primary (Blue) — HEX</label>
            <Input value={localBrand.primary} onChange={e=>updateBrandField('primary', e.target.value)} />
          </div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Accent (Gold) — HEX</label>
            <Input value={localBrand.gold} onChange={e=>updateBrandField('gold', e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <label className="inline-flex items-center gap-2">
              <SecondaryButton as="span">Upload Logo</SecondaryButton>
              <input type="file" accept="image/*" onChange={onLogo} className="hidden" />
            </label>
            <img src={localBrand.logoDataUrl || "/brand-logo.jpg"} alt="logo" className="h-9 object-contain border rounded-lg" />
          </div>
        </div>
        <div className="mt-3 flex gap-2 items-center">
          <Pill>Preview</Pill>
          <Button disabled={saving || savingBrand} onClick={saveBrand}>{saving || savingBrand ? 'Saving…' : 'Save Branding'}</Button>
          <SecondaryButton onClick={() => setLocalBrand(brand)}>Reset</SecondaryButton>
        </div>
      </Section>

      <Section title="Raw Tables (Read-only preview)">
        <RawTable title="Items" rows={db.items} />
        <RawTable title="Firms" rows={db.firms} />
        <RawTable title="Suppliers" rows={db.suppliers} />
        <RawTable title="Lots" rows={db.lots} />
        <RawTable title="Inbound Items" rows={db.inbound_items} />
        <RawTable title="Issues to Machine" rows={db.issue_to_cutter_machine} />
      </Section>
    </div>
  );
}
