$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$artifacts=[IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts'))
$directory=Join-Path $artifacts ('files-folder-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$receive=Join-Path $directory 'receive'
$saved=$env:WINDOCK_FOLDER_SMOKE_ROOT
$process=$null
$shell=New-Object -ComObject Shell.Application
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinDockFolderVisibility {
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
}
'@
function Find-TestWindow {
    @($shell.Windows()) | Where-Object { try { $_.Document.Folder.Self.Path -eq $receive } catch { $false } }
}
try {
    $env:WINDOCK_FOLDER_SMOKE_ROOT=$directory
    $fixture=Join-Path $PSScriptRoot 'files-folder-smoke-host.mjs'
    # Hide only the test Node host. The explicit Open folder request must show Explorer.
    $process=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList ('"'+$fixture+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    $portFile=Join-Path $directory 'port.txt'
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while(-not (Test-Path -LiteralPath $portFile)){if([DateTime]::UtcNow -gt $deadline){throw 'Folder fixture did not start'};Start-Sleep -Milliseconds 100}
    $port=[int](Get-Content -LiteralPath $portFile)
    $response=Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/transfers/local/open" -Method Post -Headers @{'x-windock-files'='local'} -ContentType 'application/json' -Body '{}'
    if(-not $response.ok){throw 'Open folder was rejected'}
    $deadline=[DateTime]::UtcNow.AddSeconds(8)
    do {
        $visible=@(Find-TestWindow | Where-Object {[WinDockFolderVisibility]::IsWindowVisible([IntPtr]$_.HWND)})
        if($visible.Count){break};Start-Sleep -Milliseconds 100
    }while([DateTime]::UtcNow -lt $deadline)
    if(-not $visible.Count){throw 'Open folder returned success but no visible Explorer window appeared'}
    Write-Output 'PASS local Open folder API launches a visible Explorer window from a hidden host.'
}finally {
    foreach($window in @(Find-TestWindow)){$window.Quit()}
    if($process -and -not $process.HasExited){Stop-Process -Id $process.Id}
    $env:WINDOCK_FOLDER_SMOKE_ROOT=$saved
    $resolved=[IO.Path]::GetFullPath($directory)
    if(-not $resolved.StartsWith($artifacts+'\files-folder-test-',[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected fixture cleanup target'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
