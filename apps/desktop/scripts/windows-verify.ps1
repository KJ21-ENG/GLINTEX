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
    $script:processSequence++
    $logStem = Join-Path $OutputDirectory ("process-$script:processSequence-" + [IO.Path]::GetFileName($File))
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -RedirectStandardOutput ($logStem + '.stdout.txt') -RedirectStandardError ($logStem + '.stderr.txt')
    if (-not $process.WaitForExit($Timeout * 1000)) { $process.Kill($true); throw "Timed out: $([IO.Path]::GetFileName($File))" }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "Process exited $($process.ExitCode): $([IO.Path]::GetFileName($File))" }
  } finally { if ($isSetup) { Remove-Item Env:GLINTEX_INSTALL_TEST -ErrorAction SilentlyContinue } }
}
function Stop-TestApp {
  Get-Process -Name GLINTEX -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
  Start-Sleep -Seconds 2
}
function Invoke-Uninstall([string]$Name) {
  Invoke-Bounded (Join-Path $installRoot 'Update.exe') @('--uninstall','--silent')
  $remaining = @()
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $remaining = @(Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -like 'app-*' })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Seconds 2
  }
  $shortcuts = @(Get-ChildItem (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'), ([Environment]::GetFolderPath('Desktop')) -Filter '*GLINTEX*.lnk' -Recurse -ErrorAction SilentlyContinue)
  $registration = @(Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'GLINTEX' -or ($_.UninstallString -and $_.UninstallString.Contains($installRoot)) })
  $processes = @(Get-Process -Name GLINTEX -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase) })
  $allExecutables = @(Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $dead = Test-Path (Join-Path $installRoot '.dead')
  $result = @{ versionedExecutables=@($remaining | ForEach-Object { $_.FullName }); remainingLaunchers=$allExecutables; deadMarker=$dead; shortcutCount=$shortcuts.Count; registrationCount=$registration.Count; runningProcessCount=$processes.Count }
  $result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory ($Name + '.json'))
  if ($shortcuts.Count -gt 0 -or $registration.Count -gt 0 -or $processes.Count -gt 0) { throw 'Uninstall left an active shortcut, registration or process' }
  if ($allExecutables.Count -gt 0 -and -not $dead) { throw 'Residual application cache lacks the Squirrel dead marker' }
  $result.completeFileRemoval = $allExecutables.Count -eq 0
  $result.scope = 'Application registration, shortcuts and processes removed; Squirrel dead cache files explicitly recorded.'
  return $result
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
  $report.uninstallDetails = Invoke-Uninstall 'uninstall-details'
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Uninstall removed or changed retained workstation data' }
  $report.uninstall = $true
  # Reinstall the original candidate after uninstall, retaining profile/queue data.
  Invoke-Bounded ([IO.Path]::GetFullPath($Installer)) @('--silent')
  Start-Sleep -Seconds 8
  Stop-TestApp
  $reinstalledExe = Get-ChildItem $installRoot -Filter GLINTEX.exe -Recurse | Where-Object { $_.Directory.Name -like 'app-*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  Invoke-Smoke $reinstalledExe.FullName 'reinstalled-smoke' $userData
  $originalVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'installed-smoke.json') | ConvertFrom-Json).version
  $reinstalledVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'reinstalled-smoke.json') | ConvertFrom-Json).version
  if ($reinstalledVersion -ne $originalVersion) { throw "Rollback selected $reinstalledVersion instead of original $originalVersion" }
  $report.reinstalledVersion = $reinstalledVersion
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Reinstall changed retained settings or queue marker' }
  $report.reinstallPreserved = $true
  $report.finalUninstallDetails = Invoke-Uninstall 'final-uninstall-details'
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Final uninstall changed retained settings or queue marker' }
  $report.installerSignature = (Get-AuthenticodeSignature ([IO.Path]::GetFullPath($Installer))).Status.ToString()
  $report.settingsSha256 = $beforeSettings.ToLower(); $report.queueMarkerSha256 = $beforeQueue.ToLower()
  $report.passed = $true
} catch { $report.error = $_.Exception.Message; throw }
finally {
  foreach ($log in @((Join-Path $env:LOCALAPPDATA 'SquirrelTemp/SquirrelSetup.log'), (Join-Path $env:TEMP 'SquirrelTemp/SquirrelSetup.log'), (Join-Path $env:TEMP 'SquirrelSetup.log'), (Join-Path $installRoot 'SquirrelSetup.log'))) {
    if (Test-Path $log) { Copy-Item $log (Join-Path $OutputDirectory ('squirrel-' + (Split-Path (Split-Path $log) -Leaf) + '.txt')) }
  }
  $report.completedAt = (Get-Date).ToUniversalTime().ToString('o')
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'windows-verification.json')
  Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_SMOKE_REPORT, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE -ErrorAction SilentlyContinue
}
