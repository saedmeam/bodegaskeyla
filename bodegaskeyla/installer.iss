; --- BODEGAS KEYLA ENTERPRISE INSTALLER ---
; Optimized for Inno Setup 6+
; Logic: Bundles the win-unpacked output from electron-builder into a professional Setup.exe

#define AppName "BodegasKeyla"
#define AppVersion "1.0.6"
#define AppPublisher "Neu360"
#define AppURL "https://www.keyla.com.ec"
#define AppExeName "BodegasKeyla.exe"
#define AppId "{{0C7AE8E9-1736-4C5D-8E1E-1798305F8C7A}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DefaultGroupName={#AppName}
SourceDir=.
OutputDir=Output
OutputBaseFilename=BodegasKeyla_Setup_v{#AppVersion}
SetupIconFile=public\logo-keyla.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
CloseApplications=force
RestartApplications=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 1. Base Electron Application (Result of electron-builder: win-unpacked)
Source: "release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; 2. Extra Core Resources for Enterprise Printing & Encryption
Source: "encrypter-xuit.jar"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "PrintVeris.jar"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "config.json"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "C:\Program Files (x86)\JasperStarter\*"; DestDir: "{app}\JasperStarter"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "src\assets\reports\*"; DestDir: "{app}\resources\reports"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

; 3. Core Entry Points (Ensuring they are in the root for direct launch)
Source: "main.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "preload.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "printer.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "encryptionService.js"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; IconFilename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not RegKeyExists(HKLM, 'SOFTWARE\JavaSoft\Java Runtime Environment') and
     not RegKeyExists(HKLM, 'SOFTWARE\JavaSoft\JDK') and
     not RegKeyExists(HKLM64, 'SOFTWARE\JavaSoft\Java Runtime Environment') and
     not RegKeyExists(HKLM64, 'SOFTWARE\JavaSoft\JDK') then
  begin
    if MsgBox('Keyla requiere Java para funciones de encriptación.' + #13#10#13#10 +
              'No se detectó Java automáticamente. ¿Desea continuar con la instalación?',
              mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;

[Messages]
spanish.WelcomeLabel2=Este proceso instalará {#AppName} en su sistema empresarial.%n%nSe recomienda cerrar todas las demás aplicaciones antes de continuar.
