import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

import { config } from '../config/index.js';
import { live } from '../jobs/poller.js';

const pendingCommands = new Map();

let connectorSocket = null;

function makeRequestId() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2)
  );
}

export function connectorAvailable() {
  return !!(
    connectorSocket &&
    connectorSocket.connected
  );
}

export function connectorCommand(
  command,
  args = {},
  timeout = 15000
) {
  return new Promise((resolve, reject) => {

    if (!connectorAvailable()) {
      return reject(
        new Error('MikroTik connector is offline')
      );
    }

    const requestId = makeRequestId();

    const timer = setTimeout(() => {

      pendingCommands.delete(requestId);

      reject(
        new Error(
          `Connector command timed out: ${command}`
        )
      );

    }, timeout);

    pendingCommands.set(requestId, {
      resolve,
      reject,
      timer
    });

    connectorSocket.emit('command', {
      requestId,
      command,
      args
    });
  });
}

export function initSocket(server) {

  const io = new Server(server, {
    cors: {
      origin: config.corsOrigin
    }
  });

  /*
   * Normal dashboard/browser WebSocket authentication.
   */
  io.use((socket, next) => {

    try {

      jwt.verify(
        socket.handshake.auth?.token,
        config.jwtSecret
      );

      next();

    } catch {

      next(
        new Error('unauthorized')
      );
    }
  });

  io.on('connection', socket => {

    socket.emit('update', live);

  });

  /*
   * Dedicated connector namespace.
   *
   * This is NOT authenticated using the user's
   * dashboard JWT. It uses CONNECTOR_TOKEN.
   */
  const connectorNamespace =
    io.of('/connector');

  connectorNamespace.use(
    (socket, next) => {

      const supplied =
        socket.handshake.auth?.token;

      if (
        !config.connectorToken ||
        !supplied ||
        supplied !== config.connectorToken
      ) {
        return next(
          new Error('connector unauthorized')
        );
      }

      next();
    }
  );

  connectorNamespace.on(
    'connection',
    socket => {

      console.log(
        'MikroTik connector connected:',
        socket.id
      );

      connectorSocket = socket;

      live.router = {
        ...(live.router || {}),
        connectorOnline: true
      };

      io.emit('update', live);

      socket.on(
        'update',
        snapshot => {

          if (
            snapshot &&
            typeof snapshot === 'object'
          ) {

            Object.assign(
              live,
              snapshot
            );

            live.router = {
              ...(live.router || {}),
              connectorOnline: true
            };

            io.emit(
              'update',
              live
            );
          }
        }
      );

      socket.on(
        'commandResult',
        message => {

          const requestId =
            message?.requestId;

          if (!requestId) {
            return;
          }

          const pending =
            pendingCommands.get(requestId);

          if (!pending) {
            return;
          }

          clearTimeout(
            pending.timer
          );

          pendingCommands.delete(
            requestId
          );

          if (message.ok) {

            pending.resolve(
              message.result || {}
            );

          } else {

            pending.reject(
              new Error(
                message.error ||
                'Connector command failed'
              )
            );
          }
        }
      );

      socket.on(
        'disconnect',
        reason => {

          console.log(
            'MikroTik connector disconnected:',
            reason
          );

          if (
            connectorSocket === socket
          ) {
            connectorSocket = null;
          }

          live.router = {
            ...(live.router || {}),
            online: false,
            connectorOnline: false,
            error:
              'Windows MikroTik connector disconnected'
          };

          io.emit(
            'update',
            live
          );
        }
      );
    }
  );

  return io;
}