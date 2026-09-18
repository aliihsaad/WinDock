param(
    [string]$Compiler = '',
    [string]$PackageDirectory = 'artifacts\WinDock-win-x64'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot $PackageDirectory))
$outputRoot = Join-Path $projectRoot 'artifacts\installer'
if (-not $Compiler) {
    $candidates = @((Join-Path $projectRoot '.tools\innosetup7\ISCC.exe'), (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'))
    $Compiler = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $Compiler) { $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($command) { $Compiler = $command.Source } }
}
if (-not $Compiler) { throw 'Install Inno Setup 7 or pass -Compiler with the path to ISCC.exe.' }
foreach ($name in @('WinDockTray.exe','WinDockHelper.exe','node.exe','server.js','package.json','package-lock.json','src\platform\windows.js','public\index.html','node_modules\ws\index.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $name) -PathType Leaf)) { throw "Build Windows first. Missing: $name" }
}
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Installer version must have three numeric components.' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
& $Compiler "/DAppVersion=$version" "/DPackageDir=$packageRoot" "/DOutputDir=$outputRoot" (Join-Path $projectRoot 'native\installer\WinDock.iss')
if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed ($LASTEXITCODE)" }
Write-Output "Windows installer ready: $outputRoot\WinDockSetup.exe"
