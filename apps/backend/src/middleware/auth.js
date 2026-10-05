import prisma from '../lib/prisma.js';
import { hashSessionToken, SESSION_COOKIE_NAME } from '../utils/auth.js';
import { ACCESS_LEVELS, buildEffectivePermissions, normalizePermissions } from '../utils/permissions.js';

function getTokenFromRequest(req) {
  const cookieToken = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : null;
  if (cookieToken) return cookieToken;

  const header = req.headers?.authorization || req.headers?.Authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice('bearer '.length).trim();
    return token || null;
  }
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const tokenHash = hashSessionToken(token);
    const session = await prisma.userSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt) return res.status(401).json({ error: 'unauthorized' });
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return res.status(401).json({ error: 'session_expired' });
    if (!session.user || session.user.isActive === false) return res.status(403).json({ error: 'user_disabled' });
    const roleLinks = Array.isArray(session.user.roles) ? session.user.roles : [];
    const roles = roleLinks.map(link => link.role).filter(Boolean);
    if (!roles.length) return res.status(403).json({ error: 'role_missing' });

    const roleKeys = roles.map(role => role.key);
    const roleNames = roles.map(role => role.name);
    const isAdmin = roleKeys.includes('admin');
    const permissions = buildEffectivePermissions(roles);
    const primaryRoleKey = isAdmin ? 'admin' : (roleKeys[0] || null);

    req.user = {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      roles: roles.map(role => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description || null,
        permissions: normalizePermissions(role.permissions),
      })),
      roleKeys,
      roleNames,
      primaryRoleKey,
      isAdmin,
      permissions,
    };
    req.session = {
      id: session.id,
      tokenHash: session.tokenHash,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error', err);
    res.status(500).json({ error: 'auth_check_failed' });
  }
}

export function requireRole(roleKey) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!Array.isArray(req.user.roleKeys) || !req.user.roleKeys.includes(roleKey)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

function hasPermissionLevel(req, permissionKey, minLevel) {
  if (req.user?.isAdmin) return true;
  const level = req.user?.permissions ? Number(req.user.permissions[permissionKey] || 0) : 0;
  return level >= minLevel;
}

export function requirePermission(permissionKey, minLevel = ACCESS_LEVELS.READ) {
  return function requirePermissionMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!hasPermissionLevel(req, permissionKey, minLevel)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

const STICKER_TEMPLATE_PERMISSIONS = {
  inbound: 'inbound',
  cutter_issue: 'issue.cutter',
  cutter_issue_small: 'issue.cutter',
  holo_issue: 'issue.holo',
  coning_issue: 'issue.coning',
  cutter_receive: 'receive.cutter',
  holo_receive: 'receive.holo',
  coning_receive: 'receive.coning',
  coning_receive_small: 'receive.coning',
};

export function requireStickerTemplateRead(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const stageKey = String(req.params.stageKey || '').trim();
  if (!Object.prototype.hasOwnProperty.call(STICKER_TEMPLATE_PERMISSIONS, stageKey)) {
    return res.status(404).json({ error: 'Template not found' });
  }
  const stagePermission = STICKER_TEMPLATE_PERMISSIONS[stageKey];
  // Stock/history readers can print; opening stock uses inbound/receive artwork.
  // Reading that artwork grants no Settings or receipt mutation authority.
  const allowed = hasPermissionLevel(req, 'settings', ACCESS_LEVELS.READ)
    || hasPermissionLevel(req, stagePermission, ACCESS_LEVELS.READ)
    || hasPermissionLevel(req, 'stock', ACCESS_LEVELS.READ)
    || ((stagePermission === 'inbound' || stagePermission.startsWith('receive.'))
      && hasPermissionLevel(req, 'opening_stock', ACCESS_LEVELS.READ));
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  next();
}

function requireActionPermission(baseKey, actionKey) {
  return function requireActionPermissionMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (req.user.isAdmin) return next();
    const baseAllowed = hasPermissionLevel(req, baseKey, ACCESS_LEVELS.READ);
    const actionAllowed = hasPermissionLevel(req, actionKey, ACCESS_LEVELS.READ);
    if (!baseAllowed || !actionAllowed) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export function requireEditPermission(baseKey) {
  return requireActionPermission(baseKey, `${baseKey}.edit`);
}

export function requireDeletePermission(baseKey) {
  return requireActionPermission(baseKey, `${baseKey}.delete`);
}
