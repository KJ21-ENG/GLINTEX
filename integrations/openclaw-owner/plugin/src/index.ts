import type { OpenClawPluginDefinition, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { jsonResult } from 'openclaw/plugin-sdk/tool-results';

import {
  executeGlintexAction,
  prepareGlintexAction,
  readGlintex,
  verifyGlintexAction,
  type ExecuteActionParameters,
  type PluginConfig,
  type PrepareActionParameters,
  type ReadParameters,
  type TrustedToolContext,
  type VerifyActionParameters,
} from './client.js';
import {
  currentTurnStateFromAgentRun,
  isExactOwnerConfirmation,
  type CurrentTurnState,
} from './policy.js';
import {
  executeActionParameters,
  prepareActionParameters,
  readParameters,
  verifyActionParameters,
} from './tool-schemas.js';

const readDescription =
  'Read live owner-authorized GLINTEX operations, inventory, production, contractor settlement, Tally outstanding, task, learning, audit, and technical status data through fixed bounded resources. Use resource=reference before resolving controlled values or master IDs. Never infer a current fact from memory.';
const prepareDescription =
  'Prepare exactly one bounded owner-task or governed learning-candidate action. This validates the payload, checks duplicates and concurrency, stores a durable preview, and returns an expiring confirmation command. It does not perform the business change. Show the complete preview and confirmation command to the owner, then stop.';
const executeDescription =
  'Execute one previously prepared operation. The plugin blocks this tool unless the authenticated owner current Telegram message consists exactly of the returned CONFIRM GLINTEX GLX-XXXXXXXXXX command. Never call it in the preparation turn or from quoted/replied text.';
const verifyDescription =
  'Verify a completed GLINTEX operation against the durable ledger, stored entity, and audit evidence. Always call after execution before claiming that anything changed.';

function configFromApi(raw: Record<string, unknown> | undefined): PluginConfig {
  const config = raw || {};
  return {
    baseUrl: String(config.baseUrl || ''),
    tallyBaseUrl: String(config.tallyBaseUrl || ''),
    apiTokenFile: String(config.apiTokenFile || ''),
    allowedAgentId: String(config.allowedAgentId || ''),
    ownerTelegramId: String(config.ownerTelegramId || ''),
    requestTimeoutMs: config.requestTimeoutMs === undefined ? undefined : Number(config.requestTimeoutMs),
    maxResponseBytes: config.maxResponseBytes === undefined ? undefined : Number(config.maxResponseBytes),
  };
}

function trustedContext(context: OpenClawPluginToolContext): TrustedToolContext {
  return {
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    sessionId: context.sessionId,
    messageChannel: context.messageChannel,
    agentAccountId: context.agentAccountId,
    requesterSenderId: context.requesterSenderId,
    senderIsOwner: context.senderIsOwner,
  };
}

const plugin: OpenClawPluginDefinition = {
  id: 'glintex-owner-operations',
  name: 'GLINTEX Owner Operations',
  description: 'Owner-only, confirmation-gated GLINTEX business tools.',
  version: '1.0.2',
  register(api) {
    const config = configFromApi(api.pluginConfig);
    const inboundBySession = new Map<string, CurrentTurnState>();

    api.on('inbound_claim', (event, ctx) => {
      const sessionKey = event.sessionKey || ctx.sessionKey;
      const targetAgent = ctx.agentId || (sessionKey?.startsWith(`agent:${config.allowedAgentId}:`) ? config.allowedAgentId : undefined);
      if (!sessionKey || targetAgent !== config.allowedAgentId) return;
      const now = Date.now();
      for (const [key, state] of inboundBySession) {
        if (now - state.capturedAt > 120_000) inboundBySession.delete(key);
      }
      inboundBySession.set(sessionKey, {
        content: String(event.body ?? event.content ?? ''),
        senderId: event.senderId,
        senderIsOwner: event.senderIsOwner,
        channel: event.channel,
        isGroup: event.isGroup,
        capturedAt: now,
      });
    });

    api.on('before_agent_run', (event, ctx) => {
      if (ctx.agentId !== config.allowedAgentId) return { outcome: 'pass' };
      const sessionKey = ctx.sessionKey || '';
      const state = inboundBySession.get(sessionKey);
      if (sessionKey) inboundBySession.delete(sessionKey);
      const storedState = currentTurnStateFromAgentRun(event, state, ctx.messageProvider);
      if (storedState.senderIsOwner !== true
        || storedState.senderId !== config.ownerTelegramId
        || storedState.channel !== 'telegram'
        || storedState.isGroup === true) {
        return {
          outcome: 'block',
          reason: 'owner_direct_context_required',
          message: 'This agent is available only in the authenticated owner Telegram direct chat.',
          category: 'authorization',
        };
      }
      if (ctx.runId) {
        api.runContext.setRunContext({
          runId: ctx.runId,
          namespace: 'glintex-owner-current-turn',
          value: {
            content: storedState.content,
            senderId: storedState.senderId || '',
            senderIsOwner: storedState.senderIsOwner === true,
            channel: storedState.channel || '',
            isGroup: false,
            capturedAt: storedState.capturedAt,
          },
        });
      }
      return { outcome: 'pass' };
    });

    api.on('before_tool_call', (event, ctx) => {
      if (event.toolName !== 'glintex_execute_action') return;
      if (ctx.agentId !== config.allowedAgentId) {
        return { block: true, blockReason: 'GLINTEX execution is restricted to the owner agent.' };
      }
      const runId = event.runId || ctx.runId;
      const state = runId
        ? api.runContext.getRunContext({ runId, namespace: 'glintex-owner-current-turn' }) as unknown as CurrentTurnState | undefined
        : undefined;
      const confirmationCode = String(event.params?.confirmationCode || '');
      if (!isExactOwnerConfirmation(state, confirmationCode, config.ownerTelegramId)) {
        return {
          block: true,
          blockReason: 'A fresh exact owner confirmation message is required before this operation can execute.',
        };
      }
    });

    api.registerTool((toolContext) => {
      if (toolContext.agentId !== config.allowedAgentId) return null;
      const context = trustedContext(toolContext);
      return [
        {
          name: 'glintex_read',
          label: 'Read GLINTEX',
          description: readDescription,
          parameters: readParameters,
          async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
            return jsonResult(await readGlintex(rawParams as ReadParameters, config, context, signal));
          },
        },
        {
          name: 'glintex_prepare_action',
          label: 'Prepare GLINTEX Action',
          description: prepareDescription,
          parameters: prepareActionParameters,
          async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
            return jsonResult(await prepareGlintexAction(rawParams as PrepareActionParameters, config, context, signal));
          },
        },
        {
          name: 'glintex_execute_action',
          label: 'Execute GLINTEX Action',
          description: executeDescription,
          parameters: executeActionParameters,
          async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
            return jsonResult(await executeGlintexAction(rawParams as ExecuteActionParameters, config, context, signal));
          },
        },
        {
          name: 'glintex_verify_action',
          label: 'Verify GLINTEX Action',
          description: verifyDescription,
          parameters: verifyActionParameters,
          async execute(_toolCallId: string, rawParams: unknown, signal?: AbortSignal) {
            return jsonResult(await verifyGlintexAction(rawParams as VerifyActionParameters, config, context, signal));
          },
        },
      ];
    }, { names: ['glintex_read', 'glintex_prepare_action', 'glintex_execute_action', 'glintex_verify_action'] });
  },
};

export default plugin;
