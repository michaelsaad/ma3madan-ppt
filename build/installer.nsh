; Ma3madan PPT installer additions.
!macro customInstall
  ; The phone remote: phones on the same network may reach the app (on any network: a hotspot or a
  ; new Wi-Fi is often "Public"), and only from that local network.
  ; Needs an installation for all users (admin); otherwise Windows asks once, the first time.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Ma3madan PPT"'
  ; Windows' own rules for it (a 'Block' from a dismissed prompt would win over any 'Allow').
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Ma3madan PPT" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any remoteip=localsubnet'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Ma3madan PPT"'
  ; It started with Windows (tray.js): not any more.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ma3madan PPT"
!macroend
