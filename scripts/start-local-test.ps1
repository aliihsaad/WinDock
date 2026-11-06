#requires -Version 7.2
# Copy beside WinDockTray.exe in the local test package. No installation or key creation.
param(
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'WinDock-LocalTest-20261031'),
    [int]$SecurePort = 8621,
    [switch]$LegacyOnly
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$tray = Join-Path $root 'WinDockTray.exe'
if (-not (Test-Path -LiteralPath $tray)) { throw 'Run this script from the extracted Windows test package, beside WinDockTray.exe.' }
if (Get-Process -Name WinDockTray -ErrorAction SilentlyContinue) { throw 'Quit the existing WinDock tray application first, then run this launcher again. Nothing was stopped.' }
if ($SecurePort -lt 1 -or $SecurePort -gt 65535) { throw 'SecurePort must be between 1 and 65535.' }
$state = [IO.Path]::GetFullPath($StateDirectory)
$certificate = Join-Path $state 'tls\host.crt'
$privateKey = Join-Path $state 'tls\host.key'
if (-not $LegacyOnly -and (-not (Test-Path -LiteralPath $certificate) -or -not (Test-Path -LiteralPath $privateKey))) {
    throw 'Local TLS files are missing. Follow LOCAL_TESTING.md to provision the test certificate while Wi-Fi and USB tethering are connected. This launcher never creates keys.'
}
New-Item -ItemType Directory -Path $state -Force | Out-Null
$names = @('WINDOCK_CONFIG','WINDOCK_TLS_CERT','WINDOCK_TLS_KEY','WINDOCK_TLS_PORT')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:WINDOCK_CONFIG = Join-Path $state 'config.json'
    $env:WINDOCK_TLS_CERT = if ($LegacyOnly) { $null } else { $certificate }
    $env:WINDOCK_TLS_KEY = if ($LegacyOnly) { $null } else { $privateKey }
    $env:WINDOCK_TLS_PORT = if ($LegacyOnly) { $null } else { [string]$SecurePort }
    # This is an interactive tray GUI: Hidden can suppress its first connection-info form.
    # The tray starts without a form; its Node child already uses CreateNoWindow.
    $process = Start-Process -FilePath $tray -WorkingDirectory $root -WindowStyle Normal -PassThru
    Write-Output "Started local test companion (process $($process.Id)). Open Show connection info in its tray menu."
    Write-Output "Test dock configuration: $state"
    Write-Output 'HTTP uses existing saved port settings. Read the actual endpoints from the tray; avoid changing shared tray settings during this test.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
