/**
 * Masters page component for GLINTEX Inventory
 */

import React, { useState } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input } from '../components';

export function Masters({ db, onAddItem, onDeleteItem, onAddFirm, onDeleteFirm, onAddSupplier, onDeleteSupplier, onAddMachine, onDeleteMachine, onAddOperator, onDeleteOperator, refreshing }) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [machineName, setMachineName] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState('items'); // items | firms | suppliers | machines | operators

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

  async function addMachine() {
    const name = machineName.trim();
    if (!name) return;
    if (db.machines.some(m => m.name.toLowerCase() === name.toLowerCase())) { alert("Machine already exists"); return; }
    setWorking(true);
    try {
      await onAddMachine(name);
      setMachineName("");
    } catch (err) {
      alert(err.message || 'Failed to add machine');
    } finally {
      setWorking(false);
    }
  }

  async function deleteMachine(id) {
    if (!confirm("Delete machine? You cannot remove it if referenced by issue to machine records.")) return;
    setWorking(true);
    try {
      await onDeleteMachine(id);
    } catch (err) {
      alert(err.message || 'Failed to delete machine');
    } finally {
      setWorking(false);
    }
  }

  async function addOperator() {
    const name = operatorName.trim();
    if (!name) return;
    if (db.operators.some(o => o.name.toLowerCase() === name.toLowerCase())) { alert("Operator already exists"); return; }
    setWorking(true);
    try {
      await onAddOperator(name);
      setOperatorName("");
    } catch (err) {
      alert(err.message || 'Failed to add operator');
    } finally {
      setWorking(false);
    }
  }

  async function deleteOperator(id) {
    if (!confirm("Delete operator? You cannot remove it if referenced by issue to machine records.")) return;
    setWorking(true);
    try {
      await onDeleteOperator(id);
    } catch (err) {
      alert(err.message || 'Failed to delete operator');
    } finally {
      setWorking(false);
    }
  }

  const disable = working || refreshing;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => setTab('items')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='items' ? cls.navActive : 'border-transparent'} ${tab!=='items' ? cls.navHover : ''}`}>
          Items
        </button>
        <button onClick={() => setTab('firms')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='firms' ? cls.navActive : 'border-transparent'} ${tab!=='firms' ? cls.navHover : ''}`}>
          Firms
        </button>
        <button onClick={() => setTab('suppliers')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='suppliers' ? cls.navActive : 'border-transparent'} ${tab!=='suppliers' ? cls.navHover : ''}`}>
          Suppliers
        </button>
        <button onClick={() => setTab('machines')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='machines' ? cls.navActive : 'border-transparent'} ${tab!=='machines' ? cls.navHover : ''}`}>
          Machines
        </button>
        <button onClick={() => setTab('operators')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='operators' ? cls.navActive : 'border-transparent'} ${tab!=='operators' ? cls.navHover : ''}`}>
          Operators
        </button>
      </div>

      {tab === 'items' && (
        <Section title="Items">
          <div className="flex gap-2 mb-3"><Input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="New item name" /><Button onClick={addItem} disabled={disable}>Add</Button></div>
          <ul className="space-y-2">{db.items.map(i => (
            <li key={i.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
              <span>{i.name}</span>
              <SecondaryButton onClick={()=>deleteItem(i.id)} disabled={disable}>Delete</SecondaryButton>
            </li>
          ))}</ul>
        </Section>
      )}

      {tab === 'firms' && (
        <Section title="Firms">
          <div className="flex gap-2 mb-3"><Input value={firmName} onChange={e=>setFirmName(e.target.value)} placeholder="New firm name" /><Button onClick={addFirm} disabled={disable}>Add</Button></div>
          <ul className="space-y-2">{db.firms.map(f => (
            <li key={f.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
              <span>{f.name}</span>
              <SecondaryButton onClick={()=>deleteFirm(f.id)} disabled={disable}>Delete</SecondaryButton>
            </li>
          ))}</ul>
        </Section>
      )}

      {tab === 'suppliers' && (
        <Section title="Suppliers">
          <div className="flex gap-2 mb-3"><Input value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="New supplier name" /><Button onClick={addSupplier} disabled={disable}>Add</Button></div>
          <ul className="space-y-2">{db.suppliers.map(s => (
            <li key={s.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
              <span>{s.name}</span>
              <SecondaryButton onClick={()=>deleteSupplier(s.id)} disabled={disable}>Delete</SecondaryButton>
            </li>
          ))}</ul>
        </Section>
      )}

      {tab === 'machines' && (
        <Section title="Machines">
          <div className="flex gap-2 mb-3"><Input value={machineName} onChange={e=>setMachineName(e.target.value)} placeholder="New machine name" /><Button onClick={addMachine} disabled={disable}>Add</Button></div>
          <ul className="space-y-2">{db.machines.map(m => (
            <li key={m.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
              <span>{m.name}</span>
              <SecondaryButton onClick={()=>deleteMachine(m.id)} disabled={disable}>Delete</SecondaryButton>
            </li>
          ))}</ul>
        </Section>
      )}

      {tab === 'operators' && (
        <Section title="Operators">
          <div className="flex gap-2 mb-3"><Input value={operatorName} onChange={e=>setOperatorName(e.target.value)} placeholder="New operator name" /><Button onClick={addOperator} disabled={disable}>Add</Button></div>
          <ul className="space-y-2">{db.operators.map(o => (
            <li key={o.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${cls.cardBorder} ${cls.cardBg}`}>
              <span>{o.name}</span>
              <SecondaryButton onClick={()=>deleteOperator(o.id)} disabled={disable}>Delete</SecondaryButton>
            </li>
          ))}</ul>
        </Section>
      )}
    </div>
  );
}
