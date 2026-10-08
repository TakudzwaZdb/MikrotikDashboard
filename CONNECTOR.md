# Render + laptop connector (router behind another router)

```
 MikroTik  <-- RouterOS API (LAN) -->  Laptop: "npm run connector"  --- outgoing websocket --->  Render (website, database, logins)
```
Render never connects to the router, so there is nothing to time out. The laptop does the router work; Render stores history, enforces the data cap and shows the dashboard. **The laptop must stay on and online** (if it is off the dashboard shows ROUTER OFFLINE, the hotspot itself keeps working).

## 1. Render (Environment tab)
| Variable | Value |
|---|---|
| `CONNECTOR_MODE` | `true` |
| `CONNECTOR_TOKEN` | a long random text (e.g. 40+ characters). Same value goes on the laptop |
| `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD` | as before |
| `DATA_CAP_GB`, `DATA_CAP_*` | as before (the cap is enforced by Render, through the connector) |

Not needed on Render any more: `MIKROTIK_HOST/PORT/USERNAME/PASSWORD/USE_TLS`. Save, then wait for the redeploy.

## 2. Router (Winbox > New Terminal), once
```
/ip service set api address=LAPTOP_LAN_IP/32 disabled=no port=8728
/user group add name=dashboard policy=read,write,api,test,sensitive
/user add name=dashboard group=dashboard password="STRONG_PASSWORD" address=LAPTOP_LAN_IP/32
```
(Give the laptop a static DHCP lease so LAPTOP_LAN_IP never changes.)

## 3. Laptop
1. Install Node.js 18+ (nodejs.org, LTS).
2. Unzip the project, open Command Prompt in the folder, run `npm install`.
3. `copy .env.connector.example .env`, then `notepad .env` and fill in `RENDER_URL`, `CONNECTOR_TOKEN`, `MIKROTIK_HOST/PORT/USERNAME/PASSWORD`, `MIKROTIK_USE_TLS=false` (port 8728).
4. Start it: `npm run connector`, or double-click `windows\connector.bat` (restarts itself if it stops; put a shortcut in `shell:startup` to start with Windows).
5. Windows Settings > Power: sleep = **Never** while plugged in; lid close = Do nothing.

A healthy start looks like:
```
CONNECTED TO RENDER (socket ...)
Router OK - <router name> (N vouchers, M online). Sending to Render.
```
Run **only one** connector. A second one makes the first one stop (on purpose).
The laptop needs no database and no JWT_SECRET. Keep your real `.env` private (never upload it to GitHub).

## Troubleshooting (the dashboard and the connector window now print the reason)
| Message | Meaning / fix |
|---|---|
| `TIMEOUT: the router did not answer at ...` | Laptop cannot reach the router API. `ping` the router; check `/ip service print` (api enabled, port, "available from" includes the laptop IP). **Port 8728 needs `MIKROTIK_USE_TLS=false`; 8729 needs `true`. A mismatch looks exactly like a timeout.** |
| `Router refused the connection` | API service disabled or other port. |
| `Router rejected the login` | Wrong `MIKROTIK_USERNAME` / `MIKROTIK_PASSWORD`, or the user's group lacks api/read/write. |
| `Cannot connect to Render: connector unauthorized` | `CONNECTOR_TOKEN` differs between laptop and Render (or is not set on Render). |
| `Cannot connect to Render: xhr poll error / ENOTFOUND` | Wrong `RENDER_URL`, or no internet. A sleeping free Render service needs ~1 minute to wake up; the connector keeps retrying. |
| `The laptop connector is not connected to this server` | The connector is not running, or the laptop is off/offline. |
| `The laptop connector is an old version` | Update the project on the laptop (this version) and restart. |
| `Database problem: ...` | Router data is live but PostgreSQL on Render is unreachable (free Render databases expire after ~30 days; create a new one or use Neon/Supabase and update `DATABASE_URL`). |

## Free Render limits
A free web service sleeps after ~15 min without visits. The connector pings `/health` every 10 minutes to keep it awake (best effort, not guaranteed by Render); data-cap enforcement only works while Render is awake. For reliable monitoring use a paid always-on instance.
