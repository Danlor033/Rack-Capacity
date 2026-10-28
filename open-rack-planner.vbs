' Opens Rack Planner, starting its server first if nothing is serving.
'
' Windows runs this with no console window. The server it starts keeps
' running after this script exits, and serves the folder this file sits in,
' so the whole thing can be moved without editing anything.

Const PORT = 8794

Dim shell, fso, folder, url, serving, http
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:" & PORT & "/"

' Is a server already answering? Asking is cheaper than guessing, and it
' keeps a second copy from fighting over the port.
serving = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.open "GET", url & "index.html", False
http.send
If Err.Number = 0 Then
  If http.status = 200 Then serving = True
End If
Err.Clear
On Error GoTo 0

If Not serving Then
  ' 0 = no window. False = do not wait; the server outlives this script.
  shell.Run "pythonw """ & folder & "\serve.py""", 0, False

  ' Give it a moment to take the port before the browser asks for a page.
  Dim tries
  For tries = 1 To 20
    WScript.Sleep 250
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.open "GET", url & "index.html", False
    http.send
    If Err.Number = 0 Then
      If http.status = 200 Then Exit For
    End If
    Err.Clear
    On Error GoTo 0
  Next
End If

shell.Run url, 1, False
