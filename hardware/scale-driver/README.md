# Windows scale driver kit

GLINTEX Electron 1.1.0 bundles this optional helper. Updating GLINTEX does not
automatically reinstall the Windows driver. Run setup from **Workstation setup
& print jobs** only when needed, then select this PC's actual COM port and save
the verified protocol settings. The driver exposes a Windows COM port;
Electron's native SerialPort still depends on that operating-system driver.

This kit installs the Prolific **5.1.12.0** Windows 10 x64 driver used by the
BAFO BF-812 converter with hardware ID `USB\VID_067B&PID_23A3&REV_0305`.
Different converters have different USB serial numbers; the hardware ID selects
the driver. No access to another GLINTEX PC is needed.

The package comes directly from Microsoft Update. Its four x64 files were
verified byte-for-byte against the package used successfully on GT-5 on
5 October 2026. The complete downloaded package also includes the vendor's
x86 files, although this kit installs only on Windows 10 x64.

## Set up a PC

1. Install the verified GLINTEX Electron Windows Setup.exe as the intended
   Windows user. Its distribution includes these scripts and manifest outside
   ASAR, under the installed application's `resources\scale-driver` folder.
   Driver binaries are downloaded separately; they are not bundled in Setup.
2. Connect the converter to USB and the scale to the converter. Power on the scale.
3. Sign in to Electron with Settings write access. Open **Workstation setup &
   print jobs**, disconnect any connected scale and close other serial apps.
   Choose **Run scale driver setup (administrator)** and approve Windows UAC.
   Normal Electron installation remains per user; only the helper is elevated.
4. Confirm that the script reports a healthy Prolific COM port. The port number
   depends on the PC; it is not always COM3.
5. Choose **Refresh devices and jobs** and select this PC's actual COM port.
   For the tested GT-5 bracket scale, set **2400 baud, 8 data bits, no parity,
   1 stop bit, no flow control**, profile **bracket-integer**, unit **kg**, and
   **3 decimal places**. Choose **Save scale settings > Connect saved scale >
   Test fresh capture** and compare with the display. `[01363]` means 1.363 kg
   with this explicit configuration. Verify the manual for any other scale.

The native SerialPort module still needs the Windows driver to expose a COM
port. Electron does not need Chrome's **Authorize Scale**. Chrome and Electron
must not hold the same port concurrently. The current browser parser rejects
the tested `[01363]` frame; this kit does not change browser protocol support.

For standalone use, copy the whole folder, keep script/manifest/cache together,
and right-click **Install.cmd > Run as administrator**. Setup errors and UAC
cancellation appear in Electron, with the helper log under
`%APPDATA%\GLINTEX\scale-driver`. A restart request is reported for manual action.

The first run downloads a 270,156-byte CAB from the pinned Microsoft URL. Later
runs use the local cache. Electron uses the stable per-user cache at
`%APPDATA%\GLINTEX\scale-driver\cache`, so an app upgrade does not discard it.
The script verifies the archive SHA-256, every extracted
file SHA-256, the Microsoft catalog signature, and the driver binary signatures.
Windows validates the catalog-backed package again during driver installation.

It checks the connected converter's hardware ID, reports the COM port through
the device registry and .NET, and skips reinstalling an already healthy matching
driver. It does not open the serial port, send commands to the scale, change
Windows Update settings, disable driver signature enforcement, or restart the PC.
If Windows requests a restart, it reports that request for a manual restart.

`Install.cmd` permits its PowerShell script for that process only. It does not
change the PC's persistent PowerShell execution policy. Review the script before
running it with administrator access.

## Prepare for an offline PC

On an internet-connected Windows PC, run:

```bat
Install.cmd -PrepareOnly
```

This downloads, extracts and verifies the package without installing a driver.
Then copy the entire folder, **including `cache`**, onto a USB drive or the next
PC. `Install.cmd` can then install from that cache without contacting Microsoft
or another GLINTEX workstation.

For the Electron button to use an offline cache, copy the prepared `cache`
folder to `%APPDATA%\GLINTEX\scale-driver\cache` for the intended Windows user
before running setup. Do not run Electron itself as a different administrator.
Alternatively, use the standalone copied folder as described above. The app's
cloud login still needs internet even when driver installation uses an offline cache.

To verify an existing cache without downloading or installing anything:

```bat
Install.cmd -VerifyOnly
```

## Provenance and supported hardware

- [Microsoft Update Catalog entry](https://www.catalog.update.microsoft.com/Search.aspx?q=Prolific%205.1.12.0)
  (`0f6706ef-1885-4a5a-bfec-75965b37eba5`).
- [Prolific PL2303GT support](https://www.prolific.com.tw/en/portfolio-item/pl2303gt/).
- [manifest.json](manifest.json) pins the download URL, archive and file hashes,
  supported hardware ID and original validation evidence.
- The tested scale streams bracketed readings at **2400 baud, 8 data bits,
  no parity, 1 stop bit, no flow control**. Configure these explicitly in Electron;
  the native bracket profile also requires its documented unit and decimal factor.

Vendor binaries retain their original copyright and signatures. The repository
stores the setup script and verified download manifest; `cache/` stays out of Git.
This provides a reusable public-repository setup kit without publishing another
copy of the proprietary driver. The cache remains available locally for offline
deployment under the vendor's applicable terms.

For Windows 11, ARM64 or a converter with another hardware ID, use the appropriate
package from the manufacturer's support page. A yellow warning does not identify
the driver by itself; check Device Manager's error code and hardware ID first.

If verification fails, installation stops. Obtain a fresh cache with
`-PrepareOnly` in a new directory rather than editing signed driver files or
changing their hashes in the manifest.
