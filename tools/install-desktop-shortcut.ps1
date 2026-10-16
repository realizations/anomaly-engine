# Creates "Anomaly Engine.lnk" on the desktop.
#
# The shortcut runs run.bat, which is the repository's existing from-scratch build and
# start. Deliberately not a second launcher with an incremental build check: a staleness
# test that gets it wrong ships a stale engine, and the user cannot tell the difference
# between "my change did not take" and "the build was skipped". Correct every time is
# worth more here than quick.
#
# ASCII only. Windows PowerShell 5.1 reads a script file without a BOM as ANSI, so a
# single em dash or smart quote in a comment becomes a parse error and the whole file
# fails to run.
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$bat = Join-Path $repo 'run.bat'
if (-not (Test-Path -LiteralPath $bat)) { throw "run.bat not found at $bat" }

$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'Anomaly Engine.lnk'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = $bat
$sc.WorkingDirectory = $repo
$sc.Description = 'Anomaly Engine - build and run'
$sc.Save()

Write-Output "Created: $link"
Write-Output "Runs:    $bat"