# Capture provenance and application integration

The desktop workstation panel appears in the signed-in application only when the isolated native bridge exists. Browser users do not see it. It provides server/scale/printer status, explicit port and Windows printer selection, protocol and serial parameters, bounded raw diagnostics, a diagnostic capture, exact-artwork calibration preview/submit, retained print-job state/reprint, and start-at-login. Device configuration requires Settings WRITE permission. The main process independently enforces authentication and authorization.

Production capture callers inspected and updated:
- Opening stock inbound weight, Cutter gross, Holo gross and Coning gross
- Cutter receive gross (cart entries), Holo receive gross, Coning receive gross (cart rows)
- Common CatchWeightButton and WeightCaptureDialog; ScaleTestPage uses the same common component for a diagnostic capture

Capture values are no longer rounded to three decimals when put into these forms. Existing business calculations remain unchanged; diagnostic readouts show the unrounded captured value. Cutter receive operational gross/tare/net storage and balances still follow the existing three-decimal business rules; the linked provenance retains the unrounded acquisition. The submitted provenance preserves the original capture weight and source unit/frame even where business reports round displayed quantities.

Capture metadata includes capture ID, exact kg value, timestamp, raw frame (bounded to 512 characters), scale device, profile ID and bounded profile snapshot (including integer decimal scaling), unit, baud rate and controller source. Editing a captured form value clears scale attribution; normal manual entry is explicitly marked manual with a form-entry reason. Metadata describes client-reported acquisition and is not a cryptographic attestation.

All eight receive/opening endpoints accepting metadata validate it before business mutations. Old clients without provenance continue working. A mismatching capture/transaction weight is rejected rather than recorded as scale-backed. Unknown metadata keys are removed. No database schema migration is needed: the existing AuditLog JSON payload links this provenance to the saved lot, receive row, or receive challan, with batch input row indices. Holo and Coning manual create routes now produce a linked create audit entry as well.

Limitations: this uses the repository's existing best-effort audit writer, which catches storage failures. Audit recording is not transactionally guaranteed and is not represented as such. Receipt tables themselves have no new capture columns. Backend deployment is needed for linked transaction provenance; an older production backend continues accepting the compatible receipt payload but ignores the extra fields. Capture audit before saving is separate and is not proof a transaction was saved. No production deployment or physical scale calibration is performed by these changes.

## Executed software checks

- `node --test apps/backend/src/routes/__tests__/desktopAuth.integration.test.js` executes the actual repository login/logout handlers and auth middleware with in-memory Prisma persistence through Express/Supertest. Covers persistent HttpOnly cookie, identity restoration in a fresh client, role permissions, invalid credentials, expiry, disabled user, removed roles and revoked session after logout. It never loads production DB/integration modules.
- `node --test apps/backend/src/utils/__tests__/weightProvenance.test.mjs apps/frontend/src/utils/__tests__/weightProvenance.test.mjs` covers precision, identity preservation, manual invalidation, invalid/mismatched metadata, bounded fields and pre-mutation rejection.
- `npm run build --workspace=apps/frontend` verifies the shared frontend and desktop panel bundle.

These fixture checks do not establish a real Windows login, actual COM behavior, or printer paper alignment. Those remain covered by packaged runtime checks and the owner's hardware acceptance checklist.
