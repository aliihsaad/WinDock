param([string]$Dotnet = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot 'artifacts\WinDock-win-x64'
if (-not $Dotnet) {
    $localSdk = Join-Path $projectRoot '.tools\dotnet\dotnet.exe'
    $Dotnet = if (Test-Path -LiteralPath $localSdk) { $localSdk } else { (Get-Command dotnet -ErrorAction Stop).Source }
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.tools\nuget'

Push-Location $projectRoot
try {
    foreach ($project in @('native\win\WinDockHelper.csproj', 'native\tray\WinDockTray.csproj')) {
        & $Dotnet publish $project -c Release -r win-x64 --self-contained true -p:IncludeNativeLibrariesForSelfExtract=true -o $outputPath --nologo
        if ($LASTEXITCODE -ne 0) { throw "Publish failed: $project" }
    }
    Copy-Item -LiteralPath 'server.js','package.json','package-lock.json' -Destination $outputPath -Force
    # Copy directory contents explicitly so repeated builds do not nest folders.
    foreach ($directory in @('src','public')) {
        $destination = Join-Path $outputPath $directory
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Get-ChildItem -LiteralPath $directory | Copy-Item -Destination $destination -Recurse -Force
    }
    & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Packaged dependency installation failed' }
    Copy-Item -LiteralPath (Get-Command node.exe -ErrorAction Stop).Source -Destination (Join-Path $outputPath 'node.exe') -Force
    # Also enable npm start in the development checkout.
    Copy-Item -LiteralPath (Join-Path $outputPath 'WinDockHelper.exe') -Destination $projectRoot -Force
    Write-Output "WINDOWS BUILD OK: $outputPath\WinDockTray.exe"
}
finally { Pop-Location }
