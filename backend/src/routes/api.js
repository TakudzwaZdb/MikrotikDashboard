import { Router } from 'express';
import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import { z } from 'zod'; import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { q } from '../database/db.js';
import { auth, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { live, syncOnce } from '../jobs/poller.js';
import * as hs from '../services/mikrotik/hotspotService.js';
import { disconnectHotspotSession } from '../services/mikrotik/sessionService.js';

const r = Router();
const mac = z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/).transform(s => s.toUpperCase());
const user = z.string().min(1).max(64).regex(/^[\w.\-@]+$/);
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e.message); res.status(e instanceof z.ZodError ? 400 : 502).json({ error: e instanceof z.ZodError ? 'Invalid input' : e.message }); });
const who = req => req.user.sub;
const offline = res => res.status(503).json({ error: 'MIKROTIK OFFLINE' });

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
r.get('/profiles', wrap(async (_q, res) => res.json(await hs.getHotspotProfiles())));

r.get('/vouchers/:name/usage', wrap(async (req, res) => {
  const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const n = user.parse(req.params.name);
  res.json((await q(`SELECT date_trunc('day',ts) day, max(upload_bytes) upload, max(download_bytes) download, max(total_bytes) total FROM voucher_usage
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
    daily: (await q(`SELECT date_trunc('day',ended_at) day, sum(upload_bytes) upload, sum(download_bytes) download, count(*) sessions, avg(duration_seconds) avg_duration FROM session_history WHERE mac_address=$1 GROUP BY 1 ORDER BY 1`, [m])).rows,
    sessions: (await q('SELECT * FROM session_history WHERE mac_address=$1 ORDER BY started_at DESC LIMIT 200', [m])).rows });
}));

const act = (name, minRole, fn) => r.post(name, requireRole(minRole), wrap(async (req, res) => {
  if (!live.router.online) return offline(res);
  try { const out = await fn(req); await syncOnce(req.app.get('io')); res.json({ ok: true, ...out }); }
  catch (e) { await audit(who(req), name, { voucher: req.params.name, reason: req.body?.reason, result: 'FAILED: ' + e.message }); throw e; }
}));
const reason = z.object({ reason: z.string().max(300).optional() });

act('/vouchers/:name/disconnect', 'operator', async req => { const n = user.parse(req.params.name); const o = await disconnectHotspotSession(n); await audit(who(req), 'User disconnected', { voucher: n, reason: reason.parse(req.body).reason }); return o; });
act('/vouchers/:name/disable', 'operator', async req => { const n = user.parse(req.params.name); await hs.disableHotspotUser(n); await audit(who(req), 'Voucher disabled', { voucher: n, reason: reason.parse(req.body).reason }); return {}; });
act('/vouchers/:name/enable', 'operator', async req => { const n = user.parse(req.params.name); await hs.enableHotspotUser(n); await q('UPDATE vouchers_cache SET blocked=false, limit_reached_at=NULL WHERE username=$1', [n]); await audit(who(req), 'Voucher enabled', { voucher: n }); return {}; });
act('/vouchers/:name/block', 'operator', async req => { const n = user.parse(req.params.name); await hs.disableHotspotUser(n); await disconnectHotspotSession(n); await q('UPDATE vouchers_cache SET blocked=true WHERE username=$1', [n]); await audit(who(req), 'Voucher blocked', { voucher: n, reason: reason.parse(req.body).reason }); return {}; });
act('/vouchers/:name/unblock', 'operator', async req => { const n = user.parse(req.params.name); await hs.enableHotspotUser(n); await q('UPDATE vouchers_cache SET blocked=false WHERE username=$1', [n]); await audit(who(req), 'Voucher unblocked', { voucher: n }); return {}; });
act('/vouchers/:name/reset-usage', 'admin', async req => { const n = user.parse(req.params.name); await hs.resetUserCounters(n); await audit(who(req), 'Usage reset', { voucher: n, reason: reason.parse(req.body).reason }); return {}; });

r.get('/blocked-devices', wrap(async (_q, res) => res.json((await q('SELECT * FROM blocked_devices ORDER BY created_at DESC LIMIT 500')).rows)));
r.post('/blocked-devices', requireRole('operator'), wrap(async (req, res) => {
  if (!live.router.online) return offline(res);
  const b = z.object({ mac, reason: z.string().max(300).optional(), hours: z.number().int().positive().max(8760).optional() }).parse(req.body);
  const s = live.sessions.find(x => x.mac?.toUpperCase() === b.mac);
  await hs.blockMac(b.mac, `dashboard:${who(req)}`);
  if (s) await disconnectHotspotSession(s.username);
  await q('INSERT INTO blocked_devices(mac_address,ip_address,voucher_username,reason,blocked_by,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
    [b.mac, s?.ip || null, s?.username || null, b.reason || null, who(req), b.hours ? new Date(Date.now() + b.hours * 3600000) : null]);
  await audit(who(req), 'Device blocked', { mac: b.mac, ip: s?.ip, voucher: s?.username, reason: b.reason });
  res.json({ ok: true, note: 'Blocked by MAC via ip-binding. Randomized/private MACs can evade MAC blocks.' });
}));
r.delete('/blocked-devices/:mac', requireRole('operator'), wrap(async (req, res) => {
  if (!live.router.online) return offline(res);
  const m = mac.parse(req.params.mac); await hs.unblockMac(m);
  await q('UPDATE blocked_devices SET active=false WHERE mac_address=$1 AND active', [m]);
  await audit(who(req), 'Device unblocked', { mac: m }); res.json({ ok: true });
}));

r.get('/alerts', wrap(async (_q, res) => res.json((await q('SELECT * FROM security_alerts ORDER BY ts DESC LIMIT 300')).rows)));
r.post('/alerts/:id/resolve', requireRole('operator'), wrap(async (req, res) => { await q('UPDATE security_alerts SET resolved=true WHERE id=$1', [z.coerce.number().int().parse(req.params.id)]); res.json({ ok: true }); }));
r.get('/audit', requireRole('admin'), wrap(async (_q, res) => res.json((await q('SELECT * FROM audit_logs ORDER BY ts DESC LIMIT 500')).rows)));

// reports: ?type=top-vouchers|top-devices|daily&from&to&format=csv
r.get('/reports', wrap(async (req, res) => {
  const p = z.object({ type: z.enum(['top-vouchers', 'top-devices', 'daily']), from: z.string().optional(), to: z.string().optional(), format: z.string().optional() }).parse(req.query);
  const rng = `ts>=COALESCE($1::timestamptz, now()-interval '30 days') AND ts<COALESCE($2::timestamptz, now())`;
  const sql = {
    'top-vouchers': `SELECT username, max(total_bytes)-min(total_bytes) AS bytes_used, max(upload_bytes)-min(upload_bytes) upload, max(download_bytes)-min(download_bytes) download FROM voucher_usage WHERE ${rng} GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    'top-devices': `SELECT mac_address, max(total_bytes)-min(total_bytes) AS bytes_used FROM device_usage WHERE ${rng} GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    daily: `SELECT date_trunc('day',ended_at)::date day, count(*) sessions, sum(upload_bytes) upload, sum(download_bytes) download, avg(duration_seconds)::int avg_session_seconds FROM session_history WHERE ended_at>=COALESCE($1::timestamptz, now()-interval '30 days') AND ended_at<COALESCE($2::timestamptz, now()) GROUP BY 1 ORDER BY 1` }[p.type];
  const rows = (await q(sql, [p.from || null, p.to || null])).rows;
  if (p.format !== 'csv') return res.json(rows);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`; // CSV-injection safe
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  res.type('text/csv').attachment(`${p.type}.csv`).send([cols.join(','), ...rows.map(x => cols.map(c => esc(x[c])).join(','))].join('\n'));
}));

r.get('/settings/mikrotik', (_q, res) => res.json({ router: live.router, lastSync: live.lastSync, pollInterval: config.pollInterval, autoDisconnect: config.autoDisconnect, autoBlock: config.autoBlock }));
r.post('/settings/mikrotik/test', requireRole('admin'), wrap(async (req, res) => { await syncOnce(req.app.get('io')); res.json({ router: live.router }); }));
r.post('/settings/mikrotik/sync', requireRole('operator'), wrap(async (req, res) => { await syncOnce(req.app.get('io')); res.json({ lastSync: live.lastSync, online: live.router.online }); }));
export default r;
