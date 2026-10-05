# GLINTEX Windows desktop

## Release scope and evidence

Electron is the desktop application; the old Tauri helper is not required. The bundled React UI uses **https://app.glintex.in/api/** and its existing sessions, roles and cloud database. No workstation backend/database is installed. Production transactions are not test fixtures.

Initial version **1.0.0**, Windows **x64**, Electron **44.5.1**, Forge **8.0.1**. Exact release commit: `build-info.json` and delivery `manifest.json`. Implementation branch: `codex/electron-windows-desktop`; starting commit: `c2e19c68118d9a32456ca000c4c5ee109bc89b52`.

A workflow definition is not execution evidence. Windows packaging, launch, installation, upgrade and uninstall remain **pending until the Windows run and its JSON reports pass**. Physical accuracy/protocol compatibility/alignment always await the owner's checks below. This document must not be described as a successful test report.

Builds are **unsigned test installers** unless legitimate signing credentials are separately provisioned. No certificate is invented, no secrets are committed and no security warning is bypassed. Fleet signing requires a trusted certificate and authorized signing process. This build-only workflow injects no certificates and publishes no GitHub release.

## Windows compatibility

Target: Windows 10/11 **x86-64**, not Windows ARM64 or 32-bit. Electron ended Windows 7/8/8.1 support after version 22. This family-level baseline does not establish support for every old Windows 10 revision. Factory builds **18362 and 19045 have not been executed here**. The report records the exact Windows runner used; a Windows Server runner is not a factory desktop. Test each actual OS before operational use and maintain the OS through normal IT policy. This project performs no fleet installation.

Sources: [Electron Windows support](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice), [Forge Squirrel maker](https://www.electronforge.io/config/makers/squirrel.windows), [Windows signing](https://www.electronforge.io/guides/code-signing/code-signing-windows).

## Installation

1. Obtain `GLINTEX-1.0.0-x64-Setup.exe`, checksum manifest and verification reports through the private delivery attachment or successful authorized repository Actions artifact. Repository artifacts require authorized GitHub access; the coordinator must provide a usable download.
2. Run `Get-FileHash .\GLINTEX-1.0.0-x64-Setup.exe -Algorithm SHA256` and compare with manifest. Check version/source commit before installation.
3. Run Setup as the intended Windows user. Squirrel installs per user and provides shortcuts plus an Apps & Features uninstaller. No separate Node, Rust, Python or old helper is needed.
4. Open GLINTEX and sign in with the existing account. Cookies persist in the application profile. Logout/server expiry/disabled users/roles remain authoritative. Internet access is required for cloud and authenticated hardware operations.
5. Open **Desktop device settings**. Configuration requires settings-write permission; start-at-login is optional and off by default.

Chrome remains available during migration. Do not connect Chrome Web Serial and Electron to the same COM port simultaneously.

## Scale setup

No scale model/protocol is assumed. Start at **Unknown**, explicitly select the COM port, verify available USB/serial identity, and set baud rate/data bits/parity/stop bits/flow control from the instrument manual. Connect and inspect bounded raw-frame diagnostics. Unknown profile cannot capture. Never select a profile just because its result looks plausible.

| Profile | Complete input | Meaning |
| --- | --- | --- |
| `st-us-line` | `ST 12.345 kg` / `US 12.345 kg`, CR/LF | ST eligible for sample stability; US never captured |
| `explicit-unit-line` | `12.345 kg`, CR/LF | Explicit decimal/unit; multiple samples establish statistical stability, only when operator verified this protocol |
| `bracket-integer` | `[12345]` | Closing bracket terminates; explicitly configured kg / 3 decimals means 12.345 kg |
| `unknown` | Diagnostics only | Capture disabled |

Units: kg, g, lb, oz; decimal separator: dot. ST/US can have space/comma separation before the number. Binary/checksummed/vendor-specific protocols and undocumented decimal scaling are unsupported. Obtain the manual/sample frames for a new tested implementation when none matches. `ERR 42`, overload, unknown units and unstable messages cannot become guessed weights.

Defaults: 3 complete samples within 0.001 kg, at most 1500 ms old. These are configurable assumptions, not a claim about instrument resolution. Set range/tolerance/scaling from the real instrument. Captures reject pre-request partial frames, stale data and concurrency, time out visibly and preserve precision. Capture metadata includes ID, raw frame, profile/device, unit, timestamp and source; manual entry is distinct. Backend provenance changes are additive/backward-compatible.

Missing/changed/ambiguous identity never substitutes another port. Close competing serial software before reconnecting a busy device. Suspend cancels captures; resume reconnects only the exact configured device. Diagnostics retain at most 40 frames of 512 characters in memory.

## Printer and label jobs

Install the manufacturer's Windows driver if needed. Select the exact printer name. TSC TE244 **203 × 203 dpi** is the initial factory profile, not a universal setting. Other configurable profiles are 300/600 dpi; verify the driver and physical device.

Template + transaction + media profile produces one canonical bitmap artifact. Preview and printing use the same page artwork, dimensions, columns/gaps/offsets, fonts, rotations and barcode geometry. Editor guides/selection handles stay outside artwork. Template retrieval failure does not silently substitute another template.

Vertical die-cut gap is recorded in the artifact snapshot but is controlled by the Windows driver stock/gap-sensor settings. Set that driver gap to match your media. Printed page height is label height plus top margin, not full media pitch; extra gap pixels are not injected.

Set actual roll/label sizes, zero margins, 100% scale and no fit-to-page. Native printing awaits image decoding/font readiness. Electron `print()` sizes are microns; `printToPDF()` sizes are inches. The normal desktop path does not depend on localhost:9090 or printer-native font layouts.

Jobs have stable IDs and retain artwork/template/profile snapshots. **Submitted means Windows accepted submission, not that paper printed.** A crash/timeout during submission is **outcome uncertain**. Check labels and spooler before deliberate Reprint; ambiguous jobs are never automatically retried. Reprint uses persisted artwork and must never resave a receipt.

Retention defaults: 100 jobs / 100 MiB. Old eligible terminal records can be pruned; a removed record cannot be reprinted from this queue. Preserve records you need. Local workstation settings and retained jobs live under `%APPDATA%\GLINTEX`; protect Windows account/disk access through normal IT policy.

## Owner's hardware acceptance checklist

- [ ] Install on each intended Windows build; confirm icon, shortcuts, single instance, login/logout and role restrictions
- [ ] Verify actual scale identity, serial settings, documented profile, units and decimal factor
- [ ] Compare zero and several traceable test weights; record resolution/tolerance and accuracy
- [ ] Confirm unstable/error/overload/fragmented/stale/busy/disconnected states never save guessed measurements
- [ ] Compare two fresh captured transactions and their provenance; distinguish a manually entered transaction
- [ ] Unplug/replug and sleep/wake; verify the exact selected device reconnects and a fresh capture is required
- [ ] Preview every actual stage template, long values, punctuation/fonts, rotations and barcode quiet zones
- [ ] Print calibration/test labels on actual media; measure known geometry/outer dimensions with a ruler, then calibrate documented profile offsets
- [ ] Inspect small Cutter issue and small Coning receive labels for eliminated preview-only centering offsets
- [ ] Scan barcodes; check columns, last-page copies, margins, no clipping or unwanted blanks
- [ ] Turn printer off/remove paper; observe failures/uncertainty and check spooler/paper before reprinting
- [ ] Confirm failed prints/reprints create no additional receipts
- [ ] Upgrade after capture/save/print finishes and verify settings/jobs remain

Software tests do not certify physical scale accuracy or printer alignment.

## Repeatable development and Windows packaging

Read AGENTS/workflow instructions and use your own provider/session identity. Node 24 is the build toolchain; end users do not need it.

```powershell
# Repository root
$env:PUPPETEER_SKIP_DOWNLOAD='true'
npm ci --no-audit --no-fund
cd apps/desktop
# Local runtime dependencies are required for Forge, not just hoisted links
npm ci --workspaces=false --no-audit --no-fund
cd ../..
npm run test:desktop
node --test apps/frontend/src/utils/__tests__/*.test.mjs apps/backend/src/utils/__tests__/weightProvenance.test.mjs
npm run build:frontend
npm run dev:desktop
# On Windows x64
npm run make:desktop:windows
```

Regenerate root and desktop-local lockfiles deliberately on dependency changes. Forge rebuilds native SerialPort modules for Electron; packaged smoke loads SerialPort and enumerates ports without attached hardware.

The separate `electron-windows.yml` workflow is build-only, contents-read, no publication/deployment. Authorized feature-branch pushes/manual runs execute software tests, build the real Windows installer, launch the packaged app, install it, check shortcuts, test a temporary next-version upgrade with settings/queue preservation markers, uninstall and upload private artifacts. The higher-version fixture is excluded from delivery. Existing Tauri workflow remains unchanged.

`windows-verify.ps1` requires a clean disposable Windows user/runner. Outside CI it requires `-AllowLocalInstall`; never use it on an operational machine. Its JSON results establish what executed. The packaged `--self-test` is executed in two separate processes for baseline, installed and upgraded applications. Its isolated loopback fixture checks the actual bundled login/settings UI, HttpOnly/SameSite cookies, process-restart persistence, logout, expiry, IPC auth gates and foreign redirect rejection without production mutations. Screenshots and JSON reports are included as evidence when the run succeeds.

## Upgrade, rollback and recovery

No automatic update feed is configured. Finish capture/save/print, close GLINTEX, back up `%APPDATA%\GLINTEX`, then run a newer verified installer under the same Windows account. Keep the application identity/user profile. Squirrel nupkg/RELEASES files accompany the artifact, but are not an enabled automatic update channel.

To roll back, preserve current data and note uncertain jobs, uninstall through Windows Apps & Features and install the prior verified release. Restore an appropriate backup only if its settings/queue schema is compatible. Never delete the profile as an upgrade shortcut or replay uncertain jobs automatically. Cloud/database rollback is outside this workstation procedure.

- Server/session failure: reconnect/sign in; do not disable web security or alter cookies manually
- Scale busy/unavailable: verify exact identity and close competing software; unsupported frames need documented protocol work
- Wrong label size: confirm physical roll/DPI/driver stock/margins and calibration offsets; do not add preview-only scaling
- Uncertain print: inspect paper and Windows spooler, then explicitly reprint if needed
- Unreadable settings: preserve the file and recover a known backup instead of silently choosing another device
- Unsigned warning: verify source/checksum and use your organization's approved test-install process; arrange legitimate signing for fleet distribution

Support reports should contain version/source commit, sanitized error/status, device model/profile and minimal non-sensitive frames. Exclude passwords, session tokens and production data.

### Access boundaries and browser-only account setup

Native operations validate the bundled top-level window and recheck the cloud session. Device configuration requires Settings write permission. Captures require production write access. Label submission respects the existing read-enabled history/stock reprint flow; it never grants permission to create a receipt. Retained job records are visible to their authenticated creator, or an administrator, while their current role still allows the label stage. Renderer-supplied creator IDs are overwritten in the main process.

External links/account-connection popups are not loaded inside the privileged desktop window. The application offers to open the fixed browser application URL for that workflow. The normal browser application remains available. Same-origin challan print frames remain separate from the durable sticker queue; their OS dialog output still needs workstation acceptance testing.

### Dependency audit boundary

The initial implementation's locked desktop production dependencies have zero reported npm advisories. A read-only audit of the original main-branch monorepo lock found 49 advisories; the implementation root lock reports 48, with no newly named vulnerable packages. These include existing frontend/backend dependencies (2 critical advisories among the aggregate results). The desktop shell does not certify those pre-existing application dependencies as remediated. Broader dependency upgrades require compatibility work and are not silently included in this hardware migration. Saved audit reports accompany the local validation checkpoint; rerun audit before a signed production release.

Device identity note: the configured COM path is never silently substituted. Serial number and PNP identity are checked when available. Ports without stable hardware identity show an explicit warning. A USB/RS232 adapter identity still cannot prove which physical scale is plugged into the adapter; verify that during setup and after cabling changes.
