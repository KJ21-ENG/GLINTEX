import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePermissions } from '../permissions.js';
import { getLandingModule, getLandingProcess, resolvePostLoginPath } from '../landing.js';

// A user as the app holds it after sign-in: every key present, 0 where not granted.
const userWith = (granted) => {
  const none = Object.fromEntries(Object.keys(normalizePermissions({})).map((key) => [key, 0]));
  return { isAdmin: false, permissions: normalizePermissions({ ...none, ...granted }) };
};

test('a boiler-only user lands on Boiler with the Holo process', () => {
  const landing = getLandingModule(userWith({ boiler: 2 }));
  assert.equal(landing.key, 'boiler');
  assert.equal(landing.process, 'holo');
});

test('several permissions pick the first module in sidebar order', () => {
  assert.equal(getLandingModule(userWith({ reports: 1, dispatch: 2, boiler: 2 })).key, 'dispatch');
  assert.equal(getLandingModule(userWith({ 'receive.coning': 1, masters: 2 })).key, 'receive');
});

test('admins and full users still land on Inbound', () => {
  assert.equal(getLandingModule({ isAdmin: true, permissions: {} }).key, 'inbound');
  assert.equal(getLandingModule(userWith({ inbound: 1, boiler: 2 })).key, 'inbound');
});

test('a user with no module gets no landing page', () => {
  assert.equal(getLandingModule(userWith({})), null);
});

test('sign-in skips a requested page the user cannot open', () => {
  const boilerOnly = userWith({ boiler: 2 });
  assert.equal(resolvePostLoginPath(boilerOnly, '/app/inbound'), '/app');
  assert.equal(resolvePostLoginPath(boilerOnly, '/app'), '/app');
  assert.equal(resolvePostLoginPath(boilerOnly, undefined), '/app');
  assert.equal(resolvePostLoginPath(boilerOnly, '/app/boiler'), '/app/boiler');
  assert.equal(resolvePostLoginPath(userWith({ stock: 1 }), '/app/stock'), '/app/stock');
});

test('Issue and Receive landings select a stage the user can open', () => {
  const holoIssuer = userWith({ 'issue.holo': 2 });
  assert.equal(getLandingProcess(holoIssuer, getLandingModule(holoIssuer), 'cutter'), 'holo');
  const coningReceiver = userWith({ 'receive.coning': 1 });
  assert.equal(getLandingProcess(coningReceiver, getLandingModule(coningReceiver), 'cutter'), 'coning');
  const twoStages = userWith({ 'issue.cutter': 2, 'issue.coning': 2 });
  assert.equal(getLandingProcess(twoStages, getLandingModule(twoStages), 'coning'), 'coning');
  const inbound = userWith({ inbound: 2 });
  assert.equal(getLandingProcess(inbound, getLandingModule(inbound), 'coning'), 'coning');
});
