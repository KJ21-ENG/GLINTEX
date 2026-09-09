# Machine-specific contractor rates: local validation

Implemented optional individual-machine rates across cutter, holo and coning. Existing rates default to Any machine. A matching machine rate outranks matching generic rates; quality specificity still resolves within each tier, and equal-priority overlaps are rejected. Machine identity comes from the production row's linked issue, consistent with the production report. Rows without a linked machine use generic rates.

Machine ID/name are captured on new settlement lines and displayed in preview, saved settlement breakdown and PDF. Existing saved financial amounts are not rewritten. Existing snapshots without machine identity remain usable subject to the usual financial/rate checks. Captured machine changes are included in stale-production detection. Drafts can explicitly use Sync Production.

## Validation

- 62 calculation/service unit tests passed.
- 33 PostgreSQL payment integration tests passed, including machine rate create/edit/delete, invalid-process machine rejection, overlap rejection, fallback selection, separate groups, snapshot preservation and stale-payment rejection.
- Corrected one pre-existing integration fixture to request March 20 for its March 20 re-coning row, instead of March 15.
- Frontend production build passed. Existing chunk-size and outdated browser-data warnings remain.
- git diff --check passed.
- Visible in-app browser: signed in, created FIRKI rate at 10/kg through Masters, retained Any machine at 8/kg, previewed two 10 kg rows as 100 + 80 = 180, created/opened draft and verified separate machine names and amounts.
- Generated and visually inspected a one-page settlement PDF with both machine groups and total 180.

## Local runtimes

Started with npm, no Docker. Frontend http://localhost:5173; backend http://localhost:4000.
Demo data: Demo Contractor, 100 POLYESTER, B/S, two machines, 10 kg each on 2026-09-09. Demo draft available in Draft History. Local initial login: admin / admin123 (disposable local database only).

PostgreSQL identity verified before setup: role kushjariwla, host 127.0.0.1, port 5432.
- glintex_machine_rates_20260909_test: disposable integration test database.
- glintex_machine_rates_20260909_dev: retained demo database serving npm app.

Restart backend from repository root:

```sh
DATABASE_URL=postgresql://kushjariwla@127.0.0.1:5432/glintex_machine_rates_20260909_dev LOCAL_DISABLE_INTEGRATIONS=1 PORT=4000 npm run dev:backend
```

Restart frontend:

```sh
VITE_API_BASE=http://localhost:4000 npm run dev:frontend
```

LOCAL_DISABLE_INTEGRATIONS is honored only outside production and prevents messaging clients and backup/Telegram schedulers starting during isolated local tests. Production behavior is unchanged.

The schema migration is local only. No VPS data, rates, settlements or services changed; no commit, push or deployment performed.
