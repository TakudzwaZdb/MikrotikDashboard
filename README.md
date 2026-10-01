# MikroTik Voucher Dashboard - one application

One Node project (root `package.json`): the backend (`backend/`) serves both the API and the built website (`frontend/`).

```
npm install            # installs everything (backend + frontend)
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, MIKROTIK_*
npm run build          # builds the website into frontend/dist
npm start              # applies DB migrations, creates the admin user, starts on http://localhost:8080
```
Development (hot reload): `npm run dev` (API on :8080, website on :5173).
Hosting guides: LAPTOP-HOSTING.md, RENDER.md, DEPLOY.md.

---
# MikroTik Voucher Dashboard

Admin/monitoring layer over an existing **MikroTik Hotspot + Mikhmon** setup. MikroTik RouterOS is the source of truth for users, sessions and authentication. PostgreSQL only holds a cache, usage snapshots, alerts and audit logs. Mikhmon is never modified.

## Scope of this release
Included: full backend (RouterOS API, polling, snapshots, limit enforcement, block/disconnect/disable against the real router, heuristics, audit, JWT/RBAC, reports + CSV, Socket.IO) and a working React frontend (dashboard, vouchers, active users, devices, data usage, alerts, blocked devices, reports, audit, settings).
Not yet included: per-device detail page with charts (the API `GET /api/devices/:mac` is ready), per-voucher detail modal, custom-range pickers beyond Reports, and automated tests. Nothing has been run against a live router yet - see "First run checklist".

## 1. MikroTik preparation
```
/ip service set api-ssl disabled=no port=8729
/ip service set api disabled=yes            # use API-SSL only
/certificate add name=api-cert common-name=router.local days-valid=3650
/certificate sign api-cert
/ip service set api-ssl certificate=api-cert
/ip service set api-ssl address=<DASHBOARD_SERVER_IP>/32
```
For plain API (lab only): `/ip service set api disabled=no address=<DASHBOARD_IP>/32`, set `MIKROTIK_PORT=8728`, `MIKROTIK_USE_TLS=false`.

## 2. Dedicated API account (least privilege)
```
/user group add name=dashboard policy=api,read,write,test,policy,sensitive
/user add name=dashapi group=dashboard password=<STRONG> address=<DASHBOARD_SERVER_IP>/32
```
`write` is needed to disable users, remove active sessions and manage ip-bindings. Do not use `admin`.

## 3. Mikhmon compatibility
Keep using Mikhmon to generate vouchers. Every 10 s (`USAGE_POLL_INTERVAL`) the dashboard reads `/ip/hotspot/user`, so new vouchers appear automatically. Notes:
- Mikhmon stores expiry info in the user `comment` field; the dashboard never edits comments on users.
- Mikhmon "expire mode" scripts may remove/disable users themselves; removed users vanish from the cache but their usage history stays in PostgreSQL.
- Limits shown come from the user's `limit-uptime` / `limit-bytes-total` (set by Mikhmon profiles/vouchers). RouterOS enforces these natively; the dashboard also verifies and audits them.
- Counters: `bytes-in` = upload from the client, `bytes-out` = download to the client (RouterOS 6 and 7).

## 4. Wavlink AC1200 (AP/bridge mode)
Set to AP mode, disable its DHCP server and NAT, give it a static management IP in the MikroTik LAN, and plug its LAN port (not WAN) into the MikroTik hotspot bridge/interface. Because the Wavlink only bridges, the hotspot sees each client's real MAC.

## 5. PostgreSQL
```
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER dashboard WITH PASSWORD 'change_me';"
sudo -u postgres psql -c "CREATE DATABASE mikrotik_dashboard OWNER dashboard;"
```

## 6. Install and configure
```
cp .env.example .env     # fill in every value; JWT_SECRET: openssl rand -hex 32
npm install
npm run build            # builds the website
npm start                # migrate + create admin (ADMIN_USER / ADMIN_PASSWORD) + start on :8080
```
For development with hot reload: `npm run dev` (website on http://localhost:5173).

## 7. Production
`npm run build && npm start` serves the website and the API from one process on port 8080. Put nginx or a tunnel in front for HTTPS (WebSocket upgrade for `/socket.io`), run it with systemd or pm2, set `CORS_ORIGIN` to the real origin, keep PostgreSQL and the RouterOS API off the public internet. Or use Docker / Render (see DEPLOY.md, RENDER.md).

## 8. Block behaviour and limits
- Disconnect: removes the entry from `/ip/hotspot/active` and re-queries to confirm it is gone.
- Disable/Block voucher: sets `disabled=yes` on the hotspot user and verifies; block also disconnects.
- Block device: `/ip/hotspot/ip-binding type=blocked` by MAC. Phones with randomized/private MACs can evade this; blocking the voucher is more reliable.
- Suspicious activity: heuristics only (concurrent sessions, many MACs, frequent reconnects). It cannot reliably detect tethering because phone NAT hides downstream devices. Auto actions default off and only fire with 2+ indicators.
- RESET USAGE clears the router counters for one voucher (admin only, audited); historical snapshots are kept.

## 9. Troubleshooting
- MIKROTIK OFFLINE: check `/ip service`, firewall, API user `address=`, port, TLS setting; the error text is shown in the dashboard.
- Certificate errors: the client currently accepts the router's self-signed certificate; pin a CA if the dashboard is not on a trusted LAN.
- No vouchers: the API user needs `read`; confirm `/ip hotspot user print` returns rows.
- Login rate-limited: 10 attempts / 15 min per IP.

## 10. First run checklist
Test on a non-production router first: (1) Settings > TEST CONNECTION, (2) disable/enable a test voucher and check Winbox, (3) disconnect a test client, (4) block a test MAC and check `/ip hotspot ip-binding`. RouterOS field names can differ slightly between versions, so verify these against your build.

## Automatic 2.5 GB data cap
When a voucher's router counters (upload + download) reach `DATA_CAP_GB` (default 2.5 GiB), the backend, in this order and against the real router: disconnects the active session, disables (blocks) the voucher, optionally blocks the device MAC for `DATA_CAP_BLOCK_DEVICE_HOURS` (default 24, 0 = off), saves a final usage snapshot, then removes the hotspot user (`DATA_CAP_REMOVE_USER=true`). Every step is audited and raises a security alert, and the dashboard shows a red notice. Removal is permanent on the router; historical usage stays in PostgreSQL. Enforcement happens on each poll, so a fast user can overshoot by up to `USAGE_POLL_INTERVAL` seconds of traffic; lower it (minimum 3) for tighter control. Set `DATA_CAP_GB=0` to turn the cap off.

## Themes
Top bar: theme selector (Grafana Dark, Light, Midnight Blue, Nord, Terminal Green, High Contrast, Auto follows your OS, Day/Night switches at 07:00/19:00) and an accent colour picker. Changes apply instantly to the UI and to the charts, and are remembered in the browser (`localStorage`: `theme`, `accent`). To add a theme, add an entry to `THEMES` in `frontend/src/App.jsx`.
