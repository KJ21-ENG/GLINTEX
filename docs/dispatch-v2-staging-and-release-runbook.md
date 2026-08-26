# Dispatch V2 staging, release, and hotfix runbook

## Fixed environment mapping

| Environment | Branch | URL | VPS directory | Compose project | Database policy |
| --- | --- | --- | --- | --- | --- |
| Production | `main` | `https://app.glintex.in` | `/var/www/glintex-app` | `glintex-app` | Read-only without explicit production authorization |
| Employee staging | `release/dispatch-v2` | `https://staging.glintex.in` | `/var/www/glintex-staging` | `glintex-staging` | Retained and mutable for employee testing |

Staging binds only to VPS loopback ports `4273` (frontend) and `4102` (backend), uses the private `glintex-staging-internal` Docker network and `glintex-staging-postgres-data` volume, and omits `agent-api`. Public access is only through the dedicated Nginx vhost with TLS and HTTP Basic Auth, followed by application authentication.

## Immutable safety rules

1. Verify local, remote, and deployed production SHA before and after staging work. Never write to the production directory, stack, database, Nginx file, DNS records, GitHub environment, or `main` during a staging rollout.
2. Before every DB mutation, query and record `current_database()`, `current_user`, `inet_server_addr()`, and `inet_server_port()`. Stop on any mismatch.
3. Do not run a bare Prisma migration command. On staging use:

   ```bash
   APP_DIR=/var/www/glintex-staging /var/www/glintex-staging/docker/staging/migrate.sh
   ```

4. Staging must set `GLINTEX_RUNTIME_MODE=staging` and `EXTERNAL_INTEGRATIONS_DISABLED=true`. The backend fails startup if staging omits the kill switch. No production tokens, WhatsApp auth, recipients, or agent secrets are copied.
5. Never commit QA evidence, recordings, screenshots, browser state, dumps, `.env` files, secrets, auth sessions, backups, logs, or build output.

## First staging bootstrap

1. Confirm `staging.glintex.in` has no existing record, then create only `A staging -> 72.61.228.188` in the `glintex.in` Hostinger zone using the bound Codex in-app Browser.
2. Create `/var/www/glintex-staging`, clone the public repository, and check out `release/dispatch-v2` at the exact approved release SHA.
3. Create `.env.staging`, `staging-secrets/`, and `staging-data/{backups,logs}` with mode `600` for secret files and `700` for directories. The env file contains only staging DB/runtime values. Store application and Basic Auth passwords in separate restrictive files and the operator credential store.
4. Start only the staging DB and prove its identity. Copy the verified custom-format dump from the retained green DB to `staging-data/backups/` and verify its recorded SHA-256 and byte count.
5. Restore only into the empty staging database. Re-prove identity, run the explicit migration wrapper, then run the one-time sanitizer:

   ```bash
   docker compose --env-file .env.staging -p glintex-staging \
     -f docker-compose.staging.yml --profile tools run --rm data-sanitizer
   ```

   The sanitizer revokes all human sessions, removes Drive credentials and agent operation/session material, disables notification templates and channels, clears recipients, sanitizes customer/document contact fields, deactivates copied users, and creates/rotates the two staging-only accounts from mounted secret files. It prints identities and counts, never passwords.
6. Build and start `db`, `backend`, and `frontend`; verify all container health, exact deploy SHA in `/api/readiness`, staging runtime mode, disabled external integrations, migration state, fixture counts, and the absence of `agent-api`.
7. Install `docker/staging/nginx-staging.conf`, replace `__STAGING_GATE_TOKEN__` only in the VPS copy with a freshly generated random token, create the restrictive htpasswd file, run `nginx -t`, reload Nginx, obtain the certificate with Certbot, and re-run `nginx -t`. A successful Basic Auth response sets an eight-hour `Secure`, `HttpOnly`, `SameSite=Strict` staging-gateway cookie so browser API calls remain inside the same gateway session. The token stays only in the mode-`600` staging vhost and must never enter Git or evidence. Unauthenticated public requests and invalid cookies must return `401`, while Basic Auth and gateway-cookie HTTPS health/readiness requests pass.

## Routine feature deployment

1. Merge or cherry-pick reviewed feature work into `release/dispatch-v2` and validate it without touching `main`.
2. Push the exact release commit. `.github/workflows/deploy-staging.yml` uses only the GitHub `staging` environment and its staging-only SSH/Basic Auth secrets.
3. The VPS deploy wrapper verifies the requested SHA against `origin/release/dispatch-v2`, proves the staging DB identity, creates a hashed pre-deploy dump, builds images, runs explicit migrations, starts the three expected services, and checks health.
4. On failure, it restores the previous source/container revision and retains the pre-deploy DB dump for deliberate recovery. Database restore is never automatic because it is destructive.
5. Record release SHA, backup hash, migration state, readiness output, and employee smoke result. Retain the changed staging database for further employee use.

## Employee access and smoke

Retrieve Basic Auth and application credentials from the operator's secure credential store. Never paste them into issues, chat, logs, evidence, or Git. Test through `https://staging.glintex.in` and confirm the visible amber staging banner.

Numbered smoke journey:

1. Verify unauthenticated access is rejected, then pass Basic Auth and application login.
2. Open Packing and inspect/create a reversible employee test fixture.
3. Open Stock and Packed Stock and verify the expected packed-unit data.
4. Open Dispatch and inspect draft/history/challan behavior without sending documents externally.
5. Open Settings and confirm WhatsApp/Telegram/Drive and cron delivery are disabled with no recipients or tokens.
6. Open Reports and verify packing/reconciliation reports load.
7. Confirm `/api/readiness` reports the exact release SHA, `runtimeMode=staging`, and `externalIntegrationsDisabled=true`.
8. Confirm no notification delivery succeeded and no staging `agent-api` container exists.

## Rollback and troubleshooting

- Application rollback: select the last verified release SHA, retain a new staging DB backup, run `docker/staging/deploy.sh <sha>`, and repeat the smoke. Do not point staging at production data.
- Database recovery: stop application writes, prove the staging DB identity, take a failure-state dump, obtain explicit recovery authorization, restore the selected staging backup only, migrate, and verify key counts. Never automate production-like destructive restore.
- `502`: check loopback listeners, `docker compose ... ps`, backend logs, and Nginx upstream ports.
- Browser login remains on `Signing in`: verify the first Basic Auth response sets the staging-gateway cookie, subsequent same-origin API calls use it, invalid cookies still return `401`, and the application login request reaches the backend. Rotate only the staging gateway token if recovery requires invalidating browser gateway sessions.
- Readiness failure: compare deploy SHA, migration record, required tables, and launch state. Do not bypass readiness.
- External-integration guard failure: stop the backend and correct staging env/sanitization. Never enable the integration to make the check green.
- TLS/DNS: verify only the `staging` A record, authoritative DNS, certificate names, and `nginx -t`. Do not modify apex or `app.glintex.in`.

## Urgent production hotfix and mandatory forward-port

1. Query the live production repo/runtime and select the exact non-`v*` `production-*` tag/SHA matching the deployed commit.
2. Branch `hotfix/<ticket>` from that production tag, never from `release/dispatch-v2`.
3. Create an isolated temporary production-like runtime and database. Prove identity before import/migration and keep production integrations disabled.
4. Implement the minimal fix. Run affected tests, regression checks, builds, migration/diff review, and a production-like smoke.
5. Obtain explicit user authorization for the production backup, `main` promotion, and deployment. Staging or hotfix authority alone is insufficient.
6. Back up production, promote only the hotfix to `main`, deploy, and verify production SHA, health, DB identity, and the affected journey.
7. Immediately cherry-pick or equivalently forward-port the same logical fix into `release/dispatch-v2`, resolve conflicts against the release line, redeploy staging, and repeat staging validation.
8. Record production and staging SHAs plus evidence. Remove temporary hotfix containers, network, volumes, secrets, and database only after absence proof and according to the authorized cleanup scope.

Production promotion of the full Dispatch V2 release remains a separate future decision requiring explicit authorization, a fresh backup, release-candidate evidence, and a production rollback plan.
