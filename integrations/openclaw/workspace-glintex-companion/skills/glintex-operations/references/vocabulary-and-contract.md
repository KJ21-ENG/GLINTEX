# Vocabulary and live contract

Call `glintex_read` with `resource=reference` whenever a supported resource,
master lookup, or current ID matters. Its `domainContract` defines the adapter;
its live bootstrap data defines current master rows.

## Processes

- `cutter`: inbound pieces are issued for cutting and received as bobbin/crate rows.
- `holo`: cutter receive rows flow into holo issues and finished holo roll rows.
- `coning`: holo receive rows flow into coning issues and finished cone/box rows.

Use only these lowercase process values in tool calls. Do not substitute machine
names or contractor names for a process.

## Contractor settlement status

- `draft`: prepared but not marked paid.
- `paid`: marked paid in the application.

The agent may explain these records but cannot create, edit, mark paid, reverse,
delete, download, or attach anything.

## Current-value rule

Never infer accepted master values from historical rows. Resolve items, yarns,
cuts, twists, firms, suppliers, customers, machines, workers, packaging, and
contractors from the live reference result. If wording maps to multiple masters,
ask one focused question.
