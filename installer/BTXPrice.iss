#define MyAppName "Biotex Price"
#define MyAppVersion "1.1.4"

[Setup]
AppId={{B6C94DBB-BAAD-44D5-8230-CA430817A0AB}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\Programs\BTXPrice
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
UsePreviousTasks=no
OutputDir=..\dist
OutputBaseFilename=BTXPrice-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\app.ico
UninstallDisplayIcon={app}\Biotex Price.exe
#ifdef SIGNED_RELEASE
SignTool=btx
SignedUninstaller=yes
#endif

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstüne kısayol ekle"; GroupDescription: "Ek seçenekler:"; Flags: unchecked

[Files]
Source: "..\build\desktop\Biotex Price-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Biotex Price"; Filename: "{app}\Biotex Price.exe"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{userdesktop}\Biotex Price"; Filename: "{app}\Biotex Price.exe"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\Biotex Price.exe"; Description: "Biotex Price uygulamasını aç"; Flags: postinstall nowait skipifsilent
