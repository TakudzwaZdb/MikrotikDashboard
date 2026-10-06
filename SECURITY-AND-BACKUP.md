# Security, backups and keeping it running (laptop hosting)

## 1. Change the passwords (do this first)
**Dashboard admin** - sign in > Settings > *My account* > Change password (10+ characters). The password you set there is kept when the app restarts. (To force-reset it from `.env` instead: set `ADMIN_PASSWORD=...` and `ADMIN_RESET=true`, run `docker compose -f docker-compose.local.yml up -d`, then remove `ADMIN_RESET`.)

**Other people**: Settings > Users > add a *viewer* (read only), *operator* (can disconnect/block) or *admin*. Give staff viewer unless they need more.

**Router API user (`dashboard`)** - in Winbox > New Terminal:
```
/user set dashboard password="NEW_LONG_PASSWORD"
/user print
```
Put the same password in `.env` as `MIKROTIK_PASSWORD`, then `docker compose -f docker-compose.local.yml up -d`.
Remove router logins you do not use (`/user remove numbers=<n>`), and never use `admin` with an empty or old password. `/ip service print` should show `api` limited to the laptop's IP and **no** public access to `winbox`/`telnet`/`ftp`/`www` from the internet.

Also rotate `JWT_SECRET` and `DB_PASSWORD` if they were ever pasted anywhere (changing `DB_PASSWORD` after the first start needs `docker compose ... down -v` which wipes data - back up first and restore).

## 2. Backups
The database (voucher history, sessions, audit log, users) lives in a Docker volume on the laptop.
1. Run once by hand to test: open Command Prompt in the project folder and run `windows\backup.bat`. A file appears in `backups\`.
2. Optional cloud copy: edit `windows\backup.bat`, set `COPY_TO` to a folder that your Google Drive / OneDrive app syncs.
3. Schedule it daily at 02:00 (Command Prompt as Administrator):
```
schtasks /Create /SC DAILY /ST 02:00 /TN "EWZ Dashboard Backup" /TR "C:\apps\mikrotik-voucher-dashboard\windows\backup.bat"
```
4. Restore: `windows\restore.bat backups\dashboard_YYYY-MM-DD_HHMM.dump` (asks for confirmation, replaces current data).
The last 30 days of backups are kept automatically. Test a restore at least once.

## 3. Start by itself after a power cut or restart
- Docker Desktop > Settings > General > *Start Docker Desktop when you sign in*.
- ngrok as a Windows service: `ngrok service install --config "%LOCALAPPDATA%\ngrok\ngrok.yml"` then `ngrok service start` (Command Prompt as Administrator).
- Windows: Settings > System > Power > sleep = *Never* (plugged in), lid close = *Do nothing*; Settings > Accounts > Sign-in options > turn on automatic sign-in (or use a PIN) so the laptop reaches the desktop after a restart.
- Test: restart the laptop, wait 3 minutes, open the public address from your phone on mobile data.

## 4. Alerts
In `.env` fill `NOTIFY_TELEGRAM_TOKEN` + `NOTIFY_TELEGRAM_CHAT` (free Telegram bot) or `NOTIFY_WEBHOOK_URL` (e.g. WhatsApp via CallMeBot), then `docker compose -f docker-compose.local.yml up -d`. Settings > Alerts > *Send test message*. You will be messaged when the router goes offline (after 3 failed syncs) and when it is back, when a voucher reaches its data cap, and on medium/high security alerts.

## 5. Retire the old Render copy
It cannot reach the router, so it only ever shows "offline". In the Render dashboard open the `mikrotikdashboard3` web service > Settings > *Suspend Service* (or *Delete Web Service*), and also the `mikrotik-db` database if you will not use it. If the GitHub repo is public, make sure no `.env` or passwords were ever committed (Settings > Secrets shows nothing; check the repo files).
