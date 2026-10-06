@echo off
REM Restore a backup:  windows\restore.bat backups\dashboard_2026-10-06_0200.dump   (replaces the current data!)
if "%~1"=="" ( echo Usage: windows\restore.bat backups\FILE.dump & exit /b 1 )
cd /d "%~dp0.."
set /p OK=This REPLACES all current data with %~1. Type YES to continue: 
if /i not "%OK%"=="YES" exit /b 1
docker compose -f docker-compose.local.yml exec -T db pg_restore -U dashboard -d mikrotik_dashboard --clean --if-exists --no-owner < "%~1"
echo Done. Restart the app: docker compose -f docker-compose.local.yml restart app
