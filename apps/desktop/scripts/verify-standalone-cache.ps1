param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if (-not $env:CI -or $env:OS -ne 'Windows_NT') { throw 'Isolated Windows CI fixture only.' }
Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1')) -ErrorAction Stop
$source = Join-Path $PSScriptRoot '../../../hardware/scale-driver/Install-ScaleDriver.ps1'
$manifestPath = Join-Path (Split-Path $source) 'manifest.json'
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ine '6ece02cbcf3e84a1a1168a11652cb22a63bac358c12e6a77f2804fd77dad4f67') { throw 'Test manifest identity mismatch.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Standalone helper syntax failed.' }
# Test the exact cache functions without running the full preparer, its admin
# guard, extraction or any driver operation under the CI runner's admin token.
foreach ($name in @('Assert-Archive','Get-PreparedArchive')) {
  $functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true) | Where-Object { $_.Name -eq $name })
  if ($functions.Count -ne 1) { throw 'Cache test function identity mismatch.' }
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$temporary = Join-Path $OutputDirectory ('standalone-cache-test-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary) | Out-Null
try {
  $known = Join-Path $temporary 'known.cab'
  Get-PreparedArchive -ArchivePath $known -Manifest $manifest
  $script:knownArchive = [IO.File]::ReadAllBytes($known)
  $script:downloads=0
  function Invoke-WebRequest {
    param($Uri,[switch]$UseBasicParsing,$OutFile,$TimeoutSec)
    if ($Uri -ne $manifest.archive.url -or $TimeoutSec -ne 60) { throw 'Unexpected download parameters.' }
    $script:downloads++
    [IO.File]::WriteAllBytes($OutFile,$script:knownArchive)
  }
  $cases=@()
  foreach ($kind in @('truncated','tampered','linked')) {
    $directory=Join-Path $temporary $kind;[IO.Directory]::CreateDirectory($directory) | Out-Null
    $archive=Join-Path $directory 'prolific-5.1.12.0-windows-10-x64.cab'
    $outside=Join-Path $directory 'outside.txt';[IO.File]::WriteAllText($outside,'preserve link target')
    if ($kind -eq 'linked') { New-Item -ItemType SymbolicLink -Path $archive -Value $outside | Out-Null }
    else { $length=if($kind -eq 'truncated'){100}else{$manifest.archive.bytes};[IO.File]::WriteAllBytes($archive,(New-Object byte[] $length)) }
    $before=$script:downloads
    Get-PreparedArchive -ArchivePath $archive -Manifest $manifest
    if ($script:downloads -ne $before+1) { throw 'Invalid archive did not trigger one verified replacement.' }
    $quarantine=@(Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -like 'invalid-archive-*' })
    if ($quarantine.Count -ne 1 -or [IO.File]::ReadAllText($outside) -ne 'preserve link target') { throw 'Quarantine or target preservation failed.' }
    if ($kind -eq 'linked' -and -not ($quarantine[0].Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked entry was not preserved.' }
    Get-PreparedArchive -ArchivePath $archive -Manifest $manifest
    if ($script:downloads -ne $before+1) { throw 'Healthy cached archive downloaded again.' }
    $cases += $kind
  }
  @{passed=$true;actualPinnedMicrosoftArchive=$true;cases=$cases;healthyArchiveReused=$true;linkTargetPreserved=$true;driverInstalled=$false;elevationRequested=$false;fullStandaloneStandardUserExecutionTested=$false;scope='Exact standalone cache functions on isolated CI fixtures; no full preparer or driver install.'} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'standalone-cache-recovery.json')
} finally {
  Remove-Item Function:Invoke-WebRequest -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temporary -Recurse -Force
}
