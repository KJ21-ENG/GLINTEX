param(
  [Parameter(Mandatory=$true)][string]$PackagedExe,
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$UpgradeInstaller,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../out/verification'),
  [switch]$AllowLocalInstall
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This verifier requires PowerShell 7 on Windows x64.' }
if (-not $env:CI -and -not $AllowLocalInstall) { throw 'This installs/uninstalls GLINTEX for the current user. Run only on an isolated test machine, using -AllowLocalInstall.' }
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'Windows x64 required.' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$report = [ordered]@{ passed=$false; startedAt=(Get-Date).ToUniversalTime().ToString('o'); os=[Environment]::OSVersion.VersionString; architecture='x64'; packagedLaunch=$false; installedLaunch=$false; shortcut=$false; upgradePreserved=$false; uninstall=$false; physicalHardwareTested=$false }
$installRoot = Join-Path $env:LOCALAPPDATA 'GLINTEX'
$userData = Join-Path $env:APPDATA 'GLINTEX'
if (Test-Path $installRoot) { throw 'Existing GLINTEX installation found. Use a clean disposable Windows test user/runner.' }
if (Test-Path $userData) { throw 'Existing GLINTEX user data found. Use a clean disposable Windows test user/runner.' }
function Invoke-Bounded([string]$File, [string[]]$Arguments, [int]$Timeout=120) {
  $isSetup = [IO.Path]::GetFileName($File) -like '*Setup.exe'
  if ($isSetup) { $env:GLINTEX_INSTALL_TEST = '1' }
  try {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit($Timeout * 1000)) { $process.Kill($true); throw "Timed out: $([IO.Path]::GetFileName($File))" }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "Process exited $($process.ExitCode): $([IO.Path]::GetFileName($File))" }
  } finally { if ($isSetup) { Remove-Item Env:GLINTEX_INSTALL_TEST -ErrorAction SilentlyContinue } }
}
function Stop-TestApp {
  Get-Process -Name GLINTEX -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
  Start-Sleep -Seconds 2
}
function Invoke-Smoke([string]$Exe, [string]$Name, [string]$Data) {
  Invoke-SelfTest $Exe $Name $Data
  $result = Get-Content -Raw (Join-Path $OutputDirectory "$Name-reports/packaged-second.json") | ConvertFrom-Json
  if (-not $result.passed -or -not $result.packaged -or $result.platform -ne 'win32' -or $result.arch -ne 'x64') { throw "Invalid $Name report" }
  $result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory ($Name + '.json'))
}
function Invoke-SelfTest([string]$Exe, [string]$Name, [string]$Data) {
  $env:GLINTEX_TEST_DATA = $Data
  $env:GLINTEX_TEST_REPORTS = Join-Path $OutputDirectory ($Name + '-reports')
  New-Item -ItemType Directory -Force $env:GLINTEX_TEST_REPORTS | Out-Null
  foreach ($phase in @('first', 'second')) {
    $env:GLINTEX_TEST_PHASE = $phase
    Invoke-Bounded $Exe @('--self-test') 180
  }
  $reports = Get-ChildItem $env:GLINTEX_TEST_REPORTS -Filter '*.json'
  if ($reports.Count -lt 2) { throw "Missing $Name self-test reports" }
  foreach ($file in $reports) { if (-not (Get-Content -Raw $file.FullName | ConvertFrom-Json).passed) { throw "Failed $Name self-test" } }
  Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE
}
try {
  Invoke-Smoke ([IO.Path]::GetFullPath($PackagedExe)) 'packaged-smoke' (Join-Path $OutputDirectory 'isolated-smoke-data')
  $report.packagedLaunch = $true
  Invoke-Bounded ([IO.Path]::GetFullPath($Installer)) @('--silent')
  Start-Sleep -Seconds 8
  Stop-TestApp
  $installedExe = Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse | Where-Object { $_.Directory.Name -like 'app-*' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $installedExe) { throw 'Installed executable missing' }
  Invoke-Smoke $installedExe.FullName 'installed-smoke' $userData
  $report.installedLaunch = $true
  $shortcut = Get-ChildItem (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs') -Filter '*GLINTEX*.lnk' -Recurse | Select-Object -First 1
  if (-not $shortcut) { throw 'Start menu shortcut missing' }
  $report.shortcut = $true
  # Harmless files in the same persisted folders: verify an upgrade does not remove
  # either category, without submitting labels or inventing transaction records.
  $settingsFile = Join-Path $userData 'workstation/workstation.json'
  New-Item -ItemType Directory -Force (Split-Path $settingsFile), (Join-Path $userData 'print-jobs') | Out-Null
  '{"schemaVersion":1,"startAtLogin":false,"scale":{"path":"COM999","profileId":"unknown"}}' | Set-Content -NoNewline -Encoding utf8 $settingsFile
  $queueSentinel = Join-Path $userData 'print-jobs/upgrade-preservation-test.txt'
  'GLINTEX CI preservation marker; not a job.' | Set-Content -NoNewline -Encoding utf8 $queueSentinel
  $beforeSettings = (Get-FileHash $settingsFile -Algorithm SHA256).Hash
  $beforeQueue = (Get-FileHash $queueSentinel -Algorithm SHA256).Hash
  if ($UpgradeInstaller) {
    Invoke-Bounded ([IO.Path]::GetFullPath($UpgradeInstaller)) @('--silent')
    Start-Sleep -Seconds 8
    Stop-TestApp
    $upgradedExe = Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse | Where-Object { $_.Directory.Name -like 'app-*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Invoke-Smoke $upgradedExe.FullName 'upgraded-smoke' $userData
    $firstVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'installed-smoke.json') | ConvertFrom-Json).version
    $nextVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'upgraded-smoke.json') | ConvertFrom-Json).version
    if ([version]$nextVersion -le [version]$firstVersion) { throw 'Upgrade fixture did not increase version' }
    if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Upgrade changed persisted settings or queue marker' }
    $report.upgradePreserved = $true
    $report.upgradeFrom = $firstVersion; $report.upgradeTo = $nextVersion
  }
  Invoke-Bounded (Join-Path $installRoot 'Update.exe') @('--uninstall','--silent')
  Start-Sleep -Seconds 5
  if (Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse -ErrorAction SilentlyContinue) { throw 'Uninstall left application executables' }
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Uninstall removed or changed retained workstation data' }
  $report.uninstall = $true
  # Reinstall the original candidate after uninstall, retaining profile/queue data.
  Invoke-Bounded ([IO.Path]::GetFullPath($Installer)) @('--silent')
  Start-Sleep -Seconds 8
  Stop-TestApp
  $reinstalledExe = Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse | Where-Object { $_.Directory.Name -like 'app-*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  Invoke-Smoke $reinstalledExe.FullName 'reinstalled-smoke' $userData
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Reinstall changed retained settings or queue marker' }
  $report.reinstallPreserved = $true
  Invoke-Bounded (Join-Path $installRoot 'Update.exe') @('--uninstall','--silent')
  $report.passed = $true
} catch { $report.error = $_.Exception.Message; throw }
finally {
  $report.completedAt = (Get-Date).ToUniversalTime().ToString('o')
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'windows-verification.json')
  Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_SMOKE_REPORT, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE -ErrorAction SilentlyContinue
}
