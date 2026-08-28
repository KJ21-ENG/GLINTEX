# Full-snapshot remediation release runbook

## Release gates

1. Local implementation and automated checks.
2. Isolated rehearsal database identity and fixture load.
3. Legacy versus v2 parity and `EXPLAIN ANALYZE` evidence.
4. Staging browser automation and network budgets.
5. User-operated Windows and Android proof.
6. Explicit production authorization.
7. Controlled production rollout and 60-minute observation.
8. Twenty-four-hour zero-full-snapshot verification.

No later gate is implied by completion of an earlier gate.

## Isolated rehearsal database

Use a unique database name. Never run fixture creation against `glintex`, a production host, or an unidentified connection.

Before any stateful command, record:

```sql
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), version();
```

The fixture target must contain the requested production-scale mix: 15,000 Holo issues, 15,000 Holo receive rows, 6,000 Coning issues, 12,000 Coning receive rows, 2,000 lots, equal timestamps, deleted rows, opening stock, dispatch consumption, take-backs, reversals, and legacy barcode cases.

After applying migrations, retain `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` output for issue, receive, on-machine, opening-stock, stock-group, and lot-row queries. Any sequential scan or sort that makes the acceptance p95 fail blocks release.

## Automated and network checks

Run:

```sh
npm test --workspace apps/backend
npm run build --workspace apps/frontend
DATABASE_URL=postgresql://glintex:glintex@127.0.0.1:5433/<unique_rehearsal_db> apps/backend/node_modules/.bin/prisma validate --schema apps/backend/prisma/schema.prisma
git diff --check
```

For each automated browser journey, retain a HAR or equivalent request log and assert:

- no `/api/module/process/:process?full=true` request;
- routine response under 500 KB;
- action detail and source lookup under 100 KB;
- first list render under 2 seconds on the factory network and under 5 seconds on the tested Android connection;
- Issue POST p95 under 2 seconds and p99 under 5 seconds;
- filter facets make no initialization request and one request on first value-filter opening.

## Manual device proof

Once an authorized staging URL exists, test one platform at a time.

### Windows factory desktop

1. Open the exact staging URL supplied for Holo Issue.
2. Scan one valid Cutter Receive barcode.
3. Submit one controlled Holo issue and record from before submit until the form clears.
4. Confirm the button stops loading immediately after the POST response.
5. Confirm success is shown even if sticker printing is declined or fails.
6. Open Holo Receive, save one controlled receive, and verify background list refresh.
7. Upload the recording and request log privately.

### Android factory device

1. Open the exact staging URL supplied for Coning Issue.
2. Scan one valid Holo Receive barcode.
3. Submit one controlled Coning issue and record from before submit until the form clears.
4. Confirm the button stops loading immediately after the POST response.
5. Confirm no duplicate record is created and the source balance updates.
6. Upload the recording and request log privately.

## Production rollout

Production deployment requires fresh explicit authorization. Before the window, verify exact source SHA, migration status, database identity, backup completion, container health, and zero conflicting active tasks.

Sequence:

1. Build the backend and frontend images from the exact release SHA.
2. Run `docker compose --profile migration run --rm migrate` while the prior application remains live. This applies ordinary Prisma migrations first, then the idempotent `prisma/manual/apply_process_pagination_indexes.sql` file with PostgreSQL `CONCURRENTLY` outside Prisma's transaction.
3. Deploy the backward-compatible backend and require its container health check to pass.
4. Run targeted API probes against the healthy backend.
5. Deploy the frontend only after those probes pass.
6. Validate JSON compression and performance logging.
7. Run non-destructive page-load checks.
8. Have the authorized operator perform one controlled Holo issue, Holo receive, and Coning issue.
9. Observe for at least 60 minutes.
10. Keep the release pending until 24 hours of monitoring confirms zero UI-originated full snapshots.

Rollback restores the prior frontend, backend, and Nginx configuration. Additive indexes remain unless evidence implicates them. Software rollback never reverses committed operational records.
