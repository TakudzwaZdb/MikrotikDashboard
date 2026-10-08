/*
 * Bridge between the web server (Render) and the laptop connector.
 *
 * Holds the one active connector socket and lets the server send
 * commands to it ("disable this voucher", "sync now" ...).
 * It deliberately imports nothing from the poller so it can be used
 * from anywhere without circular imports.
 */

const pending = new Map();

let connectorSocket = null;

export const setConnectorSocket = socket => {
  connectorSocket = socket;
};

export const getConnectorSocket = () => connectorSocket;

export const connectorAvailable = () =>
  !!(connectorSocket && connectorSocket.connected);

const makeRequestId = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

/**
 * Send a command to the laptop and wait for its answer.
 * The laptop talks to the router, so a command can legitimately take
 * a few seconds (RouterOS connect + print + set + verify).
 */
export function connectorCommand(command, args = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!connectorAvailable()) {
      return reject(
        new Error(
          'The MikroTik connector (laptop) is not connected to the server. ' +
          'Start it on the laptop with "npm run connector".'
        )
      );
    }

    const requestId = makeRequestId();

    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(
        new Error(
          `The laptop connector did not answer "${command}" within ${Math.round(timeout / 1000)} s ` +
          '(the router may be slow or unreachable from the laptop).'
        )
      );
    }, timeout);

    pending.set(requestId, { resolve, reject, timer });

    connectorSocket.emit('command', { requestId, command, args });
  });
}

/** Called by the socket layer when the connector answers a command. */
export function resolveCommand(message) {
  const requestId = message?.requestId;
  const entry = requestId && pending.get(requestId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(requestId);

  if (message.ok) entry.resolve(message.result || {});
  else entry.reject(new Error(message.error || 'Connector command failed'));
}

/** Fail every waiting command (the connector went away). */
export function rejectAllCommands(reason) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
    pending.delete(id);
  }
}
