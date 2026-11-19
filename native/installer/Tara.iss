; Build with scripts/build-installer.ps1. Install only the runtime allowlist.
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef PackageDir
  #error PackageDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{A5613067-949D-4D26-B81D-8FD6328D8A7A}
AppName=Tara
AppVersion={#AppVersion}
AppPublisher=AliDevLab
AppPublisherURL=https://github.com/yeshwanthkumardomala/tara
AppSupportURL=https://github.com/yeshwanthkumardomala/tara/issues
DefaultDirName={localappdata}\Programs\Tara
DefaultGroupName=Tara
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
WizardStyle=modern dark
SetupIconFile=..\tray\Assets\Tara.ico
UninstallDisplayIcon={app}\TaraTray.exe
UninstallDisplayName=Tara
OutputDir={#OutputDir}
OutputBaseFilename=TaraSetup
Compression=lzma2
SolidCompression=yes
SetupMutex=Local\Tara.Setup
AppMutex=Local\Tara.Tray
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Tara Setup

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked
Name: autostart; Description: "Start Tara when I sign in to Windows"; Flags: unchecked

[Files]
Source: "{#PackageDir}\TaraTray.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\TaraHelper.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\scripts\create-local-tls.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#PackageDir}\docs\PLAY_RELEASE.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "{#PackageDir}\docs\SECURE_CONNECTIONS.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "{#PackageDir}\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "config.json,*.log,*.pdb"
Source: "{#PackageDir}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.apk,config.json,*.log,*.pdb"
; build-windows.ps1 stages only production dependencies, including managed TLS and QR.
Source: "{#PackageDir}\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.log,*.pdb"

[Icons]
Name: "{autoprograms}\Tara"; Filename: "{app}\TaraTray.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Tara"; Filename: "{app}\TaraTray.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[InstallDelete]
; The app was called WinDock before. Clear its old programs so only Tara's remain.
Type: files; Name: "{app}\WinDock*.exe"
Type: files; Name: "{autoprograms}\WinDock.lnk"
Type: files; Name: "{autodesktop}\WinDock.lnk"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "WinDock"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Tara"; ValueData: """{app}\TaraTray.exe"""; Flags: uninsdeletevalue; Tasks: autostart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "Tara"; Flags: deletevalue; Tasks: not autostart

[Run]
Filename: "{app}\TaraTray.exe"; Description: "Open Tara"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
; An update started from the phone runs silently; bring Tara back up afterwards.
Filename: "{app}\TaraTray.exe"; WorkingDir: "{app}"; Flags: nowait runasoriginaluser; Check: WizardSilent

[Messages]
FinishedHeadingLabel=Tara is ready.
FinishedLabel=Find Tara in your Windows system tray and choose Pair a phone securely. Allow its bundled runtime on your trusted Private network if Windows asks. If the phone cannot connect, choose Connection help and paired phones in the pairing window, then Check connection.
