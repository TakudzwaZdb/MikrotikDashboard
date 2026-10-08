import { Router } from 'express';
import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import { z } from 'zod'; import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { q } from '../database/db.js';
import { auth, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { live, syncOnce, idle } from '../jobs/poller.js';
import { ops } from '../services/routerOps.js';
import { connectorAvailable, connectorCommand } from '../connector/bridge.js';
import { notify, channels } from '../services/notify.js';

const r = Router();
const mac = z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/).transform(s => s.toUpperCase());
const user = z.string().min(1).max(64).regex(/^[\w.\-@]+$/);
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e.message); res.status(e instanceof z.ZodError ? 400 : 502).json({ error: e instanceof z.ZodError ? 'Invalid input' : e.message }); });
const who = req => req.user.sub;
const offline = res => res.status(503).json({ error: `MIKROTIK OFFLINE${live.router?.error ? ': ' + live.router.error : ''}` });

/**
 * Bring the live data up to date.
 *  - direct mode: read the router from this server
 *  - connector mode (Render): ask the laptop to read it; Render itself never contacts the router
 */
async function refresh(io, { ask = false } = {}) {
  if (!config.connectorMode) return syncOnce(io);
  if (ask && connectorAvailable()) await connectorCommand('sync', {}, 30000);
  await idle(); // wait until the snapshot the laptop just sent is processed
}

r.post('/auth/login', rateLimit({ windowMs: 15 * 60000, limit: 10 }), wrap(async (req, res) => {
  const { username, password } = z.object({ username: z.string().max(64), password: z.string().max(200) }).parse(req.body);
  const a = (await q('SELECT a.*, r.name role FROM admins a JOIN roles r ON r.id=a.role_id WHERE username=$1', [username])).rows[0];
  if (!a || !(await bcrypt.compare(password, a.password_hash))) { await audit(username, 'Login failed', { result: 'DENIED' }); return res.status(401).json({ error: 'Invalid credentials' }); }
  res.json({ token: jwt.sign({ sub: a.username, role: a.role }, config.jwtSecret, { expiresIn: '8h' }), role: a.role });
}));

r.use(auth);
r.get('/overview', (_q, res) => res.json({ router: live.router, summary: live.summary, lastSync: live.lastSync }));
r.get('/vouchers', (_q, res) => live.router.online ? res.json(live.vouchers) : offline(res));
r.get('/sessions', (_q, res) => live.router.online ? res.json(live.sessions) : offline(res));
r.get('/profiles', wrap(async (_q, res) => res.json(await ops.profiles())));

r.get('/vouchers/:name/usage', wrap(async (req, res) => {
  const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const n = user.parse(req.params.name);
  res.json((await q(`SELECT date_trunc('day',ts) AS day, max(upload_bytes) upload, max(download_bytes) download, max(total_bytes) total FROM voucher_usage
    WHERE username=$1 AND ts>=COALESCE($2::timestamptz, now()-interval '7 days') AND ts<COALESCE($3::timestamptz, now()) GROUP BY 1 ORDER BY 1`, [n, from || null, to || null])).rows);
}));

r.get('/devices', wrap(async (_q, res) => res.json((await q(`
  SELECT d.*, COALESCE(u.upload,0) upload, COALESCE(u.download,0) download, COALESCE(s.c,0) sessions,
   EXISTS(SELECT 1 FROM active_sessions a WHERE a.mac_address=d.mac_address) online,
   EXISTS(SELECT 1 FROM blocked_devices b WHERE b.mac_address=d.mac_address AND b.active) blocked
  FROM devices d
  LEFT JOIN (SELECT mac_address, sum(upload_bytes) upload, sum(download_bytes) download FROM session_history GROUP BY 1) u USING (mac_address)
  LEFT JOIN (SELECT mac_address, count(*) c FROM session_history GROUP BY 1) s USING (mac_address) ORDER BY d.last_seen DESC`)).rows)));

r.get('/devices/:mac', wrap(async (req, res) => {
  const m = mac.parse(req.params.mac);
  const dev = (await q('SELECT * FROM devices WHERE mac_address=$1', [m])).rows[0]; if (!dev) return res.status(404).json({ error: 'Not found' });
  res.json({ device: dev,
    daily: (await q(`SELECT date_trunc('day',ended_at) AS day, sum(upload_bytes) upload, sum(download_bytes) download, count(*) sessions, avg(duration_seconds) avg_duration FROM session_history WHERE mac_address=$1 GROUP BY 1 ORDER BY 1`, [m])).rows,
    sessions: (await q('SELECT * FROM session_history WHERE mac_address=$1 ORDER BY started_at DESC LIMIT 200', [m])).rows });
}));

const act = (name, minRole, fn) => r.post(name, requireRole(minRole), wrap(async (req, res) => {
  if (!live.router.online) return offline(res);
  try { const out = await fn(req); await refresh(req.app.get('io')); res.json({ ok: true, ...out }); }
  catch (e) { await audit(who(req), name, { voucher: req.params.name, reason: req.body?.reason, result: 'FAILED: ' + e.message }); throw e; }
}));
const reason = z.object({ reason: z.string().max(300).optional() });

act('/vouchers/:name/disconnect', 'operator', async req => { const n = user.parse(req.params.name); const o = await ops.disconnect(n); await audit(who(req), 'User disconnected', { voucher: n, reason: reason.parse(req.body).reason }); return o; });
act('/vouchers/:name/disable', 'operator', async req => { const n = user.parse(req.params.name); await ops.disable(n); await audit(who(req), 'Voucher disabled', { voucher: n, reason: reason.parse(req.body).reason }); return {}; });
act('/vouchers/:name/enable', 'operator', async req => { const n = user.parse(req.params.name); await ops.enable(n); await q('UPDATE vouchers_cache SET blocked=false, limit_reached_at=NULL WHERE username=$1', [n]); await audit(who(req), 'Voucher enabled', { voucher: n }); return {}; });
act('/vouchers/:name/block', 'operator', async req => { const n = user.parse(req.params.name); await ops.disable(n); await ops.disconnect(n); await q('UPDATE vouchers_cache SET blocked=true WHERE username=$1', [n]); await audit(who(req), 'Voucher blocked', { voucher: n, reason: reason.parse(req.body).reason }); return {}; });
act('/vouchers/:name/unblock', 'operator', async req => { const n = user.parse(req.params.name); await ops.enable(n); await q('UPDATE vouchers_cache SET blocked=false WHERE username=$1', [n]); await audit(who(req), 'Voucher unblocked', { voucher: n }); return {}; });
act('/vouchers/:name/reset-usage', 'admin', async req => { const n = user.parse(req.params.name); await ops.resetUsage(n); await audit(who(req), 'Usage reset', { voucher: n, reason: reason.parse(req.body).reason }); return {}; });

r.get('/blocked-devices', wrap(async (_q, res) => res.json((await q('SELECT b.*, d.host_name FROM blocked_devices b LEFT JOIN devices d ON d.mac_address=b.mac_address ORDER BY b.created_at DESC LIMIT 500')).rows)));
r.post('/blocked-devices', requireRole('operator'), wrap(async (req, res) => {
  if (!live.router.online) return offline(res);
  const b = z.object({ mac, reason: z.string().max(300).optional(), hours: z.number().int().positive().max(8760).optional() }).parse(req.body);
  const s = live.sessions.find(x => x.mac?.toUpperCase() === b.mac);
  await ops.blockMac(b.mac, `dashboard:${who(req)}`);
  if (s) await ops.disconnect(s.username);
  await q('INSERT INTO blocked_devices(mac_address,ip_address,voucher_username,reason,blocked_by,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
    [b.mac, s?.ip || null, s?.username || null, b.reason || null, who(req), b.hours ? new Date(Date.now() + b.hours * 3600000) : null]);
  await audit(who(req), 'Device blocked', { mac: b.mac, ip: s?.ip, voucher: s?.username, reason: b.reason });
  res.json({ ok: true, note: 'Blocked by MAC via ip-binding. Randomized/private MACs can evade MAC blocks.' });
}));
r.delete('/blocked-devices/:mac', requireRole('operator'), wrap(async (req, res) => {
  if (!live.router.online) return offline(res);
  const m = mac.parse(req.params.mac); await ops.unblockMac(m);
  await q('UPDATE blocked_devices SET active=false WHERE mac_address=$1 AND active', [m]);
  await audit(who(req), 'Device unblocked', { mac: m }); res.json({ ok: true });
}));

r.get('/alerts', wrap(async (_q, res) => res.json((await q('SELECT a.*, d.host_name FROM security_alerts a LEFT JOIN devices d ON d.mac_address=a.mac_address ORDER BY a.ts DESC LIMIT 300')).rows)));
r.post('/alerts/:id/resolve', requireRole('operator'), wrap(async (req, res) => { await q('UPDATE security_alerts SET resolved=true WHERE id=$1', [z.coerce.number().int().parse(req.params.id)]); res.json({ ok: true }); }));
r.get('/audit', requireRole('admin'), wrap(async (_q, res) => res.json((await q('SELECT * FROM audit_logs ORDER BY ts DESC LIMIT 500')).rows)));

// reports: ?type=top-vouchers|top-devices|daily&from&to&format=csv
r.get('/reports', wrap(async (req, res) => {
  const p = z.object({ type: z.enum(['top-vouchers', 'top-devices', 'daily']), from: z.string().optional(), to: z.string().optional(), format: z.string().optional() }).parse(req.query);
  const rng = `ts>=COALESCE($1::timestamptz, now()-interval '30 days') AND ts<COALESCE($2::timestamptz, now())`;
  const sql = {
    'top-vouchers': `SELECT username, max(total_bytes)-min(total_bytes) AS bytes_used, max(upload_bytes)-min(upload_bytes) upload, max(download_bytes)-min(download_bytes) download FROM voucher_usage WHERE ${rng} GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    'top-devices': `SELECT mac_address, max(total_bytes)-min(total_bytes) AS bytes_used FROM device_usage WHERE ${rng} GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    daily: `SELECT date_trunc('day',ended_at)::date AS day, count(*) sessions, sum(upload_bytes) upload, sum(download_bytes) download, avg(duration_seconds)::int avg_session_seconds FROM session_history WHERE ended_at>=COALESCE($1::timestamptz, now()-interval '30 days') AND ended_at<COALESCE($2::timestamptz, now()) GROUP BY 1 ORDER BY 1` }[p.type];
  const rows = (await q(sql, [p.from || null, p.to || null])).rows;
  if (p.format !== 'csv') return res.json(rows);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`; // CSV-injection safe
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  res.type('text/csv').attachment(`${p.type}.csv`).send([cols.join(','), ...rows.map(x => cols.map(c => esc(x[c])).join(','))].join('\n'));
}));


// ---- accounts & passwords -------------------------------------------------------------------
const pw = z.string().min(10, 'Password must be at least 10 characters').max(200);
r.post('/auth/change-password', rateLimit({ windowMs: 15 * 60000, limit: 10 }), wrap(async (req, res) => {
  const b = z.object({ current: z.string().max(200), next: pw }).parse(req.body);
  const a = (await q('SELECT * FROM admins WHERE username=$1', [who(req)])).rows[0];
  if (!a || !(await bcrypt.compare(b.current, a.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  await q('UPDATE admins SET password_hash=$2 WHERE username=$1', [a.username, await bcrypt.hash(b.next, 12)]);
  await audit(who(req), 'Password changed', { result: 'OK' }); res.json({ ok: true });
}));
r.get('/users', requireRole('admin'), wrap(async (_q, res) => res.json((await q('SELECT a.username, r.name role, a.created_at FROM admins a JOIN roles r ON r.id=a.role_id ORDER BY a.id')).rows)));
r.post('/users', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ username: z.string().min(3).max(32).regex(/^[\w.\-]+$/), password: pw, role: z.enum(['admin', 'operator', 'viewer']) }).parse(req.body);
  if ((await q('SELECT 1 FROM admins WHERE username=$1', [b.username])).rowCount) return res.status(400).json({ error: 'That username already exists' });
  await q('INSERT INTO admins(username,password_hash,role_id) VALUES($1,$2,(SELECT id FROM roles WHERE name=$3))', [b.username, await bcrypt.hash(b.password, 12), b.role]);
  await audit(who(req), 'User created', { reason: `${b.username} (${b.role})` }); res.json({ ok: true });
}));
r.put('/users/:name', requireRole('admin'), wrap(async (req, res) => {
  const n = user.parse(req.params.name), b = z.object({ role: z.enum(['admin', 'operator', 'viewer']).optional(), password: pw.optional() }).parse(req.body);
  if (n === who(req) && b.role && b.role !== 'admin') return res.status(400).json({ error: 'You cannot lower your own role' });
  if (b.role) await q('UPDATE admins SET role_id=(SELECT id FROM roles WHERE name=$2) WHERE username=$1', [n, b.role]);
  if (b.password) await q('UPDATE admins SET password_hash=$2 WHERE username=$1', [n, await bcrypt.hash(b.password, 12)]);
  await audit(who(req), 'User updated', { reason: `${n}${b.role ? ' role=' + b.role : ''}${b.password ? ' password reset' : ''}` }); res.json({ ok: true });
}));
r.delete('/users/:name', requireRole('admin'), wrap(async (req, res) => {
  const n = user.parse(req.params.name); if (n === who(req)) return res.status(400).json({ error: 'You cannot delete your own account' });
  await q('DELETE FROM admins WHERE username=$1', [n]); await audit(who(req), 'User deleted', { reason: n }); res.json({ ok: true });
}));
r.post('/settings/notify/test', requireRole('admin'), wrap(async (_q, res) => {
  if (!channels().length) return res.status(400).json({ error: 'No alert channel configured in .env (see ALERTS section of .env.example)' });
  await notify('test message - alerts are working.'); res.json({ ok: true, channels: channels() });
}));

r.get('/settings/mikrotik', wrap(async (_q, res) => res.json({ notify: channels(), router: live.router, lastSync: live.lastSync, pollInterval: config.pollInterval, autoDisconnect: config.autoDisconnect, autoBlock: config.autoBlock,
  connectorMode: config.connectorMode, connectorOnline: connectorAvailable(), dbError: live.dbError })));

// "Test connection" / "Sync now": succeed only when the router really answered, otherwise say exactly why not.
const syncAndReport = io => async (_req, res) => {
  if (config.connectorMode && !connectorAvailable()) {
    return res.status(503).json({ error: 'The laptop connector is not connected to this server. Start it on the laptop ("npm run connector") and check CONNECTOR_TOKEN / RENDER_URL.', router: live.router });
  }
  await refresh(io(_req), { ask: true });
  if (!live.router.online) return res.status(502).json({ error: live.router.error || 'Router not reachable', router: live.router });
  res.json({ router: live.router, lastSync: live.lastSync, online: true });
};
r.post('/settings/mikrotik/test', requireRole('admin'), wrap(syncAndReport(req => req.app.get('io'))));
r.post('/settings/mikrotik/sync', requireRole('operator'), wrap(syncAndReport(req => req.app.get('io'))));
export default r;
