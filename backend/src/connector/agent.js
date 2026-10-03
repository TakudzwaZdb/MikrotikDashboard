import 'dotenv/config';

import { io } from 'socket.io-client';

import { config } from '../config/index.js';

import {
  live,
  syncOnce,
  startPoller
} from '../jobs/poller.js';

import * as hs from '../services/mikrotik/hotspotService.js';

import {
  disconnectHotspotSession
} from '../services/mikrotik/sessionService.js';

const RENDER_URL =
  process.env.RENDER_URL;

const CONNECTOR_TOKEN =
  process.env.CONNECTOR_TOKEN;

if (!RENDER_URL) {
  throw new Error(
    'RENDER_URL must be configured'
  );
}

if (!CONNECTOR_TOKEN) {
  throw new Error(
    'CONNECTOR_TOKEN must be configured'
  );
}

if (!config.mikrotik.host) {
  throw new Error(
    'MIKROTIK_HOST must be configured'
  );
}

console.log('');
console.log(
  '=========================================='
);
console.log(
  '     MikroTik Dashboard Connector'
);
console.log(
  '=========================================='
);

console.log(
  `Render: ${RENDER_URL}`
);

console.log(
  `MikroTik: ${config.mikrotik.host}:${config.mikrotik.port}`
);

console.log(
  `TLS: ${config.mikrotik.tls}`
);

console.log(
  `Poll interval: ${config.pollInterval}s`
);

console.log(
  '=========================================='
);
console.log('');

/*
 * Connect to the Render connector namespace.
 */
const connector = io(
  `${RENDER_URL}/connector`,
  {
    auth: {
      token: CONNECTOR_TOKEN
    },

    transports: [
      'websocket'
    ],

    reconnection: true,

    reconnectionAttempts:
      Infinity,

    reconnectionDelay:
      3000,

    reconnectionDelayMax:
      15000,

    timeout:
      15000
  }
);

/*
 * The poller expects an object with
 * an emit() function.
 *
 * Every successful sync sends the
 * complete live snapshot to Render.
 */
const fakeIO = {

  emit(event, data) {

    if (
      event === 'update' &&
      connector.connected
    ) {

      connector.emit(
        'update',
        data
      );
    }

    /*
     * Forward cap events to Render.
     */
    if (
      event === 'cap-event' &&
      connector.connected
    ) {

      connector.emit(
        'cap-event',
        data
      );
    }
  }

};

/*
 * Keep a reference to the local poller.
 *
 * This prevents multiple polling
 * intervals from being created if
 * Socket.IO reconnects.
 */
let connectorPoller = null;

/*
 * Commands received from Render.
 */
async function performCommand(
  command,
  args = {}
) {

  switch (command) {

    case 'disconnect-voucher': {

      const name =
        String(args.name);

      return await
        disconnectHotspotSession(
          name
        );
    }

    case 'disable-voucher': {

      const name =
        String(args.name);

      await hs.disableHotspotUser(
        name
      );

      return {};
    }

    case 'enable-voucher': {

      const name =
        String(args.name);

      await hs.enableHotspotUser(
        name
      );

      return {};
    }

    case 'block-voucher': {

      const name =
        String(args.name);

      await hs.disableHotspotUser(
        name
      );

      await disconnectHotspotSession(
        name
      );

      return {};
    }

    case 'unblock-voucher': {

      const name =
        String(args.name);

      await hs.enableHotspotUser(
        name
      );

      return {};
    }

    case 'reset-voucher-usage': {

      const name =
        String(args.name);

      await hs.resetUserCounters(
        name
      );

      return {};
    }

    case 'block-mac': {

      const mac =
        String(args.mac);

      await hs.blockMac(
        mac,
        `dashboard:${
          String(
            args.by || 'remote'
          )
        }`
      );

      if (args.username) {

        await disconnectHotspotSession(
          String(args.username)
        );
      }

      return {};
    }

    case 'unblock-mac': {

      const mac =
        String(args.mac);

      await hs.unblockMac(
        mac
      );

      return {};
    }

    case 'profiles': {

      return await
        hs.getHotspotProfiles();
    }

    case 'sync': {

      await syncOnce(
        fakeIO
      );

      return {
        online:
          live.router.online,

        lastSync:
          live.lastSync
      };
    }

    default:

      throw new Error(
        `Unknown connector command: ${command}`
      );
  }
}

/*
 * Connected to Render.
 */
connector.on(
  'connect',
  async () => {

    console.log('');
    console.log(
      'CONNECTED TO RENDER'
    );

    console.log(
      `Connector socket: ${connector.id}`
    );

    console.log('');

    /*
     * Perform an immediate synchronization.
     */
    try {

      await syncOnce(
        fakeIO
      );

      console.log(
        'Initial MikroTik synchronization completed.'
      );

    } catch (error) {

      console.error(
        'Initial MikroTik sync failed:',
        error.message
      );
    }

    /*
     * Start continuous MikroTik polling.
     *
     * This is the important fix.
     *
     * The connector now synchronizes
     * with MikroTik every config.pollInterval
     * seconds.
     */
    if (!connectorPoller) {

      connectorPoller =
        startPoller(
          fakeIO
        );

      console.log(
        `Continuous MikroTik polling started every ${config.pollInterval}s.`
      );
    }

  }
);

/*
 * Disconnected from Render.
 */
connector.on(
  'disconnect',
  reason => {

    console.log(
      `Disconnected from Render: ${reason}`
    );

  }
);

/*
 * Connection error.
 */
connector.on(
  'connect_error',
  error => {

    console.error(
      `Render connector error: ${error.message}`
    );

  }
);

/*
 * Render asks Windows to perform
 * a MikroTik operation.
 */
connector.on(
  'command',
  async message => {

    const requestId =
      message?.requestId;

    const command =
      message?.command;

    const args =
      message?.args || {};

    if (
      !requestId ||
      !command
    ) {

      return;
    }

    console.log(
      `Remote command: ${command}`
    );

    try {

      const result =
        await performCommand(
          command,
          args
        );

      /*
       * Synchronize dashboard after
       * an operation.
       */
      try {

        await syncOnce(
          fakeIO
        );

      } catch (syncError) {

        console.error(
          'Post-command sync failed:',
          syncError.message
        );

      }

      connector.emit(
        'commandResult',
        {
          requestId,

          ok: true,

          result:
            result ?? {}
        }
      );

    } catch (error) {

      console.error(
        `Command failed (${command}):`,
        error.message
      );

      connector.emit(
        'commandResult',
        {
          requestId,

          ok: false,

          error:
            error.message
        }
      );

    }

  }
);

/*
 * Graceful shutdown.
 */
function shutdown() {

  console.log(
    'Stopping MikroTik connector...'
  );

  /*
   * Stop local polling.
   */
  if (connectorPoller) {

    clearInterval(
      connectorPoller
    );

    connectorPoller =
      null;
  }

  connector.disconnect();

  process.exit(0);
}

process.on(
  'SIGINT',
  shutdown
);

process.on(
  'SIGTERM',
  shutdown
);