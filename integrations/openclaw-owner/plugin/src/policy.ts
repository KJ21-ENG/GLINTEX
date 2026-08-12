export interface CurrentTurnState {
  content: string;
  senderId?: string;
  senderIsOwner?: boolean;
  channel?: string;
  isGroup?: boolean;
  capturedAt: number;
}

export function isExactOwnerConfirmation(
  state: CurrentTurnState | undefined,
  confirmationCode: string,
  ownerTelegramId: string,
  now = Date.now(),
) {
  if (!state
    || state.senderIsOwner !== true
    || state.senderId !== ownerTelegramId
    || state.channel !== 'telegram'
    || state.isGroup === true
    || now - state.capturedAt < 0
    || now - state.capturedAt > 120_000) {
    return false;
  }
  const code = String(confirmationCode || '').trim().toUpperCase();
  if (!/^GLX-[A-F0-9]{10}$/.test(code)) return false;
  return state.content === `CONFIRM GLINTEX ${code}`;
}
