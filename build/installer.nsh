; REX — the "already installed" page of the Windows installer.
;
; electron-builder includes this file by name: `nsis.include` defaults to
; `build/installer.nsh`, so `electron-builder.yml` carries no key for it.
;
; It is compiled BEFORE electron-builder's own templates, so nothing at the top
; level of this file may name a variable those templates declare. Everything
; that does lives inside the `customWelcomePage` macro, which the assisted
; installer expands as its first page — after `multiUser.nsh` has declared
; `$hasPerUserInstallation` and `$hasPerMachineInstallation`, and after
; `.onInit` has filled them from the registry and pointed `$INSTDIR` at the
; installed copy.
;
; What the page does. When REX is already installed it offers two choices:
; Reinstall, the default, which is also the repair — every file is replaced
; and the settings in the home folder stay — and Uninstall, which runs the
; installed uninstaller in its own wizard and then closes the setup. On a
; machine without REX the page is skipped, so a first install looks exactly as
; it did before this file existed.
;
; Why the uninstaller is copied out first. It deletes the folder it lives in,
; so it cannot run from there. electron-builder makes the same copy when it
; replaces an old version (`uninstallOldVersion` in `include/installUtil.nsh`).
; The one difference is the `/S` flag: electron-builder runs it silent, and
; this page does not — the person chose Uninstall, and sees the uninstaller's
; own Welcome, progress and Finish pages.

!include nsDialogs.nsh
!include LogicLib.nsh

!macro customWelcomePage
  Var rexPageDialog
  Var rexPageReinstall
  Var rexPageUninstall

  Page custom rexPageCreate rexPageLeave

  Function rexPageCreate
    ; A first install has nothing to choose. Abort in a creator skips the page.
    ${If} $hasPerUserInstallation != "1"
    ${AndIf} $hasPerMachineInstallation != "1"
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "REX is already installed" "Choose what to do with the copy on this computer."

    nsDialogs::Create 1018
    Pop $rexPageDialog
    ${If} $rexPageDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "REX ${VERSION} is already installed in:$\r$\n$INSTDIR"
    Pop $0

    ${NSD_CreateRadioButton} 0 34u 100% 12u "&Reinstall REX"
    Pop $rexPageReinstall
    ; WS_GROUP on the first button makes the two of them one group, so
    ; checking one unchecks the other and the arrow keys move between them.
    ${NSD_AddStyle} $rexPageReinstall ${WS_GROUP}
    ${NSD_CreateLabel} 14u 47u -14u 20u "Replaces every file and keeps your settings. Use this to repair a copy that does not start."
    Pop $0

    ${NSD_CreateRadioButton} 0 74u 100% 12u "&Uninstall REX"
    Pop $rexPageUninstall
    ${NSD_CreateLabel} 14u 87u -14u 20u "Removes REX from this computer. Your documents, and the REX data in your home folder, stay."
    Pop $0

    ${NSD_Check} $rexPageReinstall
    nsDialogs::Show
  FunctionEnd

  Function rexPageLeave
    ${NSD_GetState} $rexPageUninstall $0
    ${If} $0 != ${BST_CHECKED}
      Return
    ${EndIf}

    CopyFiles /SILENT "$INSTDIR\${UNINSTALL_FILENAME}" "$PLUGINSDIR\rex-uninstaller.exe"
    ${IfNot} ${FileExists} "$PLUGINSDIR\rex-uninstaller.exe"
      MessageBox MB_OK|MB_ICONEXCLAMATION "The uninstaller was not found in $INSTDIR. Use Settings > Apps to remove REX."
      Abort
    ${EndIf}

    ${If} $hasPerUserInstallation == "1"
      StrCpy $1 "/currentuser"
    ${Else}
      StrCpy $1 "/allusers"
    ${EndIf}

    ; One wizard on screen at a time. `_?=` tells the uninstaller where REX
    ; is and keeps it from copying itself to a temp folder and returning at
    ; once, so ExecWait really waits for it.
    HideWindow
    ExecWait '"$PLUGINSDIR\rex-uninstaller.exe" $1 _?=$INSTDIR' $2
    ${If} $2 != 0
      BringToFront
      MessageBox MB_OK|MB_ICONEXCLAMATION "The uninstaller did not finish (code $2). REX is still installed."
      Abort
    ${EndIf}
    Quit
  FunctionEnd
!macroend
