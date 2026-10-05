// Executes the actual login/logout handlers and auth middleware with isolated
// in-memory persistence. No production database or messaging integrations load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as auth from '../../utils/auth.js';
import * as permissions from '../../utils/permissions.js';

const routesSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const middlewareSource = readFileSync(new URL('../../middleware/auth.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
function section(start, end) {
  const a = routesSource.indexOf(start), b = routesSource.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Actual route source missing: ${start}`);
  return routesSource.slice(a, b);
}
async function fixture() {
  const users = [{ id: 'user-test', username: 'test-operator', isActive: true, passwordHash: await auth.hashPassword('fixture-password-only'), roles: [{ role: { id: 'role-test', key: 'operator', name: 'Operator', permissions: { ...permissions.normalizePermissions({}, { baseDefault: 0 }), 'receive.cutter': 2, settings: 0 } } }] }];
  const sessions = [];
  const prisma = {
    user: { findUnique: async ({ where }) => users.find(u => u.username === where.username), update: async () => users[0] },
    userSession: {
      create: async ({ data }) => { const s = { id: `session-${sessions.length}`, ...data, user: users[0] }; sessions.push(s); return s; },
      findUnique: async ({ where }) => sessions.find(s => s.tokenHash === where.tokenHash),
      update: async ({ where, data }) => Object.assign(sessions.find(s => s.id === where.id), data),
    },
  };
  const router = express.Router();
  const context = vm.createContext({ ...auth, ...permissions, prisma, router, console, Date });
  vm.runInContext(middlewareSource, context);
  vm.runInContext(section('function buildUserPayload(user)', 'function getActor(req)'), context);
  vm.runInContext(section('function actorUpdateFields(actorUserId)', 'async function logCrudWithActor'), context);
  vm.runInContext(section("router.post('/api/auth/login'", "router.post('/api/auth/bootstrap'"), context);
  router.use(context.requireAuth);
  vm.runInContext(section("router.get('/api/auth/me'", '// ===== Admin: Users & Roles ====='), context);
  router.post('/fixture/receive', context.requirePermission('receive.cutter', 2), (_, res) => res.json({ ok: true }));
  router.post('/fixture/settings', context.requirePermission('settings', 2), (_, res) => res.json({ ok: true }));
  const app = express(); app.use(express.json(), cookieParser(), router);
  return { app, users, sessions };
}
async function login(app) {
  const response = await request(app).post('/api/auth/login').send({ username: ' Test-Operator ', password: 'fixture-password-only' }).expect(200);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Expires=/i);
  return cookie.split(';')[0];
}

test('actual login issues persistent HttpOnly cookie; restored client retains identity and roles; logout revokes', async () => {
  const f = await fixture(); const cookie = await login(f.app);
  const me = await request(f.app).get('/api/auth/me').set('Cookie', cookie).expect(200);
  assert.equal(me.body.user.username, 'test-operator');
  assert.equal(me.body.user.permissions['receive.cutter'], 2);
  // A fresh HTTP client with persisted cookie models reopening the application.
  await request(f.app).get('/api/auth/me').set('Cookie', cookie).expect(200);
  await request(f.app).post('/fixture/receive').set('Cookie', cookie).expect(200);
  await request(f.app).post('/fixture/settings').set('Cookie', cookie).expect(403);
  const logout = await request(f.app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
  assert.ok(logout.headers['set-cookie'].some(c => c.startsWith(`${auth.SESSION_COOKIE_NAME}=;`) && /Max-Age=0/i.test(c)));
  await request(f.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
});
test('invalid credentials create no session; missing and expired cookies reject', async () => {
  const f = await fixture();
  await request(f.app).post('/api/auth/login').send({ username: 'test-operator', password: 'wrong' }).expect(401);
  assert.equal(f.sessions.length, 0);
  await request(f.app).get('/api/auth/me').expect(401);
  const cookie = await login(f.app); f.sessions[0].expiresAt = new Date(Date.now() - 1000);
  const response = await request(f.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  assert.equal(response.body.error, 'session_expired');
});
test('disabled user and removed roles take effect on existing session', async () => {
  const f = await fixture(); const cookie = await login(f.app);
  f.users[0].isActive = false;
  await request(f.app).get('/api/auth/me').set('Cookie', cookie).expect(403);
  f.users[0].isActive = true; f.users[0].roles = [];
  await request(f.app).get('/api/auth/me').set('Cookie', cookie).expect(403);
});

test('production secure-cookie option is preserved without changing SameSite or HttpOnly', () => {
  const previous = process.env.COOKIE_SECURE;
  try {
    process.env.COOKIE_SECURE = 'true';
    assert.deepEqual(auth.getSessionCookieOptions(), { httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
  } finally {
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  }
});
