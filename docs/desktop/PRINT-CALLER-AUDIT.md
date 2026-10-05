# Print caller and post-commit audit

Latest source audit: 22 actual `printStageTemplate` / `printStageTemplatesBatch` JSX invocations, plus desktop calibration/reprint bridge controls. Import references and template-loading calls are not separate print invocations. Every label request enters the shared helper, which now throws on failed service/native results and template-request failures. No unintended default template is selected after a failed request.

| Caller / action | Invocations | Failure and mutation separation |
|---|---:|---|
| Inbound: save lot | 1 | Confirmed commit resets cart/input before template retrieval or printing; print failure says saved and points to history/reprint |
| Inbound: add purchased Cutter crate | 1 | Cart insertion is retained; print failure is visible; input reset still runs; no receipt commit in print action |
| Inbound: history piece and whole-lot reprint | 2 | Print-only; alerts on exceptions; no create API |
| Opening Stock: Cutter, Holo, Coning add-crate | 3 | Print-only catch protects input reset after cart insertion; operator told not to add again |
| Stock: issue selected pieces | 1 | Confirmed issue clears selection/closes modal before template/print; explicit saved-but-label-failed alert |
| IssueToCutter: issue | 1 | Confirmed issue clears selected lines before template/print; print error never retries mutation |
| IssueToHolo / IssueToConing | 2 | Existing post-commit print functions have their own catches and visible saved/reprint messages |
| Issue History: standard and Cutter-small | 2 | Print-only; visible error alerts; no mutation |
| Holo Receive / Coning Receive queued labels | 2 | Form/cart commit cleanup precedes queued print; catch now alerts operator rather than console only |
| Cutter Receive confirmation | 1 | Print-only confirmation; visible feedback; template preparation failure cannot prevent staged-input reset |
| Receive History: standard and Coning-small | 2 | Print-only; visible error alerts; no mutation |
| BobbinView / HoloView / ConingView | 3 | Print-only stock reprints, alerts and busy-state cleanup |
| Label Designer test print | 1 | Reports native/service rejection in visible status; no receipt mutation |
| Desktop calibration and retained-job reprint | Separate bridge paths | Exact artifact preview; explicit submission/reprint; failure displayed in panel; no production API mutation |

## Refresh-after-commit handling

The InventoryContext lot/issue wrappers previously awaited a refresh after confirmed API success, allowing a refresh failure to look like a failed save. They now return confirmed results with `refreshWarning`, and callers retain commit cleanup while reporting the refresh problem separately. The same handling protects Cutter receive and Cutter purchase save. Opening-stock post-save preview refresh errors explicitly say the stock was saved.

The reusable `runPostCommitPrint` helper runs local finalization before optional print work, handles thrown failures and returned `{success:false}`, and never invokes a mutation. `refreshAfterCommit` catches only the refresh phase. Neither helper retries a save. An API transport failure before a confirmed response remains a separate uncertain-save concern; this change does not claim server-side request idempotency.

## Executed tests

`node --test apps/frontend/src/utils/__tests__/postCommit*.test.mjs`

Tests execute real extracted Inbound save/reprint handlers, the Cutter issue handler, and the actual InventoryContext action wrappers with injected fixture dependencies. They establish mutation count, cleared draft state before template/print failure, visible saved-but-print-failed feedback, no repeat save on a cleared draft, print-only history retry, and confirmed-success behavior when refresh fails. Separate helper tests cover returned `success:false` and thrown failures. No production data is used.

## Separate document printing

Dispatch challan (`utils/printDispatchChallan.js`) and Receive History challan use browser `iframe.contentWindow.print()`, not the sticker pipeline. They do not create receipts. Desktop CSP/runtime support for those document print paths must be checked independently; they are not represented as native sticker jobs or physically verified outputs.
