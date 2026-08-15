# Workflows and calculations

## Manufacturing sequence

The routine material chain is:

```text
Inbound -> Cutter Issue -> Cutter Receive -> Holo Issue -> Holo Receive
        -> Coning Issue -> Coning Receive -> Dispatch
```

For list questions, read only the relevant `issues`, `receives`, `on_machine`,
or `stock` resource and disclose the process and filters. The agent does not
currently expose an exact barcode-history resource, so do not promise a full
lineage when the available bounded records cannot prove one.

## Cut tracing

For downstream coning work, prefer:

```text
Coning Issue -> receivedRowRefs -> Holo Receive row -> Holo Issue -> Cut
```

Only fall back to the cut directly stored on the coning issue when trace data is
unavailable, such as opening stock. If the paths disagree, show both and report
the conflict instead of selecting the convenient result.

## Stock and on-machine work

Use `stock` for current application-calculated holo or coning lot availability.
Use `on_machine` for issued work that remains pending at a process. Do not
recompute current availability from raw history when the application provides a
calculated resource.

## Production summary

The owner-agent production resource summarizes non-deleted receive rows by date:

- Cutter quantity uses `bobbinQuantity`; weight prefers `netWt`, then `totalKg`.
- Holo quantity uses `rollCount`; weight prefers `rollWeight`, then gross minus
  tare.
- Coning quantity uses `coneCount`; weight prefers `netWeight`, then
  `coneWeight`, then gross minus tare.

State the exact process and inclusive date range. Do not represent this bounded
summary as the specialized reports UI's full issued, wastage, efficiency, or
commercial calculation. Do not combine unlike process quantities without clear
labels.

## Operational entry-date overview

Issue and receive history support two explicit date bases:

- `business` (the default) uses the stored work date in `date`.
- `record` uses the row's `createdAt` timestamp converted to the
  `Asia/Kolkata` calendar date and exposes `recordDate` on each row.

For questions such as "what was entered today?", use `dateBasis=record` and
state that the filter is the record/entry date. Always show the stored business
date separately when it differs. Keep the `production` resource on its
documented business-date semantics unless the owner explicitly asks for a
record-entry audit.

## Contractor settlements

Raw production is not automatically equal to a contractor draft. A draft may
exclude rows already reserved by another draft or opening-stock rows. Compare
the exact process, contractor, period, source lines, status, adjustments, and
exclusions before explaining a difference. `finalPayable` is stored settlement
evidence, not permission or proof of an external payment.

## Tally accounting

Treat Tally results as read-only accounting snapshots. State the requested side,
party or company filter, result count, and freshness when available. Never infer
a payment, receipt, reconciliation, or legal liability from amount similarity.

## Owner-task workflow

Read for duplicates before creating. For updates or transitions, read the exact
task and use its current `version`. Prepare one change, present the full preview,
wait for exact fresh confirmation, execute once, then verify. A verified task
record does not prove that its described real-world work has happened.

## Learning workflow

Use a learning candidate only for a durable preference, domain rule, observed
workflow gap, or process improvement with compact evidence. Confirmation creates
a proposal for human review. It does not alter this workspace or future runtime
behavior.
