param([string]$DownloadBase = './downloads', [string]$ReleaseVersion = '')
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
if ($ReleaseVersion) {
    if ($ReleaseVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
    $version = $ReleaseVersion
}
# Read the version from the actual APK, including when reusing an older companion.
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$aaptName = if ($env:OS -eq 'Windows_NT') { 'aapt.exe' } else { 'aapt' }
$aapt = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName $aaptName } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $aapt) { throw 'Android SDK aapt is required to read the packaged APK version.' }
$badging = & $aapt dump badging $apkSource
if ($LASTEXITCODE -ne 0) { throw 'Could not read APK metadata.' }
$packageLine = $badging | Where-Object { $_ -match "^package: name='com.windock.app' " } | Select-Object -First 1
$apkMetadata = [regex]::Match($packageLine, "(?:^| )versionCode='([0-9]+)' versionName='([^']+)'(?: |$)")
if (-not $apkMetadata.Success) { throw 'WinDock APK version metadata is missing.' }
$apkVersionCode = [int]$apkMetadata.Groups[1].Value
$apkVersionName = $apkMetadata.Groups[2].Value
if ($apkVersionCode -lt 1 -or $apkVersionName -cnotmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'WinDock APK version metadata is invalid.' }
$manifest = [ordered]@{
    version = $version
    available = $true
    generatedAt = [DateTime]::UtcNow.ToString('o')
    windows = @{ url="$DownloadBase/WinDockSetup.exe"; bytes=$windowsFile.Length; sha256=$windowsHash }
    android = @{ versionCode=$apkVersionCode; versionName=$apkVersionName; url="$DownloadBase/WinDock-android-debug.apk"; bytes=$androidFile.Length; sha256=$androidHash }
    checksums = "$DownloadBase/SHA256SUMS.txt"
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $downloadRoot 'downloads.json'), ($manifest | ConvertTo-Json -Depth 4), $utf8)
[IO.File]::WriteAllText((Join-Path $downloadRoot 'SHA256SUMS.txt'), "$windowsHash  WinDockSetup.exe`n$androidHash  WinDock-android-debug.apk`n", $utf8)
Write-Output "Website downloads ready: $downloadRoot"
Write-Output "Windows installer: $($windowsFile.Length) bytes; Android APK: $($androidFile.Length) bytes"
