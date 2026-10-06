# GLINTEX Windows desktop

## Release scope and evidence

Electron is the desktop application; the old Tauri helper is not required. The bundled React UI uses **https://app.glintex.in/api/** and its existing sessions, roles and cloud database. No workstation backend/database is installed. Production transactions are not test fixtures.

Initial delivered version **1.0.0**; private updater was introduced in **1.1.0**; preparation-only driver handoff is **1.1.1**; editable factory scale defaults and browser bracket capture are **1.1.2**; immediate update discovery and the compact update notice are **1.1.3**. Windows **x64**, Electron **44.5.1**, Forge **8.0.1**. Exact release commit and executed checks: `build-info.json`, delivery `manifest.json` and Windows verification reports.

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

In **Workstation setup & print jobs**, choose **Prepare verified scale driver**
after disconnecting the scale. The operation rechecks login and Settings write
access. It uses the current user's token to download the exact pinned Microsoft
package and verify CAB/file hashes, sizes and Windows signatures. It never
executes bundled PowerShell scripts, requests elevation or installs a driver.
Logs/cache live in `%APPDATA%\GLINTEX\scale-driver` and survive upgrades.
Normal preparation quarantines damaged package entries in an `invalid-*` folder
and verifies a fresh package. It preserves the old entry; verification-only mode
does not replace cached data.

If the compatible adapter has no working COM port, check its exact Hardware IDs
in Windows Device Manager, then choose **Update driver > Browse my computer for
drivers** and select the verified folder displayed by GLINTEX. Windows handles
administrator permission and revalidates the signed package. Follow any Windows
restart request manually. Leave a healthy COM port/driver unchanged. This manual
Windows step avoids treating mutable per-user app code as trusted administrator
code; prepared hashes are point-in-time data checks, not an elevation trust root.

For offline preparation, copy the whole prepared `cache` folder into the intended
user's `%APPDATA%\GLINTEX\scale-driver\cache`. The legacy standalone
`Install.cmd -PrepareOnly` and `-VerifyOnly` commands only prepare/verify as a
standard user; they respect existing PowerShell policy and refuse elevation.
If policy blocks the script, use Electron preparation or IT's approved process.
The Electron button needs cloud login; Device Manager can use the prepared folder
on an offline PC. Keep vendor caches out of public Git/Actions artifacts.

Both browser and Electron default to **2400/8/none/1/no flow control**,
profile **bracket-integer**, **kg**, and **Integer decimal places: 2**.
The port is selected from the actual available/authorized devices; COM3 is not
hard-coded. Browser users authorize the scale once and can edit **Scale settings**
in the capture dialog. Electron users select the port and edit settings in
**Workstation setup & print jobs**; it needs no Chrome authorization.
Disconnect before editing settings, save, reconnect and test a fresh capture.
On GT-5, the owner physically compared `[03626]` with **36.260 kg** on
2026-10-06: the integer is divided by **100**, not 1000. Display formatting
does not determine the integer scaling. Additional zero/test-weight checks
remain necessary for physical accuracy acceptance.

Existing supported custom profiles are preserved. On first upgrade to 1.1.2,
an older Electron profile still marked **Unknown** receives the new defaults
while preserving its selected port/device identity; this happens only once.
Users can subsequently choose any supported profile or Unknown without a restart
overwriting their choice. Browser settings are saved locally for that browser.

The initial factory profile is the bracket configuration above. For another scale,
select its documented protocol and serial settings and verify available USB/serial
identity. Connect and inspect bounded raw-frame diagnostics. Unknown profile
cannot capture. Never select a profile just because its result looks plausible.

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
It is build-only, contents-read (plus Actions read for the retained private 1.0.0 fixture), Windows Server 2022 x64, no publication/deployment.
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

`windows-verify.ps1` requires a clean disposable Windows user/runner and the verified delivered-version installer via `-BootstrapInstaller` (currently1.1.0). Missing previous-release evidence fails release acceptance. The private pipeline retrieves the exact checksum-pinned fixture within its own authorized repository. The checked-in development workflow also runs the complete package audit and fails release verification unless its fixture is already staged on the runner; it does not obtain cross-repository credentials or make the private fixture public. Outside CI the verifier requires `-AllowLocalInstall`; never use it on an operational machine. Its JSON results establish what executed. The packaged `--self-test` is executed in two separate processes for baseline, installed and upgraded applications. Its isolated loopback fixture checks the actual bundled login/settings UI, HttpOnly/SameSite cookies, process-restart persistence, logout, expiry, IPC auth gates and foreign redirect rejection without production mutations. Screenshots and JSON reports are included as evidence when the run succeeds.

## Upgrade, rollback and recovery

Versions 1.1.0–1.1.2 check the private first-party service 30 seconds after startup and every six hours, with **Check for updates** in the GLINTEX menu/workstation panel. It shows offline, sign-in, unavailable and no-new-version states. Discovery never downloads or installs automatically. **Later** hides that version's prompt for six hours in the current session; a manual check can show it sooner.
Starting in 1.1.1, a successful GLINTEX sign-in/session response immediately retries
discovery if the first check was waiting for sign-in. A late sign-in therefore
does not wait for the six-hour timer. This retry still only discovers releases.

Version 1.1.3 removes the 30-second delay: the restored session or a
successful sign-in starts discovery immediately. Page load also triggers an
immediate check if session discovery has not already run. Failures retry after
30 seconds, two minutes, five minutes and then every 15 minutes. Returning online
or waking Windows retries a failed check immediately. Concurrent checks share
one request, and downloading or selecting installation pauses discovery.

The update notice is a compact strip with one primary action for its current
state and a download progress bar. Background checking, offline errors and
up-to-date status stay quiet in the workspace; manual checks and workstation
settings show their feedback. **What’s new** expands the version, formatted date
and release notes; **Details** contains download verification and installation
information. **Later** hides the notice while keeping the update accessible in
workstation settings. Write release notes in short user-facing sentences with
newlines between changes; keep build, protocol and CI details in delivery reports.

Choose **Download update** to use the existing HttpOnly session at the fixed HTTPS installer endpoint. Redirects, other origins, unsupported manifests, downgrades, wrong size and SHA-256 mismatches are rejected. Interrupted/cancelled downloads are not installable. **What’s new** expands the release version, formatted date and notes in 1.1.3. No GitHub token or signing secret is in the client. The candidate is an **unsigned test installer**: trusted HTTPS and hash validation establish source/integrity, not Windows publisher signing; OS warnings remain enabled.

Choose **Install after I close GLINTEX** after download verification. Continue working or cancel the choice. Only deliberate app close plus final save/discard confirmation starts installation. Connected scales, driver setup, native/server operations and queued print submissions block that close. Check the Windows print queue: accepted jobs may still print physically. Settings/cookies are flushed, then the helper must acknowledge startup before GLINTEX closes. A first-party GUI host waits for app exit, rechecks the installer with .NET SHA-256 and opens it. It runs without elevation, services or scheduled tasks and records local status in `%APPDATA%\GLINTEX\updates\install-status.json`; a failed handoff is shown on the next launch. There is no forced app close, startup installation or Windows reboot; restart clears the installation choice.
Version 1.1.3 labels the same choice **Install when I close GLINTEX**.

Existing 1.0.0 needs **one manual upgrade** to the current version (1.1.3) under the same Windows account. Finish capture/save/print, close GLINTEX, back up `%APPDATA%\GLINTEX`, then run the verified newer Setup.exe. Keep app identity/user profile. Squirrel nupkg/RELEASES files are temporary packaging output excluded from the new delivery artifact; the client uses authenticated first-party routes.

### Private release administration

After authorized backend deployment, set `GLINTEX_DESKTOP_RELEASE_HOST_DIRECTORY=/var/lib/glintex/desktop-releases` and `GLINTEX_DESKTOP_RELEASE_DIRECTORY=/app/desktop-releases` in the host environment. Compose mounts the folder read-only in the backend. Keep it outside every public web root, with directories 0750/files 0640 and readable by the backend service identity. Unconfigured/empty hosting advertises no fake release.

Stage an exact successful private Windows delivery plus its `windows-verification.json`, then run:

```sh
node apps/backend/scripts/publish-desktop-release.mjs /private/delivery /private/windows-verification.json /var/lib/glintex/desktop-releases 'Optional scale driver setup and private user-controlled updates'
```

The publisher checks installer size/hash, source identity and successful installation/upgrade/bootstrap evidence, writes an immutable version directory and atomically selects `latest.json`. It has no HTTP upload route. Publish only the intended tested release; never the higher-version CI fixture. Both API routes require a current active/non-revoked session and return private/no-store headers. Verify live authenticated metadata/full-download hashes, anonymous rejection and absence of direct webroot access. Future releases require new successful private builds and explicit publication approval. An older latest pointer stops newer offers; clients never downgrade automatically.

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
