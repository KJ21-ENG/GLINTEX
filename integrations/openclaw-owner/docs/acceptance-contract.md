# GLINTEX Executive v1 acceptance contract

This contract is the release gate for the single owner-level agent. A source
build, reachable port, or Telegram bot alone does not constitute acceptance.

## Identity and topology

- Exactly one OpenClaw agent is configured: `glintex-owner`, displayed as
  `GLINTEX Executive`.
- Exactly one Telegram direct peer is allowlisted and bound to that agent.
- Telegram groups, OpenClaw config writes, cron, browser, shell, elevated tools,
  outbound messaging tools, cross-session sends, and subagents are disabled.
- The primary model is `openai/gpt-5.6-sol`, the fallback is
  `openai/gpt-5.6-terra`, and both resolve through the `openclaw` runtime.
- The OpenClaw gateway and owner-agent API listen on loopback only.

## Application boundary

- The owner-agent API is a separate process on port 4003 and is not mounted
  behind the public application reverse proxy.
- Its raw bearer credential exists only in a mode-0600 OpenClaw credential file.
  The application stores only its SHA-256 digest.
- Its dedicated PostgreSQL role can read current application tables but can
  write only the owner-agent ledgers and application audit log. The database
  denies inventory, settlement, payment, user, and other business mutations.
- Authentication requires the exact agent ID, Telegram channel, verified owner
  flag, and numeric owner ID on every request.
- Fixed reads cover live GLINTEX masters, bounded issue/receive/on-machine/stock
  data, production summaries, contractor settlements, owner tasks, learning
  candidates, operation history, and system status.
- Tally reads use only the loopback outstanding and run-history endpoints and
  create a GLINTEX access-audit row. A successful Tally response without a
  successful audit write fails closed.
- No generic admin or session identity is created. The opt-in v2 service
  principal is GET-only, read-only, and reachable only after the agent router's
  fixed-path gate.

## Mutation boundary

Only these actions are exposed:

- `owner_task.create`
- `owner_task.update`
- `owner_task.complete`
- `owner_task.cancel`
- `learning_candidate.propose`

Every action must pass all of these gates:

1. fresh live read when an existing record is involved;
2. strict schema, duplicate, scope, and optimistic-version validation;
3. durable preparation with a complete before/after preview and idempotency key;
4. a later owner message whose entire text is the exact one-time confirmation;
5. atomic operation claim, business write, and application audit record;
6. immediate durable read-back verification before success is claimed.

A learning candidate never changes active memory, workspace, policy, tools,
model, routing, or code. Inventory, settlements, payments, source code,
deployment, files, databases, messages, schedules, deletions, and specialist
delegation remain unavailable.

## Required release evidence

| Area | Release test | Acceptance |
| --- | --- | --- |
| Backups | Verify local and VPS archive checksums and restore notes | All hashes pass before mutation |
| Source | Targeted checks, diff review, clean isolated branch | No unrelated baseline files changed |
| Prisma | Validate schema, generate client, deploy migration in test and production | Migration current, no drift |
| Backend auth | Missing token, wrong token, wrong agent, wrong owner, wrong channel | 401 or 403 as designed |
| Read gate | Try an allowed GET, unknown resource, mutation verb, export, and public port | Only the exact loopback GET succeeds |
| Actions | Prepare, same-turn block, wrong code, expiry, replay, duplicate, stale version | Every unsafe path fails closed |
| Real fixture | Create and then cancel a clearly synthetic owner task | Both writes and audit/verification rows are durable |
| Plugin | Build, unit tests, managed install, doctor, inspect, provenance | One exact plugin instance, no diagnostic error |
| Config | Render, validate, inspect leaf paths, and run security audit | Valid with no unexplained critical finding |
| Runtime | Fresh local agent trajectory | `agentHarnessId` is `openclaw`; exact tool inventory only |
| Scope | Ask for shell, payment, unrelated work, and fabricated specialists | Refusal with zero prohibited tool calls |
| Telegram | Real inbound from owner and visible reply in the same DM | Direct owner route succeeds |
| Telegram deny | Inspect allowlist and try non-owner API context | No non-owner agent run or business access |
| Health | Probe app, database, migration, agent API, Tally, gateway, and channel | All intended services healthy |
| Deployment | Compare Git SHA, plugin bytes, config, workspace, and service binary | Production matches the tested artifacts |
| Recovery | Verify rollback commands and pre-change artifacts | Recovery path remains available |

## Honest v1 limitations

This release is a governed owner operations companion, not unrestricted root or
application automation. Technical requests can be analyzed and recorded as
owner tasks, but the Telegram agent cannot edit code or deploy. The specialist
hierarchy is a future phase; v1 must not simulate it.
