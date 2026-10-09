; Inno Setup kurulum betiği: iscc /DSurum=0.1.0 packaging\kurulum.iss
; Yönetici yetkisi istemez (kullanıcının kendi klasörüne kurar); ofis bilgisayarlarında da kurulabilir.
#ifndef Surum
  #define Surum "0.0.0"
#endif

[Setup]
AppId={{8C6E5E2B-3B8F-4D6B-9A41-6F2C1D0B7A51}
AppName=Parsel Sorgu +
AppVersion={#Surum}
AppPublisher=Parsel Sorgu +
DefaultDirName={autopf}\Parsel Sorgu Plus
DefaultGroupName=Parsel Sorgu +
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ParselSorguPlus-Kurulum-{#Surum}
SetupIconFile=ParselSorgu.ico
UninstallDisplayIcon={app}\ParselSorguPlus.exe
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "masaustu"; Description: "Masaüstüne kısayol oluştur"; GroupDescription: "Kısayollar:"

[Files]
Source: "..\dist\ParselSorguPlus\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Parsel Sorgu +"; Filename: "{app}\ParselSorguPlus.exe"
Name: "{autodesktop}\Parsel Sorgu +"; Filename: "{app}\ParselSorguPlus.exe"; Tasks: masaustu

[Run]
Filename: "{app}\ParselSorguPlus.exe"; Description: "Parsel Sorgu +'yı şimdi aç"; Flags: nowait postinstall skipifsilent
