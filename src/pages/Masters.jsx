/**
 * Masters page component for GLINTEX Inventory
 */

import React, { useState, useMemo } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, SearchableInput } from '../components';

export function Masters({ db, onAddItem, onDeleteItem, onEditItem, onAddFirm, onDeleteFirm, onEditFirm, onAddSupplier, onDeleteSupplier, onEditSupplier, onAddMachine, onDeleteMachine, onEditMachine, onAddOperator, onDeleteOperator, onEditOperator, onAddBobbin, onDeleteBobbin, onEditBobbin, refreshing }) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [machineName, setMachineName] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [bobbinName, setBobbinName] = useState("");
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState('items'); // items | firms | suppliers | machines | operators | bobbins

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

  async function addBobbin() {
    const name = bobbinName.trim();
    if (!name) return;
    if (db.bobbins.some(b => b.name.toLowerCase() === name.toLowerCase())) { alert("Bobbin already exists"); return; }
    setWorking(true);
    try {
      await onAddBobbin(name);
      setBobbinName("");
    } catch (err) {
      alert(err.message || 'Failed to add bobbin');
    } finally {
      setWorking(false);
    }
  }

  async function deleteBobbin(id) {
    if (!confirm("Delete bobbin? You cannot remove it if referenced by receive rows.")) return;
    setWorking(true);
    try {
      await onDeleteBobbin(id);
    } catch (err) {
      alert(err.message || 'Failed to delete bobbin');
    } finally {
      setWorking(false);
    }
  }

  const disable = working || refreshing;

  const normalizedQuery = itemName.trim().toLowerCase();
  const isDuplicate = normalizedQuery !== '' && db.items.some(i => i.name.trim().toLowerCase() === normalizedQuery);

  const filteredItems = useMemo(() => {
    const q = itemName.trim().toLowerCase();
    if (!q) return db.items;
    return db.items.filter(i => i.name.toLowerCase().includes(q));
  }, [db.items, itemName]);

  // Firms
  const normalizedFirmQuery = firmName.trim().toLowerCase();
  const isFirmDuplicate = normalizedFirmQuery !== '' && db.firms.some(f => f.name.trim().toLowerCase() === normalizedFirmQuery);
  const filteredFirms = useMemo(() => {
    const q = firmName.trim().toLowerCase();
    if (!q) return db.firms;
    return db.firms.filter(f => f.name.toLowerCase().includes(q));
  }, [db.firms, firmName]);

  // Suppliers
  const normalizedSupplierQuery = supplierName.trim().toLowerCase();
  const isSupplierDuplicate = normalizedSupplierQuery !== '' && db.suppliers.some(s => s.name.trim().toLowerCase() === normalizedSupplierQuery);
  const filteredSuppliers = useMemo(() => {
    const q = supplierName.trim().toLowerCase();
    if (!q) return db.suppliers;
    return db.suppliers.filter(s => s.name.toLowerCase().includes(q));
  }, [db.suppliers, supplierName]);

  // Machines
  const normalizedMachineQuery = machineName.trim().toLowerCase();
  const isMachineDuplicate = normalizedMachineQuery !== '' && db.machines.some(m => m.name.trim().toLowerCase() === normalizedMachineQuery);
  const filteredMachines = useMemo(() => {
    const q = machineName.trim().toLowerCase();
    if (!q) return db.machines;
    return db.machines.filter(m => m.name.toLowerCase().includes(q));
  }, [db.machines, machineName]);

  // Operators
  const normalizedOperatorQuery = operatorName.trim().toLowerCase();
  const isOperatorDuplicate = normalizedOperatorQuery !== '' && db.operators.some(o => o.name.trim().toLowerCase() === normalizedOperatorQuery);
  const filteredOperators = useMemo(() => {
    const q = operatorName.trim().toLowerCase();
    if (!q) return db.operators;
    return db.operators.filter(o => o.name.toLowerCase().includes(q));
  }, [db.operators, operatorName]);

  // Bobbins
  const normalizedBobbinQuery = bobbinName.trim().toLowerCase();
  const isBobbinDuplicate = normalizedBobbinQuery !== '' && db.bobbins.some(b => b.name.trim().toLowerCase() === normalizedBobbinQuery);
  const filteredBobbins = useMemo(() => {
    const q = bobbinName.trim().toLowerCase();
    if (!q) return db.bobbins;
    return db.bobbins.filter(b => b.name.toLowerCase().includes(q));
  }, [db.bobbins, bobbinName]);

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
        <button onClick={() => setTab('bobbins')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='bobbins' ? cls.navActive : 'border-transparent'} ${tab!=='bobbins' ? cls.navHover : ''}`}>
          Bobbins
        </button>
      </div>

      {tab === 'items' && (
        <Section title="Items">
          <SearchableInput items={db.items} onAdd={onAddItem} onDelete={onDeleteItem} onEdit={onEditItem} placeholder="New item name" disabled={disable} />
        </Section>
      )}

      {tab === 'firms' && (
        <Section title="Firms">
          <SearchableInput items={db.firms} onAdd={onAddFirm} onDelete={onDeleteFirm} onEdit={onEditFirm} placeholder="New firm name" disabled={disable} />
        </Section>
      )}

      {tab === 'suppliers' && (
        <Section title="Suppliers">
          <SearchableInput items={db.suppliers} onAdd={onAddSupplier} onDelete={onDeleteSupplier} onEdit={onEditSupplier} placeholder="New supplier name" disabled={disable} />
        </Section>
      )}

      {tab === 'machines' && (
        <Section title="Machines">
          <SearchableInput items={db.machines} onAdd={onAddMachine} onDelete={onDeleteMachine} onEdit={onEditMachine} placeholder="New machine name" disabled={disable} />
        </Section>
      )}

      {tab === 'operators' && (
        <Section title="Operators">
          <SearchableInput items={db.operators} onAdd={onAddOperator} onDelete={onDeleteOperator} onEdit={onEditOperator} placeholder="New operator name" disabled={disable} />
        </Section>
      )}

      {tab === 'bobbins' && (
        <Section title="Bobbins">
          <SearchableInput items={db.bobbins} onAdd={onAddBobbin} onDelete={onDeleteBobbin} onEdit={onEditBobbin} placeholder="New bobbin name" disabled={disable} />
        </Section>
      )}
    </div>
  );
}
