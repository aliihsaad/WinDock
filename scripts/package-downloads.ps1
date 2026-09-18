param([string]$DownloadBase = './downloads')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$downloadRoot = Join-Path $projectRoot 'artifacts\website-downloads'
$installerSource = Join-Path $projectRoot 'artifacts\installer\WinDockSetup.exe'
$apkSource = Join-Path $projectRoot 'artifacts\WinDock-android-debug.apk'
if (-not (Test-Path -LiteralPath $installerSource -PathType Leaf)) { throw 'Build the Windows installer first: npm run build:installer' }
if (-not (Test-Path -LiteralPath $apkSource -PathType Leaf)) { throw 'Build the Android APK first: npm run build:android' }
if ($DownloadBase -ne './downloads' -and $DownloadBase -notmatch '^https://[^\s]+$') { throw 'DownloadBase must be ./downloads or an HTTPS release-asset base URL.' }
$DownloadBase = $DownloadBase.TrimEnd('/')
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
Copy-Item -LiteralPath $installerSource -Destination (Join-Path $downloadRoot 'WinDockSetup.exe') -Force
Copy-Item -LiteralPath $apkSource -Destination (Join-Path $downloadRoot 'WinDock-android-debug.apk') -Force
$windowsFile = Get-Item -LiteralPath (Join-Path $downloadRoot 'WinDockSetup.exe')
$androidFile = Get-Item -LiteralPath (Join-Path $downloadRoot 'WinDock-android-debug.apk')
function Get-DownloadHash([string]$Path) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
}
$windowsHash = Get-DownloadHash $windowsFile.FullName
$androidHash = Get-DownloadHash $androidFile.FullName
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$manifest = [ordered]@{
    version = $version
    available = $true
    generatedAt = [DateTime]::UtcNow.ToString('o')
    windows = @{ url="$DownloadBase/WinDockSetup.exe"; bytes=$windowsFile.Length; sha256=$windowsHash }
    android = @{ url="$DownloadBase/WinDock-android-debug.apk"; bytes=$androidFile.Length; sha256=$androidHash }
    checksums = "$DownloadBase/SHA256SUMS.txt"
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $downloadRoot 'downloads.json'), ($manifest | ConvertTo-Json -Depth 4), $utf8)
[IO.File]::WriteAllText((Join-Path $downloadRoot 'SHA256SUMS.txt'), "$windowsHash  WinDockSetup.exe`n$androidHash  WinDock-android-debug.apk`n", $utf8)
Write-Output "Website downloads ready: $downloadRoot"
Write-Output "Windows installer: $($windowsFile.Length) bytes; Android APK: $($androidFile.Length) bytes"
