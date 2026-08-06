Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "node server.js", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:3001/app-v5.html"
