# Telegram-only GLINTEX companion

This directory contains the source-controlled pieces for one dedicated OpenClaw
agent:

- `glintex-readonly`: one bounded, owner-only read tool;
- `workspace-glintex-companion`: the agent's scope, identity, memory policy, and
  GLINTEX application handbook.

The existing production notification bot is intentionally separate. Do not move
its token, update polling, groups, schedules, or bindings into this companion.

## Phase-one contract

- Channel: one dedicated Telegram bot account.
- Admission: one allowlisted owner Telegram user ID, direct messages only.
- Agent: `glintex-companion`.
- Model: `openai/gpt-5.6-sol`, with `openai/gpt-5.5` fallback.
- Runtime: OpenClaw for every selectable model.
- Project tool: `glintex_read` only.
- Host execution, messaging, cron, subagents, writes, deletes, payments,
  attachments, self-modification, and cross-context sends: denied.

## Separate authority gates

The source in this directory does not authorize or perform any of these actions:

1. commit or push;
2. deploy the GLINTEX backend change;
3. create and install the backend read credential;
4. enable the OpenClaw agent and Telegram binding;
5. expand access beyond owner-only reads;
6. add writes, attachments, schedules, or group access.

Each gate must be deliberately approved and verified.

## Production activation outline

1. Deploy the backend change through the normal GLINTEX release process.
2. Generate one independent high-entropy read token and store it in production as
   `GLINTEX_AGENT_READ_TOKEN`.
3. Set `GLINTEX_AGENT_READ_PERMISSIONS` to the approved base scopes only.
4. Store the same token locally in a mode-0600 OpenClaw credential file.
5. Build and validate `glintex-readonly`, then install only its built artifact.
6. Copy `workspace-glintex-companion` into its private OpenClaw workspace.
7. Add a named Telegram account and bind that exact account to
   `glintex-companion`.
8. Validate config, restart or reload through supported OpenClaw commands, and run
   the acceptance contract below.

Never print either token in logs, terminal summaries, screenshots, chat, commits,
or handoff notes.

## Acceptance contract

| Test | Expected result |
| --- | --- |
| Owner DM: project greeting | Replies as GLINTEX Companion |
| Owner DM: unrelated request | Exact scope refusal |
| Non-owner DM | No project-tool access; admission denied |
| Any group | No agent response |
| `glintex_read resource=health` | Live production health result |
| `glintex_read resource=reference` | Live masters plus domain contract |
| Current stock question | Fresh stock read with process and filters stated |
| Exact barcode question | Live lineage with uncertainty stated if incomplete |
| Mutation request | Explains phase-one read-only boundary; no write occurs |
| Host command or self-change request | Refused; no tool exists |
| Owner image/document | Understands visible evidence; does not attach or mutate |
| Existing finance Telegram bot | Still routes to Aalekhan finance companion |
| Existing Pumble channel | Unchanged and healthy |
| Existing GLINTEX notification bot | Notifications and schedules remain unchanged |
| Config validation | Passes with no new warning attributable to this agent |
| Security audit | No new critical finding attributable to this agent |

For a real Telegram acceptance test, send a new owner message after the named
account is active. Do not reuse an old update or the existing notification bot.
