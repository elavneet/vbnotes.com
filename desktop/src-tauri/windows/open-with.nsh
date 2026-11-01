; "Open with › VB Notes" for markdown and text files. Only the Open with list: unlike
; bundle.fileAssociations, this never makes VB Notes the default app for .txt or .md.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\VBNotes.Note" "" "Note"
  WriteRegStr SHCTX "Software\Classes\VBNotes.Note\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\VBNotes.Note\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "VBNotes.Note" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "VBNotes.Note" ""
  WriteRegStr SHCTX "Software\Classes\.txt\OpenWithProgids" "VBNotes.Note" ""
  ; Tells Explorer the list changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "VBNotes.Note"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "VBNotes.Note"
  DeleteRegValue SHCTX "Software\Classes\.txt\OpenWithProgids" "VBNotes.Note"
  DeleteRegKey SHCTX "Software\Classes\VBNotes.Note"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
