@echo off
setlocal
rem Preparation only. Respect the existing PowerShell policy; never elevate.
powershell.exe -NoLogo -NoProfile -File "%~dp0Install-ScaleDriver.ps1" %*
set "DRIVER_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %DRIVER_EXIT%
