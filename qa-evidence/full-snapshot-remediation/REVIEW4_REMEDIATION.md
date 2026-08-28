# Review 4 remediation evidence

Date: 2026-08-27

Base and HEAD before commit: `788258fb4909ef72310188ca592f53736ad49de6`

Product-state fingerprint: 51 files, SHA-256 `f8659faca13d0a21f8297149a057f7211eae7ec9343b49c6be33ad2ff800e018`.

## Accepted findings and corrections

- Cutter challan edit/delete now locks affected Cutter issues and receive rows, rejects paid, issued, dispatched, Holo-referenced, and actively transferred source rows, and rejects an edit that worsens issue accounting beyond the authoritative net-issued allocation. The response returns authoritative issue balances.
- Cutter Issue quantity edit locks the sorted union of old and new inbound source pieces, reloads all sources after the lock, and derives absolute counters only from those locked rows.
- Cutter Purchase delete repeats every dependency check inside its delete transaction after locking purchase receive rows, the inbound piece, lot, and challans. It rejects live Issue lines, issued/dispatched counters, Holo references, box transfers, and paid rows before hard deletion.
- Coning Stock group identity, lot keys, row expansion, and barcode-derived keys use the canonical traced Yarn-ID set. Stored child Yarn is used only through the trace fallback when upstream Holo Yarn is unavailable. Trace arrays are canonically ordered in SQL.

## Verification

- Forced-overlap Cutter Issue replacement test: concurrent allocation to the removed source was preserved; final counters were 3 kg on the old source and 5 kg on the replacement source.
- Forced-overlap Cutter Purchase delete test: the concurrent Issue committed and deletion returned `409 dependency_exists`; the lot, piece, and purchase row remained.
- Cutter challan allocation/lineage test: an edit from 4 kg to 8 kg against a 5 kg Issue returned `409 availability_changed`; Holo-referenced challan deletion returned `409 dependency_exists`.
- Trace-first Coning Stock test: stale child Yarn B and corrected child Yarn A sharing upstream Yarn A produced one group, exact expansion returned both rows, and barcode lookup returned the same lot key.
- Production-sized integration matrix: 26 tests, 24 passed, 2 opt-in gates skipped in that invocation, 0 failed.
- Backend unit suite: 132 tests, 128 passed, 4 intentional DB-backed skips, 0 failed.
- Frontend production build: passed.
- Static deployment/snapshot/performance contracts: 17 passed, 0 failed.
- Production-sized parity gate: passed.
- Production-sized issue POST load gate, 100 samples per stage: Holo p95 9.1 ms and p99 15.5 ms; Coning p95 18.8 ms and p99 24.3 ms.
- `node --check`, `git diff --check`, and explicit production Compose render: passed.

## Fingerprint algorithm

The fingerprint is deterministic: read `git status --porcelain=v1 -z`; take each modified/untracked path; recursively expand untracked directories; exclude `.agent/**`, `qa-evidence/**`, `AGENTS.md`, and `CLAUDE.md`; sort unique repository-relative paths lexically; for each path append `path UTF-8 bytes`, one NUL byte, and the raw SHA-256 digest of the file contents to one SHA-256 accumulator. The count is the number of sorted files. This is the same algorithm used for the value above.

## Remaining gates

No commit, push, merge, deployment, or GitHub write was performed. Docker image/migration/Nginx execution on a Docker-capable host, staging browser and representative factory network/device proof, production-derived parity, database identity/backup confirmation, rollback rehearsal, explicit production authorization, 60-minute observation, and 24-hour zero-full-snapshot monitoring remain separate release gates.
