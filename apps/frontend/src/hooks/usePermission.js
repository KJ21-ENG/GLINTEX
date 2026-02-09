import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { ACCESS_LEVELS, getPermissionLevel, STAGE_PERMISSION_KEYS } from '../utils/permissions';

export function usePermission(key) {
  const { user } = useAuth();
  const permissions = user?.permissions || {};
  const level = getPermissionLevel(permissions, key);
  const editLevel = getPermissionLevel(permissions, `${key}.edit`);
  const deleteLevel = getPermissionLevel(permissions, `${key}.delete`);
  return useMemo(() => ({
    level,
    canRead: level >= ACCESS_LEVELS.READ,
    canWrite: level >= ACCESS_LEVELS.WRITE,
    canEdit: editLevel >= ACCESS_LEVELS.READ,
    canDelete: deleteLevel >= ACCESS_LEVELS.READ,
    isHidden: level === ACCESS_LEVELS.NONE,
  }), [level, editLevel, deleteLevel]);
}

export function useStagePermission(processKey, stage) {
  const permissionKey = STAGE_PERMISSION_KEYS?.[processKey]?.[stage] || null;
  return {
    permissionKey,
    ...usePermission(permissionKey || ''),
  };
}
