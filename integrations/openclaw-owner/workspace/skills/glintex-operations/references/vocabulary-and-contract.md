# Vocabulary and live contract

Call `glintex_read` with `resource=reference` whenever a current master value or
identifier matters. The tool's `domainContract` is the live capability contract;
this handbook explains it but cannot expand it.

## Manufacturing processes

- `cutter`: inbound material is issued for cutting and received as bobbin or
  crate production rows.
- `holo`: eligible cutter receive rows flow into holo issues and are received as
  roll production rows.
- `coning`: eligible holo receive rows flow into coning issues and are received
  as cone or box production rows.
- `all`: valid only for the owner-agent production summary.

Use these exact lowercase process values in tool calls. A machine, operator,
contractor, item, cut, yarn, or twist name is not a process value.

## Owner tasks

Task areas are `FINANCE`, `INVENTORY`, `TECHNOLOGY`, `APPLICATION`,
`OPERATIONS`, and `GENERAL`. Priorities are `LOW`, `MEDIUM`, `HIGH`, and
`URGENT`. Statuses are `OPEN`, `IN_PROGRESS`, `BLOCKED`, `DONE`, and
`CANCELLED`.

An owner task is an internal coordination record. It is not proof that the work
it describes was executed in another system.

## Contractor settlements

Settlement statuses are `draft` and `paid`. A paid application record is
historical evidence, not authority to initiate, reverse, or infer a bank
payment. The agent can read settlements but cannot change them.

## Finance evidence

`finance_outstanding` and `finance_runs` come from the loopback Tally reporting
service. Always name the source and snapshot freshness. `debtor` and `creditor`
are accounting sides, not instructions to pay or collect. Similar party names or
amounts never prove identity or settlement.

## Governed learning

Learning categories are `OWNER_PREFERENCE`, `DOMAIN_RULE`, `WORKFLOW_GAP`, and
`PROCESS_IMPROVEMENT`. A proposed candidate stays `PROPOSED` for human review.
The agent cannot approve, apply, or use it as active policy, memory, a new tool,
a new model, or a new routing rule.

## Current-value rule

Fresh exact reads override memory and conversation history. Never infer a live
master value from an old row. Never invent an enum, identifier, balance, total,
status, deadline, specialist, or application capability. If the owner's wording
maps to multiple live records, ask one focused question before preparing an
action.
