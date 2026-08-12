export interface CurrentTurnState {
  content: string;
  senderId?: string;
  senderIsOwner?: boolean;
  channel?: string;
  isGroup?: boolean;
  capturedAt: number;
}

export interface AgentRunTurnEvent {
  prompt: string;
  senderId?: string;
  senderIsOwner?: boolean;
  channelId?: string;
}

export function currentTurnStateFromAgentRun(
  event: AgentRunTurnEvent,
  inboundState: CurrentTurnState | undefined,
  messageProvider: string | undefined,
  capturedAt = Date.now(),
): CurrentTurnState {
  return {
    // before_agent_run.prompt is the exact user message submitted to the model.
    // Inbound hook content can contain channel decorations, so it must never be
    // used as the confirmation text when this authoritative value is present.
    content: event.prompt,
    senderId: event.senderId || inboundState?.senderId,
    senderIsOwner: event.senderIsOwner ?? inboundState?.senderIsOwner,
    channel: event.channelId || inboundState?.channel || messageProvider,
    isGroup: inboundState?.isGroup === true,
    capturedAt,
  };
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
