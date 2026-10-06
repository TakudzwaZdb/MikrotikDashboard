@echo off
REM Daily database backup for the laptop-hosted dashboard. Run by hand or schedule it (see SECURITY-AND-BACKUP.md).
REM Optional: set COPY_TO to a folder that syncs to the cloud, e.g. your Google Drive folder:  set "COPY_TO=%USERPROFILE%\Google Drive\EWZ-backups"
set "COPY_TO="
cd /d "%~dp0.."
if not exist backups mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
set "FILE=backups\dashboard_%STAMP%.dump"
docker compose -f docker-compose.local.yml exec -T db pg_dump -U dashboard -d mikrotik_dashboard -Fc > "%FILE%"
if errorlevel 1 ( echo BACKUP FAILED & del "%FILE%" 2>nul & exit /b 1 )
for %%A in ("%FILE%") do if %%~zA LSS 1000 ( echo BACKUP FAILED - file is empty & del "%FILE%" & exit /b 1 )
echo Backup saved: %FILE%
if defined COPY_TO ( if not exist "%COPY_TO%" mkdir "%COPY_TO%" & copy /y "%FILE%" "%COPY_TO%" >nul & echo Copied to %COPY_TO% )
REM keep the last 30 days
forfiles /p backups /m *.dump /d -30 /c "cmd /c del @path" 2>nul
exit /b 0
