# Installs tally as two scheduled tasks on Windows: the server, which starts when you sign in and restarts if it stops,
# and the daily sync at 7:00, which runs as soon as the PC is on if it was off then. Neither needs admin rights or
# opens a window.
# Usage: bin\install-windows.cmd, which runs this past PowerShell's script policy, with any of
#   [-HostName NAME[:PORT]] [-Port N] [-At HH:MM] [-Print] [-Restart] [-Remove]
#   -HostName  a hostname tally should answer to besides localhost, like your tailscale serve address
#   -Port      the local port, 3400 unless that one is taken
#   -At        when the daily sync runs, 07:00 unless you pick another time
#   -Print     show what would be installed and install nothing
#   -Restart   restart tally with the settings it has, after a git pull
#   -Remove    stop tally and remove both tasks; your data stays where it is
param([string]$HostName = "", [int]$Port = 3400, [string]$At = "07:00", [switch]$Print, [switch]$Restart, [switch]$Remove)
$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $PSScriptRoot
$TaskPath = "\tally\"
# One plain line instead of PowerShell's red error block.
function Fail($message, $code = 1) { [Console]::Error.WriteLine($message); exit $code }

$run = Join-Path $Dir "bin\run-windows.cmd"
# Stopping a task ends only the process it started, so end run-windows.cmd and the node under it too.
function Stop-Tally {
  foreach ($name in "tally", "tally-daily") {
    if (Get-ScheduledTask -TaskPath $TaskPath -TaskName $name -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskPath $TaskPath -TaskName $name }
  }
  Get-CimInstance Win32_Process -Filter "name='cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($run) } |
    ForEach-Object { taskkill.exe /T /F /PID $_.ProcessId | Out-Null }
}

$log = Join-Path $Dir "tally.log"
$dailyLog = Join-Path $Dir "tally-daily.log"
# Waits for tally to answer on its port. 127.0.0.1, since Windows PowerShell spends 2 seconds trying IPv6 for localhost.
function Wait-Tally($port, $done) {
  for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/status" -TimeoutSec 2 | Out-Null; Write-Output $done; exit 0 } catch { Start-Sleep -Seconds 1 }
  }
  Fail "tally didn't answer on port $port within 30 seconds. The end of $log says why."
  exit 1
}

if ($Restart) {
  if (-not (Get-ScheduledTask -TaskPath $TaskPath -TaskName "tally" -ErrorAction SilentlyContinue)) { Fail "tally isn't installed yet. Run this without -Restart first." }
  Stop-Tally
  Start-ScheduledTask -TaskPath $TaskPath -TaskName "tally"
  $p = (Get-Content (Join-Path $Dir "tally.env") | Where-Object { $_ -like "TALLY_PORT=*" }) -replace "TALLY_PORT=", ""
  Wait-Tally $p "tally restarted on http://localhost:$p."
}

if ($Remove) {
  Stop-Tally
  Get-ScheduledTask -TaskPath $TaskPath -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
  try { $s = New-Object -ComObject Schedule.Service; $s.Connect(); $s.GetFolder("\").DeleteFolder("tally", 0) } catch {}
  Write-Output "Removed the tally tasks. Your data is still in $Dir\data."
  exit 0
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "node not found. Install Node 24 or newer first." 1 }
$major = [int](& $node.Source -p "process.versions.node.split('.')[0]")
if ($major -lt 24) { Fail "tally needs Node 24 or newer; this is $(& $node.Source -v)." 1 }
if ($At -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { Fail "-At needs a 24-hour time, like 07:00." 2 }
# Windows doesn't use the file modes tally sets on Mac and Linux. Your user folder is private to you; most other
# places, like C:\tally, are readable by every account on the PC.
if (-not $Dir.StartsWith($HOME + "\", [StringComparison]::OrdinalIgnoreCase)) {
  Write-Warning "tally is in $Dir, outside your user folder ($HOME), so other accounts on this PC may be able to read your bank data. Move the tally folder into $HOME and run this again."
}

$page = if ($HostName) { "https://$HostName" } else { "http://localhost:$Port" }
$envLines = @("TALLY_PORT=$Port", "TALLY_PAGE_URL=$page")
if ($HostName) { $envLines += "TALLY_HOSTS=$HostName" }

# conhost --headless runs the console programs with no window. Handing it the .cmd file directly, quoted, keeps a path
# with spaces in it (C:\Users\Jane Doe\tally) whole; wrapping it in cmd /c "..." does not.
$conhost = Join-Path $env:SystemRoot "System32\conhost.exe"
$action = { param($what) New-ScheduledTaskAction -Execute $conhost -Argument "--headless `"$run`" $what" -WorkingDirectory $Dir }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
# Task Scheduler's defaults would stop the server after 3 days and skip both tasks on battery power.
$settings = { param($limit) New-ScheduledTaskSettingsSet -ExecutionTimeLimit $limit -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew }
$server = New-ScheduledTask -Action (& $action server) -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -Principal $principal -Settings (& $settings ([TimeSpan]::Zero)) -Description "tally's server, on http://localhost:$Port"
$daily = New-ScheduledTask -Action (& $action daily) -Trigger (New-ScheduledTaskTrigger -Daily -At $At) -Principal $principal -Settings (& $settings (New-TimeSpan -Minutes 30)) -Description "tally's daily sync and alerts"

if ($Print) {
  Write-Output "tally.env:"; $envLines | ForEach-Object { "  $_" }
  Write-Output "Task $($TaskPath)tally, at sign-in: $conhost $($server.Actions[0].Arguments)"
  Write-Output "Task $($TaskPath)tally-daily, daily at $($At): $conhost $($daily.Actions[0].Arguments)"
  exit 0
}

Set-Content -Path (Join-Path $Dir "tally.env") -Value $envLines -Encoding ascii
Stop-Tally
try {
  Register-ScheduledTask -TaskPath $TaskPath -TaskName "tally" -InputObject $server -Force | Out-Null
  Register-ScheduledTask -TaskPath $TaskPath -TaskName "tally-daily" -InputObject $daily -Force | Out-Null
} catch [Microsoft.Management.Infrastructure.CimException] {
  # Tasks made from an admin PowerShell can only be replaced from one.
  Fail "Windows refused to replace the tally tasks: $($_.Exception.Message) If you installed tally from an admin PowerShell before, run this from one again."
}
Start-ScheduledTask -TaskPath $TaskPath -TaskName "tally"
Wait-Tally $Port "tally is running at http://localhost:$Port, with the daily sync at $At. Logs: $log and $dailyLog"
