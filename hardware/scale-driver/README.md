# Windows scale driver kit

GLINTEX Electron **1.1.1** includes this optional kit and a **Prepare verified
scale driver** button in **Workstation setup & print jobs**. Preparation runs
with the current user's permissions and never installs a driver or requests
administrator access. Windows Device Manager performs the optional installation.
A working driver/COM port can be left unchanged.

The pinned Prolific **5.1.12.0** package is for **Windows 10 x64 / AMD64** and the
BAFO BF-812 / PL2303GT revision `USB\VID_067B&PID_23A3&REV_0305` only. It is not
a universal driver and does not establish Windows 11 or ARM64 support. Each
converter has its own USB serial number; no PC's serial number is hardcoded.
The driver exposes a Windows COM port. Electron's native SerialPort module
still depends on that Windows driver.

## Set up a future PC

1. Verify the privately delivered versioned GLINTEX Setup.exe against its SHA-256
   and install as the intended Windows user. Normal installation remains per user.
   The four public helper files are under `resources\scale-driver`, outside ASAR.
   Vendor driver binaries are not included in Setup.exe.
2. Connect the converter and scale. In Windows Device Manager, check **Properties
   > Details > Hardware Ids** and the operating system. Use this package only for
   the exact hardware revision and Windows 10 x64. If the adapter already has a
   healthy COM port, skip driver installation and go to step 5.
3. Sign in to Electron with Settings write access. Open **Workstation setup &
   print jobs**, disconnect the scale, and choose **Prepare verified scale driver**.
   The app downloads the pinned Microsoft CAB, checks its size/SHA-256, checks all
   six extracted file sizes/hashes, verifies the Microsoft catalog and x64 binary
   signatures, and displays the verified package folder. No driver is changed.
4. Close competing serial applications. Open Device Manager from Windows Start.
   Select the compatible adapter **> Update driver > Browse my computer for
   drivers** and select the package folder displayed by GLINTEX. Windows handles
   administrator permission and revalidates the vendor's signed driver package.
   Follow any Windows restart request manually. Confirm **Code 0** and the actual
   **Prolific PL2303GT USB Serial COM Port**. Do not elevate the bundled scripts.
5. In Electron choose **Refresh devices and jobs**, select this PC's actual COM
   port, and configure its documented protocol. For the tested GT-5 bracket scale:
   **2400 baud, 8 bits, no parity, 1 stop bit, no flow control**, profile
   **bracket-integer**, **kg**, **3 decimal places**. Choose **Save scale settings
   > Connect saved scale > Test fresh capture** and compare with the display.
   `[01363]` means 1.363 kg with that explicit configuration. COM3 is GT-5's
   current port, not a default for other PCs.

Electron does not need Chrome's **Authorize Scale**. Chrome and Electron must
not hold the same port concurrently. The current browser parser rejects the
tested bracket frame; browser protocol support is unchanged. Native parser
validation does not prove a physical Electron capture on GT-5.

## Why Windows handles installation

A per-user application folder can be changed by that user. Hash checks inside
writable application code cannot make that code a trusted administrator
bootstrap. Version 1.1.1 therefore removes automatic elevation and all driver
installation commands. Replacing a helper script cannot cause GLINTEX to execute
it. Preparation authenticates package data at the time of verification; it is
not an administrator trust root or a guarantee against later same-user changes.
Windows validates catalog membership/signatures during the manual installation.

The tradeoff is a manual Device Manager step on PCs that need the driver. The
kit never opens the serial port, sends scale commands, changes Windows Update or
execution-policy settings, disables signature enforcement, or restarts Windows.
Preparation failure reports **no driver installed or changed**, with a log under
`%APPDATA%\GLINTEX\scale-driver`. It does not infer COM readiness from ambiguous
historical driver inventory.

## Offline preparation and standalone use

Electron's verified cache survives application upgrades at:

```text
%APPDATA%\GLINTEX\scale-driver\cache\prolific-5.1.12.0-windows-10-x64
```

On an internet-connected Windows PC, use the Electron preparation button, then
copy the whole `cache` folder to the same intended user's path on the next PC.
The button verifies the cache without downloading again. Electron's cloud sign-in
still requires internet. A fully offline PC can use Device Manager directly
against the previously verified folder, subject to your normal IT policy.

The legacy filenames `Install.cmd` and `Install-ScaleDriver.ps1` are retained for
compatibility, but **only prepare or verify** the package. Run as a standard user:

```bat
Install.cmd -PrepareOnly
Install.cmd -VerifyOnly
```

Without arguments the command prepares only. `-VerifyOnly` never downloads.
Copy the entire standalone folder **including `cache`** for offline verification.
These scripts respect the PC's existing PowerShell policy and refuse elevated
execution. If that policy blocks the unsigned script, use Electron preparation
or ask IT for its approved process; do not bypass or change policy for this kit.

## Provenance and privacy

- [Microsoft Update Catalog](https://www.catalog.update.microsoft.com/Search.aspx?q=Prolific%205.1.12.0), update `0f6706ef-1885-4a5a-bfec-75965b37eba5`.
- [Prolific PL2303GT support](https://www.prolific.com.tw/en/portfolio-item/pl2303gt/).
- [manifest.json](manifest.json) pins the official URL, 270,156-byte CAB and file
  hashes, version, supported hardware ID and original physical validation.
- [Microsoft Device Manager installation guidance](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/using-device-manager).

The four x64 driver files are byte-identical to the package that restored GT-5's
adapter from Code 28 to Code 0. The CAB also contains two original x86 files;
preparation verifies all six. Vendor binaries retain their copyright/signatures.
Only scripts, documentation and manifest are tracked; `cache/` is gitignored.
Do not put offline binary bundles in public Git or public Actions artifacts.
Normal Electron preparation moves a damaged package entry to a unique
`invalid-*` folder beside the cache, then prepares and verifies a fresh package.
It preserves the invalid entry for inspection and never follows a linked entry.
Verification-only mode reports failure without replacing cached data. Never edit
the manifest or hashes to accept a damaged package.
Use manufacturer support for another OS, architecture or hardware revision.
