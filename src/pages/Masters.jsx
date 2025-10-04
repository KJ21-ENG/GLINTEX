/**
 * Masters page component for GLINTEX Inventory
 */

import React, { useState } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input } from '../components';

export function Masters({ db, onAddItem, onDeleteItem, onAddFirm, onDeleteFirm, onAddSupplier, onDeleteSupplier, refreshing }) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [working, setWorking] = useState(false);

  async function addItem() {
    const name = itemName.trim();
    if (!name) return;
    if (db.items.some(i => i.name.toLowerCase() === name.toLowerCase())) { alert("Item already exists"); return; }
    setWorking(true);
    try {
      await onAddItem(name);
      setItemName("");
    } catch (err) {
      alert(err.message || 'Failed to add item');
    } finally {
      setWorking(false);
    }
  }

  async function deleteItem(id) {
    if (!confirm("Delete item? You cannot remove it if referenced by lots.")) return;
    setWorking(true);
    try {
      await onDeleteItem(id);
    } catch (err) {
      alert(err.message || 'Failed to delete item');
    } finally {
      setWorking(false);
    }
  }

  async function addFirm() {
    const name = firmName.trim();
    if (!name) return;
    if (db.firms.some(f => f.name.toLowerCase() === name.toLowerCase())) { alert("Firm already exists"); return; }
    setWorking(true);
    try {
      await onAddFirm(name);
      setFirmName("");
    } catch (err) {
      alert(err.message || 'Failed to add firm');
    } finally {
      setWorking(false);
    }
  }

  async function deleteFirm(id) {
    if (!confirm("Delete firm? You cannot remove it if referenced by lots.")) return;
    setWorking(true);
    try {
      await onDeleteFirm(id);
    } catch (err) {
      alert(err.message || 'Failed to delete firm');
    } finally {
      setWorking(false);
    }
  }

  async function addSupplier() {
    const name = supplierName.trim();
    if (!name) return;
    if (db.suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) { alert("Supplier already exists"); return; }
    setWorking(true);
    try {
      await onAddSupplier(name);
      setSupplierName("");
    } catch (err) {
      alert(err.message || 'Failed to add supplier');
    } finally {
      setWorking(false);
    }
  }

  async function deleteSupplier(id) {
    if (!confirm("Delete supplier? You cannot remove it if referenced by lots.")) return;
    setWorking(true);
    try {
      await onDeleteSupplier(id);
    } catch (err) {
      alert(err.message || 'Failed to delete supplier');
    } finally {
      setWorking(false);
    }
  }

  const disable = working || refreshing;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Section title="Items">
        <div className="flex gap-2 mb-3"><Input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New item name" /><Button onClick={addItem} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.items.map(i => (
          <li key={i.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{i.name}</span>
            <SecondaryButton onClick={()=>deleteItem(i.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>

      <Section title="Firms">
        <div className="flex gap-2 mb-3"><Input value={firmName} onChange={e=>setFirmName(e.target.value)} placeholder="New firm name" /><Button onClick={addFirm} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.firms.map(f => (
          <li key={f.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{f.name}</span>
            <SecondaryButton onClick={()=>deleteFirm(f.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>

      <Section title="Suppliers">
        <div className="flex gap-2 mb-3"><Input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="New supplier name" /><Button onClick={addSupplier} disabled={disable}>Add</Button></div>
        <ul className="space-y-2">{db.suppliers.map(s => (
          <li key={s.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
            <span>{s.name}</span>
            <SecondaryButton onClick={()=>deleteSupplier(s.id)} disabled={disable}>Delete</SecondaryButton>
          </li>
        ))}</ul>
      </Section>
    </div>
  );
}
