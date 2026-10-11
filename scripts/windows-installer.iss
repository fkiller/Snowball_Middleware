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

[Icons]
Name: "{userprograms}\Snowball Middleware"; Filename: "{app}\SnowballMiddleware.exe"; IconFilename: "{app}\SnowballMiddleware.exe"; AppUserModelID: "local.snowball.middleware"

[Run]
Filename: "{app}\SnowballMiddleware.exe"; Description: "Launch Snowball Middleware"; Flags: nowait postinstall skipifsilent
