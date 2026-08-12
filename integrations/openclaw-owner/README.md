# GLINTEX Executive

This integration delivers one owner-only OpenClaw agent for GLINTEX. The agent
uses a dedicated Telegram direct chat and combines bounded live application,
production, contractor, Tally, task, learning, audit, and technical evidence.

## Architecture

```text
Owner Telegram DM
  -> OpenClaw gateway on 127.0.0.1:18789
  -> GLINTEX Owner Operations plugin
     -> dedicated agent API on 127.0.0.1:4003
     -> read-only Tally report API on 127.0.0.1:4500
        -> durable GLINTEX read audit
  -> PostgreSQL operation, task, learning, and access ledgers
```

OpenClaw runs as a dedicated non-root user. The application agent API is a
separate read-only-hardened container with its own loopback port and no WhatsApp
browser volumes. Its credential is not an application user or admin session.

## What v1 can do

- read bounded live GLINTEX manufacturing, stock, production, contractor, task,
  learning, audit, and system information;
- read debtor, creditor, and Tally run evidence through fixed loopback paths;
- advise the owner across finance, inventory, technology, application work, and
  operating priorities;
- create, update, complete, or cancel owner tasks after a two-turn confirmation;
- propose a governed learning candidate for human review after confirmation.

It cannot mutate inventory or settlements, make payments, edit code, deploy,
run shell commands, browse, send arbitrary messages, schedule work, delete data,
change itself, or delegate to specialists. Those capabilities require separately
designed future agents and narrower service contracts.

## Components

- `plugin/`: four fixed OpenClaw tools plus current-turn owner authorization.
- `workspace/`: corporate identity, policy, memory rules, and GLINTEX handbook.
- `config/`: strict single-agent OpenClaw configuration template.
- `scripts/`: deterministic non-secret configuration renderer.
- `deploy/`: hardened systemd unit and environment template.
- `docs/acceptance-contract.md`: release gates and honest limitations.
- `docs/runbook.md`: deployment, enrollment, validation, and rollback procedure.

The raw application token, Telegram bot token, gateway token, model credentials,
confirmation secret, rendered config, and production environment are runtime
secrets and must never be committed.
