/*
 * Router polling, split in two so it works both ways:
 *
 *   collectRaw()   talks to RouterOS and returns plain JSON. NO database.
 *                  Runs wherever the router is reachable:
 *                    - direct mode: inside the web server
 *                    - connector mode: on the laptop (connector/agent.js)
 *
 *   ingestRaw()    takes that JSON, writes history to PostgreSQL, enforces limits
 *                  and builds the live view the dashboard shows.
 *                  Always runs inside the web server (Render).
 *
 * In connector mode Render NEVER connects to the router itself - it only
 * receives snapshots from the laptop - so there is nothing to time out.
 */
import { config } from '../config/index.js';
import { q } from '../database/db.js';
import { collectRaw, describeRouterError } from '../services/mikrotik/collect.js';
import { voucherStatus, isExpired } from '../utils/status.js';
import { audit } from '../utils/audit.js';
import { enforceCap } from './dataCap.js';
import { ops } from '../services/routerOps.js';
import { notify } from '../services/notify.js';

// the router is only declared OFFLINE after this many failed syncs in a row (default 3 = ~30 s with a 10 s poll)
const OFFLINE_AFTER = Math.max(1, +process.env.OFFLINE_AFTER_FAILS || 3);

export const live = {
  router: config.connectorMode
    ? { online: false, connectorOnline: false, error: 'Waiting for the laptop connector to connect to this server...' }
    : { online: false, error: 'Waiting for the first sync...' },
  vouchers: [],
  sessions: [],
  summary: null,
  lastSync: null,
  dbError: null
};

let fails = 0;
let offlineNotified = false;
let prevActive = new Map();
let prevRate = new Map();
let lastFull = 0;

const tell = text => notify(text).catch(() => {});

/* ------------------------------------------------------------------ */
/* 1. COLLECT (router only, no database)                                */
/* ------------------------------------------------------------------ */

export { collectRaw, describeRouterError };

/* ------------------------------------------------------------------ */
/* 2. ROUTER STATE (online / offline)                                   */
/* ------------------------------------------------------------------ */

/** The router could not be read. `why` is a human readable reason. */
export function routerFailed(why, io) {
  fails++;
  console.error(`[${new Date().toLocaleTimeString()}] MikroTik read failed (${fails} in a row): ${why}`);

  if (live.lastSync && live.router?.online && fails < OFFLINE_AFTER) {
    // a short hiccup (router busy, one timeout, Wi-Fi blip): keep the last good data and just flag it - no LIVE / OFFLINE flicker
    live.router = { ...live.router, stale: true, staleError: why };
  } else {
    Object.assign(live, {
      router: { online: false, error: why, connectorOnline: live.router?.connectorOnline },
      system: null, vouchers: [], sessions: [], summary: null // no fake data when really offline
    });
    if (fails >= config.notify.offlineAfterFails && !offlineNotified) {
      offlineNotified = true;
      tell(`Router is OFFLINE: ${why}`);
    }
  }
  io?.emit('update', live);
}

/** Used when the laptop connector itself is gone for good. */
export function forceOffline(why, io) {
  fails = Math.max(fails, OFFLINE_AFTER);
  routerFailed(why, io);
}

/* ------------------------------------------------------------------ */
/* 3. PROCESS (database + enforcement + live view)                      */
/* ------------------------------------------------------------------ */

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
    if (config.autoBlock) {
      await ops.disconnect(username); await ops.disable(username);
      await q('UPDATE vouchers_cache SET blocked=true WHERE username=$1', [username]); action = 'blocked';
    } else if (config.autoDisconnect) { await ops.disconnect(username); action = 'disconnected'; }
  }
  await q('INSERT INTO security_alerts(username,mac_address,severity,indicators,action_taken) VALUES($1,$2,$3,$4,$5)', [username, mac, severity, JSON.stringify(ind), action]);
  await q(`UPDATE devices SET risk_level=$2 WHERE mac_address=$1`, [mac, severity]);
  if (action !== 'none') await audit('system', `Suspicious auto-${action}`, { voucher: username, mac, reason: ind.join('; ') });
  if (severity !== 'LOW') tell(`${severity} security alert for voucher ${username}: ${ind.join('; ')}${action !== 'none' ? ` (${action})` : ''}`);
}

async function processRaw(raw, io) {
  const { res, identity, users, active } = raw;
  const sys = raw.sys || null;
  const now = raw.ts || Date.now();
  const hosts = {
    byMac: new Map((raw.hosts?.byMac) || []),
    byIp: new Map((raw.hosts?.byIp) || [])
  };

  // Every database step goes through db(): if PostgreSQL is down the dashboard still shows live router data
  // (and says so) instead of pretending the ROUTER is offline.
  let dbError = null;
  const db = async (fn, fallback) => {
    if (dbError) return fallback;
    try { return await fn(); }
    catch (e) { dbError = e.message; console.error('Database error:', e.message); return fallback; }
  };

  const cache = await db(async () => new Map((await q('SELECT * FROM vouchers_cache')).rows.map(r => [r.username, r])), new Map());
  const activeByUser = new Map();
  active.forEach(a => activeByUser.set(a.username, [...(activeByUser.get(a.username) || []), a]));

  // rates, host names, session start (pure)
  const rates = new Map();
  for (const a of active) {
    const pr = prevRate.get(a.mtId);
    rates.set(a.mtId, pr
      ? { up: Math.max(0, (a.upload - pr.up) * 8 / Math.max(1, (now - pr.t) / 1000)), down: Math.max(0, (a.download - pr.down) * 8 / Math.max(1, (now - pr.t) / 1000)) }
      : { up: 0, down: 0 });
    a.rateUpBps = rates.get(a.mtId).up; a.rateDownBps = rates.get(a.mtId).down;
    a.host = hosts.byMac.get((a.mac || '').toUpperCase()) || hosts.byIp.get(a.ip) || null;
    a.seenStart = prevActive.get(a.mtId)?.seenStart || now - a.uptimeSeconds * 1000;
  }

  // persistence
  await db(async () => {
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
    await q('DELETE FROM vouchers_cache WHERE NOT (username = ANY($1))', [users.map(u => u.username)]);

    // ended sessions -> history
    const cur = new Map(active.map(a => [a.mtId, a]));
    for (const [id, p] of prevActive) if (!cur.has(id))
      await q('INSERT INTO session_history(mt_id,username,mac_address,ip_address,started_at,duration_seconds,upload_bytes,download_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, p.username, p.mac, p.ip, new Date(p.seenStart), p.uptimeSeconds, p.upload, p.download]);

    // usage snapshots
    const fullDue = Date.now() - lastFull > 600000; if (fullDue) lastFull = Date.now();
    for (const a of active) {
      if (a.mac) {
        await q(`INSERT INTO devices(mac_address,last_ip,last_voucher,host_name) VALUES($1,$2,$3,$4) ON CONFLICT (mac_address) DO UPDATE SET last_ip=$2,last_voucher=$3,last_seen=now(),host_name=COALESCE($4,devices.host_name)`, [a.mac, a.ip, a.username, a.host]);
        await q('INSERT INTO device_usage(mac_address,ip_address,username,upload_bytes,download_bytes,total_bytes,session_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)', [a.mac, a.ip, a.username, a.upload, a.download, a.upload + a.download, a.uptimeSeconds]);
      }
      await q('INSERT INTO voucher_usage(username,mac_address,ip_address,upload_bytes,download_bytes,total_bytes,session_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [a.username, a.mac, a.ip, a.upload, a.download, a.upload + a.download, a.uptimeSeconds]);
    }
    if (fullDue) for (const u of users) if (!activeByUser.has(u.username) && u.upload + u.download > 0)
      await q('INSERT INTO voucher_usage(username,upload_bytes,download_bytes,total_bytes,session_seconds) VALUES($1,$2,$3,$4,$5)', [u.username, u.upload, u.download, u.upload + u.download, u.uptimeSeconds]);

    await q('DELETE FROM active_sessions');
    for (const a of active) await q('INSERT INTO active_sessions(mt_id,username,mac_address,ip_address,login_time,bytes_in,bytes_out) VALUES($1,$2,$3,$4,$5,$6,$7)', [a.mtId, a.username, a.mac, a.ip, new Date(a.seenStart), a.upload, a.download]);
  });

  prevRate = new Map(active.map(a => [a.mtId, { up: a.upload, down: a.download, t: now }]));
  prevActive = new Map(active.map(a => [a.mtId, a]));

  // build API view
  const blockedSet = new Set([...cache.values()].filter(c => c.blocked).map(c => c.username));
  const devHosts = await db(async () => (await q('SELECT mac_address, last_voucher, host_name FROM devices WHERE host_name IS NOT NULL')).rows, []);
  const hostByMac = new Map(devHosts.map(d => [d.mac_address.toUpperCase(), d.host_name]));
  const hostByUser = new Map(devHosts.filter(d => d.last_voucher).map(d => [d.last_voucher, d.host_name]));
  const vouchers = users.map(u => {
    const c = cache.get(u.username) || {};
    const status = voucherStatus(u, blockedSet.has(u.username));
    const total = u.upload + u.download;
    const on = activeByUser.get(u.username)?.[0];
    return { ...u, total, status, expired: isExpired(status), online: !!on, ip: on?.ip || null, mac: on?.mac || u.mac,
      host: on?.host || hostByMac.get((on?.mac || u.mac || '').toUpperCase()) || hostByUser.get(u.username) || null,
      remainingBytes: u.limitBytesTotal ? Math.max(0, u.limitBytesTotal - total) : null,
      remainingSeconds: u.limitUptimeSeconds ? Math.max(0, u.limitUptimeSeconds - u.uptimeSeconds) : null,
      firstLogin: c.first_login || null, lastLogin: c.last_login || null };
  });

  // data-limit enforcement
  for (const v of vouchers) if (v.status === 'DATA LIMIT REACHED' && !cache.get(v.username)?.limit_reached_at) {
    await db(async () => {
      try {
        await ops.disconnect(v.username);
        if (!v.disabled) await ops.disable(v.username);
        await q('UPDATE vouchers_cache SET limit_reached_at=now() WHERE username=$1', [v.username]);
        await audit('system', 'Data limit reached', { voucher: v.username, reason: `${v.total}/${v.limitBytesTotal} bytes` });
        await q(`INSERT INTO security_alerts(username,severity,indicators,action_taken) VALUES($1,'LOW',$2,'disconnected+disabled')`, [v.username, JSON.stringify(['DATA LIMIT REACHED'])]);
      } catch (e) {
        await audit('system', 'Data limit enforcement failed', { voucher: v.username, result: e.message });
      }
    });
  }

  const cap = await db(() => enforceCap(vouchers, active), { events: [], removed: new Set() });
  for (const set of [vouchers, active]) for (let i = set.length - 1; i >= 0; i--) if (cap.removed.has(set[i].username)) set.splice(i, 1);
  cap.events.forEach(ev => {
    io?.emit('cap-event', ev);
    tell(`Voucher ${ev.username} reached the data cap (${(ev.total / 1073741824).toFixed(2)} GiB). Actions: ${ev.steps.join(' > ')}`);
  });

  await db(async () => {
    for (const a of active) if (a.mac) await detectSuspicious(a.username, a.mac, active).catch(e => console.error('detect', e.message));
    const exp = await q(`UPDATE blocked_devices SET active=false WHERE active AND expires_at IS NOT NULL AND expires_at<now() RETURNING mac_address`);
    for (const r of exp.rows) { await ops.unblockMac(r.mac_address).catch(() => {}); await audit('system', 'Temporary block expired', { mac: r.mac_address }); }
  });

  const sum = {
    total: vouchers.length,
    active: vouchers.filter(v => v.status === 'ACTIVE').length,
    expired: vouchers.filter(v => v.expired).length,
    disabled: vouchers.filter(v => v.status === 'DISABLED' || v.status === 'BLOCKED').length,
    activeUsers: new Set(active.map(a => a.username)).size,
    activeDevices: new Set(active.map(a => a.mac)).size,
    upload: users.reduce((n, u) => n + u.upload, 0),
    download: users.reduce((n, u) => n + u.download, 0),
    suspicious: await db(async () => +(await q('SELECT count(*) c FROM security_alerts WHERE NOT resolved')).rows[0].c, 0),
    blockedDevices: await db(async () => +(await q('SELECT count(*) c FROM blocked_devices WHERE active')).rows[0].c, 0)
  };
  sum.totalData = sum.upload + sum.download;

  if (offlineNotified) { offlineNotified = false; tell('Router is back ONLINE.'); }
  fails = 0;

  Object.assign(live, {
    router: { online: true, error: null, identity, ...res, ...(config.connectorMode ? { connectorOnline: true } : {}) },
    system: sys, vouchers, sessions: active, summary: sum, capBytes: config.capBytes,
    lastSync: new Date().toISOString(),
    dbError: dbError ? `Database problem: ${dbError}. Live router data is shown, but history, alerts and limits are not being saved.` : null
  });
}

/* ------------------------------------------------------------------ */
/* 4. ENTRY POINTS                                                      */
/* ------------------------------------------------------------------ */

let queued = null;
let pumpPromise = null;

function pump() {
  if (pumpPromise) return pumpPromise;
  pumpPromise = (async () => {
    try {
      while (queued) {
        const { raw, io } = queued;
        queued = null; // if a newer snapshot arrives while we work, only the newest is kept
        try { await processRaw(raw, io); }
        catch (e) { console.error('Processing snapshot failed:', e); live.dbError = `Internal error: ${e.message}`; }
        finally { io?.emit('update', live); }
      }
    } finally { pumpPromise = null; }
  })();
  return pumpPromise;
}

/** A snapshot arrived (from the laptop connector, or collected locally). Resolves when it is processed. */
export function ingestRaw(raw, io) {
  queued = { raw, io };
  return pump();
}

/** Resolves when nothing is being processed. */
export const idle = () => pumpPromise || Promise.resolve();

let syncing = false;

/** DIRECT mode only: read the router from this process, then process the result. */
export async function syncOnce(io) {
  if (config.connectorMode) return; // Render never reads the router itself
  if (syncing) return;
  syncing = true;
  try {
    let raw;
    try { raw = await collectRaw(); }
    catch (e) { routerFailed(describeRouterError(e), io); return; }
    await ingestRaw(raw, io);
  } finally { syncing = false; }
}

export const startPoller = io => { syncOnce(io); return setInterval(() => syncOnce(io), config.pollInterval * 1000); };
