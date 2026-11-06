param(
    [string]$Apk = 'artifacts/WinDock-android-debug.apk',
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [string]$ExpectedVersion = '',
    [int]$ExpectedCode = 10
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not [IO.Path]::IsPathRooted($Apk)) { $Apk = Join-Path $projectRoot $Apk }
if (-not $AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $ExpectedVersion) { $ExpectedVersion = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).releaseVersion }
$buildTools = Join-Path $AndroidSdk 'build-tools/36.1.0'
$signature = & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $Apk 2>&1
if ($LASTEXITCODE -ne 0) { throw 'GitHub APK signature is invalid.' }
# Public certificate of the existing GitHub APK, not a secret/key.
$expected = '488186d4c2e70bd171bafd8fe7a11b8cce7d0fa7863113f334e07f66f57f83c1'
$certs = @($signature | ForEach-Object { if ($_ -match '^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$') { $Matches[1].ToLowerInvariant() } })
if ($certs.Count -ne 1 -or $certs[0] -cne $expected) { throw 'GitHub signing certificate mismatch. Use the established local GitHub key; a fresh CI debug key cannot update existing installations.' }
$badging = & (Join-Path $buildTools 'aapt.exe') dump badging $Apk
if ($LASTEXITCODE -ne 0) { throw 'Cannot read GitHub APK metadata.' }
$packageLine = $badging | Where-Object { $_ -match "^package: name='com.windock.app' " } | Select-Object -First 1
if ($packageLine -notmatch "versionCode='$ExpectedCode' versionName='$([regex]::Escape($ExpectedVersion))'") { throw "Expected com.windock.app $ExpectedVersion (code $ExpectedCode)." }
# Existing GitHub channel is assembleDebug. Do not substitute a Play test APK.
if (-not ($badging -contains 'application-debuggable')) { throw 'Expected the existing GitHub debug variant, not the Play release variant.' }
[pscustomobject]@{ Package='com.windock.app'; Version=$ExpectedVersion; VersionCode=$ExpectedCode; CertificateSha256=$expected; Sha256=(Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant(); Path=$Apk }
