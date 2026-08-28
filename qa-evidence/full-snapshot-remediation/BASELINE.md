# Full-snapshot performance baseline

Captured: 2026-08-27 Asia/Kolkata

Source baseline: `788258fb4909ef72310188ca592f53736ad49de6` (`origin/main` at worktree creation)

## Complaint recordings

The recordings remain in their original private WhatsApp temporary locations. They are not copied into Git.

| Recording | Duration | Bytes | SHA-256 | Observed journey |
|---|---:|---:|---|---|
| `VIDEO-2026-08-26-21-05-37.mp4` | 49.160 s | 8,951,897 | `0fe50a67bd42197275aa035679e22d91c8a75b699a80979fa061caeedd788824` | Holo issue save remains in a loading state while a full process refresh completes. |
| `VIDEO-2026-08-26-21-05-36.mp4` | 60.081 s | 12,694,347 | `a18b8d67a0fa65b694ddd818810ab23eceee78d2917112700d9d61dcfc8cd5b3` | Holo receive history takes a long time to become usable. |
| `VIDEO-2026-08-26-21-05-15.mp4` | 57.108 s | 5,882,681 | `d3653ec4c2ee0cee14d6e15f747579467e13c29dbf530615c0a4e6e764d6023c` | Coning issue page remains delayed during normal operation. |

## Retained network evidence

The incident investigation observed these production-shaped request pairs:

- Holo issue mutation returned a small response, followed by a `full=true` process snapshot of about 44.8 MB. The UI waited about 47 seconds because the mutation handler awaited that refresh.
- Coning full snapshots were about 63 MB and commonly took 30 to 90 seconds.
- Holo receive mutations were about one second, but page initialization and refresh triggered broad history and eager facet traffic.
- Repeated full snapshots accounted for more than 9 GiB per day in the retained access-log sample.
- JSON responses were not compressed on the observed route path.

These observations are the incident baseline, not post-change acceptance evidence. Production SHA, health, table counts, query plans, and parity totals must be freshly captured from the authorized staging or production environment before release.

## Root-cause ownership

- Frontend process consumers requested `full: true` for ordinary Issue, Receive, Stock, Combined Stock, and action journeys.
- Successful Issue submissions awaited `refreshProcessData()`, coupling a committed write to the slow snapshot download and parse.
- Receive value-filter facets were prefetched separately during initialization.
- Transactional history lived in the global `InventoryContext`, so unrelated actions caused broad refetches and rerenders.
- Source availability checks were performed before the write transaction, leaving a concurrency window.
- The API path lacked effective JSON compression and route-level response-size telemetry.

## Evidence-state boundaries

- Local implementation and automated validation do not establish staging performance.
- Staging parity and browser automation do not establish Windows or Android device proof.
- Staging completion does not authorize production deployment.
- Initial production health does not complete the required 24-hour verification gate.
