/**
 * Masters page component for GLINTEX Inventory
 */

import React, { useState, useMemo } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, SearchableInput, BobbinEditor, Select } from '../components';
import { formatKg } from '../utils';

export function Masters({
  db,
  onAddItem,
  onDeleteItem,
  onEditItem,
  onAddFirm,
  onDeleteFirm,
  onEditFirm,
  onAddSupplier,
  onDeleteSupplier,
  onEditSupplier,
  onAddMachine,
  onDeleteMachine,
  onEditMachine,
  onAddWorker,
  onDeleteWorker,
  onEditWorker,
  onAddBobbin,
  onDeleteBobbin,
  onEditBobbin,
  onAddBox,
  onDeleteBox,
  onEditBox,
  refreshing,
}) {
  const { cls } = useBrand();
  const [itemName, setItemName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [machineName, setMachineName] = useState("");
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState('items'); // items | firms | suppliers | machines | workers | bobbins | boxes

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

  async function addBobbin(name, weight) {
    setWorking(true);
    try {
      await onAddBobbin(name, weight);
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

  const workersList = useMemo(() => {
    if (Array.isArray(db.workers) && db.workers.length > 0) {
      return db.workers.map(w => ({ ...w, role: (w.role || 'operator') }));
    }
    const merged = [];
    (db.operators || []).forEach(op => merged.push({ ...op, role: 'operator' }));
    (db.helpers || []).forEach(helper => {
      if (!merged.some(w => w.id === helper.id)) merged.push({ ...helper, role: 'helper' });
    });
    return merged;
  }, [db.workers, db.operators, db.helpers]);

  const boxes = useMemo(() => db.boxes || [], [db.boxes]);


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
        <button onClick={() => setTab('workers')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='workers' ? cls.navActive : 'border-transparent'} ${tab!=='workers' ? cls.navHover : ''}`}>
          Workers
        </button>
        <button onClick={() => setTab('bobbins')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='bobbins' ? cls.navActive : 'border-transparent'} ${tab!=='bobbins' ? cls.navHover : ''}`}>
          Bobbins
        </button>
        <button onClick={() => setTab('boxes')} className={`px-3 py-1 rounded-lg text-sm border ${tab==='boxes' ? cls.navActive : 'border-transparent'} ${tab!=='boxes' ? cls.navHover : ''}`}>
          Boxes
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

      {tab === 'workers' && (
        <Section title="Workers">
          <WorkersPanel
            workers={workersList}
            onAdd={onAddWorker}
            onDelete={onDeleteWorker}
            onEdit={onEditWorker}
            disabled={disable}
            cls={cls}
          />
        </Section>
      )}

      {tab === 'bobbins' && (
        <Section title="Bobbins">
          <BobbinEditor items={db.bobbins} onAdd={addBobbin} onDelete={deleteBobbin} onEdit={onEditBobbin} disabled={disable} />
        </Section>
      )}

      {tab === 'boxes' && (
        <Section title="Boxes">
          <BoxesPanel
            boxes={boxes}
            onAdd={onAddBox}
            onDelete={onDeleteBox}
            onEdit={onEditBox}
            disabled={disable}
            cls={cls}
          />
        </Section>
      )}
    </div>
  );
}

function WorkersPanel({ workers, onAdd, onDelete, onEdit, disabled, cls }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('operator');
  const [message, setMessage] = useState(null);

  async function addWorker() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await onAdd(trimmed, role);
      setName('');
      setRole('operator');
      setMessage(null);
    } catch (err) {
      alert(err.message || 'Failed to add worker');
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className={`text-xs ${cls.muted}`}>Worker name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} placeholder="e.g. Arjun" />
        </div>
        <div>
          <label className={`text-xs ${cls.muted}`}>Role</label>
          <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={disabled}>
            <option value="operator">Operator</option>
            <option value="helper">Helper</option>
          </Select>
        </div>
        <div className="flex items-end">
          <Button onClick={addWorker} disabled={disabled || !name.trim()}>
            Add worker
          </Button>
        </div>
      </div>
      {message && <div className={`text-sm ${cls.muted}`}>{message}</div>}
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className={`text-left ${cls.muted}`}>
            <tr>
              <th className="py-2 pr-2">Name</th>
              <th className="py-2 pr-2">Role</th>
              <th className="py-2 pr-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.length === 0 ? (
              <tr><td colSpan={3} className="py-4 text-center text-sm">No workers yet.</td></tr>
            ) : workers.map(worker => (
              <WorkerRow
                key={worker.id}
                worker={worker}
                onEdit={onEdit}
                onDelete={onDelete}
                disabled={disabled}
                cls={cls}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkerRow({ worker, onEdit, onDelete, disabled, cls }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(worker.name);
  const [role, setRole] = useState(worker.role || 'operator');
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onEdit(worker.id, trimmed, role);
      setEditing(false);
    } catch (err) {
      alert(err.message || 'Failed to update worker');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this worker?')) return;
    try {
      await onDelete(worker.id);
    } catch (err) {
      alert(err.message || 'Failed to delete worker');
    }
  }

  if (editing) {
    return (
      <tr className={`border-t ${cls.rowBorder}`}>
        <td className="py-2 pr-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled || saving} />
        </td>
        <td className="py-2 pr-2">
          <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={disabled || saving}>
            <option value="operator">Operator</option>
            <option value="helper">Helper</option>
          </Select>
        </td>
        <td className="py-2 pr-2 text-right flex gap-2 justify-end">
          <Button onClick={save} disabled={disabled || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          <SecondaryButton onClick={() => setEditing(false)} disabled={disabled || saving}>Cancel</SecondaryButton>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-t ${cls.rowBorder}`}>
      <td className="py-2 pr-2">{worker.name}</td>
      <td className="py-2 pr-2 capitalize">{worker.role || 'operator'}</td>
      <td className="py-2 pr-2 text-right flex gap-2 justify-end">
        <SecondaryButton onClick={() => setEditing(true)} disabled={disabled}>Edit</SecondaryButton>
        <button className="text-sm text-red-500 underline" onClick={remove} disabled={disabled}>Delete</button>
      </td>
    </tr>
  );
}

function BoxesPanel({ boxes, onAdd, onDelete, onEdit, disabled, cls }) {
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');

  async function addBox() {
    const trimmed = name.trim();
    const weightNum = Number(weight);
    if (!trimmed || !Number.isFinite(weightNum) || weightNum <= 0) {
      alert('Enter a valid name and positive weight.');
      return;
    }
    try {
      await onAdd(trimmed, weightNum);
      setName('');
      setWeight('');
    } catch (err) {
      alert(err.message || 'Failed to add box');
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className={`text-xs ${cls.muted}`}>Box name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} placeholder="Carton 1" />
        </div>
        <div>
          <label className={`text-xs ${cls.muted}`}>Weight (kg)</label>
          <Input type="number" min="0" step="0.001" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={disabled} placeholder="0.650" />
        </div>
        <div className="flex items-end">
          <Button onClick={addBox} disabled={disabled || !name.trim()}>
            Add box
          </Button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className={`text-left ${cls.muted}`}>
            <tr>
              <th className="py-2 pr-2">Name</th>
              <th className="py-2 pr-2 text-right">Weight (kg)</th>
              <th className="py-2 pr-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {boxes.length === 0 ? (
              <tr><td colSpan={3} className="py-4 text-center text-sm">No boxes yet.</td></tr>
            ) : boxes.map(box => (
              <BoxRow key={box.id} box={box} onEdit={onEdit} onDelete={onDelete} disabled={disabled} cls={cls} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoxRow({ box, onEdit, onDelete, disabled, cls }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(box.name);
  const [weight, setWeight] = useState(String(box.weight ?? ''));
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    const weightNum = Number(weight);
    if (!trimmed || !Number.isFinite(weightNum) || weightNum <= 0) {
      alert('Enter valid values.');
      return;
    }
    setSaving(true);
    try {
      await onEdit(box.id, trimmed, weightNum);
      setEditing(false);
    } catch (err) {
      alert(err.message || 'Failed to update box');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this box?')) return;
    try {
      await onDelete(box.id);
    } catch (err) {
      alert(err.message || 'Failed to delete box');
    }
  }

  if (editing) {
    return (
      <tr className={`border-t ${cls.rowBorder}`}>
        <td className="py-2 pr-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled || saving} />
        </td>
        <td className="py-2 pr-2 text-right">
          <Input type="number" min="0" step="0.001" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={disabled || saving} />
        </td>
        <td className="py-2 pr-2 text-right flex gap-2 justify-end">
          <Button onClick={save} disabled={disabled || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          <SecondaryButton onClick={() => setEditing(false)} disabled={disabled || saving}>Cancel</SecondaryButton>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-t ${cls.rowBorder}`}>
      <td className="py-2 pr-2">{box.name}</td>
      <td className="py-2 pr-2 text-right">{formatKg(box.weight || 0)} kg</td>
      <td className="py-2 pr-2 text-right flex gap-2 justify-end">
        <SecondaryButton onClick={() => setEditing(true)} disabled={disabled}>Edit</SecondaryButton>
        <button className="text-sm text-red-500 underline" onClick={remove} disabled={disabled}>Delete</button>
      </td>
    </tr>
  );
}
