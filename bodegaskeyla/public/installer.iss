[Setup]
AppId={{com.neu360.bodegaskeyla}}
AppName=Bodegas Keyla
AppVersion=1.0.0
AppPublisher=Neu360
DefaultDirName={autopf}\BodegasKeyla
DefaultGroupName=Bodegas Keyla
AllowNoIcons=yes
OutputDir=..\release
OutputBaseFilename=BodegasKeyla_Setup_v1.0.0
SetupIconFile=favicon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\release\win-unpacked\BodegasKeyla.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Bodegas Keyla"; Filename: "{app}\BodegasKeyla.exe"
Name: "{autodesktop}\Bodegas Keyla"; Filename: "{app}\BodegasKeyla.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\BodegasKeyla.exe"; Description: "{cm:LaunchProgram,Bodegas Keyla}"; Flags: nowait postinstall skipifsilent
