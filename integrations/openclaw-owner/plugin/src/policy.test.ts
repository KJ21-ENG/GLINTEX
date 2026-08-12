import { describe, expect, it } from 'vitest';

import { isExactOwnerConfirmation } from './policy.js';

const ownerId = '1234567890';
const now = Date.now();

describe('current-turn confirmation policy', () => {
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
