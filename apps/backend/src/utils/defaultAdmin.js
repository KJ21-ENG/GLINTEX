import prisma from '../lib/prisma.js';
import { hashPassword, normalizeUsername } from './auth.js';

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const val = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(val)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(val)) return false;
  return defaultValue;
}

export async function ensureDefaultAdminUser() {
  const enabled = envFlag('AUTO_CREATE_ADMIN', true);
  if (!enabled) return { created: false, reason: 'disabled' };

  const userCount = await prisma.user.count();
  if (userCount > 0) return { created: false, reason: 'already_exists' };

  const username = normalizeUsername(process.env.DEFAULT_ADMIN_USERNAME || 'admin');
  const passwordProvided = process.env.DEFAULT_ADMIN_PASSWORD != null && String(process.env.DEFAULT_ADMIN_PASSWORD).length > 0;
  const password = String(process.env.DEFAULT_ADMIN_PASSWORD || 'admin123');
  const displayName = process.env.DEFAULT_ADMIN_DISPLAY_NAME != null
    ? String(process.env.DEFAULT_ADMIN_DISPLAY_NAME).trim()
    : 'Admin';

  if (!username) {
    throw new Error('DEFAULT_ADMIN_USERNAME is required');
  }
  if (!password || password.length < 6) {
    throw new Error('DEFAULT_ADMIN_PASSWORD must be at least 6 characters');
  }

  let adminRole = await prisma.role.findUnique({ where: { key: 'admin' } });
  if (!adminRole) {
    console.log('Admin role missing. Creating "admin" role...');
    try {
      adminRole = await prisma.role.create({
        data: {
          key: 'admin',
          name: 'Administrator',
          description: 'System Administrator with full access',
        },
      });
    } catch (err) {
      // Race protection: if another instance created it concurrently (P2002), fetch it.
      if (err.code === 'P2002') {
        adminRole = await prisma.role.findUnique({ where: { key: 'admin' } });
      } else {
        throw err;
      }
    }
  }

  const passwordHash = await hashPassword(password);

  try {
    await prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        roleId: adminRole.id,
        isActive: true,
      },
    });
    return { created: true, username, password, passwordSource: passwordProvided ? 'env' : 'default' };
  } catch (err) {
    // Race protection if multiple instances attempt bootstrap.
    if (err && err.code === 'P2002') return { created: false, reason: 'already_exists' };
    throw err;
  }
}
