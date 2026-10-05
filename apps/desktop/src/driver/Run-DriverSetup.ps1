[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$KitDirectory,
  [Parameter(Mandatory = $true)][string]$CacheDirectory,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [ValidateSet('Install', 'PrepareOnly', 'VerifyOnly')][string]$Mode = 'Install',
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'

function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }

try {
  if ($Mode -eq 'Install') {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      if ($Elevated) { throw 'Administrator access was not granted.' }
      # Encode a fixed invocation so spaces, quotes and shell metacharacters in
      # installation/profile paths cannot turn into commands. Elevate this helper,
      # never the normal Electron application or its per-user installer.
      $command = '& ' + (Quote-Literal $PSCommandPath) + ' -KitDirectory ' + (Quote-Literal $KitDirectory) +
        ' -CacheDirectory ' + (Quote-Literal $CacheDirectory) + ' -LogPath ' + (Quote-Literal $LogPath) + ' -Mode Install -Elevated; exit $LASTEXITCODE'
      $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
      $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
      exit $process.ExitCode
    }
  }
  $script = Join-Path $KitDirectory 'Install-ScaleDriver.ps1'
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'The bundled driver helper is missing.' }
  Start-Transcript -Path $LogPath -Force | Out-Null
  try {
    $options = @{ CacheDirectory = $CacheDirectory }
    if ($Mode -eq 'PrepareOnly') { $options.PrepareOnly = $true }
    if ($Mode -eq 'VerifyOnly') { $options.VerifyOnly = $true }
    & $script @options
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 1 }
  } finally { Stop-Transcript | Out-Null }
  exit $code
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
}
