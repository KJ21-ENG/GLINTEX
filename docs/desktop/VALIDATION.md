# Electron migration validation checkpoint

Date: 5 October 2026. Base: `c2e19c68118d9a32456ca000c4c5ee109bc89b52` (latest fetched remote main at task start). Branch: `codex/electron-windows-desktop`.

This is a local software checkpoint, **not a Windows release approval**.

## Executed

- Focused desktop/serial/print/security, frontend caller/provenance and actual backend auth-handler fixtures: **77 passed, 0 failed**. See `validation/focused-tests.txt`.
- Existing backend aggregate plus added auth case: **156 passed, 3 skipped, 0 failed**. See `validation/backend-tests.txt`. Skipped database integration cases are not claimed as passed.
- Browser frontend and bundled desktop frontend production Vite builds passed. Large-bundle warning remains.
- Linux Forge package and packaged native SerialPort binding load passed. This verifies packaging mechanics on Linux only. Final package records identify its own snapshot separately.
- Independent code review reproduced and drove fixes for post-commit print retry hazards, invisible failures, queue admission races, line rotation, preview DPI changes, and role-compatible queue access.
- Desktop production dependency audit: zero findings. Existing main lock: 49 aggregate advisories; current root lock: 48, with no newly named vulnerable packages. Audit JSON is retained beside test evidence. This is not remediation of existing web/backend advisories.

## Not executed / blocked

- Windows Setup.exe build, install, upgrade, uninstall/reinstall and actual packaged browser-cookie/visual tests: require Windows execution. The artifact-visibility-gated workflow and verifier are prepared but have **not run**. GitHub CLI authentication was blocked by the VM's API network policy. No push, dispatch, publication or deployment occurred.
- Linux graphical Electron launch terminated with exit 139 under denied DBus/NETLINK runtime operations. The sandbox was not disabled. The supported cloud browser also rejected the loopback visual fixture. These do not establish a Windows defect or a graphical pass.
- Native Chromium screenshots, raster glyph quality and temporal/device behavior remain pending the Windows fixture. Recorded canvas mocks do not prove actual glyph appearance.
- Physical scale protocol/model/accuracy, Windows driver media alignment and actual barcode scans are the owner's checklist in `../desktop-windows.md`.

## Scope notes

The production API and existing business permissions remain authoritative. The application bundles React; no local database/backend is installed. All software-test mutations use synthetic local fixtures. Capture provenance is client-reported and stored in the existing best-effort transaction audit; it is not cryptographic device attestation or atomic receipt storage. Legacy Cutter business totals retain their established three-decimal calculations; acquisition precision is preserved separately. Backend deployment is a separate authorized action, not performed here.
