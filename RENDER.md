# Deploy on Render

## READ FIRST - how Render reaches the router
Render is on the internet; your router is on a private network (often behind another router), so **Render can never connect to it directly**. Do not open the router's API port to the internet.
Instead a small program, the **connector**, runs on a laptop/PC that IS on the router's network. It reads the router and sends the data to Render over an *outgoing* connection (no port forwarding, VPN or public IP needed). Full steps: **CONNECTOR.md**.
On Render set `CONNECTOR_MODE=true` and `CONNECTOR_TOKEN=<long random text>` (render.yaml already does this); do **not** set MIKROTIK_* on Render.

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
3. When prompted, fill the secret values: `ADMIN_PASSWORD` and `CONNECTOR_TOKEN` (the same text goes in the laptop's .env).
4. Click **Apply**. Render builds the Docker image (a few minutes). On start the app creates the tables and the admin user automatically.
5. Open `https://<your-service>.onrender.com`, sign in with `admin` / your ADMIN_PASSWORD. The default page is Network Overview and should show LIVE.

## Notes
- `JWT_SECRET` is generated for you. `CORS_ORIGIN` defaults to Render's own address.
- The port is provided by Render automatically.
- If the page says ROUTER OFFLINE it now shows the reason. See the troubleshooting table in CONNECTOR.md.
- Update: push to GitHub; `autoDeploy` redeploys.
