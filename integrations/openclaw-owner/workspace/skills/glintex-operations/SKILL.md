---
name: "glintex-operations"
description: "Use for every GLINTEX request that depends on the application's resources, vocabulary, schemas, calculations, Tally evidence, task controls, or failure recovery. Follow the live domain contract and never expand the agent's authorization."
---

# GLINTEX application handbook

Use this skill for every in-scope request. It translates the application's
actual UI, manufacturing records, finance evidence, calculations, and agent
controls into a consistent owner-level operating method.

## Authority order

1. Live `glintex_read` with `resource=reference` and its `domainContract` for
   supported resources, actions, limits, and current master IDs.
2. Fresh exact record reads for current facts and concurrency versions.
3. GLINTEX/Tally server validation and stored calculations.
4. This skill for application mapping, explanations, and workflows.
5. Memory only for durable approved preferences, never current facts or IDs.

Never invent an enum, ID, date, amount, state, field, workflow, specialist, or
app capability.

## Choose the relevant reference

- Read [application-map.md](references/application-map.md) to select the app
  area and available resource or action.
- Read [vocabulary-and-contract.md](references/vocabulary-and-contract.md) for
  controlled values, finance meaning, aliases, and live-contract rules.
- Read [record-schema.md](references/record-schema.md) before preparing an
  owner-task or learning action.
- Read [workflows-and-calculations.md](references/workflows-and-calculations.md)
  for manufacturing lineage, production, finance evidence, and automation
  boundaries.
- Read [failure-recovery.md](references/failure-recovery.md) after validation,
  duplicate, stale-update, timeout, execution, or verification trouble.

For an operational "entered today" overview, use `dateBasis=record` for
`issues` and `receives`. This filters the Asia/Kolkata record/entry date while
the response's stored `date` remains the business date. Use the documented
business-date semantics for the `production` resource.

## Required loop

1. Confirm the request is in the structured current message.
2. Confirm GLINTEX scope and current owner context.
3. Read the smallest live resource needed.
4. Classify the real-world event and workflow stage.
5. Resolve exact unique IDs and every materially required field.
6. Separate facts, assumptions, estimates, and advice.
7. If an exposed action is requested, prepare one operation.
8. Stop for the exact fresh owner confirmation.
9. Execute and verify only after that confirmation.
10. Report the human-readable result, identifiers, caveats, and evidence.

## Boundary

This skill adds GLINTEX knowledge only. It does not grant code, file, host,
browser, database, payment, deployment, deletion, messaging, scheduling,
specialist-agent, channel, model, memory, or self-modification authority.
