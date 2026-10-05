// Actual handlers and authentication, isolated from production persistence/integrations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as auth from '../../../utils/auth.js';
import * as permissions from '../../../utils/permissions.js';
export const TEMPLATE_STAGES = ['inbound', 'cutter_issue', 'cutter_issue_small', 'holo_issue', 'coning_issue', 'cutter_receive', 'holo_receive', 'coning_receive', 'coning_receive_small'];
const routesSource = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
const middlewareSource = readFileSync(new URL('../../../middleware/auth.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
function section(start, end) {
  const a = routesSource.indexOf(start), b = routesSource.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Actual route source missing: ${start}`);
  return routesSource.slice(a, b);
}
export async function fixture(rolePermissions = { 'receive.cutter': 2 }, roleKey = 'operator') {
  const users = [{ id: 'user-test', username: 'test-operator', isActive: true, passwordHash: await auth.hashPassword('fixture-password-only'), roles: [{ role: { id: 'role-test', key: roleKey, name: 'Fixture role', permissions: { ...permissions.normalizePermissions({}, { baseDefault: 0 }), ...rolePermissions } } }] }];
  const sessions = [];
  const templates = new Map(TEMPLATE_STAGES.map(stageKey => [stageKey, {
    id: `template-${stageKey}`, stageKey, dimensions: { width: 48, height: 25 },
    content: { copies: 1, texts: [{ id: 'saved-text', value: 'SAVED FIXTURE {itemName}', pos: { x: 2, y: 2 } }] },
  }]));
  const calls = { reads: 0, lists: 0, writes: 0 };
  const prisma = {
    stickerTemplate: {
      findUnique: async ({ where }) => { calls.reads++; return templates.get(where.stageKey) || null; },
      findMany: async () => { calls.lists++; return [...templates.values()]; },
      upsert: async ({ where, create, update }) => {
        calls.writes++;
        const template = { ...(templates.get(where.stageKey) || create), ...update };
        templates.set(where.stageKey, template); return template;
      },
    },
    user: { findUnique: async ({ where }) => users.find(u => u.username === where.username), update: async () => users[0] },
    userSession: {
      create: async ({ data }) => { const s = { id: `session-${sessions.length}`, ...data, user: users[0] }; sessions.push(s); return s; },
      findUnique: async ({ where }) => sessions.find(s => s.tokenHash === where.tokenHash),
      update: async ({ where, data }) => Object.assign(sessions.find(s => s.id === where.id), data),
    },
  };
  const router = express.Router();
  const context = vm.createContext({ ...auth, ...permissions, prisma, router, console, Date, PERM_READ: permissions.ACCESS_LEVELS.READ, logCrudWithActor: async () => {} });
  vm.runInContext(middlewareSource, context);
  vm.runInContext(section('function buildUserPayload(user)', 'function getActor(req)'), context);
  vm.runInContext(section('function actorCreateFields(actorUserId)', 'async function logCrudWithActor'), context);
  vm.runInContext(section("router.post('/api/auth/login'", "router.post('/api/auth/bootstrap'"), context);
  router.use(context.requireAuth);
  vm.runInContext(section("router.get('/api/auth/me'", '// ===== Admin: Users & Roles ====='), context);
  vm.runInContext(section('// Sticker template endpoints', "router.put('/api/whatsapp/templates/:event'"), context);
  router.post('/fixture/receive', context.requirePermission('receive.cutter', 2), (_, res) => res.json({ ok: true }));
  router.post('/fixture/settings', context.requirePermission('settings', 2), (_, res) => res.json({ ok: true }));
  const app = express(); app.use(express.json(), cookieParser(), router);
  return { app, users, sessions, templates, calls, authenticate: context.requireAuth,
    fetchTemplate: async (url, options, cookie) => {
      assert.equal(options.credentials, 'include');
      const path = new URL(url, 'http://fixture.invalid').pathname;
      assert.match(path, /^\/api\/sticker_templates\//);
      let call = request(app).get(path);
      if (cookie) call = call.set('Cookie', cookie);
      const response = await call;
      return { ok: response.status >= 200 && response.status < 300, status: response.status, text: async () => response.text };
    },
  };
}
export async function login(app) {
  const response = await request(app).post('/api/auth/login').send({ username: ' Test-Operator ', password: 'fixture-password-only' }).expect(200);
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Expires=/i);
  return cookie.split(';')[0];
}
