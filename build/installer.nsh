; Ma3madan PPT installer additions.
!macro customInstall
  ; The phone remote: phones on the local network may reach the app (private networks only).
  ; Needs an installation for all users (admin); otherwise Windows asks once, the first time.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Ma3madan PPT"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Ma3madan PPT" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Ma3madan PPT"'
!macroend
