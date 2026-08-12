import { describe, expect, it } from 'vitest';

import {
  CurrentConfirmationTurns,
  currentTurnStateFromAgentRun,
  isExactOwnerConfirmation,
} from './policy.js';

const ownerId = '1234567890';
const now = Date.now();

describe('current-turn confirmation policy', () => {
  it('consumes a session fallback exactly once', () => {
    const turns = new CurrentConfirmationTurns();
    const state = {
      content: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channel: 'telegram',
      isGroup: false,
      capturedAt: now,
    };
    turns.set('owner-session', 'owner-run', state);

    expect(turns.consume('owner-session', 'owner-run')).toEqual(state);
    expect(turns.consume('owner-session', 'owner-run')).toBeUndefined();
  });

  it('rejects and consumes a fallback from a different run', () => {
    const turns = new CurrentConfirmationTurns();
    turns.set('owner-session', 'original-run', {
      content: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      capturedAt: now,
    });

    expect(turns.consume('owner-session', 'different-run')).toBeUndefined();
    expect(turns.consume('owner-session', 'original-run')).toBeUndefined();
  });

  it('uses the authoritative before-agent-run prompt instead of decorated inbound content', () => {
    const state = currentTurnStateFromAgentRun({
      prompt: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channelId: ownerId,
    }, {
      content: 'K\nCONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channel: 'telegram',
      isGroup: false,
      capturedAt: now - 1_000,
    }, 'telegram', now);

    expect(isExactOwnerConfirmation(state, 'GLX-ABCDEF1234', ownerId, now)).toBe(true);
  });

  it('falls back to run identity and provider when inbound metadata is unavailable', () => {
    const state = currentTurnStateFromAgentRun({
      prompt: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channelId: ownerId,
    }, undefined, 'telegram', now);

    expect(isExactOwnerConfirmation(state, 'GLX-ABCDEF1234', ownerId, now)).toBe(true);
  });

  it('does not accept an inbound exact command when the current prompt contains extra text', () => {
    const state = currentTurnStateFromAgentRun({
      prompt: 'Prepare it, then CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channelId: 'telegram',
    }, {
      content: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channel: 'telegram',
      isGroup: false,
      capturedAt: now,
    }, 'telegram', now);

    expect(isExactOwnerConfirmation(state, 'GLX-ABCDEF1234', ownerId, now)).toBe(false);
  });

  it('accepts only the exact fresh owner direct-chat confirmation', () => {
    expect(isExactOwnerConfirmation({
      content: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channel: 'telegram',
      isGroup: false,
      capturedAt: now,
    }, 'GLX-ABCDEF1234', ownerId, now)).toBe(true);
  });

  it.each([
    ['wrong owner', { senderId: '123456789' }],
    ['untrusted owner bit', { senderIsOwner: false }],
    ['group message', { isGroup: true }],
    ['wrong channel', { channel: 'web' }],
    ['quoted or additional text', { content: 'Please CONFIRM GLINTEX GLX-ABCDEF1234' }],
    ['leading whitespace', { content: ' CONFIRM GLINTEX GLX-ABCDEF1234' }],
    ['lowercase command', { content: 'confirm glintex glx-abcdef1234' }],
    ['wrong code', { content: 'CONFIRM GLINTEX GLX-0000000000' }],
  ])('rejects %s', (_label, override) => {
    const state = {
      content: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channel: 'telegram',
      isGroup: false,
      capturedAt: now,
      ...override,
    };
    expect(isExactOwnerConfirmation(state, 'GLX-ABCDEF1234', ownerId, now)).toBe(false);
  });

  it('rejects stale confirmation state', () => {
    expect(isExactOwnerConfirmation({
      content: 'CONFIRM GLINTEX GLX-ABCDEF1234',
      senderId: ownerId,
      senderIsOwner: true,
      channel: 'telegram',
      isGroup: false,
      capturedAt: now - 120_001,
    }, 'GLX-ABCDEF1234', ownerId, now)).toBe(false);
  });
});
