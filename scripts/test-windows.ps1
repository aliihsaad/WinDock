$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dotnetPath = Join-Path $projectRoot '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnetPath)) { $dotnetPath = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.tools\nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
Push-Location $projectRoot
try {
    & $dotnetPath publish native\probe\WinDockProbe.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o artifacts\probe --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Native probe build failed' }
    & node scripts\smoke-windows.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Windows smoke checks failed' }
}
finally { Pop-Location }
