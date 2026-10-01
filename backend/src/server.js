import http from 'http'; import fs from 'fs'; import path from 'path'; import express from 'express'; import helmet from 'helmet'; import cors from 'cors'; import rateLimit from 'express-rate-limit';
import { config } from './config/index.js'; import api from './routes/api.js'; import { initSocket } from './websocket/index.js'; import { startPoller } from './jobs/poller.js'; import { q } from './database/db.js';
const app = express();
app.use(helmet()); app.use(cors({ origin: config.corsOrigin })); app.use(express.json({ limit: '50kb' }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 300 }), api);
app.get('/health', (_q, r) => r.json({ ok: true }));
// Single-container hosting: serve the built frontend (STATIC_DIR) from the same origin as the API.
const staticDir = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR);
if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
  app.use(express.static(staticDir, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|socket\.io|health).*/, (_q, r) => r.sendFile(path.join(staticDir, 'index.html')));
}
const server = http.createServer(app); const io = initSocket(server); app.set('io', io);
server.listen(config.port, () => { console.log(`API on :${config.port}`);
  // self-heal: make sure the host_name column exists even if `npm run migrate` was not re-run
  q('ALTER TABLE devices ADD COLUMN IF NOT EXISTS host_name TEXT').catch(e => console.error('host_name migration failed:', e.message)).finally(() => startPoller(io)); });
