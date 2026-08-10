# Workflows and calculations

## Manufacturing sequence

The routine chain is:

```text
Inbound -> Cutter Issue -> Cutter Receive -> Holo Issue -> Holo Receive
        -> Coning Issue -> Coning Receive -> Dispatch
```

Use `barcode_history` for an exact application-generated lineage. For list-level
questions, read only the relevant `issues`, `receives`, `on_machine`, or `stock`
resource and state the process and filters.

## Cut tracing

For a downstream coning record, prefer this lineage:

```text
Coning Issue -> receivedRowRefs -> Holo Receive row -> Holo Issue -> Cut
```

Only fall back to the cut directly stored on a coning issue when trace data is
unavailable, such as opening stock. If the paths disagree, report the conflict.

## Stock and on-machine

Use `stock` only for current app-calculated holo or coning lot availability. Use
`on_machine` for issued work that remains pending at a process. Do not recompute
availability from raw historical rows when the application provides a calculated
result.

## Production

Use the application report for issued, received, wastage, and efficiency. State
the exact process, view, and date range. Keep each read within 93 days. Explain
small-table arithmetic when comparing totals and do not mix incompatible process
units without labeling them.

## Contractor settlements

Raw production is not automatically equal to one contractor draft. A draft can
exclude rows already reserved by another draft and opening-stock rows. Compare
the exact period, process, contractor, source lines, status, and exclusions before
explaining a difference. The agent is read-only and must stop before payment or
any settlement change.
