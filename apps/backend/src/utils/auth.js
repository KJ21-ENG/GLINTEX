import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'glintex_session';
export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function generateSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function getSessionExpiryDate() {
  const days = Number.isFinite(SESSION_TTL_DAYS) && SESSION_TTL_DAYS > 0 ? SESSION_TTL_DAYS : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function getSessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const defaultSameSite = isProd ? 'none' : 'lax';
  const rawSameSite = String(process.env.COOKIE_SAMESITE || defaultSameSite).trim().toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(rawSameSite) ? rawSameSite : defaultSameSite;
  const secure = process.env.COOKIE_SECURE === 'true' || sameSite === 'none';
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
  };
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...getSessionCookieOptions(), maxAge: 0 });
}

export async function hashPassword(password) {
  const pwd = String(password || '');
  const saltRounds = 12;
  return await bcrypt.hash(pwd, saltRounds);
}

export async function verifyPassword(password, passwordHash) {
  return await bcrypt.compare(String(password || ''), String(passwordHash || ''));
}
