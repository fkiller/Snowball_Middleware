#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif

[Setup]
AppId=local.snowball.middleware
AppName=Snowball Middleware
AppVersion={#AppVersion}
AppPublisher=Snowball
DefaultDirName={localappdata}\Programs\Snowball Middleware
DefaultGroupName=Snowball Middleware
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=SnowballMiddlewareSetup-{#AppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#SourceDir}\resources\app\assets\icon.ico
WizardImageFile={#SourceDir}\resources\app\assets\installer-welcome.bmp
WizardSmallImageFile={#SourceDir}\resources\app\assets\installer-small.bmp
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\SnowballMiddleware.exe

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

#ifdef PrivateTailscaleBundle
[Tasks]
Name: "tailscale"; Description: "Install Tailscale (optional; administrator approval and login required)"; Flags: unchecked

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var ResultCode: Integer; Params: String;
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('tailscale') then begin
    Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\resources\app\scripts\tailscale-install-windows.ps1') + '" -Action Install -MsiPath "' + ExpandConstant('{app}\resources\app\third-party\tailscale\tailscale-setup-1.104.5-amd64.msi') + '"';
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      MsgBox('Tailscale setup could not be started. Snowball remains installed; check Tailscale separately.', mbError, MB_OK)
    else if ResultCode <> 0 then
      MsgBox('Tailscale setup was not completed. Existing Tailscale settings were preserved; check Tailscale separately.', mbError, MB_OK)
    else
      MsgBox('Tailscale setup finished or an existing installation was retained. Open Tailscale and sign in if needed. Snowball remote pairing is not yet available.', mbInformation, MB_OK);
  end;
end;
#endif

[Icons]
Name: "{userprograms}\Snowball Middleware"; Filename: "{app}\SnowballMiddleware.exe"; IconFilename: "{app}\SnowballMiddleware.exe"; AppUserModelID: "local.snowball.middleware"

[Run]
Filename: "{app}\SnowballMiddleware.exe"; Description: "Launch Snowball Middleware"; Flags: nowait postinstall skipifsilent
