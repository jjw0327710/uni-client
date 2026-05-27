; Delete session data on uninstall so login doesn't persist after reinstall
!macro customUnInstall
  Delete "$APPDATA\UNI Client\session.json"
  Delete "$APPDATA\uni-client\session.json"
!macroend
