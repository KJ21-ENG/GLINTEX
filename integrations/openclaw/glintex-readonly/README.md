# GLINTEX read-only OpenClaw plugin

This plugin exposes one tool, `glintex_read`, to one configured OpenClaw agent.
It calls a fixed allowlist of existing GLINTEX `GET` endpoints and cannot form an
arbitrary URL or issue a mutation request.

The backend accepts the dedicated `x-glintex-agent-token` header only when all
of the following are true:

- `GLINTEX_AGENT_READ_TOKEN` contains a secret of at least 32 characters;
- `GLINTEX_AGENT_READ_PERMISSIONS` contains only known base permission keys;
- the HTTP method is `GET` or `HEAD`.

Recommended initial scopes:

```text
inbound,issue.cutter,issue.holo,issue.coning,receive.cutter,receive.holo,receive.coning,stock,reports,masters,contractor_payments
```

Do not include `settings`, `send_documents`, or any `.edit`/`.delete` key. The
backend rejects unknown and action-level keys.

The token file must be an absolute path, a regular file, and mode `0600`.
Production must use HTTPS. Deploying the backend change, setting the production
secret, and enabling the live plugin are separate operator-authorized steps.
