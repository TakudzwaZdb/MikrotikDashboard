import { RouterOSAPI } from 'node-routeros';
import { config } from '../../config/index.js';

// Each command opens a short-lived connection: robust against router reboots/idle drops.
// Serialised through a queue so we never open parallel API sessions.
let chain = Promise.resolve();
export const state = { online: false, lastError: null, lastOkAt: null };

export function connect() {
  const { host, port, user, password, tls } = config.mikrotik;
  if (!host || !user) throw new Error('MIKROTIK_HOST / MIKROTIK_USERNAME not configured');
  return new RouterOSAPI({ host, port, user, password, timeout: 30,
    tls: tls ? { rejectUnauthorized: false } : undefined }); // self-signed router cert; see README to pin a CA
}

export async function disconnect(conn) { try { await conn.close(); } catch { /* ignore */ } }

/** run(fn): fn receives a helper `w(menu, ...params)` -> rows */
export function run(fn) {
  const job = chain.then(async () => {
    const conn = connect();
    try {
      await conn.connect();
      const w = (menu, ...params) => conn.write([menu, ...params]);
      const out = await fn(w);
      state.online = true; state.lastError = null; state.lastOkAt = new Date();
      return out;
    } catch (e) {
      state.online = false; state.lastError = e.message; throw e;
    } finally { await disconnect(conn); }
  });
  chain = job.catch(() => {});
  return job;
}

export const bytes = v => Number(v || 0);
/** RouterOS duration "1d2h3m4s" or "1w2d" -> seconds */
export function parseDuration(s) {
  if (!s) return 0; let t = 0;
  for (const [, n, u] of String(s).matchAll(/(\d+)([wdhms])/g)) t += +n * { w: 604800, d: 86400, h: 3600, m: 60, s: 1 }[u];
  return t;
}
