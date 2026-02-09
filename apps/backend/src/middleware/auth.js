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
    res.status(401).json({ error: 'unauthorized' });
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
