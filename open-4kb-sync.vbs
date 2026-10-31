' Keeps the Chrome that runs the 4KB sync open, for as long as Windows is on.
'
' That Chrome has its own folder, so it is a separate window from anyone's
' everyday Chrome: closing theirs does not touch it, and it holds the JSTERP
' sign-in and the extension in extension\. If it is closed or crashes, it is
' back within a minute. --restore-last-session keeps JSTERP signed in when
' Chrome restarts. To stop the sync for good, delete the "Rack Planner 4KB
' sync" shortcut from the Startup folder and sign out of Windows.

Const CHECK_EVERY = 60000

Dim shell, fso, wmi, chrome, profile
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")

chrome = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
If Not fso.FileExists(chrome) Then
  chrome = shell.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe"
End If
profile = shell.ExpandEnvironmentStrings("%LocalAppData%") & "\RackPlannerSync"

' One keeper is enough, however many times this was started.
Dim keepers
Set keepers = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'wscript.exe' " & _
  "AND CommandLine LIKE '%open-4kb-sync.vbs%'")
If keepers.Count > 1 Then WScript.Quit

Function Running()
  Dim found
  Set found = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'chrome.exe' " & _
    "AND CommandLine LIKE '%RackPlannerSync%'")
  Running = found.Count > 0
End Function

Do
  If Not Running() Then
    ' 7 = minimized, without taking the keyboard. False = do not wait.
    shell.Run """" & chrome & """ --user-data-dir=""" & profile & """ --restore-last-session " & _
      "--start-minimized --no-first-run --no-default-browser-check", 7, False
  End If
  WScript.Sleep CHECK_EVERY
Loop
