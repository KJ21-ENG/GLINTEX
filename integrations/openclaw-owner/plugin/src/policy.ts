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

interface StoredConfirmationTurn {
  runId?: string;
  state: CurrentTurnState;
}

export class CurrentConfirmationTurns {
  private readonly bySession = new Map<string, StoredConfirmationTurn>();

  set(sessionKey: string, runId: string | undefined, state: CurrentTurnState) {
    if (!sessionKey) return;
    this.bySession.set(sessionKey, { runId, state });
  }

  clear(sessionKey: string) {
    if (sessionKey) this.bySession.delete(sessionKey);
  }

  consume(sessionKey: string | undefined, runId: string | undefined) {
    if (!sessionKey) return undefined;
    const stored = this.bySession.get(sessionKey);
    this.bySession.delete(sessionKey);
    if (!stored) return undefined;
    if (stored.runId && runId && stored.runId !== runId) return undefined;
    return stored.state;
  }
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
    // Keep identity and provider metadata from the proven inbound path. In
    // before_agent_run, channelId is the conversation target (for Telegram,
    // the numeric chat ID), not the provider name.
    senderId: inboundState?.senderId || event.senderId,
    senderIsOwner: inboundState?.senderIsOwner ?? event.senderIsOwner,
    channel: inboundState?.channel || messageProvider,
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
