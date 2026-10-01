> **Render:** see **RENDER.md** (render.yaml included). 
> **Simplest option (no server, no card):** host on your Windows laptop - see **LAPTOP-HOSTING.md**. The rest of this file is for an always-on cloud server.

# Free hosting guide (always-on VM + Docker + free HTTPS)

## 0. Connect the server to the router
RouterOS 6 cannot run WireGuard. Use the **SSH reverse tunnel from a Windows laptop** on the router's network: see **SSH-TUNNEL.md**. (WIREGUARD.md is only for RouterOS 7+.) Use the `.env` values given in SSH-TUNNEL.md.

## 1. Get a free server
Oracle Cloud "Always Free" VM (Ubuntu 22.04/24.04, ARM or AMD). Open ports **80** and **443** in the VCN security list, and in Ubuntu:
`sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`
(Any other always-on VPS works the same way.)

## 2. Get a free domain name (needed for HTTPS)
Create a subdomain at https://www.duckdns.org pointing to the server's public IP.

## 3. Install Docker on the server
`curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER` (log out/in)

## 4. Upload and configure
Copy this project folder to the server (scp / git), then:
```
cd mikrotik-voucher-dashboard
cp .env.production.example .env
nano .env        # fill in DOMAIN, passwords, MIKROTIK_*   (openssl rand -hex 32 makes good secrets)
```

## 5. Start
`docker compose up -d --build`
Open `https://<DOMAIN>` and sign in with ADMIN_USER / ADMIN_PASSWORD. Caddy obtains the HTTPS certificate automatically.

## Everyday commands
- Logs: `docker compose logs -f app`
- Update after code changes: `docker compose up -d --build`
- Backup DB: `docker compose exec db pg_dump -U dashboard mikrotik_dashboard > backup.sql`

## Security notes
- Never publish PostgreSQL (it is not exposed in this compose file).
- Change ADMIN_PASSWORD via .env then `docker compose up -d` (the admin is re-seeded on start).
- If the dashboard shows MIKROTIK OFFLINE, check `docker compose logs app` — it is almost always network reachability or wrong API credentials/port.
