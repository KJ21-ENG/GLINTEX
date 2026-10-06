@echo off
setlocal
rem ExecutionPolicy applies only to this PowerShell process, not the PC settings.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-ScaleDriver.ps1" %*
set "DRIVER_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %DRIVER_EXIT%
