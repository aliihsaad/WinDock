param(
    [switch]$Unsigned,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidSdk = $env:ANDROID_HOME
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $JavaHome) { $JavaHome = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr' }
if (-not $AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'Set JAVA_HOME to JDK 17 or 21.' }
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms\android-36\android.jar'))) { throw 'Install Android SDK Platform 36.' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$task = if ($Unsigned) { 'bundleRelease' } else { 'signedReleaseBundle' }
$signingMode = if ($Unsigned) { '-PwindockUnsigned=true' } else { '-PwindockUploadSigning=true' }
Push-Location (Join-Path $root 'android')
try {
    & .\gradlew.bat testReleaseUnitTest lintRelease $task $signingMode --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Release build failed ($LASTEXITCODE)." }
} finally { Pop-Location }
$output = Join-Path $root 'artifacts\play'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$name = if ($Unsigned) { 'WinDock-inspection-only.aab' } else { 'WinDock-upload-candidate.aab' }
$bundle = Join-Path $output $name
$sourceBundle = Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab'
if ($Unsigned) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($sourceBundle)
    try {
        if (@($zip.Entries | Where-Object { $_.FullName -match '^META-INF/.*\.(SF|RSA|DSA|EC)$' }).Count) {
            throw 'Inspection bundle unexpectedly contains a signature.'
        }
    } finally { $zip.Dispose() }
}
if (-not $Unsigned) {
    # jarsigner verifies AABs; apksigner is for APKs. An upload certificate is normally self-signed.
    $verification = & (Join-Path $JavaHome 'bin\jarsigner.exe') -verify -verbose -certs $sourceBundle 2>&1
    if ($LASTEXITCODE -ne 0 -or ($verification -join "`n") -notmatch 'jar verified') { throw 'AAB signature verification failed.' }
    if (($verification -join "`n") -match 'CN=Android Debug') { throw 'Android Debug certificates are not publication credentials.' }
}
Copy-Item -LiteralPath $sourceBundle -Destination $bundle
Get-FileHash -Algorithm SHA256 -LiteralPath $bundle | Format-List
Write-Host "Local bundle only: $bundle. Publication gates in docs/PLAY_RELEASE.md still apply."
