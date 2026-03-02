$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$desktopDist = Join-Path $root 'desktop-dist'
$artifactDir = Join-Path $root 'release-artifacts'
$wixObjDir = Join-Path $root 'wixobj'
$installerDir = Join-Path $root 'installers'

New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
New-Item -ItemType Directory -Force -Path $wixObjDir | Out-Null
New-Item -ItemType Directory -Force -Path $installerDir | Out-Null

$appDir = Get-ChildItem -Path $desktopDist -Directory -Recurse |
    Where-Object { Test-Path (Join-Path $_.FullName 'resources.neu') } |
    Select-Object -First 1

if (-not $appDir) {
    throw "Unable to locate Neutralino app directory containing resources.neu under: $desktopDist"
}

$exe = Get-ChildItem -Path $appDir.FullName -Filter '*.exe' -File -Recurse |
    Where-Object { $_.Name -notmatch 'setup|unins|installer' } |
    Select-Object -First 1

if (-not $exe) {
  $exe = Get-ChildItem -Path $desktopDist -Filter '*.exe' -File -Recurse |
    Where-Object { $_.FullName -notmatch 'release-artifacts|installers|wixobj' } |
    Where-Object { $_.Name -notmatch 'setup|unins|installer' } |
    Select-Object -First 1
}

if (-not $exe) {
  throw "Unable to locate Windows executable under: $desktopDist"
}

$appVersion = if ($env:GITHUB_REF_NAME) { $env:GITHUB_REF_NAME.TrimStart('v') } else { '1.0.0' }

$innoScript = @"
[Setup]
AppId={{79D7A952-62D7-4A6B-9D9A-9E53E2F4E8A1}}
AppName=Monochrome+
AppVersion=$appVersion
AppPublisher=Monochrome+ Team
DefaultDirName={autopf}\Monochrome+
DefaultGroupName=Monochrome+
OutputDir=$artifactDir
OutputBaseFilename=MonochromePlus-$appVersion-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "$($appDir.FullName)\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Monochrome+"; Filename: "{app}\$($exe.Name)"
Name: "{autodesktop}\Monochrome+"; Filename: "{app}\$($exe.Name)"

[Run]
Filename: "{app}\$($exe.Name)"; Description: "Launch Monochrome+"; Flags: nowait postinstall skipifsilent
"@

$innoPath = Join-Path $installerDir 'monochrome.iss'
Set-Content -Path $innoPath -Value $innoScript -Encoding UTF8

$wixProduct = @"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="Monochrome+" Language="1033" Version="$appVersion" Manufacturer="Monochrome+ Team" UpgradeCode="5A03B1E8-78A1-4AE7-B70D-56E9ABF77E9F">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of Monochrome+ is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <Feature Id="MainFeature" Title="Monochrome+" Level="1">
      <ComponentGroupRef Id="AppFiles" />
    </Feature>

    <Property Id="WIXUI_INSTALLDIR" Value="INSTALLDIR" />
    <UIRef Id="WixUI_InstallDir" />
  </Product>

  <Fragment>
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="Monochrome+" />
      </Directory>
    </Directory>
  </Fragment>
</Wix>
"@

$wixProductPath = Join-Path $installerDir 'Product.wxs'
$wixFilesPath = Join-Path $installerDir 'AppFiles.wxs'
Set-Content -Path $wixProductPath -Value $wixProduct -Encoding UTF8

$heatCmd = Get-Command heat.exe -ErrorAction SilentlyContinue
$candleCmd = Get-Command candle.exe -ErrorAction SilentlyContinue
$lightCmd = Get-Command light.exe -ErrorAction SilentlyContinue
$isccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue

$heatExe = if ($heatCmd) { $heatCmd.Source } else { $null }
$candleExe = if ($candleCmd) { $candleCmd.Source } else { $null }
$lightExe = if ($lightCmd) { $lightCmd.Source } else { $null }
$isccExe = if ($isccCmd) { $isccCmd.Source } else { $null }

if (-not $heatExe -or -not $candleExe -or -not $lightExe) {
    throw 'WiX toolset binaries are missing (heat.exe/candle.exe/light.exe).'
}

if (-not $isccExe) {
    throw 'Inno Setup compiler (ISCC.exe) is missing.'
}

$sourceDir = $appDir.FullName
$wixObjOutDir = Join-Path $wixObjDir ''

& $isccExe $innoPath

& $heatExe dir $sourceDir -cg AppFiles -dr INSTALLDIR -gg -srd -sfrag -sreg -var var.SourceDir -out $wixFilesPath
& $candleExe "-dSourceDir=$sourceDir" -out $wixObjOutDir $wixProductPath $wixFilesPath
& $lightExe -ext WixUIExtension -out (Join-Path $artifactDir "MonochromePlus-$appVersion.msi") "$wixObjDir\Product.wixobj" "$wixObjDir\AppFiles.wixobj"

Get-ChildItem -Path $artifactDir
