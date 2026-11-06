#requires -Version 7.2
# Run explicitly on the Windows host. No trust store is modified by this script.
param([string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'WinDock\tls'))
$ErrorActionPreference = 'Stop'
$directory = [IO.Path]::GetFullPath($OutputDirectory)
if ($directory.TrimEnd('\') -eq [IO.Path]::GetPathRoot($directory).TrimEnd('\')) { throw 'Use a dedicated TLS directory, not a drive root.' }
if (Test-Path -LiteralPath $directory) {
    if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'TLS directory must not be a link or junction.' }
    $unknown = @(Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -notin @('windock-ca.crt','windock-ca.key','host.crt','host.key') })
    if ($unknown.Count) { throw 'TLS directory contains unrelated files. Choose a dedicated directory before changing permissions.' }
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null
# Private keys are readable only by the current user and SYSTEM.
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
foreach ($identity in @($user, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', $inherit, 'None', 'Allow'))
}
[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($directory), $acl)
$caPath = Join-Path $directory 'windock-ca.crt'
$caKeyPath = Join-Path $directory 'windock-ca.key'
$hash = [Security.Cryptography.HashAlgorithmName]::SHA256
$padding = [Security.Cryptography.RSASignaturePadding]::Pkcs1
$now = [DateTimeOffset]::UtcNow
if ((Test-Path $caPath) -ne (Test-Path $caKeyPath)) { throw 'Incomplete CA files. Restore the matching files; do not replace a trusted CA silently.' }
if (Test-Path $caPath) {
    $ca = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPemFile($caPath, $caKeyPath)
} else {
    $caKey = [Security.Cryptography.RSA]::Create(3072)
    try {
        $req = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=WinDock local host CA', $caKey, $hash, $padding)
        $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 0, $true))
        $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new('KeyCertSign,CrlSign', $true))
        $ca = $req.CreateSelfSigned($now.AddMinutes(-5), $now.AddYears(5))
        [IO.File]::WriteAllText($caKeyPath, $caKey.ExportPkcs8PrivateKeyPem())
        [IO.File]::WriteAllText($caPath, $ca.ExportCertificatePem())
    } finally { $caKey.Dispose() }
}
$serverKey = [Security.Cryptography.RSA]::Create(3072)
try {
    if ($ca.NotAfter.ToUniversalTime() -lt $now.AddDays(366).UtcDateTime) { throw 'CA expires too soon; plan a new CA and explicit device trust migration.' }
    $req = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=WinDock local host', $serverKey, $hash, $padding)
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new('DigitalSignature,KeyEncipherment', $true))
    $oids = [Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost')
    $addresses = @('127.0.0.1') + @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        Where-Object OperationalStatus -eq 'Up' | ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
        ForEach-Object { $_.Address.ToString() } | Where-Object {
        $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)'
    })
    foreach ($address in ($addresses | Select-Object -Unique)) { $san.AddIpAddress([Net.IPAddress]::Parse($address)) }
    $req.CertificateExtensions.Add($san.Build())
    $serial = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $certificate = $req.Create($ca, $now.AddMinutes(-5), $now.AddDays(365), $serial)
    try {
        [IO.File]::WriteAllText((Join-Path $directory 'host.key'), $serverKey.ExportPkcs8PrivateKeyPem())
        [IO.File]::WriteAllText((Join-Path $directory 'host.crt'), $certificate.ExportCertificatePem())
    } finally { $certificate.Dispose() }
    Write-Host "Host certificate covers: $($addresses -join ', ')"
    Write-Host "Transfer ONLY windock-ca.crt to the phone over a trusted channel; never transfer .key files."
    Write-Host "CA certificate SHA-256: $($ca.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256))"
    Write-Host "Set WINDOCK_TLS_CERT to $(Join-Path $directory 'host.crt')"
    Write-Host "Set WINDOCK_TLS_KEY to $(Join-Path $directory 'host.key')"
    Write-Host 'Restart WinDock with those environment variables. Install the verified CA in Android certificate settings.'
} finally { $serverKey.Dispose(); $ca.Dispose() }
