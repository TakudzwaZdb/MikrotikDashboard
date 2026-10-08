# What was fixed

**Why Render showed "router offline" / timeouts**
- Render (CONNECTOR_MODE) still tried to talk to the router itself on every Refresh, Test connection and voucher action, so it timed out against a private address and then wiped the live data. Everything now goes through the laptop connector (`routerOps`).
- The laptop connector ran the whole database logic, so without a local PostgreSQL every sync failed with ECONNREFUSED, which was reported as "router not reachable". The connector now only reads the router (no database, no JWT_SECRET); Render stores/enforces everything.
- Connector history/alerts went to the laptop's database instead of Render's; they now go to Render's.
- `render.yaml` never set CONNECTOR_MODE / CONNECTOR_TOKEN.

**Other bugs**
- `/api/reports?type=daily`, voucher usage chart and device history returned errors (invalid SQL alias `day`).
- Settings page crashed: `config.notify` did not exist. Alerts (router offline/online, data cap, medium/high security alert) are now actually sent when a channel is configured.
- Router errors were unreadable ("RosException"); they now say what is wrong (timeout, refused, login, TLS/port mismatch).
- Older duplicate connector sockets could mark the router offline; two connectors fought each other. Newest connector wins, the old one exits.
- Database outage no longer makes the router look offline; the dashboard says "Database problem".
- Dashboard: requests time out after 45 s with a clear message; expired login on the live socket returns to the login page; the Overview page now shows the offline reason.
- Server keep-alive tuned for Render (avoids sporadic 502).

See CONNECTOR.md for setup.
