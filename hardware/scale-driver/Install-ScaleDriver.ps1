[CmdletBinding()]
param(
  [switch]$PrepareOnly,
  [switch]$VerifyOnly,
  [string]$CacheDirectory
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-Package {
  param([string]$Directory, $Manifest)

  foreach ($file in $Manifest.files) {
    if ([IO.Path]::GetFileName($file.name) -ne $file.name) {
      throw 'Invalid filename in the package manifest.'
    }
    $path = Join-Path $Directory $file.name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Missing package file: $($file.name). Run Install.cmd -PrepareOnly first."
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $file.sha256) {
      throw "Checksum mismatch: $($file.name). Installation stopped."
    }
  }

  $catalog = Get-AuthenticodeSignature -LiteralPath (Join-Path $Directory 'plser.cat')
  if ($catalog.Status -ne 'Valid' -or
      $catalog.SignerCertificate.Subject -notmatch 'Microsoft Windows Hardware Compatibility Publisher') {
    throw 'The driver catalog does not have a valid Microsoft hardware-publisher signature.'
  }
  foreach ($name in @('plser64.sys', 'plser64.dll')) {
    $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $Directory $name)
    if ($signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Subject -notmatch 'Microsoft Windows Hardware Compatibility Publisher|Prolific Technology Inc') {
      throw "Invalid driver signature: $name."
    }
  }
  # The INF is catalog-signed. PnPUtil validates its catalog membership during
  # installation; direct Authenticode checks on an unstaged INF are unreliable.
  $inf = Get-Content -LiteralPath (Join-Path $Directory 'plser.inf') -Raw
  if ($inf -notmatch 'DriverVer=06/07/2026,5\.1\.12\.0' -or
      $inf -notmatch '\[PRO\.NTAMD64\]') {
    throw 'Unexpected driver version or architecture.'
  }
}

try {
  if ($PrepareOnly -and $VerifyOnly) {
    throw 'Choose either -PrepareOnly or -VerifyOnly.'
  }
  if ($env:OS -ne 'Windows_NT') {
    throw 'Run this kit on Windows.'
  }
  if ([string]::IsNullOrWhiteSpace($CacheDirectory)) {
    $CacheDirectory = Join-Path $PSScriptRoot 'cache'
  }
  $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.driverVersion -ne '5.1.12.0') {
    throw 'Unsupported package manifest.'
  }
  $uri = [uri]$manifest.archive.url
  if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'catalog.s.download.windowsupdate.com') {
    throw 'The driver download must use the pinned Microsoft Update endpoint.'
  }
  $packageDirectory = Join-Path $CacheDirectory 'prolific-5.1.12.0-windows-10-x64'

  if (-not $PrepareOnly -and -not $VerifyOnly) {
    $osInfo = Get-CimInstance Win32_OperatingSystem
    if ($osInfo.Caption -notmatch 'Windows 10' -or
        -not [Environment]::Is64BitOperatingSystem -or
        $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
      throw 'This kit installs the Windows 10 x64 driver. Use Prolific official support for other operating systems.'
    }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'Right-click Install.cmd and choose Run as administrator.'
    }
    $devices = @(Get-CimInstance Win32_PnPEntity | Where-Object {
      $_.Present -and $_.PNPDeviceID -like 'USB\VID_067B&PID_23A3\*'
    })
    $matchingDevices = @($devices | Where-Object {
      $ids = (Get-PnpDeviceProperty -InstanceId $_.PNPDeviceID -KeyName 'DEVPKEY_Device_HardwareIds').Data
      @($ids | Where-Object { $manifest.supportedHardwareIds -contains $_ }).Count -gt 0
    })
    if (-not $matchingDevices.Count) {
      throw 'Connect the supported Prolific scale converter first. Other hardware IDs require their own driver.'
    }
  }

  if (-not (Test-Path -LiteralPath $packageDirectory -PathType Container)) {
    if ($VerifyOnly) {
      throw 'No cached package. Run Install.cmd -PrepareOnly first.'
    }
    [IO.Directory]::CreateDirectory($CacheDirectory) | Out-Null
    $archivePath = Join-Path $CacheDirectory 'prolific-5.1.12.0-windows-10-x64.cab'
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
      Write-Host 'Downloading the verified Prolific driver from Microsoft...'
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $temporaryArchive = "$archivePath.download"
      Invoke-WebRequest -Uri $uri.AbsoluteUri -UseBasicParsing -OutFile $temporaryArchive -TimeoutSec 60
      if ((Get-FileHash -LiteralPath $temporaryArchive -Algorithm SHA256).Hash -ine $manifest.archive.sha256) {
        Remove-Item -LiteralPath $temporaryArchive
        throw 'Downloaded archive checksum mismatch. Installation stopped.'
      }
      Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ine $manifest.archive.sha256) {
      throw 'Cached archive checksum mismatch. Installation stopped.'
    }
    $temporaryPackage = Join-Path $CacheDirectory ('extract-' + [guid]::NewGuid().ToString('N'))
    try {
      [IO.Directory]::CreateDirectory($temporaryPackage) | Out-Null
      & "$env:SystemRoot\System32\expand.exe" '-F:*' $archivePath $temporaryPackage | Out-Host
      if ($LASTEXITCODE -ne 0) { throw 'Windows could not extract the driver archive.' }
      Assert-Package -Directory $temporaryPackage -Manifest $manifest
      Move-Item -LiteralPath $temporaryPackage -Destination $packageDirectory
    } finally {
      if (Test-Path -LiteralPath $temporaryPackage) {
        Remove-Item -LiteralPath $temporaryPackage -Recurse -Force
      }
    }
  }
  Assert-Package -Directory $packageDirectory -Manifest $manifest
  Write-Host "Verified Prolific $($manifest.driverVersion); package: $packageDirectory"
  if ($PrepareOnly -or $VerifyOnly) {
    Write-Host 'No driver was installed or changed.'
    exit 0
  }

  $readyBefore = @(foreach ($candidate in $matchingDevices) {
    $candidateId = $candidate.PNPDeviceID
    $current = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceID -eq $candidateId }
    if ($candidate.ConfigManagerErrorCode -eq 0 -and $current.IsSigned -and
        $current.DriverVersion -eq $manifest.driverVersion) {
      $candidate
    }
  })
  if ($readyBefore.Count -ne $matchingDevices.Count) {
    & "$env:SystemRoot\System32\pnputil.exe" /add-driver (Join-Path $packageDirectory 'plser.inf') /install | Out-Host
    $installExit = $LASTEXITCODE
    if ($installExit -eq 3010) {
      Write-Host 'The driver was installed. Windows requests a restart; restart manually when convenient.'
      exit 3010
    }
    if ($installExit -ne 0) { throw "Windows driver installation failed (exit $installExit)." }
  } else {
    Write-Host 'The matching driver is already installed; no reinstall needed.'
  }

  foreach ($originalDevice in $matchingDevices) {
    $deviceId = $originalDevice.PNPDeviceID
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
      $device = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -eq $deviceId }
      if ($device.ConfigManagerErrorCode -eq 0) { break }
      Start-Sleep -Seconds 2
    }
    $driver = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceID -eq $deviceId }
    $port = (Get-ItemProperty -LiteralPath ("HKLM:\SYSTEM\CurrentControlSet\Enum\$deviceId\Device Parameters")).PortName
    if ($device.ConfigManagerErrorCode -ne 0 -or -not $driver.IsSigned -or
        $driver.DriverVersion -ne $manifest.driverVersion -or
        [IO.Ports.SerialPort]::GetPortNames() -notcontains $port) {
      throw 'Driver verification failed. Check Device Manager; no automatic restart will be performed.'
    }
    Write-Host "Ready: $($device.Name), driver $($driver.DriverVersion), port $port."
  }
  Write-Host 'In GLINTEX Electron: Workstation setup & print jobs > Refresh devices and jobs > select this PC''s COM port.'
  Write-Host 'For the tested bracket scale: 2400 baud, 8 bits, no parity, 1 stop bit, no flow control; bracket-integer, kg, 3 decimal places.'
  Write-Host 'Save scale settings > Connect saved scale > Test fresh capture; compare with the display. No Chrome Authorize Scale is needed.'
  exit 0
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
}
