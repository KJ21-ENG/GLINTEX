import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Edit2, X, KeyRound, RefreshCw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui';
import * as api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { ACCESS_LEVELS, ISSUE_STAGE_PERMISSIONS, MODULE_PERMISSIONS, RECEIVE_STAGE_PERMISSIONS, normalizePermissions } from '../../utils/permissions';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return String(value);
  }
}

const ACCESS_OPTIONS = [
  { value: ACCESS_LEVELS.NONE, label: 'None' },
  { value: ACCESS_LEVELS.READ, label: 'Read' },
  { value: ACCESS_LEVELS.WRITE, label: 'Read & Write' },
];

function PermissionSelect({ value, onChange, disabled }) {
  return (
    <Select value={String(value ?? ACCESS_LEVELS.WRITE)} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled}>
      {ACCESS_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </Select>
  );
}

function ActionToggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs ${disabled ? 'text-muted-foreground' : ''}`}>
      <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

function PermissionEditor({ value, onChange, disabled }) {
  const stageRows = ISSUE_STAGE_PERMISSIONS.map(issueStage => ({
    stage: issueStage.stage,
    label: issueStage.label,
    issueKey: issueStage.key,
    issueSupportsEdit: !!issueStage.supportsEdit,
    issueSupportsDelete: !!issueStage.supportsDelete,
    receiveKey: (RECEIVE_STAGE_PERMISSIONS.find(r => r.stage === issueStage.stage) || {}).key,
    receiveSupportsEdit: !!(RECEIVE_STAGE_PERMISSIONS.find(r => r.stage === issueStage.stage) || {}).supportsEdit,
    receiveSupportsDelete: !!(RECEIVE_STAGE_PERMISSIONS.find(r => r.stage === issueStage.stage) || {}).supportsDelete,
  }));

  const updatePermission = (key, level) => {
    if (!key) return;
    const next = {
      ...value,
      [key]: level,
    };
    if (level <= ACCESS_LEVELS.NONE) {
      next[`${key}.edit`] = ACCESS_LEVELS.NONE;
      next[`${key}.delete`] = ACCESS_LEVELS.NONE;
    }
    onChange(next);
  };

  const updateAction = (key, action, enabled) => {
    if (!key) return;
    onChange({
      ...value,
      [`${key}.${action}`]: enabled ? ACCESS_LEVELS.READ : ACCESS_LEVELS.NONE,
    });
  };

  const isActionEnabled = (key, action) => Number(value?.[`${key}.${action}`] || 0) >= ACCESS_LEVELS.READ;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium mb-2">Module Permissions</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODULE_PERMISSIONS.map((perm) => (
            <div key={perm.key} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
              <span className="text-sm">{perm.label}</span>
              <div className="flex items-center gap-3">
                <div className="w-40">
                  <PermissionSelect
                    value={value?.[perm.key]}
                    onChange={(level) => updatePermission(perm.key, level)}
                    disabled={disabled}
                  />
                </div>
                {perm.supportsEdit && (
                  <ActionToggle
                    label="Edit"
                    checked={isActionEnabled(perm.key, 'edit')}
                    onChange={(checked) => updateAction(perm.key, 'edit', checked)}
                    disabled={disabled || Number(value?.[perm.key] || 0) <= ACCESS_LEVELS.NONE}
                  />
                )}
                {perm.supportsDelete && (
                  <ActionToggle
                    label="Delete"
                    checked={isActionEnabled(perm.key, 'delete')}
                    onChange={(checked) => updateAction(perm.key, 'delete', checked)}
                    disabled={disabled || Number(value?.[perm.key] || 0) <= ACCESS_LEVELS.NONE}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Stage Permissions (Issue & Receive)</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
          <div className="font-medium text-muted-foreground">Stage</div>
          <div className="font-medium text-muted-foreground">Issue</div>
          <div className="font-medium text-muted-foreground">Receive</div>
          <div className="font-medium text-muted-foreground">Issue Actions</div>
          <div className="font-medium text-muted-foreground">Receive Actions</div>
          {stageRows.map((row) => (
            <React.Fragment key={row.stage}>
              <div className="flex items-center">{row.label}</div>
              <PermissionSelect
                value={value?.[row.issueKey]}
                onChange={(level) => updatePermission(row.issueKey, level)}
                disabled={disabled}
              />
              <PermissionSelect
                value={value?.[row.receiveKey]}
                onChange={(level) => updatePermission(row.receiveKey, level)}
                disabled={disabled}
              />
              <div className="flex items-center gap-3">
                {row.issueSupportsEdit && (
                  <ActionToggle
                    label="Edit"
                    checked={isActionEnabled(row.issueKey, 'edit')}
                    onChange={(checked) => updateAction(row.issueKey, 'edit', checked)}
                    disabled={disabled || Number(value?.[row.issueKey] || 0) <= ACCESS_LEVELS.NONE}
                  />
                )}
                {row.issueSupportsDelete && (
                  <ActionToggle
                    label="Delete"
                    checked={isActionEnabled(row.issueKey, 'delete')}
                    onChange={(checked) => updateAction(row.issueKey, 'delete', checked)}
                    disabled={disabled || Number(value?.[row.issueKey] || 0) <= ACCESS_LEVELS.NONE}
                  />
                )}
              </div>
              <div className="flex items-center gap-3">
                {row.receiveSupportsEdit && (
                  <ActionToggle
                    label="Edit"
                    checked={isActionEnabled(row.receiveKey, 'edit')}
                    onChange={(checked) => updateAction(row.receiveKey, 'edit', checked)}
                    disabled={disabled || Number(value?.[row.receiveKey] || 0) <= ACCESS_LEVELS.NONE}
                  />
                )}
                {row.receiveSupportsDelete && (
                  <ActionToggle
                    label="Delete"
                    checked={isActionEnabled(row.receiveKey, 'delete')}
                    onChange={(checked) => updateAction(row.receiveKey, 'delete', checked)}
                    disabled={disabled || Number(value?.[row.receiveKey] || 0) <= ACCESS_LEVELS.NONE}
                  />
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function RoleMultiSelect({ roles, selectedIds, onChange, disabled }) {
  const toggle = (roleId) => {
    if (disabled) return;
    if (selectedIds.includes(roleId)) {
      onChange(selectedIds.filter(id => id !== roleId));
    } else {
      onChange([...selectedIds, roleId]);
    }
  };

  return (
    <div className="border rounded-md p-2 space-y-2 max-h-40 overflow-auto">
      {(roles || []).length === 0 ? (
        <div className="text-xs text-muted-foreground">No roles available.</div>
      ) : (roles || []).map((role) => (
        <label key={role.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={selectedIds.includes(role.id)} onCheckedChange={() => toggle(role.id)} />
          <span>{role.name} ({role.key})</span>
        </label>
      ))}
    </div>
  );
}

export default function UserManagement() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin || (user?.roleKeys || []).includes('admin');

  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [roleKey, setRoleKey] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [rolePermissions, setRolePermissions] = useState(() => normalizePermissions({}));
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleDescription, setEditRoleDescription] = useState('');
  const [editRolePermissions, setEditRolePermissions] = useState(() => normalizePermissions({}));

  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleIds, setNewRoleIds] = useState([]);
  const [newIsActive, setNewIsActive] = useState(true);

  const [editingUserId, setEditingUserId] = useState(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRoleIds, setEditRoleIds] = useState([]);
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
      const nextRoles = (rolesRes?.roles || []).map(r => ({
        ...r,
        permissions: normalizePermissions(r.permissions || {}),
      }));
      setRoles(nextRoles);
      setUsers(usersRes?.users || []);
      if (newRoleIds.length === 0 && nextRoles.length) {
        setNewRoleIds([nextRoles[0].id]);
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
        permissions: rolePermissions,
      });
      setRoleKey('');
      setRoleName('');
      setRoleDescription('');
      setRolePermissions(normalizePermissions({}));
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
        permissions: editRolePermissions,
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
    if (!newUsername.trim() || !newPassword || newRoleIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await api.createAdminUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim() || null,
        password: newPassword,
        roleIds: newRoleIds,
        isActive: newIsActive,
      });
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewIsActive(true);
      setNewRoleIds(roleOptions[0] ? [roleOptions[0].id] : []);
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
        roleIds: editRoleIds,
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
          <div className="rounded-md border bg-muted/10 p-4">
            <PermissionEditor value={rolePermissions} onChange={setRolePermissions} />
          </div>
          <Button onClick={handleCreateRole} disabled={loading || !roleKey.trim() || !roleName.trim()}>
            <Plus className="w-4 h-4 mr-2" /> Add Role
          </Button>

          <div className="hidden sm:block rounded-md border overflow-x-auto">
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
                              setEditRolePermissions(normalizePermissions(r.permissions || {}));
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

          {/* Mobile Card View */}
          <div className="block sm:hidden space-y-2">
            {(roles || []).length === 0 ? (
              <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No roles</div>
            ) : (roles || []).map((r) => (
              <div key={r.id} className="border rounded-lg bg-card p-3">
                {editingRoleId === r.id ? (
                  <div className="space-y-2">
                    <Input value={editRoleName} onChange={(e) => setEditRoleName(e.target.value)} placeholder="Name" />
                    <Input value={editRoleDescription} onChange={(e) => setEditRoleDescription(e.target.value)} placeholder="Description" />
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdateRole(r.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingRoleId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{r.key}</span>
                        {r.description && <span className="ml-2">• {r.description}</span>}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                      setEditingRoleId(r.id);
                      setEditRoleName(r.name || '');
                      setEditRoleDescription(r.description || '');
                      setEditRolePermissions(normalizePermissions(r.permissions || {}));
                    }}><Edit2 className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {editingRoleId && (
            <div className="rounded-md border bg-muted/10 p-4">
              <div className="text-sm font-medium mb-2">Edit Permissions</div>
              <PermissionEditor value={editRolePermissions} onChange={setEditRolePermissions} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <div className="space-y-2 lg:col-span-2">
              <Label>Roles</Label>
              <RoleMultiSelect roles={roleOptions} selectedIds={newRoleIds} onChange={setNewRoleIds} />
            </div>
            <div className="space-y-2">
              <Label>Active</Label>
              <div className="h-10 flex items-center gap-2 px-3 rounded-md border">
                <Checkbox checked={newIsActive} onCheckedChange={(v) => setNewIsActive(!!v)} />
                <span className="text-sm">{newIsActive ? 'Active' : 'Disabled'}</span>
              </div>
            </div>
          </div>
          <Button onClick={handleCreateUser} disabled={loading || !newUsername.trim() || !newPassword || newRoleIds.length === 0}>
            <Plus className="w-4 h-4 mr-2" /> Add User
          </Button>

          <div className="hidden sm:block rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Roles</TableHead>
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
                        <RoleMultiSelect roles={roleOptions} selectedIds={editRoleIds} onChange={setEditRoleIds} />
                      ) : (
                        (u.roles && u.roles.length > 0)
                          ? u.roles.map(r => r.name).join(', ')
                          : '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {editingUserId === u.id ? (
                        <Checkbox checked={editIsActive} onCheckedChange={(v) => setEditIsActive(!!v)} />
                      ) : (
                        u.isActive ? 'Active' : 'Disabled'
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
                              setEditRoleIds((u.roles || []).map(r => r.id));
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

          {/* Mobile Card View */}
          <div className="block sm:hidden space-y-2">
            {(users || []).length === 0 ? (
              <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No users</div>
            ) : (users || []).map((u) => (
              <div key={u.id} className="border rounded-lg bg-card p-3">
                {editingUserId === u.id ? (
                  <div className="space-y-2">
                    <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder="Display Name" />
                    <RoleMultiSelect roles={roleOptions} selectedIds={editRoleIds} onChange={setEditRoleIds} />
                    <div className="flex items-center gap-2">
                      <Checkbox checked={editIsActive} onCheckedChange={(v) => setEditIsActive(!!v)} />
                      <span className="text-sm">{editIsActive ? 'Active' : 'Disabled'}</span>
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdateUser(u.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingUserId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{u.displayName || u.username}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{u.username}</span>
                        {u.roles && u.roles.length > 0 && <span className="ml-2">• {u.roles.map(r => r.name).join(', ')}</span>}
                      </div>
                      <div className="text-xs mt-1">
                        <span className={u.isActive ? 'text-green-600' : 'text-orange-600'}>{u.isActive ? 'Active' : 'Disabled'}</span>
                        {u.lastLoginAt && <span className="text-muted-foreground ml-2">Last: {formatDateTime(u.lastLoginAt)}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                        setEditingUserId(u.id);
                        setEditDisplayName(u.displayName || '');
                        setEditRoleIds((u.roles || []).map(r => r.id));
                        setEditIsActive(!!u.isActive);
                      }}><Edit2 className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleResetPassword(u)} title="Reset password">
                        <KeyRound className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
