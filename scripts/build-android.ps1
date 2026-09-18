param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidSdk = $env:ANDROID_HOME
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $JavaHome) { $JavaHome = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr' }
if (-not $AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'Set JAVA_HOME to JDK 17 or 21 (Android Studio includes one).' }
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms\android-34\android.jar'))) { throw 'Install Android SDK Platform 34, then set ANDROID_HOME to the SDK directory.' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
Push-Location (Join-Path $projectRoot 'android')
try {
    & .\gradlew.bat assembleDebug testDebugUnitTest lintDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build/checks failed ($LASTEXITCODE)." }
} finally { Pop-Location }
$outputDir = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Force $outputDir | Out-Null
$apk = Join-Path $outputDir 'WinDock-android-debug.apk'
Copy-Item -LiteralPath (Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk') -Destination $apk
$signer = Join-Path $AndroidSdk 'build-tools\34.0.0\apksigner.bat'
& $signer verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
Write-Host "Installable test APK: $apk"
$hasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $hash = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($apk))).Replace('-', '').ToLowerInvariant()
    Write-Host "SHA256: $hash"
} finally { $hasher.Dispose() }
