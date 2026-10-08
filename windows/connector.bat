@echo off
REM Runs the MikroTik connector and restarts it if it stops (crash, network change...).
REM Exit code 3 means another connector took over: do NOT restart then.
REM Double-click this file, or put a shortcut to it in shell:startup so it starts with Windows.
cd /d "%~dp0.."
title MikroTik Connector
:loop
echo [%date% %time%] starting connector...
call npm run connector
if %errorlevel%==3 (
  echo Another connector is running for this server. Stopping.
  pause
  exit /b 3
)
echo [%date% %time%] connector stopped, restarting in 5 s... (close this window to stop)
timeout /t 5 /nobreak >nul
goto loop
