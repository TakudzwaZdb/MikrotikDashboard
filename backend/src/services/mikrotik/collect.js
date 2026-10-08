/*
 * Reads everything the dashboard needs from the router and returns plain JSON.
 * NO database, NO socket: used by the laptop connector and by direct mode alike.
 */
import util from 'util';
import { config } from '../../config/index.js';
import { getHotspotUsers } from './hotspotService.js';
import { getHostNames } from './deviceService.js';
import { getActiveHotspotUsers } from './sessionService.js';
import { getRouterResources, getIdentity, getSystemDetails } from './routerService.js';

let sysCache = null;
let lastSys = 0;

/**
 * node-routeros errors are awkward: a refused connection has an EMPTY message and only a
 * numeric errno (-111 on Linux, -4078 on Windows). Turn whatever we get into readable text.
 */
export function errText(e) {
  let code = e?.code ?? e?.errno;
  if (typeof code === 'number') {
    try { code = util.getSystemErrorName(code); } catch { code = String(code); }
  }
  const msg = String(e?.message || '').trim();
  const text = [code, msg].filter(Boolean).join(': ');
  return text || String(e?.name || 'unknown error');
}

/** Human readable reason for a router error (uses THIS process's MIKROTIK_* settings). */
export function describeRouterError(e) {
  const m = config.mikrotik;
  const msg = errText(e);
  const where = `${m.host || '(MIKROTIK_HOST not set)'}:${m.port}`;

  if (/SOCKTMOUT|timed out|timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN/i.test(msg)) {
    return `TIMEOUT: the router did not answer at ${where} (${msg}). Check: (1) MIKROTIK_HOST/MIKROTIK_PORT; (2) this computer is on the router's network (ping ${m.host || 'the router'}); (3) /ip service api is enabled and its "available from" address allows this computer; (4) MIKROTIK_USE_TLS matches the port - plain API 8728 needs false, API-SSL 8729 needs true (now ${m.tls ? 'true' : 'false'}); a mismatch looks exactly like a timeout.`;
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return `Router refused the connection at ${where}. The API service is disabled or uses another port (on the router: /ip service print).`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return `Router address not found: ${m.host}. Use the router's IP address (e.g. 192.168.88.1).`;
  }
  if (/CANTLOGIN|invalid user name or password|cannot log in/i.test(msg)) {
    return `Router rejected the login for user "${m.user}" at ${where}. Check MIKROTIK_USERNAME / MIKROTIK_PASSWORD and that the user's group has api, read, write policies.`;
  }
  if (/SSL|TLS|certificate|wrong version|EPROTO/i.test(msg)) {
    return `TLS problem talking to ${where} (${msg}). Plain API is port 8728 with MIKROTIK_USE_TLS=false; API-SSL is 8729 with MIKROTIK_USE_TLS=true.`;
  }
  if (/ECONNRESET|STREAMCLOSD|EPIPE/i.test(msg)) {
    return `The router closed the connection at ${where} (${msg}). Usually the API user is not allowed from this address, or the router is overloaded/rebooting.`;
  }
  if (msg === 'RosException' || !msg) {
    return `The router connection failed without details at ${where}. The most common cause is MIKROTIK_USE_TLS not matching the port (plain API = port 8728 with MIKROTIK_USE_TLS=false; API-SSL = 8729 with MIKROTIK_USE_TLS=true; it is currently ${m.tls ? 'true' : 'false'}).`;
  }
  return `${msg} (router ${where})`;
}

/**
 * Read everything the dashboard needs from the router. Plain JSON out
 * (Maps are converted to arrays so it can travel over the socket).
 */
export async function collectRaw() {
  const res = await getRouterResources(); // first call fails fast when the router is unreachable
  const [identity, users, active] = await Promise.all([getIdentity(), getHotspotUsers(), getActiveHotspotUsers()]);
  const hosts = await getHostNames();

  if (Date.now() - lastSys > 30000) {
    lastSys = Date.now();
    try { sysCache = await getSystemDetails(); } catch { /* optional data */ }
  }

  return {
    ts: Date.now(),
    res,
    identity,
    users,
    active,
    sys: sysCache,
    hosts: { byMac: [...hosts.byMac], byIp: [...hosts.byIp] }
  };
}
