; --- BODEGAS KEYLA ENTERPRISE INSTALLER v1.2.0 ---
; Optimized for Inno Setup 6+
; Logic: Bundles the win-unpacked output from electron-builder into a professional Setup.exe

#define AppName "BodegasKeyla"
#define AppVersion "1.2.0"
#define AppPublisher "Farmacias Keyla - Neu360 solutions"
#define AppURL "https://www.keyla.com.ec"
#define AppExeName "BodegasKeyla.exe"
#define AppId "{{com.neu360.bodegaskeyla}"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
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
OutputDir=Output
OutputBaseFilename=BodegasKeyla_v{#AppVersion}_Setup
SetupIconFile=public\favicon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
; Enterprise Standards: Require admin for Program Files
PrivilegesRequired=admin
CloseApplications=force

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 1. Base Electron Application (Result of electron-builder: win-unpacked)
Source: "release\win-unpacked\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; 2. Extra Core Resources (Ensuring they are in \resources where Electron expects them)
Source: "encrypter-xuit.jar"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "config.json"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "public\app_icon.png"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; IconFilename: "{app}\{#AppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Verificar Java al inicio para informar al usuario
function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  // Intento de detección simple de Java en el Registro
  if not RegKeyExists(HKLM, 'SOFTWARE\JavaSoft\Java Runtime Environment') and
     not RegKeyExists(HKLM, 'SOFTWARE\JavaSoft\JDK') and
     not RegKeyExists(HKLM64, 'SOFTWARE\JavaSoft\Java Runtime Environment') and
     not RegKeyExists(HKLM64, 'SOFTWARE\JavaSoft\JDK') then
  begin
    if MsgBox('Keyla requiere Java para funciones de encriptación.' + #13#10#13#10 +
              'No se detectó Java automáticamente. ¿Desea continuar con la instalación? (Debe instalar Java manualmente si el sistema falla)',
              mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;

[Messages]
spanish.WelcomeLabel2=Este proceso instalará {#AppName} {#AppVersion} en su sistema empresarial.%n%nSe recomienda cerrar todas las demás aplicaciones antes de continuar.
