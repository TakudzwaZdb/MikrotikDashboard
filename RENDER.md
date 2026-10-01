# Deploy on Render

## READ FIRST - the router problem
Render web services cannot join a VPN/WireGuard/SSH tunnel and their outgoing IPs are shared, so the dashboard can reach your router **only if the router's API port is open to the internet**. That is risky. If you still do it:
- Use a dedicated router user (`dashboard`) with a long random password, never `admin`.
- Use API-SSL (port 8729, certificate on the router) and set `MIKROTIK_USE_TLS=true`, `MIKROTIK_PORT=8729`; plain 8728 over the internet exposes the password.
- Restrict the port to Render's outbound IP ranges (Render dashboard > your service > Connect > Outbound) in the router firewall, and drop everything else.
- Router needs a public IP (not CGNAT). Many ISPs in Zimbabwe use CGNAT; if yours does this will not work - use LAPTOP-HOSTING.md instead.

## Free-plan limits (verify on render.com/pricing - they change)
- Free web service sleeps after ~15 min with no visitors. While asleep the app does NOT poll the router, so data caps are not enforced and usage history has gaps. Use a paid always-on instance for real use.
- Free Postgres expires after ~30 days. Use a paid database, or a free external one (Neon/Supabase) and set `DATABASE_URL` to its URL plus `DATABASE_SSL=true`.

## Manual setup (New > Web Service) - the form you are on
- **Language:** Node
- **Build Command:** `npm install --include=dev && npm run build`
- **Start Command:** `npm start`
- **Health Check Path (Advanced):** `/health`
- Environment variables: see below. Create the PostgreSQL database first and use its *Internal Database URL* as `DATABASE_URL`.
(`npm start` creates the tables, creates the admin user and starts the single application that serves both the website and the API.)

## Steps (Blueprint)
1. Put the project in a GitHub repository (the folder with `Dockerfile` and `render.yaml` at the repo root). Do NOT commit any `.env` file.
2. render.com > **New > Blueprint** > connect the repo > it reads `render.yaml` and proposes the web service + database.
3. When prompted, fill the secret values: `ADMIN_PASSWORD`, `MIKROTIK_HOST` (public IP / DDNS name), `MIKROTIK_PASSWORD`. (Edit `MIKROTIK_PORT` / `MIKROTIK_USE_TLS` if you use API-SSL.)
4. Click **Apply**. Render builds the Docker image (a few minutes). On start the app creates the tables and the admin user automatically.
5. Open `https://<your-service>.onrender.com`, sign in with `admin` / your ADMIN_PASSWORD. The default page is Network Overview and should show LIVE.

## Notes
- `JWT_SECRET` is generated for you. `CORS_ORIGIN` defaults to Render's own address.
- The port is provided by Render automatically.
- If the page says MIKROTIK OFFLINE: Render dashboard > service > **Logs**; it is almost always the router not reachable from the internet, wrong credentials, or TLS settings.
- Update: push to GitHub; `autoDeploy` redeploys.
