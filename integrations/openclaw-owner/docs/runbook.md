# GLINTEX Executive production runbook

The canonical host is the GLINTEX VPS. The application checkout is
`/var/www/glintex-app`; OpenClaw state is isolated under
`/var/lib/openclaw-glintex` and runs as the non-login `openclaw-glintex` user.

## Immutable prerequisites

- Take and verify a timestamped application Git bundle, untracked-file archive,
  production environment backup, Compose override backup, OpenClaw state backup
  if present, and restore notes before mutation.
- Confirm no active OpenClaw tasks before restarting an existing gateway.
- Verify the intended application and integration Git commit.
- Use OpenClaw `2026.7.1-2` and a supported Node release.
- Never print the Telegram token, agent bearer token, confirmation secret,
  gateway token, or model credentials.

## Application deployment

1. Apply the intended clean Git commit to `/var/www/glintex-app` without
   overwriting the server-only Compose override.
2. After the migration creates the isolated ledger tables, provision the
   `glintex_owner_agent` database role with `deploy/provision-agent-db-role.sql`,
   set a random password without printing it, and put its dedicated URL in
   `GLINTEX_OWNER_AGENT_DATABASE_URL`. The role receives SELECT on current
   tables, INSERT/UPDATE only on owner-agent ledgers, and INSERT only on the
   application audit log. It receives no business-table mutation privilege.
3. Generate independent random values for the raw agent bearer token and the
   confirmation secret. Put only the bearer SHA-256 digest and confirmation
   secret in the application environment.
4. Set the exact owner Telegram ID, `glintex-owner` agent ID, documented scopes,
   action TTL, application loopback URL, and deployed SHA.
5. Build the backend and agent-api images, run `prisma migrate deploy`, and
   start the updated services with the existing production Compose file set.
6. Prove the application backend remains healthy and the owner-agent API binds
   only to `127.0.0.1:4003`.
7. Exercise missing, wrong, and correct credentials plus the fixed-route and
   method-denial tests before enabling OpenClaw.

## OpenClaw installation

1. Install the supported official Node binary with checksum verification.
2. Install exactly `openclaw@2026.7.1-2` and verify `openclaw --version`.
3. Create the non-login `openclaw-glintex` system user with home
   `/var/lib/openclaw-glintex`.
4. Create `.openclaw/credentials`, workspace, and extension directories owned by
   that user. Directories are mode 0700 and credential/config files mode 0600.
5. Copy the workspace, build the plugin, package it, and install it through
   `openclaw plugins install` under the dedicated state directory.
6. Render `config/openclaw.template.json5` with the verified numeric Telegram
   owner ID using `scripts/render-config.mjs`. Do not commit the rendered file.
7. Create `/etc/glintex-owner-openclaw.env` from the example with a random
   gateway token. Keep it root-owned and mode 0600.
8. Authenticate the `openai` provider interactively for the dedicated runtime.
   Confirm the selected profile and model through `openclaw models status`.
9. Install the hardened systemd unit, run `systemd-analyze verify`, reload, and
   enable it only after config and plugin validation pass.

## Telegram enrollment

1. Create one purpose-built bot through Telegram's verified `@BotFather`.
2. Store its token directly in the dedicated mode-0600 token file.
3. Ask the owner to send `/start` in the bot's direct chat.
4. Verify the sender and chat numeric ID from that real inbound update. Render
   the final config only with that verified ID.
5. Keep `dmPolicy=allowlist`, one `allowFrom` ID, one direct-peer binding,
   `groupPolicy=disabled`, and `configWrites=false`.
6. Start the gateway and probe the Telegram channel. Do not expose a webhook or
   gateway port publicly; this deployment uses long polling.

## Release checks

Run at minimum:

```text
openclaw config validate
openclaw plugins doctor
openclaw plugins inspect glintex-owner-operations --json
openclaw agents list --json
openclaw models status --agent glintex-owner --json
openclaw channels status --probe --json
openclaw tasks list --status running --json
openclaw security audit --json
openclaw gateway status
```

Then complete the real Telegram read, scope refusal, same-turn execution denial,
and synthetic owner-task create/cancel trajectory from the acceptance contract.

## Rollback

1. Stop and disable only `glintex-owner-openclaw.service`.
2. Stop and remove only the new `agent-api` service if application rollback is
   required.
3. Restore the pre-change application commit, environment, Compose override,
   and database backup according to the timestamped restore notes.
4. Database rollback is forward-fix preferred. The new tables are isolated and
   must not be dropped while any audit or owner-task record must be retained.
5. Re-probe the existing backend, frontend, database, WhatsApp, Tally, Telegram
   notification bot, scheduler, Nginx, and backups. Do not call rollback complete
   from service start alone.
