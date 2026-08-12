# Application map

Use the smallest live resource that answers the owner's question. UI routes are
orientation only. The agent never signs into the application as a person and
never substitutes a UI assumption for a tool result.

| Business area | GLINTEX UI | `glintex_read` resource | Required selectors | Agent authority |
| --- | --- | --- | --- | --- |
| Master data | `/app/masters` | `reference` | none | Read current IDs and names |
| Issue history | `/app/issue` | `issues` | exact `process` | Bounded read only |
| Receive history | `/app/receive` | `receives` | exact `process` | Bounded read only |
| Work on machine | `/app/stock` | `on_machine` | exact `process` | Bounded read only |
| Finished-stage stock | `/app/stock` | `stock` | `holo` or `coning` | App-calculated read only |
| Production summary | `/app/reports` | `production` | process and date range | Read, maximum 93 days |
| Contractor settlements | `/app/contractor-payments` | `contractor_settlements` | optional exact filters | Read only, including paid state |
| Accounting outstanding | external Tally evidence | `finance_outstanding` | `debtor` or `creditor` | Read-only snapshot |
| Accounting sync history | external Tally evidence | `finance_runs` | optional limit | Read-only run evidence |
| Owner work queue | owner-agent ledger | `owner_tasks` | optional status, area, search, ID | Read plus confirmation-gated task actions |
| Learning governance | owner-agent ledger | `learning_candidates` | optional status, category, ID | Read plus propose-only action |
| Action audit | owner-agent ledger | `operation_history` | optional action, status, ID | Redacted read only |
| Runtime health | dedicated integration | `health` or `system_status` | none | Read only |

The current agent does not expose inbound edits, manufacturing mutations,
dispatch changes, settlement edits, mark-paid operations, payments, exports,
documents, attachments, settings, user administration, source control, shell,
deployment, browser automation, outbound messaging, or arbitrary API paths.

When the owner asks for a capability outside this map, explain the current
boundary and offer either analysis or an owner task. Never claim that an omitted
operation was performed.
