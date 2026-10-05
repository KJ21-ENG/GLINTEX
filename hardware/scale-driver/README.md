# Windows scale driver kit

This kit installs the Prolific **5.1.12.0** Windows 10 x64 driver used by the
BAFO BF-812 converter with hardware ID `USB\VID_067B&PID_23A3&REV_0305`.
Different converters have different USB serial numbers; the hardware ID selects
the driver. No access to another GLINTEX PC is needed.

The package comes directly from Microsoft Update. Its four x64 files were
verified byte-for-byte against the package used successfully on GT-5 on
5 October 2026. The complete downloaded package also includes the vendor's
x86 files, although this kit installs only on Windows 10 x64.

## Set up a PC

1. Copy this entire `hardware/scale-driver` folder to the Windows PC. Keep the
   script, manifest and any `cache` folder together.
2. Connect the converter to USB and the scale to the converter. Power on the scale.
3. Right-click **Install.cmd** and choose **Run as administrator**.
4. Confirm that the script reports a healthy Prolific COM port. The port number
   depends on the PC; it is not always COM3.
5. In Chrome or Edge at GLINTEX, use **Fetch Weight > Authorize Scale > select
   the Prolific converter > Connect**. Compare the reading with the scale display.

The first run downloads a 270,156-byte CAB from the pinned Microsoft URL. Later
runs use the local cache. The script verifies the archive SHA-256, every extracted
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
  no parity, 1 stop bit, no flow control**. GLINTEX already detects this baud rate.

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
