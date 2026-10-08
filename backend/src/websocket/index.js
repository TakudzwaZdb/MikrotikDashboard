import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

import { config } from '../config/index.js';
import { live, ingestRaw, routerFailed, forceOffline } from '../jobs/poller.js';
import {
  setConnectorSocket,
  getConnectorSocket,
  resolveCommand,
  rejectAllCommands
} from '../connector/bridge.js';

// Re-exported so older imports keep working.
export { connectorAvailable, connectorCommand } from '../connector/bridge.js';

/* the router is shown OFFLINE only if the connector stays away this long (a quick reconnect must not flicker the dashboard) */
const GRACE_MS = 45000;
let offlineTimer = null;

/** Constant-time token comparison. */
function tokenOk(supplied) {
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(String(config.connectorToken || ''));
  return !!config.connectorToken && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function initSocket(server) {

  const io = new Server(server, {
    cors: {
      origin: config.corsOrigin
    },

    /*
     * The connector sends the complete MikroTik snapshot (all vouchers,
     * sessions, DHCP leases...) in ONE message. Socket.IO's default limit
     * is 1 MB: anything bigger makes the server drop the connection
     * ("transport close"), the connector reconnects, sends the same big
     * snapshot again and is dropped again - an endless loop.
     */
    maxHttpBufferSize: 64 * 1024 * 1024,

    /* compress big messages (snapshots shrink ~10x) */
    perMessageDeflate: {
      threshold: 1024
    },

    /* tolerate a slow / busy laptop or a bad link */
    pingInterval: 20000,
    pingTimeout: 60000
  });

  /*
   * Normal dashboard/browser WebSocket authentication.
   * (io.use applies to the main "/" namespace only.)
   */
  io.use((socket, next) => {
    try {
      jwt.verify(socket.handshake.auth?.token, config.jwtSecret);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', socket => {
    socket.emit('update', live);
  });

  /*
   * Dedicated connector namespace. NOT authenticated with a user JWT:
   * it uses CONNECTOR_TOKEN.
   */
  const connectorNamespace = io.of('/connector');

  connectorNamespace.use((socket, next) => {
    if (!config.connectorToken) {
      return next(new Error('connector unauthorized: CONNECTOR_TOKEN is not set on the server'));
    }
    if (!tokenOk(socket.handshake.auth?.token)) {
      return next(new Error('connector unauthorized: CONNECTOR_TOKEN does not match the server'));
    }
    next();
  });

  connectorNamespace.on('connection', socket => {

    const version = +socket.handshake.auth?.version || 1;

    console.log(`MikroTik connector connected: ${socket.id} (protocol v${version})`);

    /* only one connector at a time: the newest wins */
    const previous = getConnectorSocket();
    if (previous && previous.id !== socket.id && previous.connected) {
      console.warn('A second connector connected - closing the older one. Run only ONE connector.');
      previous.disconnect(true);
    }

    setConnectorSocket(socket);
    clearTimeout(offlineTimer);

    if (version < 2) {
      live.router = {
        ...(live.router || {}),
        online: false,
        connectorOnline: true,
        error: 'The laptop connector is an old version. Replace the project on the laptop with the updated one and run "npm run connector" again.'
      };
      io.emit('update', live);
      return;
    }

    live.router = {
      ...(live.router || {}),
      connectorOnline: true,
      stale: false,
      ...(live.router?.online
        ? {}
        : { error: 'Connector connected - reading the router...' })
    };
    io.emit('update', live);

    /* a full router snapshot from the laptop */
    socket.on('raw', raw => {
      if (raw && typeof raw === 'object') {
        ingestRaw(raw, io).catch(e => console.error('ingest failed:', e.message));
      }
    });

    /* the laptop is connected but could not read the router */
    socket.on('routerError', message => {
      live.router = { ...(live.router || {}), connectorOnline: true };
      routerFailed(String(message?.message || 'Router not reachable from the laptop'), io);
    });

    socket.on('commandResult', resolveCommand);

    socket.on('disconnect', reason => {

      console.log('MikroTik connector disconnected:', reason);

      /* an OLD socket closing after a newer one took over must change nothing */
      if (getConnectorSocket() !== socket) {
        return;
      }

      setConnectorSocket(null);
      rejectAllCommands('The laptop connector disconnected');

      /* keep showing the last data during a brief drop */
      live.router = {
        ...(live.router || {}),
        connectorOnline: false,
        stale: true
      };

      clearTimeout(offlineTimer);

      offlineTimer = setTimeout(() => {
        if (getConnectorSocket()) {
          return;
        }
        live.router = { ...(live.router || {}), connectorOnline: false };
        forceOffline(
          'The laptop connector is not connected to this server. Check that the laptop is on, online, and "npm run connector" is running.',
          io
        );
      }, GRACE_MS);

      io.emit('update', live);
    });
  });

  return io;
}
