@echo off
rem Task Scheduler runs this, as bin\install-windows.ps1 set it up. "server" keeps tally running and starts it again
rem 5 seconds after it stops; "daily" runs the morning sync once. Settings come from tally.env. The server's output goes
rem to tally.log and the sync's to tally-daily.log, since Windows won't let two programs append to one log at once.
cd /d "%~dp0.."
if "%~1"=="daily" (
  node --env-file-if-exists=tally.env bin\daily.mjs >> tally-daily.log 2>&1
  exit /b
)
:loop
node --env-file-if-exists=tally.env server.mjs >> tally.log 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
