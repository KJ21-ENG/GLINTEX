import prisma from '../lib/prisma.js';
import { hashSessionToken, SESSION_COOKIE_NAME } from '../utils/auth.js';

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
            role: true,
          },
        },
      },
    });

    if (!session || session.revokedAt) return res.status(401).json({ error: 'unauthorized' });
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return res.status(401).json({ error: 'session_expired' });
    if (!session.user || session.user.isActive === false) return res.status(403).json({ error: 'user_disabled' });
    if (!session.user.role) return res.status(403).json({ error: 'role_missing' });

    req.user = {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      roleId: session.user.roleId,
      roleKey: session.user.role.key,
      roleName: session.user.role.name,
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
    if (req.user.roleKey !== roleKey) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

