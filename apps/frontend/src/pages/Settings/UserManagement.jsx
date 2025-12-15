import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Edit2, X, KeyRound, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui';
import * as api from '../../api';
import { useAuth } from '../../context/AuthContext';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return String(value);
  }
}

export default function UserManagement() {
  const { user } = useAuth();
  const isAdmin = user?.roleKey === 'admin';

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [roleKey, setRoleKey] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleDescription, setEditRoleDescription] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [newIsActive, setNewIsActive] = useState(true);

  const [editingUserId, setEditingUserId] = useState(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRoleId, setEditRoleId] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);

  const roleOptions = useMemo(() => roles || [], [roles]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        api.listAdminRoles(),
        api.listAdminUsers(),
      ]);
      setRoles(rolesRes?.roles || []);
      setUsers(usersRes?.users || []);
      if (!newRoleId && (rolesRes?.roles || []).length) {
        setNewRoleId((rolesRes.roles[0] || {}).id || '');
      }
    } catch (err) {
      setError(err?.message || 'Failed to load users/roles');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function handleCreateRole() {
    if (!roleKey.trim() || !roleName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.createAdminRole({
        key: roleKey.trim().toLowerCase(),
        name: roleName.trim(),
        description: roleDescription.trim() || null,
      });
      setRoleKey('');
      setRoleName('');
      setRoleDescription('');
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to create role');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateRole(id) {
    setLoading(true);
    setError(null);
    try {
      await api.updateAdminRole(id, {
        name: editRoleName.trim(),
        description: editRoleDescription.trim() || null,
      });
      setEditingRoleId(null);
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to update role');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser() {
    if (!newUsername.trim() || !newPassword || !newRoleId) return;
    setLoading(true);
    setError(null);
    try {
      await api.createAdminUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim() || null,
        password: newPassword,
        roleId: newRoleId,
        isActive: newIsActive,
      });
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewIsActive(true);
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateUser(id) {
    setLoading(true);
    setError(null);
    try {
      await api.updateAdminUser(id, {
        displayName: editDisplayName.trim() || null,
        roleId: editRoleId,
        isActive: editIsActive,
      });
      setEditingUserId(null);
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(target) {
    const password = window.prompt(`New password for ${target.username} (min 6 chars):`);
    if (!password) return;
    if (password.length < 6) return alert('Password must be at least 6 characters');
    setLoading(true);
    setError(null);
    try {
      await api.resetAdminUserPassword(target.id, password);
      alert('Password updated');
    } catch (err) {
      setError(err?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Users & Roles</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Only admins can manage users.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Roles</CardTitle>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Roles are assigned to users. Permissions are not enforced yet (only <Badge>admin</Badge> can manage users/roles).
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Role Key</Label>
              <Input value={roleKey} onChange={(e) => setRoleKey(e.target.value)} placeholder="e.g. supervisor" />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Supervisor" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <Button onClick={handleCreateRole} disabled={loading || !roleKey.trim() || !roleName.trim()}>
            <Plus className="w-4 h-4 mr-2" /> Add Role
          </Button>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No roles</TableCell>
                  </TableRow>
                ) : (roles || []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.key}</TableCell>
                    <TableCell>
                      {editingRoleId === r.id ? (
                        <Input value={editRoleName} onChange={(e) => setEditRoleName(e.target.value)} className="h-8" />
                      ) : (
                        r.name
                      )}
                    </TableCell>
                    <TableCell>
                      {editingRoleId === r.id ? (
                        <Input value={editRoleDescription} onChange={(e) => setEditRoleDescription(e.target.value)} className="h-8" />
                      ) : (
                        r.description || '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingRoleId === r.id ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdateRole(r.id)}>
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingRoleId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingRoleId(r.id);
                              setEditRoleName(r.name || '');
                              setEditRoleDescription(r.description || '');
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
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

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. operator1" />
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 chars" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)} className="h-10">
                {(roleOptions || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.key})</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Active</Label>
              <div className="h-10 flex items-center gap-2 px-3 rounded-md border">
                <Checkbox checked={newIsActive} onCheckedChange={(v) => setNewIsActive(!!v)} />
                <span className="text-sm">{newIsActive ? 'Active' : 'Disabled'}</span>
              </div>
            </div>
          </div>
          <Button onClick={handleCreateUser} disabled={loading || !newUsername.trim() || !newPassword || !newRoleId}>
            <Plus className="w-4 h-4 mr-2" /> Add User
          </Button>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="w-[170px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No users</TableCell>
                  </TableRow>
                ) : (users || []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">{u.username}</TableCell>
                    <TableCell>
                      {editingUserId === u.id ? (
                        <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} className="h-8" />
                      ) : (
                        u.displayName || '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {editingUserId === u.id ? (
                        <Select value={editRoleId} onChange={(e) => setEditRoleId(e.target.value)} className="h-8">
                          {(roleOptions || []).map((r) => (
                            <option key={r.id} value={r.id}>{r.name} ({r.key})</option>
                          ))}
                        </Select>
                      ) : (
                        u.role ? (
                          <Badge>{u.role.name}</Badge>
                        ) : '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {editingUserId === u.id ? (
                        <Checkbox checked={editIsActive} onCheckedChange={(v) => setEditIsActive(!!v)} />
                      ) : (
                        <Badge variant={u.isActive ? 'default' : 'destructive'}>{u.isActive ? 'Active' : 'Disabled'}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.lastLoginAt)}</TableCell>
                    <TableCell className="text-right">
                      {editingUserId === u.id ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdateUser(u.id)}>
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingUserId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingUserId(u.id);
                              setEditDisplayName(u.displayName || '');
                              setEditRoleId(u.role?.id || (roleOptions[0] ? roleOptions[0].id : ''));
                              setEditIsActive(!!u.isActive);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleResetPassword(u)} title="Reset password">
                            <KeyRound className="w-4 h-4" />
                          </Button>
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
    </div>
  );
}

