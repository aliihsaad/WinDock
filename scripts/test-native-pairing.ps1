param([switch]$Preview)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dotnetPath = Join-Path $projectRoot '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnetPath)) { $dotnetPath = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.tools\nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
Push-Location $projectRoot
try {
    $output = Join-Path $projectRoot 'artifacts\native-pairing-tests'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $fixture = Join-Path $output 'fixture.json'
    $capture = Join-Path $output 'pairing-window.png'
    & node native\pairing-tests\fixture.mjs $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic pairing fixture generation failed' }
    & $dotnetPath build native\pairing-tests\WinDockPairingTests.csproj -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Native pairing tests failed to build' }
    $testArgs = @('native\pairing-tests\bin\Release\net8.0-windows\WinDockPairingTests.dll', $fixture, $capture)
    if ($Preview) { $testArgs += '--preview' }
    & $dotnetPath @testArgs
    if ($LASTEXITCODE -ne 0) { throw 'Native pairing verification failed' }
} finally { Pop-Location }
