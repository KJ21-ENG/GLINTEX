param(
  [Parameter(Mandatory=$true)][string]$PackagedExe,
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$UpgradeInstaller,
  [string]$BootstrapInstaller,
  [ValidatePattern("^\d+\.\d+\.\d+$")][string]$BootstrapVersion = '1.1.0',
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
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$report.sourceCommit = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or ($env:CI -and $report.sourceCommit -ne $env:EXPECTED_SOURCE_SHA)) { throw 'Verification source does not match requested build' }
$report.sourceTree = (git -C $sourceRoot rev-parse 'HEAD^{tree}').Trim()
$report.repository = $env:GITHUB_REPOSITORY
$report.runId = $env:GITHUB_RUN_ID
$report.runAttempt = $env:GITHUB_RUN_ATTEMPT
$report.installerSha256 = (Get-FileHash ([IO.Path]::GetFullPath($Installer)) -Algorithm SHA256).Hash.ToLower()
$report.installerBytes = (Get-Item ([IO.Path]::GetFullPath($Installer))).Length
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
    Write-Host "[$((Get-Date).ToUniversalTime().ToString('o'))] Start process $script:processSequence $File $Arguments (limit $Timeout seconds)"
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -RedirectStandardOutput ($logStem + '.stdout.txt') -RedirectStandardError ($logStem + '.stderr.txt')
    if (-not $process.WaitForExit($Timeout * 1000)) {
      # Bound cleanup too. A hung tree enumeration must not defeat the test limit.
      $killer = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/taskkill.exe') -ArgumentList @('/PID', $process.Id, '/T', '/F') -PassThru -WindowStyle Hidden
      if (-not $killer.WaitForExit(10000)) { $killer.Kill() }
      Get-Content -Tail 18 ($logStem + '.stderr.txt') | Write-Host
      throw "Timed out: $([IO.Path]::GetFileName($File))"
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { Get-Content -Tail 18 ($logStem + '.stderr.txt') | Write-Host; throw "Process exited $($process.ExitCode): $([IO.Path]::GetFileName($File))" }
    Write-Host "[$((Get-Date).ToUniversalTime().ToString('o'))] Completed process $script:processSequence"
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
function Get-InstalledVersionExe([string]$Version) {
  Write-Host "[$((Get-Date).ToUniversalTime().ToString('o'))] Verify active installed version $Version"
  $exe = Join-Path $installRoot "app-$Version/GLINTEX.exe"
  if (-not (Test-Path $exe)) { throw "Expected installed application $Version is missing" }
  $registration = @(Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'GLINTEX' })
  if ($registration.Count -ne 1 -or $registration[0].DisplayVersion -ne $Version) { throw "Windows application registration does not select $Version" }
  $index = Join-Path $installRoot 'packages/RELEASES'
  $versions = @(Get-Content $index | ForEach-Object { if ($_ -match '(?<version>\d+\.\d+\.\d+)-full\.nupkg') { [version]$Matches.version } } | Sort-Object -Descending)
  if ($versions.Count -eq 0 -or $versions[0].ToString() -ne $Version) { throw "Squirrel release index does not select $Version" }
  return Get-Item $exe
}
function Invoke-Smoke([string]$Exe, [string]$Name, [string]$Data, [bool]$ExpectRestoredSession=$false) {
  Invoke-SelfTest $Exe $Name $Data $ExpectRestoredSession
  $result = Get-Content -Raw (Join-Path $OutputDirectory "$Name-reports/packaged-second.json") | ConvertFrom-Json
  if (-not $result.passed -or -not $result.packaged -or $result.platform -ne 'win32' -or $result.arch -ne 'x64') { throw "Invalid $Name report" }
  $result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory ($Name + '.json'))
}
function Invoke-SelfTest([string]$Exe, [string]$Name, [string]$Data, [bool]$ExpectRestoredSession=$false) {
  $env:GLINTEX_TEST_DATA = $Data
  $env:GLINTEX_TEST_REPORTS = Join-Path $OutputDirectory ($Name + '-reports')
  New-Item -ItemType Directory -Force $env:GLINTEX_TEST_REPORTS | Out-Null
  $firstPhase = if ($ExpectRestoredSession) { 'restored' } else { 'first' }
  foreach ($phase in @($firstPhase, 'second')) {
    Write-Host "[$((Get-Date).ToUniversalTime().ToString('o'))] Smoke $Name phase $phase"
    $env:GLINTEX_TEST_PHASE = $phase
    Invoke-Bounded $Exe @('--self-test') 180
  }
  $reports = Get-ChildItem $env:GLINTEX_TEST_REPORTS -Filter '*.json'
  if ($reports.Count -lt 2) { throw "Missing $Name self-test reports" }
  foreach ($file in $reports) { if (-not (Get-Content -Raw $file.FullName | ConvertFrom-Json).passed) { throw "Failed $Name self-test" } }
  Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE
}
try {
  $env:GLINTEX_TEST_PREPARE_DRIVER = '1'
  try { Invoke-Smoke ([IO.Path]::GetFullPath($PackagedExe)) 'packaged-smoke' (Join-Path $OutputDirectory 'isolated-smoke-data') }
  finally { Remove-Item Env:GLINTEX_TEST_PREPARE_DRIVER -ErrorAction SilentlyContinue }
  $driver = Get-Content -Raw (Join-Path $OutputDirectory 'packaged-smoke-reports/driver-preparation.json') | ConvertFrom-Json
  if (-not $driver.passed -or $driver.installed -or $driver.elevationRequested) { throw 'Real packaged driver preparation failed' }
  $report.driverPreparation = $driver
  if ((Get-Content -Raw (Join-Path $OutputDirectory 'packaged-smoke.json') | ConvertFrom-Json).sourceCommit -ne $report.sourceCommit) { throw 'Packaged runtime source identity mismatch' }
  $report.packagedLaunch = $true
  Invoke-Bounded ([IO.Path]::GetFullPath($Installer)) @('--silent')
  Start-Sleep -Seconds 8
  Stop-TestApp
  $candidateVersion = (Get-Content -Raw (Join-Path $sourceRoot 'apps/desktop/package.json') | ConvertFrom-Json).version
  $installedExe = Get-InstalledVersionExe $candidateVersion
  if (-not $installedExe) { throw 'Installed executable missing' }
  Invoke-Smoke $installedExe.FullName 'installed-smoke' $userData
  if ((Get-Content -Raw (Join-Path $OutputDirectory 'installed-smoke.json') | ConvertFrom-Json).sourceCommit -ne $report.sourceCommit) { throw 'Installed runtime source identity mismatch' }
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
    $v = [version](Get-Content -Raw (Join-Path $OutputDirectory 'installed-smoke.json') | ConvertFrom-Json).version
    $next = "$($v.Major).$($v.Minor).$($v.Build + 1)"
    $env:GLINTEX_TEST_DATA = $userData
    $env:GLINTEX_TEST_REPORTS = Join-Path $OutputDirectory 'authenticated-update-reports'
    $env:GLINTEX_TEST_PHASE = 'update'
    $env:GLINTEX_TEST_UPDATE_INSTALLER = [IO.Path]::GetFullPath($UpgradeInstaller)
    $env:GLINTEX_TEST_UPDATE_VERSION = $next
    $env:GLINTEX_INSTALL_TEST = '1'
    try { Invoke-Bounded $installedExe.FullName @('--self-test') 300 }
    finally { Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE, Env:GLINTEX_TEST_UPDATE_INSTALLER, Env:GLINTEX_TEST_UPDATE_VERSION, Env:GLINTEX_INSTALL_TEST -ErrorAction SilentlyContinue }
    $updateReport = Get-Content -Raw (Join-Path $OutputDirectory 'authenticated-update-reports/packaged-update.json') | ConvertFrom-Json
    if (-not $updateReport.passed -or $updateReport.sourceCommit -ne $report.sourceCommit -or $updateReport.checks -notcontains 'main-process-mid-save-close-block') { throw 'Authenticated update report is missing or does not prove pending-save protection' }
    $deadline = (Get-Date).AddSeconds(120)
    while (-not (Test-Path (Join-Path $installRoot "app-$next/GLINTEX.exe"))) { if ((Get-Date) -gt $deadline) { throw 'User-controlled update installer did not create the next-version application' }; Start-Sleep -Seconds 2 }
    Start-Sleep -Seconds 8
    Stop-TestApp
    $upgradedExe = Get-InstalledVersionExe $next
    Invoke-Smoke $upgradedExe.FullName 'upgraded-smoke' $userData $true
    $restored = Get-Content -Raw (Join-Path $OutputDirectory 'upgraded-smoke-reports/packaged-restored.json') | ConvertFrom-Json
    if (-not $restored.passed -or -not $restored.restoredSession -or $restored.checks -notcontains 'restored-session-after-authenticated-upgrade') { throw 'Upgrade did not preserve the authenticated session' }
    $report.upgradeSessionPreserved = $true
    $firstVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'installed-smoke.json') | ConvertFrom-Json).version
    $nextVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'upgraded-smoke.json') | ConvertFrom-Json).version
    if ([version]$nextVersion -le [version]$firstVersion) { throw 'Upgrade fixture did not increase version' }
    if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Upgrade changed persisted settings or queue marker' }
    $report.upgradePreserved = $true
    $report.authenticatedUpdate = $true
    $report.upgradeFrom = $firstVersion; $report.upgradeTo = $nextVersion
  }
  $report.uninstallDetails = Invoke-Uninstall 'uninstall-details'
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Uninstall removed or changed retained workstation data' }
  $report.uninstall = $true
  # Reinstall the original candidate after uninstall, retaining profile/queue data.
  Invoke-Bounded ([IO.Path]::GetFullPath($Installer)) @('--silent')
  Start-Sleep -Seconds 8
  Stop-TestApp
  $reinstalledExe = Get-InstalledVersionExe $candidateVersion
  Invoke-Smoke $reinstalledExe.FullName 'reinstalled-smoke' $userData
  $originalVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'installed-smoke.json') | ConvertFrom-Json).version
  $reinstalledVersion = (Get-Content -Raw (Join-Path $OutputDirectory 'reinstalled-smoke.json') | ConvertFrom-Json).version
  if ($reinstalledVersion -ne $originalVersion) { throw "Rollback selected $reinstalledVersion instead of original $originalVersion" }
  $report.reinstalledVersion = $reinstalledVersion
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Reinstall changed retained settings or queue marker' }
  $report.reinstallPreserved = $true
  $report.finalUninstallDetails = Invoke-Uninstall 'final-uninstall-details'
  if ($BootstrapInstaller) {
    Invoke-Bounded ([IO.Path]::GetFullPath($BootstrapInstaller)) @('--silent')
    Start-Sleep -Seconds 8; Stop-TestApp
    $bootstrapExe = Get-InstalledVersionExe $BootstrapVersion
    Invoke-Smoke $bootstrapExe.FullName 'bootstrap-original' $userData
    if ((Get-Content -Raw (Join-Path $OutputDirectory 'bootstrap-original.json') | ConvertFrom-Json).version -ne $BootstrapVersion) { throw 'Bootstrap fixture is not the delivered version' }
    # Exercise the already delivered updater against this exact new installer.
    $env:GLINTEX_TEST_DATA = $userData
    $env:GLINTEX_TEST_REPORTS = Join-Path $OutputDirectory 'previous-release-update-reports'
    $env:GLINTEX_TEST_PHASE = 'update'
    $env:GLINTEX_TEST_UPDATE_INSTALLER = [IO.Path]::GetFullPath($Installer)
    $env:GLINTEX_TEST_UPDATE_VERSION = $candidateVersion
    $env:GLINTEX_INSTALL_TEST = '1'
    try { Invoke-Bounded $bootstrapExe.FullName @('--self-test') 300 }
    finally { Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE, Env:GLINTEX_TEST_UPDATE_INSTALLER, Env:GLINTEX_TEST_UPDATE_VERSION, Env:GLINTEX_INSTALL_TEST -ErrorAction SilentlyContinue }
    $previousUpdate = Get-Content -Raw (Join-Path $OutputDirectory 'previous-release-update-reports/packaged-update.json') | ConvertFrom-Json
    if (-not $previousUpdate.passed -or $previousUpdate.version -ne $BootstrapVersion -or $previousUpdate.checks -notcontains 'main-process-mid-save-close-block') { throw 'Previous-release authenticated update proof missing' }
    $deadline = (Get-Date).AddSeconds(120)
    while (-not (Test-Path (Join-Path $installRoot "app-$candidateVersion/GLINTEX.exe"))) { if ((Get-Date) -gt $deadline) { throw 'Previous updater did not install the candidate' }; Start-Sleep -Seconds 2 }
    Start-Sleep -Seconds 8; Stop-TestApp
    $bootstrappedExe = Get-InstalledVersionExe $candidateVersion
    Invoke-Smoke $bootstrappedExe.FullName 'bootstrap-upgraded' $userData $true
    $bootstrapRestored = Get-Content -Raw (Join-Path $OutputDirectory 'bootstrap-upgraded-reports/packaged-restored.json') | ConvertFrom-Json
    if ($bootstrapRestored.version -ne $originalVersion -or -not $bootstrapRestored.restoredSession) { throw 'Previous-release update did not select the candidate and preserve login' }
    if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Previous-release update changed workstation settings or queue' }
    $report.previousReleaseAuthenticatedUpdate = $true
    $report.previousReleaseSessionPreserved = $true
    $report.manualBootstrapPreserved = $true # Compatibility acceptance field: previous-version migration preserved data.
    $report.bootstrapFrom = $BootstrapVersion; $report.bootstrapTo = $originalVersion
    $report.bootstrapUninstallDetails = Invoke-Uninstall 'bootstrap-uninstall-details'
  }
  if ((Get-FileHash $settingsFile -Algorithm SHA256).Hash -ne $beforeSettings -or (Get-FileHash $queueSentinel -Algorithm SHA256).Hash -ne $beforeQueue) { throw 'Final uninstall changed retained settings or queue marker' }
  $report.installerSignature = (Get-AuthenticodeSignature ([IO.Path]::GetFullPath($Installer))).Status.ToString()
  $report.settingsSha256 = $beforeSettings.ToLower(); $report.queueMarkerSha256 = $beforeQueue.ToLower()
  $report.passed = $true
} catch { $report.error = $_.Exception.Message; throw }
finally {
  $helperStatus = Join-Path $userData 'updates/install-status.json'
  if (Test-Path $helperStatus) { Copy-Item $helperStatus (Join-Path $OutputDirectory 'update-helper-status.json') }
  foreach ($log in @((Join-Path $env:LOCALAPPDATA 'SquirrelTemp/SquirrelSetup.log'), (Join-Path $env:TEMP 'SquirrelTemp/SquirrelSetup.log'), (Join-Path $env:TEMP 'SquirrelSetup.log'), (Join-Path $installRoot 'SquirrelSetup.log'))) {
    if (Test-Path $log) { Copy-Item $log (Join-Path $OutputDirectory ('squirrel-' + (Split-Path (Split-Path $log) -Leaf) + '.txt')) }
  }
  $report.completedAt = (Get-Date).ToUniversalTime().ToString('o')
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'windows-verification.json')
  Remove-Item Env:GLINTEX_TEST_DATA, Env:GLINTEX_SMOKE_REPORT, Env:GLINTEX_TEST_REPORTS, Env:GLINTEX_TEST_PHASE -ErrorAction SilentlyContinue
}
