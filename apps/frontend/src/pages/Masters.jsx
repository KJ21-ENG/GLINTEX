import React, { useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Select, Badge, Label } from '../components/ui';
import { Plus, Trash2, Edit2, Save, X, Search } from 'lucide-react';
import { formatKg } from '../utils';

export function Masters() {
  const { 
    db, 
    createItem, updateItem, deleteItem,
    createYarn, updateYarn, deleteYarn,
    createCut, updateCut, deleteCut,
    createTwist, updateTwist, deleteTwist,
    createFirm, updateFirm, deleteFirm,
    createSupplier, updateSupplier, deleteSupplier,
    createMachine, updateMachine, deleteMachine,
    createOperator, updateOperator, deleteOperator,
    createBobbin, updateBobbin, deleteBobbin,
    createRollType, updateRollType, deleteRollType,
    createConeType, updateConeType, deleteConeType,
    createWrapper, updateWrapper, deleteWrapper,
    createBox, updateBox, deleteBox,
    refreshing 
  } = useInventory();

  const [activeTab, setActiveTab] = useState('items');

  const tabs = [
    { id: 'items', label: 'Items' },
    { id: 'yarns', label: 'Yarns' },
    { id: 'cuts', label: 'Cuts' },
    { id: 'twists', label: 'Twists' },
    { id: 'firms', label: 'Firms' },
    { id: 'suppliers', label: 'Suppliers' },
    { id: 'machines', label: 'Machines' },
    { id: 'workers', label: 'Workers' },
    { id: 'bobbins', label: 'Bobbins' },
    { id: 'rollTypes', label: 'Roll Types' },
    { id: 'coneTypes', label: 'Cone Types' },
    { id: 'wrappers', label: 'Wrappers' },
    { id: 'boxes', label: 'Boxes' },
  ];

  const renderContent = () => {
      switch(activeTab) {
          case 'items': return <SimpleMasterCrud title="Items" data={db.items} onCreate={createItem} onUpdate={updateItem} onDelete={deleteItem} loading={refreshing} />;
          case 'yarns': return <SimpleMasterCrud title="Yarns" data={db.yarns} onCreate={createYarn} onUpdate={updateYarn} onDelete={deleteYarn} loading={refreshing} />;
          case 'cuts': return <SimpleMasterCrud title="Cuts" data={db.cuts} onCreate={createCut} onUpdate={updateCut} onDelete={deleteCut} loading={refreshing} />;
          case 'twists': return <SimpleMasterCrud title="Twists" data={db.twists} onCreate={createTwist} onUpdate={updateTwist} onDelete={deleteTwist} loading={refreshing} />;
          case 'firms': return <SimpleMasterCrud title="Firms" data={db.firms} onCreate={createFirm} onUpdate={updateFirm} onDelete={deleteFirm} loading={refreshing} />;
          case 'suppliers': return <SimpleMasterCrud title="Suppliers" data={db.suppliers} onCreate={createSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} loading={refreshing} />;
          case 'machines': return <SimpleMasterCrud title="Machines" data={db.machines} onCreate={createMachine} onUpdate={updateMachine} onDelete={deleteMachine} loading={refreshing} />;
          case 'workers': return <WorkersMaster data={db.operators || []} onCreate={createOperator} onUpdate={updateOperator} onDelete={deleteOperator} loading={refreshing} />;
          case 'bobbins': return <WeightMasterCrud title="Bobbins" data={db.bobbins} onCreate={createBobbin} onUpdate={updateBobbin} onDelete={deleteBobbin} loading={refreshing} />;
          case 'rollTypes': return <WeightMasterCrud title="Roll Types" data={db.rollTypes} onCreate={createRollType} onUpdate={updateRollType} onDelete={deleteRollType} loading={refreshing} />;
          case 'coneTypes': return <WeightMasterCrud title="Cone Types" data={db.cone_types} onCreate={createConeType} onUpdate={updateConeType} onDelete={deleteConeType} loading={refreshing} />;
          case 'wrappers': return <SimpleMasterCrud title="Wrappers" data={db.wrappers} onCreate={createWrapper} onUpdate={updateWrapper} onDelete={deleteWrapper} loading={refreshing} />;
          case 'boxes': return <WeightMasterCrud title="Boxes" data={db.boxes} onCreate={createBox} onUpdate={updateBox} onDelete={deleteBox} loading={refreshing} />;
          default: return null;
      }
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 fade-in items-start">
      <Card className="w-full md:w-64 shrink-0">
          <CardHeader>
              <CardTitle className="text-lg">Master Data</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
              <nav className="flex flex-col">
                  {tabs.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 ${activeTab === t.id ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}
                      >
                          {t.label}
                      </button>
                  ))}
              </nav>
          </CardContent>
      </Card>

      <div className="flex-1 w-full">
          {renderContent()}
      </div>
    </div>
  );
}

// --- Sub Components ---

function SimpleMasterCrud({ title, data, onCreate, onUpdate, onDelete, loading }) {
    const [newName, setNewName] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await onCreate(newName);
        setNewName('');
    }

    const handleUpdate = async (id) => {
        if (!editName.trim()) return;
        await onUpdate(id, editName);
        setEditingId(null);
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{title}</CardTitle>
                <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input placeholder={`New ${title} name`} value={newName} onChange={e=>setNewName(e.target.value)} />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim()}><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="rounded-md border max-h-[60vh] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableRow><TableCell colSpan={2} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Input value={editName} onChange={e=>setEditName(e.target.value)} className="h-8" />
                                        ) : item.name}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={()=>handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={()=>{setEditingId(item.id); setEditName(item.name)}}><Edit2 className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>{if(confirm('Delete?')) onDelete(item.id)}}><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}

function WeightMasterCrud({ title, data, onCreate, onUpdate, onDelete, loading }) {
    const [newName, setNewName] = useState('');
    const [newWeight, setNewWeight] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editWeight, setEditWeight] = useState('');

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await onCreate(newName, Number(newWeight));
        setNewName('');
        setNewWeight('');
    }

    const handleUpdate = async (id) => {
        if (!editName.trim()) return;
        await onUpdate(id, editName, Number(editWeight));
        setEditingId(null);
    }

    return (
        <Card>
             <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{title}</CardTitle>
                 <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input placeholder="Name" value={newName} onChange={e=>setNewName(e.target.value)} className="flex-1" />
                    <Input placeholder="Weight (kg)" type="number" step="0.001" value={newWeight} onChange={e=>setNewWeight(e.target.value)} className="w-32" />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim()}><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="rounded-md border max-h-[60vh] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead className="text-right">Weight (kg)</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                             {filtered.length === 0 ? (
                                <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? <Input value={editName} onChange={e=>setEditName(e.target.value)} className="h-8" /> : item.name}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === item.id ? <Input type="number" step="0.001" value={editWeight} onChange={e=>setEditWeight(e.target.value)} className="h-8 w-24 ml-auto" /> : formatKg(item.weight)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={()=>handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={()=>{setEditingId(item.id); setEditName(item.name); setEditWeight(item.weight)}}><Edit2 className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>{if(confirm('Delete?')) onDelete(item.id)}}><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}

function WorkersMaster({ data, onCreate, onUpdate, onDelete, loading }) {
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('operator');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState('operator');

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await onCreate(newName, newRole);
        setNewName('');
    }

    const handleUpdate = async (id) => {
        if (!editName.trim()) return;
        await onUpdate(id, editName, editRole);
        setEditingId(null);
    }

    return (
        <Card>
             <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Workers</CardTitle>
                 <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input placeholder="Name" value={newName} onChange={e=>setNewName(e.target.value)} className="flex-1" />
                    <Select value={newRole} onChange={e=>setNewRole(e.target.value)} className="w-32">
                        <option value="operator">Operator</option>
                        <option value="helper">Helper</option>
                    </Select>
                    <Button onClick={handleCreate} disabled={loading || !newName.trim()}><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="rounded-md border max-h-[60vh] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? <Input value={editName} onChange={e=>setEditName(e.target.value)} className="h-8" /> : item.name}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select value={editRole} onChange={e=>setEditRole(e.target.value)} className="h-8">
                                                <option value="operator">Operator</option>
                                                <option value="helper">Helper</option>
                                            </Select>
                                        ) : <Badge variant="outline" className="capitalize">{item.role || 'operator'}</Badge>}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={()=>handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={()=>{setEditingId(item.id); setEditName(item.name); setEditRole(item.role || 'operator')}}><Edit2 className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>{if(confirm('Delete?')) onDelete(item.id)}}><Trash2 className="w-4 h-4" /></Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}