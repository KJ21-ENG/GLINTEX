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

  $entry = Get-Item -LiteralPath $Directory -Force
  if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Package directory must be a directory and not a link.' }
  $names = @(Get-ChildItem -LiteralPath $Directory -Force | Select-Object -ExpandProperty Name | Sort-Object)
  if (($names -join ',') -ne (($Manifest.files.name | Sort-Object) -join ',')) { throw 'Unexpected package files.' }

  foreach ($file in $Manifest.files) {
    if ([IO.Path]::GetFileName($file.name) -ne $file.name) {
      throw 'Invalid filename in the package manifest.'
    }
    $path = Join-Path $Directory $file.name
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package files must not be links.' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Missing package file: $($file.name). Run Install.cmd -PrepareOnly first."
    }
    if ((Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $file.sha256) {
      throw "Checksum mismatch: $($file.name). Preparation stopped."
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
  foreach ($file in $Manifest.files) {
    if ((Get-FileHash -LiteralPath (Join-Path $Directory $file.name) -Algorithm SHA256).Hash -ine $file.sha256) { throw 'Package changed during signature verification.' }
  }
  # The INF is catalog-signed. Windows validates catalog membership during
  # the later manual Device Manager installation.
  $inf = Get-Content -LiteralPath (Join-Path $Directory 'plser.inf') -Raw
  if ($inf -notmatch 'DriverVer=06/07/2026,5\.1\.12\.0' -or
      $inf -notmatch '\[PRO\.NTAMD64\]') {
    throw 'Unexpected driver version or architecture.'
  }
}

function Assert-Archive {
  param([string]$Path, $Manifest)
  $entry = Get-Item -LiteralPath $Path -Force
  if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $entry.Length -ne $Manifest.archive.bytes) { throw 'Unexpected cached archive entry or size.' }
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Manifest.archive.sha256) { throw 'Cached archive checksum mismatch.' }
}

function Get-PreparedArchive {
  param([string]$ArchivePath, $Manifest)
  $ready = $false
  if (Get-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue) {
    try { Assert-Archive -Path $ArchivePath -Manifest $Manifest; $ready = $true }
    catch {
      # Rename the entry itself inside the same directory; preserve link targets.
      Rename-Item -LiteralPath $ArchivePath -NewName ('invalid-archive-' + [guid]::NewGuid().ToString('N'))
    }
  }
  if (-not $ready) {
    Write-Host 'Downloading the verified Prolific driver from Microsoft...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $temporaryArchive = $ArchivePath + '.' + [guid]::NewGuid().ToString('N') + '.download'
    try {
      Invoke-WebRequest -Uri $Manifest.archive.url -UseBasicParsing -OutFile $temporaryArchive -TimeoutSec 60
      Assert-Archive -Path $temporaryArchive -Manifest $Manifest
      Move-Item -LiteralPath $temporaryArchive -Destination $ArchivePath
    } finally {
      if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive }
    }
  }
  Assert-Archive -Path $ArchivePath -Manifest $Manifest
}

try {
  if ($PrepareOnly -and $VerifyOnly) {
    throw 'Choose either -PrepareOnly or -VerifyOnly.'
  }
  if ($env:OS -ne 'Windows_NT') {
    throw 'Run this kit on Windows.'
  }
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run preparation as a standard user. Windows performs the later driver installation.' }
  if ([string]::IsNullOrWhiteSpace($CacheDirectory)) {
    $CacheDirectory = Join-Path $PSScriptRoot 'cache'
  }
  $manifestPath = Join-Path $PSScriptRoot 'manifest.json'
  if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ine '6ece02cbcf3e84a1a1168a11652cb22a63bac358c12e6a77f2804fd77dad4f67') { throw 'Bundled manifest checksum mismatch.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.driverVersion -ne '5.1.12.0') {
    throw 'Unsupported package manifest.'
  }
  $uri = [uri]$manifest.archive.url
  if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'catalog.s.download.windowsupdate.com') {
    throw 'The driver download must use the pinned Microsoft Update endpoint.'
  }
  $packageDirectory = Join-Path $CacheDirectory 'prolific-5.1.12.0-windows-10-x64'
  if (-not $VerifyOnly) { [IO.Directory]::CreateDirectory($CacheDirectory) | Out-Null }
  $cacheEntry = Get-Item -LiteralPath $CacheDirectory -Force
  if (-not $cacheEntry.PSIsContainer -or ($cacheEntry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cache must be a directory and not a link.' }
  $packageReady = $false
  if (Get-Item -LiteralPath $packageDirectory -Force -ErrorAction SilentlyContinue) {
    try { Assert-Package -Directory $packageDirectory -Manifest $manifest; $packageReady = $true }
    catch {
      if ($VerifyOnly) { throw }
      Rename-Item -LiteralPath $packageDirectory -NewName ('invalid-' + [guid]::NewGuid().ToString('N'))
    }
  }
  if (-not $packageReady) {
    if ($VerifyOnly) {
      throw 'No cached package. Run Install.cmd -PrepareOnly first.'
    }
    $archivePath = Join-Path $CacheDirectory 'prolific-5.1.12.0-windows-10-x64.cab'
    Get-PreparedArchive -ArchivePath $archivePath -Manifest $manifest
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
  Write-Host 'Preparation only. No driver was installed or changed.'
  Write-Host 'Leave a working COM port/driver unchanged.'
  Write-Host 'For Windows 10 x64 and the exact supported hardware revision only:'
  Write-Host 'Open Device Manager from Start > select the adapter > Update driver > Browse my computer for drivers > select the verified package folder above.'
  Write-Host 'Windows handles administrator permission and catalog validation. Do not run these scripts as administrator.'
  exit 0
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
}
