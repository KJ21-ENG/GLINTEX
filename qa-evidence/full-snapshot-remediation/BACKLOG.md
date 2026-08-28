# Full-snapshot remediation backlog

These items were reviewed during the release-blocker loop and do not block the current release candidate.

## Filtered Issue Tracking page-number hardening

The bounded computed/trace-filter branch is cursor-based. The shipped Issue History UI uses `useV2CursorList` and never sends the legacy `page` parameter, so the normal user journey is correct. A direct caller that combines `page > 1` with computed balance or Coning lineage filters would currently receive the first bounded cursor page.

Follow-up options:

- remove `page` from the Issue Tracking contract and reject it explicitly; or
- implement a separate bounded matched-row offset contract without weakening the 1,000-raw-row scan ceiling.

This is API hardening, not a direct normal-user defect in the current frontend.
