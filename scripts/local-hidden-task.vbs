' Run the local site and its health check without a visible console window.
' WScript waits for the child so Task Scheduler still tracks the server lifetime.
Option Explicit
Dim shell, files, root, nodeExe, command, kind, quote, persist
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
nodeExe = "C:\Program Files\nodejs\node.exe"
quote = Chr(34)
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
kind = LCase(WScript.Arguments(0))
If kind = "server" Then
  command = quote & nodeExe & quote & " " & quote & root & "\scripts\local-server-launch.mjs" & quote
ElseIf kind = "watchdog" Then
  command = quote & nodeExe & quote & " " & quote & root & "\scripts\local-health-watchdog.mjs" & quote
ElseIf kind = "scanner" Then
  command = quote & nodeExe & quote & " " & quote & root & "\scripts\local-scan-runner.mjs" & quote
Else
  WScript.Quit 2
End If
WScript.Quit shell.Run(command, 0, True)
