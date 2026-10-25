!ifndef MEMMY_WIN_PREVIEW_ROOT
  !error "Invoke: makensis -DMEMMY_WIN_PREVIEW_ROOT=/path/to/staged/windows/x64 create-preview-windows-x64.nsi"
!endif
!include "MUI2.nsh"
!include "x64.nsh"
Unicode true
CRCCheck on
Name "Memmy Turbo Preview (Windows x64)"
OutFile "${MEMMY_WIN_PREVIEW_ROOT}/Memmy-Turbo-Tauri-1.2.5-alpha.3-win11-x64-UNSIGNED-DEVELOPER-PREVIEW-Setup.exe"
InstallDir "$LOCALAPPDATA\MemmyTurboPreview"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This installer requires Windows 11 x64 or compatible Windows x64."
    Abort
  ${EndIf}
FunctionEnd
Section "Memmy Turbo Preview" SecMain
  SetOutPath "$INSTDIR"
  File "/oname=memmy-turbo-tauri.exe" "${MEMMY_WIN_PREVIEW_ROOT}/memmy-turbo-tauri.exe"
  SetOutPath "$INSTDIR\runtime"
  File /r "${MEMMY_WIN_PREVIEW_ROOT}/runtime/*"
  SetOutPath "$INSTDIR\browser-extension"
  File /r "${MEMMY_WIN_PREVIEW_ROOT}/browser-extension/*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Memmy Turbo Preview"
  CreateShortcut "$SMPROGRAMS\Memmy Turbo Preview\Memmy Turbo Preview.lnk" "$INSTDIR\memmy-turbo-tauri.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MemmyTurboTauriPreview" "DisplayName" "Memmy Turbo Preview (Developer Preview)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MemmyTurboTauriPreview" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MemmyTurboTauriPreview" "InstallLocation" "$INSTDIR"
SectionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\Memmy Turbo Preview\Memmy Turbo Preview.lnk"
  RMDir "$SMPROGRAMS\Memmy Turbo Preview"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MemmyTurboTauriPreview"
  RMDir /r "$INSTDIR"
SectionEnd
