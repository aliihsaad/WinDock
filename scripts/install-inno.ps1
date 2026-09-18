param()
# CI compiler bootstrap, pinned to the official release and its SHA-256 digest.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.tools'
$compilerRoot = Join-Path $toolsRoot 'innosetup7'
$download = Join-Path $toolsRoot 'innosetup-7.1.0-x64.exe'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $download)) {
    Invoke-WebRequest -Uri 'https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe' -OutFile $download
}
$hasher = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($download)
try { $hash = ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
finally { $stream.Dispose(); $hasher.Dispose() }
if ($hash -ne '0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f') { throw 'Inno Setup compiler checksum mismatch.' }
$install = Start-Process -FilePath $download -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/CURRENTUSER','/NOICONS',('/DIR="' + $compilerRoot + '"')) -WindowStyle Hidden -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Inno Setup installation failed: $($install.ExitCode)" }
if (-not (Test-Path -LiteralPath (Join-Path $compilerRoot 'ISCC.exe'))) { throw 'Inno Setup compiler missing after installation.' }
Write-Output "Compiler ready: $compilerRoot\ISCC.exe"
