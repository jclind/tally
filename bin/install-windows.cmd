@echo off
rem Runs install-windows.ps1 with the same options. PowerShell refuses .ps1 files on a new Windows PC; a .cmd isn't
rem held to that rule, so this is what the guide tells people to run.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
exit /b %errorlevel%
