import { config } from '../config/index.js';
import { q } from '../database/db.js';
import { state } from '../services/mikrotik/mikrotikClient.js';
import { getHotspotUsers, disableHotspotUser, unblockMac } from '../services/mikrotik/hotspotService.js';
import { getHostNames } from '../services/mikrotik/deviceService.js';
import { getActiveHotspotUsers, disconnectHotspotSession } from '../services/mikrotik/sessionService.js';
import { getRouterResources, getIdentity, getSystemDetails } from '../services/mikrotik/routerService.js';
import { voucherStatus, isExpired } from '../utils/status.js';
import { audit } from '../utils/audit.js';
import { enforceCap } from './dataCap.js';

export const live = { router: { online: false, error: null }, vouchers: [], sessions: [], summary: null, lastSync: null };
let sysCache = null, lastSys = 0, prevActive = new Map(), prevRate = new Map(), lastFull = 0, running = false;

async function detectSuspicious(username, mac, sessions) {
  const ind = [];
  if (sessions.filter(s => s.username === username).length > 1) ind.push('multiple concurrent sessions');
  const m = await q(`SELECT count(DISTINCT mac_address) c FROM device_usage WHERE username=$1 AND ts>now()-interval '1 hour'`, [username]);
  if (+m.rows[0].c >= 3) ind.push(`${m.rows[0].c} distinct MACs in 1h`);
  const h = await q(`SELECT count(*) c FROM session_history WHERE username=$1 AND ended_at>now()-interval '1 hour'`, [username]);
  if (+h.rows[0].c >= 6) ind.push(`${h.rows[0].c} reconnects in 1h`);
  if (!ind.length) return;
  const severity = ind.length >= 3 ? 'HIGH' : ind.length === 2 ? 'MEDIUM' : 'LOW';
  const dup = await q(`SELECT 1 FROM security_alerts WHERE username=$1 AND NOT resolved AND ts>now()-interval '1 hour'`, [username]);
  if (dup.rowCount) return;
  let action = 'none';
  if (ind.length >= 2) { // never act on a single indicator
    if (config.autoBlock) { await disconnectHotspotSession(username); await disableHotspotUser(username);
      await q('UPDATE vouchers_cache SET blocked=true WHERE username=$1', [username]); action = 'blocked'; }
    else if (config.autoDisconnect) { await disconnectHotspotSession(username); action = 'disconnected'; }
  }
  await q('INSERT INTO security_alerts(username,mac_address,severity,indicators,action_taken) VALUES($1,$2,$3,$4,$5)', [username, mac, severity, JSON.stringify(ind), action]);
  await q(`UPDATE devices SET risk_level=$2 WHERE mac_address=$1`, [mac, severity]);
  if (action !== 'none') await audit('system', `Suspicious auto-${action}`, { voucher: username, mac, reason: ind.join('; ') });
}

export async function syncOnce(io) {
  if (running) return; running = true;
  try {
    const [res, identity, users, active] = await Promise.all([getRouterResources(), getIdentity(), getHotspotUsers(), getActiveHotspotUsers()]);
    const hosts = await getHostNames();
    const now = Date.now();
    if (now - lastSys > 30000) { lastSys = now; try { sysCache = await getSystemDetails(); } catch { /* optional data */ } }
    const cache = new Map((await q('SELECT * FROM vouchers_cache')).rows.map(r => [r.username, r]));
    const activeByUser = new Map(); active.forEach(a => activeByUser.set(a.username, [...(activeByUser.get(a.username) || []), a]));

    // upsert vouchers (auto-discovers anything Mikhmon created)
    for (const u of users) {
      const on = activeByUser.get(u.username);
      await q(`INSERT INTO vouchers_cache(username,mt_id,profile,disabled,limit_uptime,limit_bytes_total,comment,synced_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (username) DO UPDATE SET mt_id=$2,profile=$3,disabled=$4,limit_uptime=$5,limit_bytes_total=$6,comment=$7,synced_at=now()`,
        [u.username, u.mtId, u.profile, u.disabled, u.limitUptimeSeconds || null, u.limitBytesTotal, u.comment]);
      if (on && on.some(x => !prevActive.has(x.mtId)))
        await q('UPDATE vouchers_cache SET last_login=now(), first_login=COALESCE(first_login,now()) WHERE username=$1', [u.username]);
    }
    // vanished users (removed in Mikhmon) leave the cache but keep history
    const names = users.map(u => u.username);
    await q('DELETE FROM vouchers_cache WHERE NOT (username = ANY($1))', [names]);

    // ended sessions -> history
    const cur = new Map(active.map(a => [a.mtId, a]));
    for (const [id, p] of prevActive) if (!cur.has(id))
      await q('INSERT INTO session_history(mt_id,username,mac_address,ip_address,started_at,duration_seconds,upload_bytes,download_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, p.username, p.mac, p.ip, new Date(p.seenStart), p.uptimeSeconds, p.upload, p.download]);

    // snapshots + rates
    const fullDue = now - lastFull > 600000; if (fullDue) lastFull = now;
    const rates = new Map();
    for (const a of active) {
      const pr = prevRate.get(a.mtId);
      rates.set(a.mtId, pr ? { up: Math.max(0, (a.upload - pr.up) * 8 / ((now - pr.t) / 1000)), down: Math.max(0, (a.download - pr.down) * 8 / ((now - pr.t) / 1000)) } : { up: 0, down: 0 });
      a.rateUpBps = rates.get(a.mtId).up; a.rateDownBps = rates.get(a.mtId).down;
      a.host = hosts.byMac.get((a.mac || '').toUpperCase()) || hosts.byIp.get(a.ip) || null;
      a.seenStart = prevActive.get(a.mtId)?.seenStart || now - a.uptimeSeconds * 1000;
      if (a.mac) {
        await q(`INSERT INTO devices(mac_address,last_ip,last_voucher,host_name) VALUES($1,$2,$3,$4) ON CONFLICT (mac_address) DO UPDATE SET last_ip=$2,last_voucher=$3,last_seen=now(),host_name=COALESCE($4,devices.host_name)`, [a.mac, a.ip, a.username, a.host]);
        await q('INSERT INTO device_usage(mac_address,ip_address,username,upload_bytes,download_bytes,total_bytes,session_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)', [a.mac, a.ip, a.username, a.upload, a.download, a.upload + a.download, a.uptimeSeconds]);
      }
      await q('INSERT INTO voucher_usage(username,mac_address,ip_address,upload_bytes,download_bytes,total_bytes,session_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [a.username, a.mac, a.ip, a.upload, a.download, a.upload + a.download, a.uptimeSeconds]);
    }
    if (fullDue) for (const u of users) if (!activeByUser.has(u.username) && u.upload + u.download > 0)
      await q('INSERT INTO voucher_usage(username,upload_bytes,download_bytes,total_bytes,session_seconds) VALUES($1,$2,$3,$4,$5)', [u.username, u.upload, u.download, u.upload + u.download, u.uptimeSeconds]);
    prevRate = new Map(active.map(a => [a.mtId, { up: a.upload, down: a.download, t: now }]));
    prevActive = new Map(active.map(a => [a.mtId, a]));
    await q('DELETE FROM active_sessions');
    for (const a of active) await q('INSERT INTO active_sessions(mt_id,username,mac_address,ip_address,login_time,bytes_in,bytes_out) VALUES($1,$2,$3,$4,$5,$6,$7)', [a.mtId, a.username, a.mac, a.ip, new Date(a.seenStart), a.upload, a.download]);

    // build API view
    const blockedSet = new Set([...cache.values()].filter(c => c.blocked).map(c => c.username));
    const devHosts = (await q('SELECT mac_address, last_voucher, host_name FROM devices WHERE host_name IS NOT NULL')).rows;
    const hostByMac = new Map(devHosts.map(d => [d.mac_address.toUpperCase(), d.host_name])), hostByUser = new Map(devHosts.filter(d => d.last_voucher).map(d => [d.last_voucher, d.host_name]));
    const vouchers = users.map(u => { const c = cache.get(u.username) || {}; const status = voucherStatus(u, blockedSet.has(u.username)); const total = u.upload + u.download;
      const on = activeByUser.get(u.username)?.[0];
      return { ...u, total, status, expired: isExpired(status), online: !!on, ip: on?.ip || null, mac: on?.mac || u.mac,
        host: on?.host || hostByMac.get((on?.mac || u.mac || '').toUpperCase()) || hostByUser.get(u.username) || null,
        remainingBytes: u.limitBytesTotal ? Math.max(0, u.limitBytesTotal - total) : null,
        remainingSeconds: u.limitUptimeSeconds ? Math.max(0, u.limitUptimeSeconds - u.uptimeSeconds) : null,
        firstLogin: c.first_login || null, lastLogin: c.last_login || null }; });

    // data-limit enforcement
    for (const v of vouchers) if (v.status === 'DATA LIMIT REACHED' && !cache.get(v.username)?.limit_reached_at) {
      try { await disconnectHotspotSession(v.username); if (!v.disabled) await disableHotspotUser(v.username);
        await q('UPDATE vouchers_cache SET limit_reached_at=now() WHERE username=$1', [v.username]);
        await audit('system', 'Data limit reached', { voucher: v.username, reason: `${v.total}/${v.limitBytesTotal} bytes` });
        await q(`INSERT INTO security_alerts(username,severity,indicators,action_taken) VALUES($1,'LOW',$2,'disconnected+disabled')`, [v.username, JSON.stringify(['DATA LIMIT REACHED'])]);
      } catch (e) { await audit('system', 'Data limit enforcement failed', { voucher: v.username, result: e.message }); }
    }
    const cap = await enforceCap(vouchers, active);
    for (const set of [vouchers, active]) for (let i = set.length - 1; i >= 0; i--) if (cap.removed.has(set[i].username)) set.splice(i, 1);
    cap.events.forEach(ev => io?.emit('cap-event', ev));
    for (const a of active) if (a.mac) await detectSuspicious(a.username, a.mac, active).catch(e => console.error('detect', e.message));
    const exp = await q(`UPDATE blocked_devices SET active=false WHERE active AND expires_at IS NOT NULL AND expires_at<now() RETURNING mac_address`);
    for (const r of exp.rows) { await unblockMac(r.mac_address).catch(() => {}); await audit('system', 'Temporary block expired', { mac: r.mac_address }); }

    const sum = { total: vouchers.length, active: vouchers.filter(v => v.status === 'ACTIVE').length, expired: vouchers.filter(v => v.expired).length,
      disabled: vouchers.filter(v => v.status === 'DISABLED' || v.status === 'BLOCKED').length, activeUsers: new Set(active.map(a => a.username)).size,
      activeDevices: new Set(active.map(a => a.mac)).size, upload: users.reduce((n, u) => n + u.upload, 0), download: users.reduce((n, u) => n + u.download, 0),
      suspicious: +(await q('SELECT count(*) c FROM security_alerts WHERE NOT resolved')).rows[0].c,
      blockedDevices: +(await q('SELECT count(*) c FROM blocked_devices WHERE active')).rows[0].c };
    sum.totalData = sum.upload + sum.download;
    Object.assign(live, { router: { online: true, error: null, identity, ...res }, system: sysCache, vouchers, sessions: active, summary: sum, capBytes: config.capBytes, lastSync: new Date().toISOString() });
  } catch (e) {
    Object.assign(live, { router: { online: false, error: e.message }, system: null, vouchers: [], sessions: [], summary: null }); // no fake data when offline
    if (state.lastError) console.error('MikroTik sync failed:', e.message);
  } finally { running = false; io?.emit('update', live); }
}

export const startPoller = io => { syncOnce(io); return setInterval(() => syncOnce(io), config.pollInterval * 1000); };
