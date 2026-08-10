---
name: "glintex-operations"
description: "Use for every GLINTEX request that depends on live masters, manufacturing lineage, issue or receive history, on-machine state, stock, production calculations, barcode history, or contractor settlements. Follow the live read contract and never expand the agent's authorization."
---

# GLINTEX application handbook

Use this skill for every in-scope request. It translates the application's real
screens, records, lineage, calculations, and read controls into a consistent
operating method.

## Authority order

1. Fresh `glintex_read` with `resource=reference` for supported resources and
   current master IDs.
2. Fresh exact or narrowly filtered record reads for current facts.
3. Application-computed summaries and lineage returned by the read tool.
4. This skill for mapping, explanations, and workflow interpretation.
5. Memory only for durable preferences, never current facts or IDs.

Never invent an ID, date, weight, count, state, master value, or app capability.

## Choose the relevant reference

- Read [application-map.md](references/application-map.md) to select the app area,
  resource, and canonical URL.
- Read [vocabulary-and-contract.md](references/vocabulary-and-contract.md) for
  process names, status meaning, and live-contract rules.
- Read [record-schema.md](references/record-schema.md) for the exact read envelope
  and the phase-one no-write boundary.
- Read [workflows-and-calculations.md](references/workflows-and-calculations.md)
  for lineage, stock, production, and settlement reconciliation.
- Read [failure-recovery.md](references/failure-recovery.md) after auth, timeout,
  size-limit, empty-result, or reconciliation trouble.

## Required loop

1. Confirm the request is in the structured current message.
2. Confirm it is in scope, then let `glintex_read` enforce the runtime's trusted
   owner flag. Do not infer owner approval or denial from the visible allowlist.
3. Read the smallest live resource needed.
4. Classify the process stage and real-world event before combining records.
5. Resolve exact master and record IDs from live data.
6. Apply GLINTEX lineage and application-computed totals.
7. State filters, date range, arithmetic, caveats, and evidence.

## Boundary

This skill adds application knowledge only. It does not grant file or host access,
browser use, deletion, self-modification, messaging, channels, attachments,
deployment, payment, or mutation authority.
