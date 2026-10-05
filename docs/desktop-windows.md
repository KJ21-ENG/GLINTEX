# GLINTEX Windows desktop

## Release scope and evidence

Electron is the desktop application; the old Tauri helper is not required. The bundled React UI uses **https://app.glintex.in/api/** and its existing sessions, roles and cloud database. No workstation backend/database is installed. Production transactions are not test fixtures.

Initial delivered version **1.0.0**; optional driver-kit integration is **1.0.1**. Windows **x64**, Electron **44.5.1**, Forge **8.0.1**. Exact release commit: `build-info.json` and delivery `manifest.json`. Driver integration branch: `codex/electron-scale-driver-kit-20261005`. A new Windows installer remains pending its authorized private build and verification reports.

A workflow definition is not execution evidence. Windows packaging, launch, installation, upgrade and uninstall remain **pending until the Windows run and its JSON reports pass**. Physical accuracy/protocol compatibility/alignment always await the owner's checks below. This document must not be described as a successful test report.

Builds are **unsigned test installers** unless legitimate signing credentials are separately provisioned. No certificate is invented, no secrets are committed and no security warning is bypassed. Fleet signing requires a trusted certificate and authorized signing process. This build-only workflow injects no certificates and publishes no GitHub release.

## Windows compatibility

Target: Windows 10/11 **x86-64**, not Windows ARM64 or 32-bit. Electron ended Windows 7/8/8.1 support after version 22. This family-level baseline does not establish support for every old Windows 10 revision. Factory builds **18362 and 19045 have not been executed here**. The report records the exact Windows runner used; a Windows Server runner is not a factory desktop. Test each actual OS before operational use and maintain the OS through normal IT policy. This project performs no fleet installation.

Sources: [Electron Windows support](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice), [Forge Squirrel maker](https://www.electronforge.io/config/makers/squirrel.windows), [Windows signing](https://www.electronforge.io/guides/code-signing/code-signing-windows).

## Installation

1. Obtain the versioned `GLINTEX-<version>-x64-Setup.exe`, checksum manifest and verification reports through private delivery or a successful authorized **private repository** Actions artifact. Repository artifacts require authorized GitHub access; the coordinator must provide a usable download.
2. Run `Get-FileHash .\GLINTEX-<version>-x64-Setup.exe -Algorithm SHA256` with the actual filename and compare with manifest. Check version/source commit before installation.
3. Run Setup as the intended Windows user. Squirrel installs per user and provides shortcuts plus an Apps & Features uninstaller. No separate Node, Rust, Python or old helper is needed.
4. Open GLINTEX and sign in with the existing account. Cookies persist in the application profile. Logout/server expiry/disabled users/roles remain authoritative. Internet access is required for cloud and authenticated hardware operations.
5. Open **Workstation setup & print jobs**. Configuration requires settings-write permission; start-at-login is optional and off by default.

Chrome remains available during migration. Do not connect Chrome Web Serial and Electron to the same COM port simultaneously.

## Scale setup

### Optional BAFO / Prolific Windows driver

The distribution includes [the reusable driver kit](../hardware/scale-driver/README.md)
as plain scripts/manifest in `resources\scale-driver`, outside ASAR. A packaging
allowlist excludes `cache/`, CAB/ZIP archives and proprietary driver binaries.
The Windows driver exposes a COM port; Electron's native SerialPort module still
depends on it. This kit supports **Windows 10 x64** and exact hardware revision
`USB\VID_067B&PID_23A3&REV_0305` only. It does not establish driver support for
Windows 11, ARM64 or other converters.

In **Workstation setup & print jobs**, choose **Run scale driver setup
(administrator)** after disconnecting the scale and closing competing apps.
The operation rechecks login and requires Settings write access. UAC elevates
only the fixed PowerShell helper. It downloads the pinned Prolific 5.1.12.0
package from Microsoft, verifies CAB/file hashes and signatures, checks hardware
revision, then installs if needed. Healthy matching drivers are retained. It
reports the actual COM port, failure/cancellation and any manual restart request;
it never opens the serial port or creates a receipt. Logs and the verified cache
live in `%APPDATA%\GLINTEX\scale-driver` and survive app upgrades.

Offline driver preparation: on a connected Windows PC run the kit's
`Install.cmd -PrepareOnly`; copy its entire `cache` folder into the intended
user's `%APPDATA%\GLINTEX\scale-driver\cache`, or run the standalone copied kit.
`Install.cmd -VerifyOnly` verifies existing cache without downloading/installing.
The Electron button still requires a live cloud login. Do not place the offline
binary cache in public Git or public Actions artifacts.

For the tested GT-5 bracket scale, refresh devices and choose its actual port
(currently COM3, not a default for other PCs), set **2400/8/none/1/no flow control**,
profile **bracket-integer**, **kg**, **3 decimal places**. Save settings, connect,
then test a fresh capture and compare with the display. `[01363]` means 1.363 kg
only with that explicit configuration. Native parser validation is not physical
Electron capture acceptance. Electron requires no Chrome authorization; current
browser protocol support rejects this bracket frame and is unchanged here.

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

The public `electron-windows.yml` workflow skips public-repository runs unless
separate explicit artifact-visibility approval was obtained. Private delivery
uses [GLINTEX-desktop-builds](https://github.com/KJ21-ENG/GLINTEX-desktop-builds/actions/workflows/electron-windows.yml).
It is build-only, contents-read, Windows Server 2022 x64, no publication/deployment.
An authorized run tests software, packages/launches/installs the app, checks shortcuts,
tests a temporary higher-version upgrade with settings/queue preservation markers,
uninstalls and uploads artifacts in the private repository for **one day**. The
higher-version fixture is excluded from delivery. Physical devices and Windows
10 desktop acceptance remain separate. Existing Tauri workflow remains unchanged.

After source edits, bump the desktop version deliberately and review root plus
desktop-local lockfile version metadata:

```sh
npm version patch --workspace apps/desktop --no-git-tag-version --ignore-scripts
```

Pushing source does not refresh the current private builder's pinned bundle. An
authorized coordinator must update its `source/source.bundle` and
`source/manifest.json` (exact source commit/tree/base and bundle SHA-256). The
bundle must advertise `refs/heads/codex/electron-windows-desktop`. Then use **Run
workflow**, branch **main**, exact `source_sha` and unique `run_tag`, or:

```sh
gh workflow run electron-windows.yml --repo KJ21-ENG/GLINTEX-desktop-builds --ref main -f source_sha=<40-character-SHA> -f run_tag=<unique-tag>
gh run download <run-id> --repo KJ21-ENG/GLINTEX-desktop-builds -n "GLINTEX-Windows-x64-<SHA>-<tag>" -D <destination>
```

Review the successful run's manifest, checksums and JSON reports before private
delivery. Workflow availability and GitHub login do not grant permission to
refresh/push or dispatch a new release.

`windows-verify.ps1` requires a clean disposable Windows user/runner. Outside CI it requires `-AllowLocalInstall`; never use it on an operational machine. Its JSON results establish what executed. The packaged `--self-test` is executed in two separate processes for baseline, installed and upgraded applications. Its isolated loopback fixture checks the actual bundled login/settings UI, HttpOnly/SameSite cookies, process-restart persistence, logout, expiry, IPC auth gates and foreign redirect rejection without production mutations. Screenshots and JSON reports are included as evidence when the run succeeds.

## Upgrade, rollback and recovery

No automatic update feed is configured. Finish capture/save/print, close GLINTEX, back up `%APPDATA%\GLINTEX`, then run a newer verified installer under the same Windows account. Keep the application identity/user profile. Squirrel nupkg/RELEASES files accompany the artifact, but are not an enabled automatic update channel.

To roll back, preserve current data and note uncertain jobs, uninstall through Windows Apps & Features and install the prior verified release. Restore an appropriate backup only if its settings/queue schema is compatible. Never delete the profile as an upgrade shortcut or replay uncertain jobs automatically. Cloud/database rollback is outside this workstation procedure.

Squirrel uninstallation removes application registration and shortcuts, and marks the install directory `.dead`. Its best-effort cleanup can leave cached application files. Verification reports list any residual executables and distinguish registered-app removal from complete file removal; they also require no running GLINTEX process and verify the original version after reinstall. Residual cache files must not be described as fully removed. Do not manually delete the separate `%APPDATA%\GLINTEX` workstation profile during routine uninstall or rollback.

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

### Artifact visibility gate

The GLINTEX repository is public. GitHub Actions artifacts from a public repository must **not** be assumed private to the owner; authenticated repository readers may be able to download them. This workflow therefore skips public-repository execution by default, including branch pushes. Prefer an explicitly authorized private build repository or private Windows runner with private artifact transfer. A manual `allow_public_artifacts` input is available only to record separately obtained explicit approval for public-repository artifact accessibility. The input itself is not authorization. Do not enable it merely to bypass this delivery constraint. ChatGPT Library owner attachments remain the planned private delivery channel after a suitable build route is established.
