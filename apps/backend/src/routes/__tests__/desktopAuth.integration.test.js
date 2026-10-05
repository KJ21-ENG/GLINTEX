// Executes the actual login/logout handlers and auth middleware with isolated
// in-memory persistence. No production database or messaging integrations load.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import * as auth from '../../utils/auth.js';
import { fixture, login } from './helpers/desktopAuthFixture.js';

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
