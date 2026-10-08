/*
 * MikroTik connector - runs on the laptop that is on the router's network.
 *
 *   router (LAN)  <--RouterOS API-->  THIS PROGRAM  --outgoing websocket-->  Render
 *
 * The connection to Render is OUTGOING, so no port-forwarding, VPN or public
 * IP is needed even if the router sits behind another router.
 *
 *  - every POLL seconds it reads the router and sends the snapshot to Render
 *  - it performs commands sent by the dashboard (disable voucher, block MAC ...)
 *  - it needs NO database and NO JWT_SECRET
 *
 * Settings (.env next to package.json):
 *   RENDER_URL=https://your-service.onrender.com
 *   CONNECTOR_TOKEN=<same value as on Render>
 *   MIKROTIK_HOST / MIKROTIK_PORT / MIKROTIK_USERNAME / MIKROTIK_PASSWORD / MIKROTIK_USE_TLS
 */
import './env.js'; // must stay first: tells config/index.js this is the connector

import 'dotenv/config';

import { io } from 'socket.io-client';

import { config } from '../config/index.js';
import { collectRaw, describeRouterError } from '../services/mikrotik/collect.js';
import { directOps } from '../services/routerOps.js';

const RENDER_URL = String(process.env.RENDER_URL || '').trim().replace(/\/+$/, '');
const CONNECTOR_TOKEN = String(process.env.CONNECTOR_TOKEN || '').trim();

function fatal(message) {
  console.error('');
  console.error(`CONFIG ERROR: ${message}`);
  console.error('');
  process.exit(1);
}

if (!RENDER_URL) fatal('RENDER_URL is not set in .env (e.g. RENDER_URL=https://your-service.onrender.com)');
if (!/^https?:\/\//i.test(RENDER_URL)) fatal(`RENDER_URL must start with https:// (got "${RENDER_URL}")`);
if (!CONNECTOR_TOKEN) fatal('CONNECTOR_TOKEN is not set in .env (it must equal CONNECTOR_TOKEN on Render)');
if (!config.mikrotik.host) fatal('MIKROTIK_HOST is not set in .env (e.g. MIKROTIK_HOST=192.168.88.1)');
if (!config.mikrotik.user) fatal('MIKROTIK_USERNAME is not set in .env');

const POLL_MS = config.pollInterval * 1000;

const stamp = () => new Date().toLocaleTimeString();
const log = (...a) => console.log(`[${stamp()}]`, ...a);

console.log('');
console.log('==========================================');
console.log('     MikroTik Dashboard Connector');
console.log('==========================================');
console.log(`Render:   ${RENDER_URL}`);
console.log(`MikroTik: ${config.mikrotik.host}:${config.mikrotik.port} (TLS ${config.mikrotik.tls ? 'on' : 'off'}, user ${config.mikrotik.user})`);
console.log(`Poll:     every ${config.pollInterval}s`);
console.log('==========================================');
console.log('');

/*
 * node-routeros and sockets can raise errors outside any promise.
 * The connector must never die because of one bad router reply.
 */
process.on('uncaughtException', e => console.error(`[${stamp()}] Unexpected error (connector keeps running):`, e?.message || e));
process.on('unhandledRejection', e => console.error(`[${stamp()}] Unexpected rejection (connector keeps running):`, e?.message || e));

/* ------------------------------------------------------------------ */
/* Connection to Render                                                 */
/* ------------------------------------------------------------------ */

const connector = io(`${RENDER_URL}/connector`, {
  auth: { token: CONNECTOR_TOKEN, version: 2 },

  /* websocket first; long-polling only as a fallback for networks that block websockets */
  transports: ['websocket', 'polling'],

  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 3000,
  reconnectionDelayMax: 15000,

  /* a sleeping Render free instance needs up to ~60 s to wake up */
  timeout: 70000,

  perMessageDeflate: { threshold: 1024 }
});

/* ------------------------------------------------------------------ */
/* Reading the router and sending snapshots                             */
/* ------------------------------------------------------------------ */

let collecting = null;
let routerWasOk = null;

/** Read the router once and send the result (or the error) to Render. Never throws. */
function collectAndSend(reason = 'poll') {
  if (!connector.connected) return Promise.resolve(false);
  if (collecting) return collecting; // never two reads at once

  collecting = (async () => {
    try {
      const raw = await collectRaw();

      if (routerWasOk !== true) {
        log(`Router OK - ${raw.identity || 'MikroTik'} (${raw.users.length} vouchers, ${raw.active.length} online). Sending to Render.`);
      }
      routerWasOk = true;

      if (connector.connected) connector.emit('raw', raw);
      return true;
    } catch (e) {
      const why = describeRouterError(e);

      if (routerWasOk !== false) {
        log(`ROUTER NOT REACHABLE: ${why}`);
      }
      routerWasOk = false;

      if (connector.connected) connector.emit('routerError', { message: why });
      return false;
    } finally {
      collecting = null;
    }
  })();

  return collecting;
}

/* poll loop - started once, runs for the life of the process */
setInterval(() => { collectAndSend('poll'); }, POLL_MS);

connector.on('connect', () => {
  log(`CONNECTED TO RENDER (socket ${connector.id})`);
  collectAndSend('connect');
});

connector.on('disconnect', reason => {
  log(`Disconnected from Render: ${reason}`);

  if (reason === 'io server disconnect') {
    /* The server only does this when a NEWER connector connected. Reconnecting would start a tug-of-war
       between two copies, so this copy stops. (exit code 3 tells windows\connector.bat not to restart it) */
    log('Another connector connected to the same server and took over. Only ONE connector may run - this copy is stopping.');
    process.exit(3);
  } else if (reason === 'ping timeout') {
    log('No reply from Render for 60 s (slow or unstable internet). Reconnecting...');
  } else if (reason === 'transport close' || reason === 'transport error') {
    log('Connection dropped (network, or Render restarting). Reconnecting...');
  }
});

let lastConnectError = '';
connector.on('connect_error', error => {
  const msg = error?.message || String(error);

  /* print each distinct problem once, then every 10th repeat */
  if (msg !== lastConnectError) {
    lastConnectError = msg;
    log(`Cannot connect to Render: ${msg}`);

    if (/unauthorized/i.test(msg)) {
      log('=> CONNECTOR_TOKEN on this laptop is different from CONNECTOR_TOKEN on Render, or it is not set on Render. Make them identical.');
    } else if (/xhr poll error|websocket error|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
      log(`=> Check the internet connection and that RENDER_URL (${RENDER_URL}) is exactly your Render address. A sleeping Render service can take about a minute to wake up.`);
    }
  }
});

connector.io.on('reconnect', () => { lastConnectError = ''; });

/* ------------------------------------------------------------------ */
/* Commands from the dashboard                                          */
/* ------------------------------------------------------------------ */

const str = v => {
  const s = String(v ?? '').trim();
  if (!s) throw new Error('Missing value');
  return s;
};

async function performCommand(command, args = {}) {
  switch (command) {

    case 'disconnect-voucher':
      return await directOps.disconnect(str(args.name));

    case 'disable-voucher':
      await directOps.disable(str(args.name));
      return {};

    case 'enable-voucher':
      await directOps.enable(str(args.name));
      return {};

    case 'remove-voucher':
      await directOps.remove(str(args.name));
      return {};

    case 'block-voucher': {
      const name = str(args.name);
      await directOps.disable(name);
      await directOps.disconnect(name);
      return {};
    }

    case 'unblock-voucher':
      await directOps.enable(str(args.name));
      return {};

    case 'reset-voucher-usage':
      await directOps.resetUsage(str(args.name));
      return {};

    case 'block-mac':
      await directOps.blockMac(str(args.mac), String(args.comment || `dashboard:${args.by || 'remote'}`));
      return {};

    case 'unblock-mac':
      await directOps.unblockMac(str(args.mac));
      return {};

    case 'profiles':
      return await directOps.profiles();

    case 'sync': {
      const ok = await collectAndSend('sync');
      return { online: ok };
    }

    default:
      throw new Error(`Unknown connector command: ${command}`);
  }
}

connector.on('command', async message => {
  const requestId = message?.requestId;
  const command = message?.command;
  const args = message?.args || {};

  if (!requestId || !command) return;

  log(`Command from dashboard: ${command}`);

  try {
    const result = await performCommand(command, args);

    /* send the fresh router state BEFORE the answer, so the dashboard shows the change immediately */
    if (command !== 'sync' && command !== 'profiles') {
      await collectAndSend('after-command');
    }

    connector.emit('commandResult', { requestId, ok: true, result: result ?? {} });
  } catch (error) {
    const why = describeRouterError(error);
    log(`Command failed (${command}): ${why}`);
    connector.emit('commandResult', { requestId, ok: false, error: why });
  }
});

/* ------------------------------------------------------------------ */
/* Keep a free Render instance awake                                    */
/* ------------------------------------------------------------------ */

if (String(process.env.KEEPALIVE || 'true').toLowerCase() !== 'false') {
  setInterval(() => {
    fetch(`${RENDER_URL}/health`, { signal: AbortSignal.timeout(20000) }).catch(() => { /* offline - ignore */ });
  }, 10 * 60 * 1000);
}

/* ------------------------------------------------------------------ */
/* Shutdown                                                             */
/* ------------------------------------------------------------------ */

function shutdown() {
  console.log('Stopping MikroTik connector...');
  connector.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
