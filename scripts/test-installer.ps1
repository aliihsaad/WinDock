param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts'))
$installRoot = Join-Path $artifactsRoot ('installer-smoke-' + [guid]::NewGuid().ToString('N'))
if (-not $installRoot.StartsWith($artifactsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test path escaped artifacts.' }
$setupPath = Join-Path $artifactsRoot 'installer\WinDockSetup.exe'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{A5613067-949D-4D26-B81D-8FD6328D8A7A}_is1'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'WinDock.lnk'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path -LiteralPath $uninstallKey) { throw 'An installed WinDock already exists; refusing to replace it during testing.' }
if (Test-Path -LiteralPath $shortcutPath) { throw 'An existing WinDock Start menu shortcut would conflict with this test.' }
if (Get-ItemProperty -LiteralPath $runKey -Name 'WinDock' -ErrorAction SilentlyContinue) { throw 'An existing WinDock autostart setting would conflict with this test.' }
$personalConfig = Join-Path $env:APPDATA 'windock\config.json'
$originalConfig = if (Test-Path -LiteralPath $personalConfig) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($personalConfig)) } else { $null }
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$oldPort = $env:PORT
$oldConfig = $env:WINDOCK_CONFIG
$installed = $false
try {
    $arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOCLOSEAPPLICATIONS','/NORESTARTAPPLICATIONS','/SP-','/TASKS=!desktopicon,!autostart',('/DIR="'+$installRoot+'"'),('/LOG="'+(Join-Path $artifactsRoot 'installer-smoke-install.log')+'"'))
    $setup = Start-Process -FilePath $setupPath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Install failed: $($setup.ExitCode)" }
    $installed = $true
    $registered = Get-ItemProperty -LiteralPath $uninstallKey
    if ($registered.InstallLocation.TrimEnd('\') -ne $installRoot) { throw 'Installer registered an unexpected location.' }
    foreach ($file in @('WinDockTray.exe','WinDockHelper.exe','node.exe','server.js','public\index.html','src\platform\windows.js','node_modules\ws\index.js','unins000.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $file))) { throw "Missing installed file: $file" }
    }
    if (-not (Test-Path -LiteralPath $shortcutPath)) { throw 'Start menu shortcut missing.' }
    if (Test-Path -LiteralPath (Join-Path $installRoot 'config.json')) { throw 'Personal config included in installer.' }
    Write-Output 'PASS fresh installation, runtime files, Start menu entry, and uninstall registration.'
    $env:PORT = '18625'
    $env:WINDOCK_CONFIG = Join-Path $installRoot 'smoke-config.json'
    $tray = Start-Process -FilePath (Join-Path $installRoot 'WinDockTray.exe') -ArgumentList '--smoke-test' -WorkingDirectory $installRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifactsRoot 'installer-smoke-tray.stdout.log') -RedirectStandardError (Join-Path $artifactsRoot 'installer-smoke-tray.stderr.log')
    if (-not $tray.WaitForExit(35000)) { throw 'Installed tray smoke test timed out.' }
    if ($tray.ExitCode -ne 0) { throw 'Installed tray smoke test failed; see artifacts/installer-smoke-tray.stderr.log.' }
    if ((Get-Content -LiteralPath (Join-Path $artifactsRoot 'installer-smoke-tray.stdout.log') -Raw) -notmatch 'TRAY OK') { throw 'Installed host readiness was not verified.' }
    Write-Output 'PASS installed app launches its bundled server, receives URL/PIN, and exits.'
    [IO.File]::WriteAllText((Join-Path $installRoot 'preserve-test.txt'), 'upgrade sentinel')
    $upgrade = Start-Process -FilePath $setupPath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($upgrade.ExitCode -ne 0 -or [IO.File]::ReadAllText((Join-Path $installRoot 'preserve-test.txt')) -ne 'upgrade sentinel') { throw 'Upgrade failed or removed unrelated data.' }
    Write-Output 'PASS reinstall/upgrade preserves existing data.'
} finally {
    $env:PORT = $oldPort
    $env:WINDOCK_CONFIG = $oldConfig
    if ($installed) {
        $registered = Get-ItemProperty -LiteralPath $uninstallKey
        if ($registered.InstallLocation.TrimEnd('\') -ne $installRoot) { throw 'Uninstall target changed; refusing cleanup.' }
        $uninstall = Start-Process -FilePath (Join-Path $installRoot 'unins000.exe') -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw 'Uninstaller failed.' }
        if ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath (Join-Path $installRoot 'WinDockTray.exe')) -or (Test-Path -LiteralPath $shortcutPath)) { throw 'Uninstall left managed app files or registration behind.' }
        Write-Output 'PASS uninstall removes managed files, shortcut, and registration.'
    }
    $currentConfig = if (Test-Path -LiteralPath $personalConfig) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($personalConfig)) } else { $null }
    if ($currentConfig -cne $originalConfig) { throw 'Personal dock configuration changed.' }
    Write-Output 'PASS personal dock configuration unchanged.'
}
