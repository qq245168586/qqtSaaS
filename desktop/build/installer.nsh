; Recover known legacy installs, including the reported 2.1.7 update failure.
; Windows 2.1.0-2.1.4 shipped an uninstaller that could not remove locked
; Electron files. Rescue those installs without touching the user's AppData.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

Var tmyRescueInstallDir
Var tmyRescueNeeded

!macro TmyManagerFindProcess _RESULT
  !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" ${_RESULT}
!macroend

!macro TmyManagerForceClose
  DetailPrint "正在关闭运行中的 ${PRODUCT_NAME}..."
  !insertmacro nsProcess::CloseProcess "${APP_EXECUTABLE_FILENAME}" $R0
  Sleep 300
  !insertmacro nsProcess::KillProcess "${APP_EXECUTABLE_FILENAME}" $R0
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R0
  Sleep 800
!macroend

!macro TmyManagerMarkBrokenInstall _ROOT_KEY
  ReadRegStr $R0 ${_ROOT_KEY} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $R2 ${_ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCpy $R3 "0"
  ${If} $R0 != ""
    ${IfNot} ${FileExists} "$R0\${UNINSTALL_FILENAME}"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.0.0"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.1.0"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.1.1"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.1.2"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.1.3"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.1.4"
      StrCpy $R3 "1"
    ${ElseIf} $R2 == "2.1.7"
      StrCpy $R3 "1"
    ${EndIf}
  ${EndIf}

  ${If} $R3 == "1"
    ; Keep InstallLocation so the repaired version installs in the same place.
    ; Remove only the bad uninstall command so electron-builder does not invoke it.
    StrCpy $tmyRescueInstallDir "$R0"
    StrCpy $tmyRescueNeeded "1"
    ClearErrors
    DeleteRegKey ${_ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"
    ${If} "${_ROOT_KEY}" == "HKLM"
    ${AndIf} ${Errors}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_TOPMOST "检测到旧版本的卸载记录已经损坏。点击“确定”后 Windows 会弹出权限确认，请选择“是”，安装器将修复记录并继续。" /SD IDCANCEL IDOK +3
      SetErrorLevel 1003
      Quit
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '$SYSDIR\reg.exe' -ArgumentList 'DELETE','HKLM\${UNINSTALL_REGISTRY_KEY}','/f','/reg:64' -Verb RunAs -WindowStyle Hidden -Wait"`
      Pop $R1
    ${EndIf}
    ClearErrors
  ${EndIf}
!macroend

!macro preInit
  ; Older clients already pass --updated but do not pass /S. Ensure that
  ; upgrading from those clients also skips the installation wizard.
  !ifndef BUILD_UNINSTALLER
    ${If} ${isUpdated}
      SetSilent silent
    ${EndIf}
  !endif
  StrCpy $tmyRescueInstallDir ""
  StrCpy $tmyRescueNeeded "0"
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}
  !insertmacro TmyManagerMarkBrokenInstall HKCU
  !insertmacro TmyManagerMarkBrokenInstall HKLM
!macroend

!macro TmyManagerReplaceBrokenInstall
  ${If} $tmyRescueNeeded == "1"
  ${AndIf} $tmyRescueInstallDir != ""
    ; Only remove a directory that still looks like this application's install.
    ${If} ${FileExists} "$tmyRescueInstallDir\${APP_EXECUTABLE_FILENAME}"
    ${OrIf} ${FileExists} "$tmyRescueInstallDir\${UNINSTALL_FILENAME}"
      DetailPrint "正在修复旧版本安装目录..."
      RMDir /r /REBOOTOK "$tmyRescueInstallDir.rescue-old"
      ClearErrors
      Rename "$tmyRescueInstallDir" "$tmyRescueInstallDir.rescue-old"
      ${If} ${Errors}
        ClearErrors
        RMDir /r "$tmyRescueInstallDir"
        ${If} ${FileExists} "$tmyRescueInstallDir\${APP_EXECUTABLE_FILENAME}"
          MessageBox MB_RETRYCANCEL|MB_ICONSTOP|MB_TOPMOST "旧版本文件仍被 Windows 占用。请允许安装器关闭应用后点击“重试”，无需手动删除目录。" /SD IDCANCEL IDRETRY tmy_manager_retry_cleanup IDCANCEL tmy_manager_cleanup_cancelled
        ${EndIf}
      ${Else}
        RMDir /r /REBOOTOK "$tmyRescueInstallDir.rescue-old"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Goto tmy_manager_cleanup_done

  tmy_manager_retry_cleanup:
    !insertmacro TmyManagerForceClose
    ClearErrors
    RMDir /r "$tmyRescueInstallDir"
    ${If} ${FileExists} "$tmyRescueInstallDir\${APP_EXECUTABLE_FILENAME}"
      MessageBox MB_RETRYCANCEL|MB_ICONSTOP|MB_TOPMOST "Windows 仍未释放旧版本文件。请在权限确认窗口中选择“是”，然后点击“重试”。" /SD IDCANCEL IDRETRY tmy_manager_retry_cleanup IDCANCEL tmy_manager_cleanup_cancelled
    ${EndIf}
    Goto tmy_manager_cleanup_done

  tmy_manager_cleanup_cancelled:
    SetErrorLevel 1001
    Quit

  tmy_manager_cleanup_done:
!macroend

!macro customCheckAppRunning
  !insertmacro TmyManagerForceClose
  !insertmacro TmyManagerFindProcess $R0
  ${If} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_TOPMOST "检测到 ${PRODUCT_NAME} 仍在后台运行。点击“确定”后 Windows 会弹出权限确认，请选择“是”，安装器将关闭旧版本后继续安装。" /SD IDCANCEL IDOK tmy_manager_elevated_close IDCANCEL tmy_manager_close_cancelled
  ${Else}
    Goto tmy_manager_close_done
  ${EndIf}

  tmy_manager_elevated_close:
    DetailPrint "正在请求 Windows 权限以关闭 ${PRODUCT_NAME}..."
    nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '$SYSDIR\taskkill.exe' -ArgumentList '/F','/T','/IM','${APP_EXECUTABLE_FILENAME}' -Verb RunAs -WindowStyle Hidden -Wait"`
    Pop $R0
    Sleep 1000

    !insertmacro TmyManagerFindProcess $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONSTOP|MB_TOPMOST "Windows 仍未能关闭 ${PRODUCT_NAME}。请在权限确认窗口中选择“是”，然后点击“重试”。" /SD IDCANCEL IDRETRY tmy_manager_elevated_close IDCANCEL tmy_manager_close_cancelled
    ${EndIf}
    Goto tmy_manager_close_done

  tmy_manager_close_cancelled:
    SetErrorLevel 1002
    Quit

  tmy_manager_close_done:
    !insertmacro TmyManagerReplaceBrokenInstall
!macroend
