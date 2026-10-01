# Host the dashboard on the Windows laptop + free public web address

The laptop sits on the router's network, so the app talks to the router directly (no VPN/SSH tunnel, no Oracle account). A tunnel program gives it a public https address. The laptop must stay **on, awake, online**. If it is off, the website is unreachable and the router is not monitored (the hotspot itself keeps working).

## 1. Router (Winbox > New Terminal) - skip what you already did
Give the laptop a static lease (IP > DHCP Server > Leases > Make Static), then:
```
/ip service set api address=LAPTOP_LAN_IP/32 disabled=no port=8728
/ip service set api-ssl disabled=yes
/user group add name=dashboard policy=read,write,api,test,sensitive
/user add name=dashboard group=dashboard password="STRONG_PASSWORD" address=LAPTOP_LAN_IP/32
```

## 2. Install Docker Desktop on the laptop
Download from docker.com (Windows, WSL 2 backend), install, restart, open it once. In Docker Desktop > Settings > General tick **Start Docker Desktop when you sign in**.

## 3. Prepare the project
Unzip the project (e.g. `C:\apps\mikrotik-voucher-dashboard`). In Command Prompt:
```
cd C:\apps\mikrotik-voucher-dashboard
copy .env.local.example .env
notepad .env
```
Fill in: `ROUTER address` in `MIKROTIK_HOST` (from `ipconfig` > Default Gateway), `MIKROTIK_PASSWORD` (step 1), and long random `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD`. Leave `PUBLIC_URL` for step 5.

## 4. Free public address with ngrok
1. Create a free account at ngrok.com. In the dashboard copy your **authtoken**, and under **Domains** claim your free static domain (looks like `something.ngrok-free.app`).
2. Install: `winget install ngrok.ngrok` (or download from ngrok.com). Then: `ngrok config add-authtoken YOUR_TOKEN`
3. Put that domain in `.env` as `PUBLIC_URL=https://something.ngrok-free.app`
Free-tier limits (as of a recent comparison; check ngrok's pricing page): 1 GB transfer and 20,000 HTTP requests per month. Enough for light use; for heavy use choose a Cloudflare named tunnel (free, needs your own domain on Cloudflare) instead.

## 5. Start everything
```
docker compose -f docker-compose.local.yml up -d --build
ngrok http --url=something.ngrok-free.app 8080
```
(Use the exact command ngrok shows for your domain if the flag name differs.) Open `https://something.ngrok-free.app`, click through ngrok's one-time visitor notice if shown, and sign in with ADMIN_USER / ADMIN_PASSWORD. It should show LIVE.
Local check without ngrok: http://localhost:8080

## 6. Keep it running
- Docker containers restart automatically (`restart: unless-stopped`) once Docker Desktop starts at sign-in.
- Run ngrok as a service: `ngrok service install --config "%USERPROFILE%\AppData\Local\ngrok\ngrok.yml"` then `ngrok service start` (define your tunnel in that file with `addr: 8080` and your `domain`), or simply keep the ngrok window open.
- Windows Settings > System > Power: sleep = **Never** while plugged in; lid close = Do nothing.

## Troubleshooting
- MIKROTIK OFFLINE: `docker compose -f docker-compose.local.yml logs app`; check `MIKROTIK_HOST`, the `dashboard` password, and that the router's `api` service address equals the laptop's LAN IP.
- Site loads but no live data / login loops: `PUBLIC_URL` in `.env` must exactly match the address in the browser (https, no trailing slash); then `docker compose -f docker-compose.local.yml up -d`.
- Update after code changes: `docker compose -f docker-compose.local.yml up -d --build`.

## Security
Anyone can reach the login page, so use a strong ADMIN_PASSWORD. Never expose the router API or Postgres to the internet (this setup does not).
