import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ACCESS_LEVELS, getPermissionLevel } from '../../utils/permissions';
import AccessDenied from './AccessDenied';

export default function PermissionGate({ permission, permissions, minLevel = ACCESS_LEVELS.READ, children, fallback }) {
  const { user } = useAuth();
  if (user?.isAdmin) return children;
  const permissionList = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  const permissionsMap = user?.permissions || {};

  const levels = permissionList.length
    ? permissionList.map((key) => getPermissionLevel(permissionsMap, key))
    : [getPermissionLevel(permissionsMap, permission)];

  const allowed = levels.some((level) => level >= minLevel);
  if (!allowed) {
    return fallback || <AccessDenied />;
  }
  return children;
}
